"""Behaviour evals for the interviewer, against the service's own prompts, tools and fact gate.

Every scenario runs N times; a behaviour counts as fixed only when it passes every run (one good
voice test proves little: the model is not deterministic). Text in, audio out, over a plain Realtime
WebSocket that uses app/runtime/prompts.py and facts.py, with the engine's rules for tools (run when
the reply completes; one spoken follow-up). Not covered: VAD, timing, barge-in, echo (voice tests).
Ported from the phase 0 spike's evals.py with its 16 scenarios.

Run from engine/:  uv run python tools/evals.py [--runs 5] [--only greeting,drill_down] [--model ...]
About $0.02 a run at gpt-realtime-2.x prices. Transcripts go to engine/results/evals-*.json (gitignored).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import ssl
import sys
import time
from pathlib import Path

import httpx
import truststore
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import WebSocketException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.config import get_settings  # noqa: E402
from app.runtime import facts, guard, prompts, turns  # noqa: E402
from app.store import case_files  # noqa: E402

SETTINGS = get_settings()
KEY = SETTINGS.openai_api_key
CASE = facts.Case.from_doc(next(d for d in case_files() if d["caseId"] == "coffee"))
FACT_MODEL = SETTINGS.fact_model
RESULTS = ROOT / "results"

GREETING = "Hi, I'm Maya, and I'll be your interviewer today. How are you doing?"
PRESENTED = ("Great, let's get into the case. The client is a regional coffee chain whose operating profit dropped "
             "from 6 million to 4.5 million dollars over two years, while revenue stayed roughly flat at about 30 "
             "million. They want to understand why profit fell and what to do about it. How would you like to "
             "approach this?")
HEARD = "Great, let's get into the case. The client is a regional coffee chain whose operating profit dropped"
MISSED = PRESENTED[len(HEARD):].strip()

ANSWERED_RE = re.compile(r"\b(i'?m|i am)( doing| also)? (well|good|great|fine|pretty good)\b|thanks for asking|"
                         r"\bnot bad\b|\bdoing well\b", re.I)
CLAIMS_DEAF_RE = re.compile(r"couldn'?t (quite )?(hear|catch|make out)|didn'?t (quite )?(hear|catch)|"
                            r"trouble hearing|hard to hear|cut out|breaking up", re.I)
REDIRECT_RE = re.compile(r"\b(case|focus|back to|stick to|keep (to|on))\b", re.I)
VISITS_RE = re.compile(r"\b(flat|unchanged|same|steady|stable|haven'?t changed|hasn'?t changed|no change|"
                       r"not changed|held)\b", re.I)


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


class Session:
    """One interview over a WebSocket, driven like the engine drives the live call."""

    def __init__(self, ws, http: httpx.AsyncClient):
        self.ws, self.http, self.stage, self.notes, self.note_id = ws, http, "intro", 0, None
        self.released: set[str] = set()
        self.last_candidate = ""
        self.lookups: list[dict] = []   # what lookup_fact was asked and gave out
        self.replies: list[dict] = []   # every response in this run
        self.calls: list[dict] = []     # tool calls the engine ran
        self.candidate_said = ""
        self.seq = 0

    async def send(self, event: dict) -> None:
        await self.ws.send(json.dumps(event))

    def _id(self, tag: str) -> str:
        self.seq += 1
        return f"{tag}_{self.seq}"

    async def item(self, item: dict) -> None:
        await self.send({"type": "conversation.item.create", "item": item})

    async def system(self, text: str, item_id: str | None = None) -> None:
        await self.item({"id": item_id or self._id("sys"), "type": "message", "role": "system",
                         "content": [{"type": "input_text", "text": text}]})

    async def interviewer(self, text: str) -> None:
        await self.item({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]})

    async def candidate(self, text: str) -> None:
        """A candidate turn, then the engine's reply to it."""
        self.candidate_said += " " + text
        self.last_candidate = text
        await self.item({"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]})
        await self.reply("end_of_speech")

    async def seed_case(self, presented: str = PRESENTED) -> None:
        """History up to a presented case, without paying to generate it."""
        await self.interviewer(GREETING)
        await self.item({"type": "message", "role": "user",
                         "content": [{"type": "input_text", "text": "I'm doing well, thanks."}]})
        await self.item({"type": "function_call", "call_id": "call_seed", "name": "start_case", "arguments": "{}"})
        await self.item({"type": "function_call_output", "call_id": "call_seed",
                         "output": json.dumps({"case_brief": prompts.case_brief(CASE.statement)})})
        await self.interviewer(presented)
        self.stage = "case"

    async def seed_fact(self, question: str, fact_id: str) -> None:
        """A fact already asked for and told, without paying to generate it."""
        fact = CASE.facts[fact_id]
        self.candidate_said += " " + question
        await self.item({"type": "message", "role": "user", "content": [{"type": "input_text", "text": question}]})
        await self.item({"type": "function_call", "call_id": f"call_{fact_id}", "name": "lookup_fact",
                         "arguments": json.dumps({"question": question})})
        await self.item({"type": "function_call_output", "call_id": f"call_{fact_id}",
                         "output": json.dumps({"facts": [fact.answer], "say": facts.SAY["answer"]})})
        await self.interviewer(fact.answer)
        self.released.add(fact_id)

    async def reply(self, reason: str, prompt: str | None = None) -> None:
        if prompt:
            await self.system(prompt)
        if reason in prompts.STEERED:  # note_mode "item": the new note replaces the old one
            self.notes += 1
            previous, self.note_id = self.note_id, self._id("note")
            await self.system(prompts.steering_note(self.stage, "conversation", self.notes, 0), self.note_id)
            if previous:
                await self.send({"type": "conversation.item.delete", "item_id": previous})
        r = await self.respond(reason, prompts.response_options(reason))
        self.replies.append(r)
        if r["status"] == "completed" and r["calls"]:  # as the engine: run them all, then one follow-up
            wanted = [w for w in [await self.run_tool(c, spoke=bool(r["messages"])) for c in r["calls"]] if w]
            if wanted:
                await self.reply(min(wanted, key=prompts.FOLLOW_UP_RANK.index))

    async def run_tool(self, call: dict, spoke: bool) -> str | None:
        name = call.get("name")
        try:
            args = json.loads(call.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        self.calls.append({"name": name, "args": args, "spoke_first": spoke})
        out = lambda result: self.item({"type": "function_call_output", "call_id": call["call_id"],  # noqa: E731
                                        "output": json.dumps(result)})
        if name == "start_case":
            if self.stage == "case":
                await out({"ok": False, "detail": "The case has already started."})
                return None
            self.stage = "case"
            await out({"case_brief": prompts.case_brief(CASE.statement)})
            return "case_brief"
        if name == "wait_for_candidate":
            wait_ms = turns.wait_ms_for(args.get("seconds"))
            await out({"ok": True, "waiting_seconds": round(wait_ms / 1000),
                       **({} if spoke else {"next": prompts.WAIT_RESULT})})
            return None if spoke else "tool_ack"
        if name == "lookup_fact":
            question = str(args.get("question") or "")
            if self.stage != "case":
                await out({"facts": [], "say": "The case has not started yet; there is nothing to look up."})
                return "fact_answer"
            self.candidate_said += " " + question
            result = await facts.lookup(self.http, KEY, FACT_MODEL, CASE, question, self.released,
                                        said=self.last_candidate)
            self.lookups.append({"question": question, "status": result["status"], "ids": result.get("ids", []),
                                 **({"error": result["error"]} if "error" in result else {})})
            await out({k: result[k] for k in ("facts", "say")})
            return "fact_answer"
        await out({"ok": False, "detail": f"Unknown tool {name}."})
        return None

    async def respond(self, reason: str, options: dict) -> dict:
        create = {"type": "response.create"}
        if options:
            create["response"] = options
        start = time.monotonic()
        await self.send(create)
        first_audio = None
        async for raw in self.ws:
            ev = json.loads(raw)
            kind = ev["type"]
            if kind == "response.output_audio.delta" and first_audio is None:
                first_audio = round((time.monotonic() - start) * 1000)
            elif kind == "error":
                raise RuntimeError(ev["error"].get("message"))
            elif kind == "response.done":
                resp = ev["response"]
                messages, calls = [], []
                for o in resp.get("output", []):
                    if o["type"] == "message":
                        text = " ".join((c.get("transcript") or c.get("text") or "") for c in o.get("content", []))
                        if text.strip():
                            messages.append({"phase": o.get("phase"), "text": text.strip()})
                    elif o["type"] == "function_call":
                        calls.append(o)
                return {"reason": reason, "status": resp.get("status"), "details": resp.get("status_details"),
                        "messages": messages, "calls": calls, "first_audio_ms": first_audio}
        raise RuntimeError("socket ended")

    # --- what the candidate heard ------------------------------------------------

    def said(self) -> str:
        return " ".join(m["text"] for r in self.replies for m in r["messages"])

    def problems(self) -> list[str]:
        """Checks every scenario must pass: no preamble, nothing said twice."""
        found = []
        msgs = [m for r in self.replies for m in r["messages"]]
        if any(m["phase"] == "commentary" for m in msgs):
            found.append("spoke a preamble")
        norm = [" ".join(words(m["text"])) for m in msgs]
        for i, a in enumerate(norm):
            for b in norm[i + 1:]:
                if a == b or (len(a.split()) >= 4 and (a in b or b in a)) or (a.split()[:6] == b.split()[:6]
                                                                               and len(a.split()) >= 6):
                    found.append(f"said twice: “{a[:60]}”")
        hit = guard.check(self.said(), self.candidate_said, CASE, self.released)
        if hit:
            found.append(f"guard: {hit['kind']} “{hit['term']}”")
        for r in self.replies:
            if r["status"] != "completed":
                found.append(f"{r['reason']} reply {r['status']}: {r['details']}")
        return found


# --- scenarios: each returns a list of failures (empty = pass) ---------------------

async def greeting(s: Session) -> list[str]:
    await s.reply("greeting", turns.GREETING_PROMPT)
    said, fails = s.said(), []
    if len([m for r in s.replies for m in r["messages"]]) != 1:
        fails.append("not exactly one message")
    if s.calls or any(r["calls"] for r in s.replies):
        fails.append("called a tool while greeting")
    if "maya" not in said.lower() or "?" not in said:
        fails.append("no introduction and question")
    return fails


async def small_talk_question(s: Session) -> list[str]:
    await s.interviewer(GREETING)
    await s.candidate("I'm good, thanks. How about you?")
    fails = []
    if not ANSWERED_RE.search(s.said()):
        fails.append("ignored their question")
    if s.stage == "case" and "coffee" not in s.said().lower():
        fails.append("started the case but did not present it")
    return fails


async def ready_to_start(s: Session) -> list[str]:
    """After a line of small talk she should lead into the case herself."""
    await s.interviewer(GREETING)
    await s.candidate("Doing well, thank you. Joining from Bangalore today.")
    if s.stage != "case":
        await s.candidate("Yes, it's been a good day so far.")
    return [] if s.stage == "case" and "coffee" in s.said().lower() else ["did not move to the case"]


async def repeat_request(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("Sorry, I just got a call and missed that. Could you repeat the case?")
    said, fails = s.said(), []
    if "coffee" not in said.lower():
        fails.append("did not repeat the case")
    if CLAIMS_DEAF_RE.search(said):
        fails.append("claimed she could not hear them")
    return fails


async def asks_for_time(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("Could I take thirty seconds to structure my thoughts?")
    said, fails = s.said(), []
    waits = [c for c in s.calls if c["name"] == "wait_for_candidate"]
    if not waits:
        fails.append("did not call wait_for_candidate")
    elif waits[0]["args"].get("seconds") not in (30,):
        fails.append(f"wrong duration {waits[0]['args'].get('seconds')}")
    if not 1 <= len(words(said)) <= 20:  # a short acknowledgement: two short sentences are fine, a speech is not
        fails.append(f"acknowledgement of {len(words(said))} words")
    if re.search(r"coffee|profit|revenue|cost", said, re.I):
        fails.append("talked about the case")
    return fails


async def asked_fact(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("Before I structure this, has the number of customer visits changed?")
    said, fails = s.said(), told_only(s, {"visits", "revenue_drivers"})
    if not VISITS_RE.search(said):
        fails.append("did not give the fact asked for")
    return fails  # leaks: the guard check every scenario gets


async def asks_for_help(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("Honestly, I'm not sure where to start. What would you look at first?")
    return told_only(s, set())  # hints, such as naming the cost branch first: the guard check every scenario gets


async def off_topic(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("Before we go on, what do you think about the stock market right now?")
    return [] if REDIRECT_RE.search(s.said()) else ["did not bring them back to the case"]


async def resume_after_interruption(s: Session) -> list[str]:
    """She was cut off mid-presentation; the engine noted what was heard. She should pick up from there."""
    await s.seed_case(presented=HEARD)
    await s.system(prompts.INTERRUPTED_NOTE.format(heard_tail=" ".join(HEARD.split()[-12:]), missed=MISSED))
    await s.candidate("Sorry, my phone rang. Please go on.")
    said, fails = s.said(), []
    if not re.search(r"30 million|revenue", said, re.I):
        fails.append("did not give what they missed")
    if re.search(r"regional coffee chain", said, re.I):
        fails.append("started over")
    if said[:1].islower():
        fails.append("resumed mid-sentence with no bridge")
    return fails


# --- the fact gate: how much each kind of question gets -------------------------

FRAMEWORK = "I'd split profit into revenue and costs, and costs into fixed and variable."
YES_RE = re.compile(r"\b(yes|yeah|right|correct|exactly|indeed|good guess)\b", re.I)


def told_only(s: Session, allowed: set[str]) -> list[str]:
    extra = s.released - allowed
    return [f"gave out {', '.join(sorted(extra))}"] if extra else []


async def broad_cost_question(s: Session) -> list[str]:
    """22 Oct voice test: a fixed-or-variable question got beans +35%, the supplier, labour and rent."""
    await s.seed_case()
    await s.candidate(FRAMEWORK)
    s.replies.clear()
    await s.candidate("Among those costs, has anything increased, and is it fixed or variable?")
    fails = told_only(s, {"cost_total", "cost_split"})
    if "variable" not in s.said().lower():
        fails.append("did not answer which type rose")
    return fails


async def drill_down(s: Session) -> list[str]:
    await s.seed_case()
    await s.seed_fact("Did fixed or variable costs rise?", "cost_split")
    await s.candidate("Which variable costs went up?")
    fails = told_only(s, {"cost_split", "variable_detail"})
    if not re.search(r"ingredient", s.said(), re.I):
        fails.append("did not answer which variable cost")
    return fails


async def specific_question(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("What happened to coffee bean costs over the two years?")
    fails = told_only(s, {"beans"})
    if not re.search(r"35|thirty-five", s.said()):
        fails.append("did not give the figure asked for")
    return fails


async def cause_question(s: Session) -> list[str]:
    await s.seed_case()
    await s.seed_fact("What happened to coffee bean costs?", "beans")
    await s.candidate("Why did bean costs go up so much?")
    fails = told_only(s, {"beans", "beans_why"})
    if not re.search(r"supplier", s.said(), re.I):
        fails.append("did not give the cause asked for")
    return fails


async def fishing_for_the_cause(s: Session) -> list[str]:
    """A guess at the root cause before establishing what it would explain: not confirmed."""
    await s.seed_case()
    await s.candidate("Is the problem that they changed their coffee supplier?")
    fails = told_only(s, set())
    if YES_RE.search(s.said()):
        fails.append("confirmed the guess")
    return fails


async def fact_not_in_the_case(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("What is the chain's market share in its region?")
    said, fails = s.said(), told_only(s, set())
    if re.search(r"\d", said):
        fails.append("invented a figure")
    if not re.search(r"assum|estimate|what would you", said, re.I):
        fails.append("did not ask for an assumption")
    return fails


async def framework_check(s: Session) -> list[str]:
    """22 Oct voice test: "Is this correct?" got "I can't confirm a framework… if you want a specific cost
    fact, just ask for that one"."""
    await s.seed_case()
    await s.candidate(f"{FRAMEWORK} Is this correct?")
    said, fails = s.said(), told_only(s, set())
    if re.search(r"can'?t (confirm|tell you|validate)|ask (me )?for (a |that |the )?(specific|one)|specific (cost )?fact",
                 said, re.I):
        fails.append("explained her rules or how to ask")
    return fails


SCENARIOS = {f.__name__: f for f in (greeting, small_talk_question, ready_to_start, repeat_request, asks_for_time,
                                      asked_fact, asks_for_help, off_topic, resume_after_interruption,
                                      broad_cost_question, drill_down, specific_question, cause_question,
                                      fishing_for_the_cause, fact_not_in_the_case, framework_check)}


async def run_one(http: httpx.AsyncClient, ssl_ctx, name: str, model: str, effort: str) -> dict:
    async with ws_connect(f"wss://api.openai.com/v1/realtime?model={model}", ssl=ssl_ctx, max_size=None,
                          ping_interval=20, ping_timeout=None,
                          additional_headers={"Authorization": f"Bearer {KEY}"}) as ws:
        s = Session(ws, http)
        await s.send({"type": "session.update", "session": {
            "type": "realtime", "instructions": prompts.BASE_INSTRUCTIONS, "tools": prompts.TOOLS,
            "tool_choice": "auto", "output_modalities": ["audio"],
            **({"reasoning": {"effort": effort}} if effort else {}),
            "audio": {"input": {"turn_detection": None}, "output": {"voice": "marin"}}}})
        try:
            fails = await SCENARIOS[name](s)
            fails += s.problems()
        except RuntimeError as err:
            fails = [f"error: {err}"]
        return {"scenario": name, "ok": not fails, "fails": fails, "calls": s.calls, "lookups": s.lookups,
                "replies": [{"reason": r["reason"], "status": r["status"], "first_audio_ms": r["first_audio_ms"],
                             "messages": r["messages"], "calls": [c.get("name") for c in r["calls"]]}
                            for r in s.replies]}


async def main() -> None:
    global FACT_MODEL
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--only", default="")
    ap.add_argument("--model", default=SETTINGS.realtime_model)
    ap.add_argument("--reasoning", default=SETTINGS.reasoning)
    ap.add_argument("--fact-model", default=SETTINGS.fact_model)
    ap.add_argument("--parallel", type=int, default=3)  # 8 at once hit rate limits in the spike
    a = ap.parse_args()
    FACT_MODEL = a.fact_model
    names = [n for n in a.only.split(",") if n] or list(SCENARIOS)
    ssl_ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    sem = asyncio.Semaphore(a.parallel)
    async with httpx.AsyncClient(verify=ssl_ctx, timeout=20.0) as http:
        async def one(name):
            async with sem:
                try:
                    return await run_one(http, ssl_ctx, name, a.model, a.reasoning)
                except (OSError, WebSocketException, httpx.HTTPError, asyncio.TimeoutError) as err:
                    return {"scenario": name, "ok": False, "fails": [f"connection: {err}"], "replies": []}
        results = await asyncio.gather(*(one(n) for n in names for _ in range(a.runs)))
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"evals-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps({"model": a.model, "reasoning": a.reasoning, "fact_model": a.fact_model,
                               "results": results}, indent=1))
    print(f"{a.model} · reasoning {a.reasoning or 'default'} · fact matcher {a.fact_model} · "
          f"{a.runs} runs per scenario\n")
    passed = 0
    for name in names:
        rs = [r for r in results if r["scenario"] == name]
        audio = sorted(x["first_audio_ms"] for r in rs for x in r["replies"] if x.get("first_audio_ms"))
        p50 = audio[len(audio) // 2] if audio else None
        passed += all(r["ok"] for r in rs)
        print(f"{'PASS' if all(r['ok'] for r in rs) else 'FAIL'}  {name:<27} {sum(r['ok'] for r in rs)}/{len(rs)}"
              f"   first audio p50 {p50} ms")
        for r in rs:
            if not r["ok"]:
                said = " | ".join(m["text"] for x in r["replies"] for m in x["messages"])
                print(f"        ✗ {'; '.join(r['fails'])}\n          she said: {said[:220]}")
    print(f"\n{passed}/{len(names)} scenarios pass every run · transcripts: {out}")


if __name__ == "__main__":
    asyncio.run(main())
