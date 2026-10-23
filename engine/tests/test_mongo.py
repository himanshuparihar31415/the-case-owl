"""MongoStore against a real Mongo. Skipped unless ENGINE_TEST_MONGO_URI is set; never point it at the
platform's database. Each run uses a throwaway database and drops it.

    docker run -d -p 27017:27017 --name engine-mongo mongo:7
    ENGINE_TEST_MONGO_URI=mongodb://localhost:27017 uv run pytest tests/test_mongo.py
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import timedelta

import pytest

from app.runtime.interview import utcnow
from app.store import MongoStore, case_files

URI = os.environ.get("ENGINE_TEST_MONGO_URI", "")
pytestmark = pytest.mark.skipif(not URI, reason="set ENGINE_TEST_MONGO_URI to run against a real Mongo")


@pytest.fixture
async def store():
    db = f"engine_test_{uuid.uuid4().hex[:8]}"
    st = MongoStore(URI, db)
    await st.setup()
    try:
        yield st
    finally:
        await st.client.drop_database(db)
        await st.close()


async def test_the_latest_published_case_is_served(store):
    doc = next(d for d in case_files() if d["caseId"] == "coffee")
    await store.put_case({**doc, "version": 1})
    await store.put_case({**doc, "version": 2, "statement": "A newer statement."})
    await store.put_case({**doc, "version": 3, "status": "draft", "statement": "Not yet."})
    got = await store.get_case("coffee")
    assert (got["version"], got["statement"]) == (2, "A newer statement.")
    assert await store.get_case("nope") is None


async def test_sessions_round_trip_with_datetimes(store):
    now = utcnow()
    await store.save_session({"callId": "rtc_1", "sessionId": "s1", "state": "live", "startedAt": now,
                              "leaseUntil": now + timedelta(seconds=30),
                              "ledger": [{"item_id": "i1", "role": "interviewer", "text": "Hi.", "at": now}]})
    got = await store.get_session("rtc_1")
    assert got["startedAt"].tzinfo is not None and abs((got["startedAt"] - now).total_seconds()) < 0.01
    assert await store.claimable(now) == []  # its owner holds a fresh lease


async def test_handed_off_lapsed_and_unsettled_interviews_are_claimable(store):
    now = utcnow()
    docs = {"handed_off": {"state": "live", "leaseUntil": None},
            "lapsed": {"state": "ending", "leaseUntil": now - timedelta(seconds=1)},
            "settle_owed": {"state": "ended", "leaseUntil": None, "settle": {"status": "retrying"}},
            "held": {"state": "live", "leaseUntil": now + timedelta(seconds=30)},
            "settled": {"state": "ended", "leaseUntil": None, "settle": {"status": "acked"}},
            "given_up": {"state": "ended", "leaseUntil": None, "settle": {"status": "failed"}}}
    for call_id, doc in docs.items():
        await store.save_session({"callId": call_id, **doc})
    assert sorted(await store.claimable(now)) == ["handed_off", "lapsed", "settle_owed"]
    assert (await store.claim("settled", "me", now + timedelta(seconds=30), now)) is None


async def test_checked_in_cases_publish_once(store):
    coffee = [d for d in case_files() if d["caseId"] == "coffee"]
    assert await store.sync_file_cases(coffee) == ["coffee v1"]
    assert await asyncio.gather(store.sync_file_cases(coffee), store.sync_file_cases(coffee)) == [[], []]
    edited = {**coffee[0], "statement": "Edited.", "contentHash": "edited"}
    assert await store.sync_file_cases([edited]) == ["coffee v2"]
    assert (await store.get_case("coffee"))["statement"] == "Edited."


async def test_only_one_instance_wins_a_claim(store):
    now = utcnow()
    await store.save_session({"callId": "rtc_2", "state": "live", "owner": "old", "leaseUntil": now - timedelta(seconds=5)})
    results = await asyncio.gather(*(store.claim("rtc_2", f"instance_{i}", now + timedelta(seconds=30), now)
                                     for i in range(5)))
    winners = [r for r in results if r]
    assert len(winners) == 1 and winners[0]["owner"].startswith("instance_")
    assert await store.claim("rtc_2", "late", now + timedelta(seconds=30), now) is None  # the lease is fresh now


async def test_events_are_stored(store):
    await store.add_events([{"sessionId": "s1", "callId": "rtc_1", "type": "turn", "payload": {}, "t": 5}])
    assert await store.events.count_documents({"sessionId": "s1"}) == 1
