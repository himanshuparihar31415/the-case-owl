"""The fact gate (the plan's accuracy rule): the interviewer holds only the case statement. Every
other fact comes from lookup_fact, one at a time, at the level of detail the candidate asked about.

Facts form a tree (an engine_cases document): a broad fact ("variable costs rose") sits above the
detail under it ("bean costs rose 35 percent") and the cause under that ("a new supplier"). A broad
question gets the broad fact and nothing below it, so the candidate has to dig.

`match()` is a small LLM call that sees only what each fact covers, never the answers. `release()` is
plain code: prerequisites and the released set. Carried over from the phase 0 spike (48/48 on its
granularity benchmark with gpt-5.4-nano).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass, field

import httpx

MATCH_TIMEOUT_S = 3.0
MATCH_PROMPT = """You match a candidate's question in a case interview to the interviewer's fact sheet. Each fact has an id, the broader fact it sits under, and what it covers.
- Pick the fact that answers exactly what was asked, at the same level of detail. A broad question gets the broad fact, never the more detailed facts under it.
- You get the interviewer's restatement and, when available, the candidate's own words (transcribed, so they may contain errors). The level of detail is the candidate's: never go deeper than their words.
- Facts already told are listed. If the question goes beyond one of them ("why?", "which ones?"), pick the fact under it that answers the new part; pick an already-told fact only if they ask to hear it again.
- Pick two facts only if the question explicitly asks about both.
- "not_data": they ask for an opinion, a hint, a confirmation of their idea or what to do, not for information.
- "unknown": no fact covers it.
Reply with JSON only: {"status": "match" | "not_data" | "unknown", "fact_ids": ["<exact id string>", ...]}"""

# What the interviewer is told to do with each outcome. She speaks after the tool returns.
SAY = {
    "answer": "Tell them only this, in your own words, as a short natural answer. Add nothing: no offer of more "
              "detail and no comment on what you can or cannot share.",
    "declined": "Do not confirm or deny. Ask what makes them think so.",
    "not_data": "This is not a request for case data. Give no opinion or hint; turn it back to them.",
    "unknown": "You do not have that information. Say so briefly and ask what they would assume.",
    "unavailable": "You cannot check that right now. Ask what they would assume for now.",
}
CHAT_URL = "https://api.openai.com/v1/chat/completions"


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
    version: int
    statement: str
    facts: dict[str, Fact]
    leads: list[dict]

    @classmethod
    def from_doc(cls, doc: dict) -> "Case":
        facts = {f["id"]: Fact(f["id"], f.get("parent"), f["covers"], f["answer"], f.get("terms", []),
                               f.get("requires", [])) for f in doc["facts"]}
        return cls(doc["caseId"], doc.get("version", 1), doc["statement"], facts, doc.get("leads", []))


def chat_body(model: str, system: str, user: str, max_tokens: int) -> dict:
    """A JSON-mode chat request that works across model families: reasoning models (gpt-5.x, the Luna
    models) take reasoning_effort and no temperature; older ones take temperature."""
    reasoning = model.startswith(("gpt-5", "gpt-6", "o"))
    return {"model": model, "max_completion_tokens": max_tokens, "response_format": {"type": "json_object"},
            **({"reasoning_effort": os.environ.get("SMALL_MODEL_REASONING", "none")} if reasoning
               else {"temperature": 0}),
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}


async def chat_json(http: httpx.AsyncClient, api_key: str, body: dict, timeout_s: float) -> dict:
    r = await http.post(CHAT_URL, json=body, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout_s)
    data = r.json()
    if r.status_code != 200:
        raise ValueError((data.get("error") or {}).get("message", f"HTTP {r.status_code}"))
    return json.loads(data["choices"][0]["message"]["content"])


def sheet(case: Case) -> str:
    """The fact sheet the matcher sees: ids, tree position and coverage. No answers."""
    return "\n".join(f'id "{f.id}" | under "{f.parent or "case"}" | covers: {f.covers}' for f in case.facts.values())


async def match(http: httpx.AsyncClient, api_key: str, model: str, case: Case, question: str, said: str = "",
                released: set[str] | None = None) -> dict:
    words = f"\nCandidate's words: {said}" if said.strip() else ""
    told = f"\nAlready told: {', '.join(sorted(released))}" if released else ""
    body = chat_body(model, MATCH_PROMPT,
                     f"Facts:\n{sheet(case)}{told}\n\nInterviewer's restatement: {question}{words}", 80)
    verdict = await chat_json(http, api_key, body, MATCH_TIMEOUT_S)
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


async def lookup(http: httpx.AsyncClient, api_key: str, model: str, case: Case, question: str,
                 released: set[str], said: str = "") -> dict:
    """The tool's result. A failure (one retry, unless it timed out) gives nothing away and is not passed
    off as "no such fact": she says she can't check it now and asks for an assumption."""
    err: Exception | None = None
    for _ in range(2):
        try:
            return release(case, await match(http, api_key, model, case, question, said, released), released)
        except (httpx.HTTPError, asyncio.TimeoutError, ValueError, KeyError, IndexError, json.JSONDecodeError) as e:
            err = e
            if isinstance(e, (httpx.TimeoutException, asyncio.TimeoutError)):
                break
    return {"status": "unavailable", "facts": [], "say": SAY["unavailable"], "error": str(err) or type(err).__name__}


def allowed_text(case: Case, candidate_said: str, released: set[str]) -> str:
    """What the interviewer may echo: the statement, the candidate's words and released facts."""
    return " ".join([case.statement, candidate_said] + [case.facts[i].answer for i in released if i in case.facts])


def mentions(text: str, term: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text, re.I) is not None
