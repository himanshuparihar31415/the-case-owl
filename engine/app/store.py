"""The engine's own data (docs/engine-contract.md, section 5): engine_cases, engine_sessions and
session_events, in the engine's own database. The engine never touches the platform's collections.

`MemoryStore` serves development and tests, preloaded with cases/*.json (case id = file name);
`MongoStore` is production.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

import certifi

CASES_DIR = Path(__file__).resolve().parents[1] / "cases"
LIVE_STATES = ("connecting", "live", "awaiting_reoffer", "ending")
SETTLE_OWED = ("pending", "retrying")  # an ended interview whose transcript Node has not acknowledged
EVENTS_TTL = timedelta(days=90)


def case_files() -> list[dict]:
    """The checked-in cases, as published engine_cases documents. `contentHash` lets a startup publish a
    changed file as a new version without touching cases that came from anywhere else."""
    docs = []
    for path in sorted(CASES_DIR.glob("*.json")):
        text = path.read_text()
        docs.append({"caseId": path.stem, "version": 1, "status": "published", **json.loads(text),
                     "source": "file", "contentHash": hashlib.sha256(text.encode()).hexdigest()[:16]})
    return docs


def owes_work(doc: dict) -> bool:
    """Still needs an owner: the interview is live, or Node is still owed its transcript."""
    return doc.get("state") in LIVE_STATES or (
        doc.get("state") == "ended" and (doc.get("settle") or {}).get("status") in SETTLE_OWED)


def lease_free(doc: dict, now: datetime) -> bool:
    """Released at a hand-off (None), or lapsed because the owner stopped renewing it."""
    return doc.get("leaseUntil") is None or doc["leaseUntil"] < now


class Store(Protocol):
    async def get_case(self, case_id: str) -> dict | None: ...
    async def put_case(self, doc: dict) -> None: ...
    async def sync_file_cases(self, docs: list[dict]) -> list[str]: ...
    async def save_session(self, doc: dict) -> None: ...
    async def get_session(self, call_id: str) -> dict | None: ...
    async def claimable(self, now: datetime) -> list[str]: ...
    async def claim(self, call_id: str, owner: str, lease_until: datetime, now: datetime) -> dict | None: ...
    async def add_events(self, events: list[dict]) -> None: ...
    async def close(self) -> None: ...


def next_file_version(latest: dict | None, doc: dict) -> int | None:
    """The version to publish a checked-in case as, or None to leave it: unchanged, or the latest
    version was not made from the file (phase 2 generates cases straight into the database)."""
    if latest is None:
        return 1
    if latest.get("source") != "file" or latest.get("contentHash") == doc["contentHash"]:
        return None
    return latest["version"] + 1


class MemoryStore:
    def __init__(self, seed: bool = True):
        self.cases: dict[tuple[str, int], dict] = {}
        self.sessions: dict[str, dict] = {}
        self.events: list[dict] = []
        if seed:
            for doc in case_files():
                self.cases[(doc["caseId"], doc["version"])] = doc

    async def get_case(self, case_id: str) -> dict | None:
        published = [d for (cid, _), d in self.cases.items() if cid == case_id and d.get("status") == "published"]
        return copy.deepcopy(max(published, key=lambda d: d["version"])) if published else None

    async def put_case(self, doc: dict) -> None:
        self.cases[(doc["caseId"], doc["version"])] = copy.deepcopy(doc)

    async def sync_file_cases(self, docs: list[dict]) -> list[str]:
        published = []
        for doc in docs:
            versions = [d for (cid, _), d in self.cases.items() if cid == doc["caseId"]]
            version = next_file_version(max(versions, key=lambda d: d["version"]) if versions else None, doc)
            if version is not None:
                await self.put_case({**doc, "version": version})
                published.append(f"{doc['caseId']} v{version}")
        return published

    async def save_session(self, doc: dict) -> None:
        self.sessions[doc["callId"]] = copy.deepcopy(doc)

    async def get_session(self, call_id: str) -> dict | None:
        return copy.deepcopy(self.sessions.get(call_id))

    async def claimable(self, now: datetime) -> list[str]:
        return [d["callId"] for d in self.sessions.values() if owes_work(d) and lease_free(d, now)]

    async def claim(self, call_id: str, owner: str, lease_until: datetime, now: datetime) -> dict | None:
        doc = self.sessions.get(call_id)
        if not doc or not owes_work(doc) or not lease_free(doc, now):
            return None
        doc.update(owner=owner, leaseUntil=lease_until)
        return copy.deepcopy(doc)

    async def add_events(self, events: list[dict]) -> None:
        self.events.extend(copy.deepcopy(events))

    async def close(self) -> None:
        return None


class MongoStore:
    def __init__(self, uri: str, db_name: str):
        from pymongo import AsyncMongoClient  # imported here so tests and development need no Mongo

        # Atlas (TLS): verify against certifi's CA bundle. Python's own list fails on python.org builds
        # ("unable to get local issuer certificate", seen 24 Oct); the bundle comes with httpx.
        tls = uri.startswith("mongodb+srv://") or re.search(r"[?&](tls|ssl)=true", uri, re.I) is not None
        extra = {"tlsCAFile": certifi.where()} if tls else {}
        self.client = AsyncMongoClient(uri, tz_aware=True, **extra)
        db = self.client[db_name]
        self.cases, self.sessions, self.events = db["engine_cases"], db["engine_sessions"], db["session_events"]

    async def setup(self) -> None:
        await self.cases.create_index([("caseId", 1), ("version", -1)], unique=True)
        await self.sessions.create_index("callId", unique=True)
        await self.sessions.create_index("sessionId")
        await self.sessions.create_index("state")
        await self.events.create_index([("sessionId", 1), ("t", 1)])
        await self.events.create_index("at", expireAfterSeconds=int(EVENTS_TTL.total_seconds()))

    async def get_case(self, case_id: str) -> dict | None:
        return await self.cases.find_one({"caseId": case_id, "status": "published"}, {"_id": 0},
                                         sort=[("version", -1)])

    async def put_case(self, doc: dict) -> None:
        await self.cases.replace_one({"caseId": doc["caseId"], "version": doc["version"]}, doc, upsert=True)

    async def sync_file_cases(self, docs: list[dict]) -> list[str]:
        from pymongo.errors import DuplicateKeyError

        published = []
        for doc in docs:
            latest = await self.cases.find_one({"caseId": doc["caseId"]}, {"_id": 0, "version": 1, "source": 1,
                                                                            "contentHash": 1}, sort=[("version", -1)])
            version = next_file_version(latest, doc)
            if version is None:
                continue
            try:  # insert, never replace: two instances starting together publish it once
                await self.cases.insert_one({**doc, "version": version})
                published.append(f"{doc['caseId']} v{version}")
            except DuplicateKeyError:
                pass
        return published

    async def save_session(self, doc: dict) -> None:
        await self.sessions.replace_one({"callId": doc["callId"]}, doc, upsert=True)

    async def get_session(self, call_id: str) -> dict | None:
        return await self.sessions.find_one({"callId": call_id}, {"_id": 0})

    @staticmethod
    def _claimable_filter(now: datetime) -> dict:
        return {"$and": [
            {"$or": [{"state": {"$in": list(LIVE_STATES)}},
                     {"state": "ended", "settle.status": {"$in": list(SETTLE_OWED)}}]},
            {"$or": [{"leaseUntil": None}, {"leaseUntil": {"$lt": now}}]}]}

    async def claimable(self, now: datetime) -> list[str]:
        return [d["callId"] async for d in self.sessions.find(self._claimable_filter(now), {"_id": 0, "callId": 1})]

    async def claim(self, call_id: str, owner: str, lease_until: datetime, now: datetime) -> dict | None:
        """Atomic: only one instance takes over an interview that was handed off or whose owner stopped
        renewing its lease."""
        return await self.sessions.find_one_and_update(
            {"callId": call_id, **self._claimable_filter(now)},
            {"$set": {"owner": owner, "leaseUntil": lease_until}}, projection={"_id": 0},
            return_document=True)

    async def add_events(self, events: list[dict]) -> None:
        if events:
            now = datetime.now(timezone.utc)
            await self.events.insert_many([{**e, "at": e.get("at", now)} for e in events])

    async def close(self) -> None:
        await self.client.close()
