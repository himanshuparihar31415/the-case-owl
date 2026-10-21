"""The fact gate (the plan's accuracy rule, pulled into the spike): the interviewer holds only the case
statement. Everything else she learns from lookup_fact, one fact at a time, at the level of detail the
candidate asked about.

Facts form a tree (cases/*.json): a broad fact ("variable costs rose") sits above the detail under it
("bean costs rose 35 percent") and the cause under that ("a new supplier"). A broad question gets the
broad fact and nothing below it, so the candidate has to dig, as with a real interviewer.

`match()` is a small LLM call that sees only what each fact covers, never the answers. `release()` is
plain code: prerequisites and the released set. Shared by server.py and evals.py.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

try:
    import aiohttp
except ImportError:  # the unit tests run without dependencies; only match() needs it
    aiohttp = None

HERE = Path(__file__).resolve().parent
MATCH_MODEL = os.environ.get("FACT_MODEL", "gpt-5.4-nano")  # 48/48 on the granularity bench, fastest
MATCH_TIMEOUT_S = 3.0
MATCH_PROMPT = """You match a candidate's question in a case interview to the interviewer's fact sheet. Each fact has an id, the broader fact it sits under, and what it covers.
- Pick the fact that answers exactly what was asked, at the same level of detail. A broad question gets the broad fact, never the more detailed facts under it.
- You get the interviewer's restatement and, when available, the candidate's own words (transcribed, so they may contain errors). The level of detail is the candidate's: never go deeper than their words.
- Pick two facts only if the question explicitly asks about both.
- "not_data": they ask for an opinion, a hint, a confirmation of their idea or what to do, not for information.
- "unknown": no fact covers it.
Reply with JSON only: {"status": "match" | "not_data" | "unknown", "fact_ids": ["<exact id string>", ...]}"""

# What the interviewer is told to do with each outcome. She speaks after the tool returns.
SAY = {
    "answer": "Tell them only this, in your own words, and nothing more. Then hand back to them.",
    "declined": "Do not confirm or deny. Ask what makes them think so.",
    "not_data": "This is not a request for case data. Give no opinion or hint; turn it back to them.",
    "unknown": "You do not have that information. Say so briefly and ask what they would assume.",
    "unavailable": "You cannot check that right now. Ask what they would assume for now.",
}


@dataclass
class Fact:
    id: str
    parent: str | None
    covers: str
    answer: str
    terms: list[str] = field(default_factory=list)
    requires: list[str] = field(default_factory=list)


@dataclass
class Case:
    id: str
    statement: str
    facts: dict[str, Fact]
    leads: list[dict]


def load(name: str = "coffee") -> Case:
    raw = json.loads((HERE / "cases" / f"{name}.json").read_text())
    facts = {f["id"]: Fact(f["id"], f.get("parent"), f["covers"], f["answer"], f.get("terms", []),
                           f.get("requires", [])) for f in raw["facts"]}
    return Case(raw["id"], raw["statement"], facts, raw.get("leads", []))


def chat_body(model: str, system: str, user: str, max_tokens: int) -> dict:
    """A JSON-mode chat request that works across model families: reasoning models (gpt-5.x, the Luna
    models) take reasoning_effort and no temperature; older ones take temperature."""
    reasoning = model.startswith(("gpt-5", "gpt-6", "o"))
    return {"model": model, "max_completion_tokens": max_tokens, "response_format": {"type": "json_object"},
            **({"reasoning_effort": os.environ.get("SMALL_MODEL_REASONING", "none")} if reasoning
               else {"temperature": 0}),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}


def sheet(case: Case) -> str:
    """The fact sheet the matcher sees: ids, tree position and coverage. No answers."""
    return "\n".join(f'id "{f.id}" | under "{f.parent or "case"}" | covers: {f.covers}' for f in case.facts.values())


async def match(http: "aiohttp.ClientSession", headers: dict, case: Case, question: str, said: str = "",
                model: str | None = None) -> dict:
    words = f"\nCandidate's words: {said}" if said.strip() else ""
    body = chat_body(model or MATCH_MODEL, MATCH_PROMPT,
                     f"Facts:\n{sheet(case)}\n\nInterviewer's restatement: {question}{words}", 80)
    async with http.post("https://api.openai.com/v1/chat/completions", json=body, headers=headers,
                         timeout=aiohttp.ClientTimeout(total=MATCH_TIMEOUT_S)) as r:
        data = await r.json()
    if r.status != 200:
        raise ValueError((data.get("error") or {}).get("message", f"HTTP {r.status}"))
    verdict = json.loads(data["choices"][0]["message"]["content"])
    if verdict.get("status") not in ("match", "not_data", "unknown"):
        raise ValueError(f"unexpected status {verdict.get('status')!r}")
    return verdict


def release(case: Case, verdict: dict, released: set[str]) -> dict:
    """Policy in code: which matched facts may be told now. Marks them released."""
    if verdict["status"] != "match":
        return {"status": verdict["status"], "facts": [], "say": SAY[verdict["status"]]}
    ids = verdict.get("fact_ids") if isinstance(verdict.get("fact_ids"), list) else []
    found = [case.facts[i] for i in ids[:2] if isinstance(i, str) and i in case.facts]
    if len(found) > 1:  # two facts only side by side in one branch ("labour and rent"), never across branches
        found = [f for f in found if f.parent == found[0].parent]
    ready = [f for f in found if all(r in released for r in f.requires)]
    if ready:
        released.update(f.id for f in ready)
        return {"status": "answer", "facts": [f.answer for f in ready], "ids": [f.id for f in ready],
                "say": SAY["answer"]}
    status = "declined" if found else "unknown"
    return {"status": status, "facts": [], "say": SAY[status]}


async def lookup(http: "aiohttp.ClientSession", headers: dict, case: Case, question: str,
                 released: set[str], said: str = "") -> dict:
    """The tool's result. A failure (one retry, unless it timed out) gives nothing away and is not passed
    off as "no such fact": she says she can't check it now and asks for an assumption."""
    err: Exception | None = None
    for _ in range(2):
        try:
            return release(case, await match(http, headers, case, question, said), released)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, KeyError, IndexError,
                json.JSONDecodeError) as e:
            err = e
            if isinstance(e, asyncio.TimeoutError):
                break
    return {"status": "unavailable", "facts": [], "say": SAY["unavailable"], "error": str(err) or type(err).__name__}


def allowed_text(case: Case, candidate_said: str, released: set[str]) -> str:
    """What the interviewer may echo: the statement, the candidate's words and released facts."""
    return " ".join([case.statement, candidate_said] + [case.facts[i].answer for i in released if i in case.facts])


def mentions(text: str, term: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text, re.I) is not None
