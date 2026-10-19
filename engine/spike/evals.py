# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp>=3.10", "truststore>=0.9"]
# ///
"""Behaviour evals for the interviewer: every scenario runs N times, and a fix counts only when it
passes every run. One good voice test proves little; the model is not deterministic.

Text in, audio out, over a plain WebSocket session that uses server.py's instructions, tools, case
brief, steering notes and per-reply options, and the engine's rules for tools (run when the reply
completes; one spoken follow-up). What this cannot cover: VAD, timing, barge-in and echo. Those stay
voice tests.

Run from the repo root:  uv run engine/spike/evals.py [--runs 5] [--only greeting,repeat_request]
About $0.02 per run at gpt-realtime-2.x prices. Results go to engine/spike/results/evals-*.json.
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

import aiohttp
import truststore

sys.path.insert(0, str(Path(__file__).resolve().parent))
import guard  # noqa: E402
import server  # noqa: E402
import turns  # noqa: E402

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

    def __init__(self, ws: aiohttp.ClientWebSocketResponse):
        self.ws, self.stage, self.notes, self.note_id = ws, "intro", 0, None
        self.replies: list[dict] = []   # every response in this run
        self.calls: list[dict] = []     # tool calls the engine ran
        self.candidate_said = ""
        self.seq = 0

    def _id(self, tag: str) -> str:
        self.seq += 1
        return f"{tag}_{self.seq}"

    async def item(self, item: dict) -> None:
        await self.ws.send_json({"type": "conversation.item.create", "item": item})

    async def system(self, text: str, item_id: str | None = None) -> None:
        await self.item({"id": item_id or self._id("sys"), "type": "message", "role": "system",
                         "content": [{"type": "input_text", "text": text}]})

    async def interviewer(self, text: str) -> None:
        await self.item({"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]})

    async def candidate(self, text: str) -> None:
        """A candidate turn, then the engine's reply to it."""
        self.candidate_said += " " + text
        await self.item({"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]})
        await self.reply("end_of_speech")

    async def seed_case(self, presented: str = PRESENTED) -> None:
        """History up to a presented case, without paying to generate it."""
        await self.interviewer(GREETING)
        await self.item({"type": "message", "role": "user",
                         "content": [{"type": "input_text", "text": "I'm doing well, thanks."}]})
        await self.item({"type": "function_call", "call_id": "call_seed", "name": "start_case", "arguments": "{}"})
        await self.item({"type": "function_call_output", "call_id": "call_seed",
                         "output": json.dumps({"case_brief": server.CASE_BRIEF})})
        await self.interviewer(presented)
        self.stage = "case"

    async def reply(self, reason: str, prompt: str | None = None) -> None:
        if prompt:
            await self.system(prompt)
        if reason in server.STEERED:  # note_mode "item": the new note replaces the old one
            self.notes += 1
            previous, self.note_id = self.note_id, self._id("note")
            await self.system(server.steering_note(self.stage, "conversation", self.notes, 0), self.note_id)
            if previous:
                await self.ws.send_json({"type": "conversation.item.delete", "item_id": previous})
        r = await self.respond(reason, server.response_options(reason))
        self.replies.append(r)
        if r["status"] == "completed":
            for call in r["calls"]:
                await self.run_tool(call, spoke=bool(r["messages"]))

    async def run_tool(self, call: dict, spoke: bool) -> None:
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
                return
            self.stage = "case"
            await out({"case_brief": server.CASE_BRIEF})
            await self.reply("case_brief")
        elif name == "wait_for_candidate":
            wait_ms = turns.wait_ms_for(args.get("seconds"))
            await out({"ok": True, "waiting_seconds": round(wait_ms / 1000),
                       **({} if spoke else {"next": server.WAIT_RESULT})})
            if not spoke:
                await self.reply("tool_ack")
        else:
            await out({"ok": False, "detail": f"Unknown tool {name}."})

    async def respond(self, reason: str, options: dict) -> dict:
        create = {"type": "response.create"}
        if options:
            create["response"] = options
        start = time.monotonic()
        await self.ws.send_json(create)
        first_audio = None
        async for msg in self.ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                raise RuntimeError(f"socket closed: {msg.type} {self.ws.close_code}")
            ev = json.loads(msg.data)
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
    if not 1 <= len(words(said)) <= 15:
        fails.append(f"acknowledgement of {len(words(said))} words")
    if re.search(r"coffee|profit|revenue|cost", said, re.I):
        fails.append("talked about the case")
    return fails


async def asked_fact(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("Before I structure this, has the number of customer visits changed?")
    said, fails = s.said(), []
    if not VISITS_RE.search(said):
        fails.append("did not give the fact asked for")
    hit = guard.check(said, s.candidate_said)
    if hit:
        fails.append(f"guard: {hit['kind']} “{hit['term']}”")
    return fails


async def asks_for_help(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("Honestly, I'm not sure where to start. What would you look at first?")
    hit = guard.check(s.said(), s.candidate_said)  # includes naming the cost branch first
    return [f"guard: {hit['kind']} “{hit['term']}”"] if hit else []


async def off_topic(s: Session) -> list[str]:
    await s.seed_case()
    await s.candidate("Before we go on, what do you think about the stock market right now?")
    return [] if REDIRECT_RE.search(s.said()) else ["did not bring them back to the case"]


async def resume_after_interruption(s: Session) -> list[str]:
    """She was cut off mid-presentation; the engine noted what was heard. She should pick up from there."""
    await s.seed_case(presented=HEARD)
    await s.system(server.INTERRUPTED_NOTE.format(heard_tail=" ".join(HEARD.split()[-12:]), missed=MISSED))
    await s.candidate("Sorry, my phone rang. Please go on.")
    said, fails = s.said(), []
    if not re.search(r"30 million|revenue", said, re.I):
        fails.append("did not give what they missed")
    if re.search(r"regional coffee chain", said, re.I):
        fails.append("started over")
    if said[:1].islower():
        fails.append("resumed mid-sentence with no bridge")
    return fails


SCENARIOS = {f.__name__: f for f in (greeting, small_talk_question, ready_to_start, repeat_request, asks_for_time,
                                      asked_fact, asks_for_help, off_topic, resume_after_interruption)}


async def run_one(http, name: str, model: str, effort: str) -> dict:
    async with http.ws_connect(f"wss://api.openai.com/v1/realtime?model={model}", headers=server.auth(),
                               max_msg_size=0) as ws:
        await ws.send_json({"type": "session.update", "session": {
            "type": "realtime", "instructions": server.BASE_INSTRUCTIONS, "tools": server.TOOLS,
            "tool_choice": "auto", "output_modalities": ["audio"],
            **({"reasoning": {"effort": effort}} if effort else {}),
            "audio": {"input": {"turn_detection": None}, "output": {"voice": "marin"}}}})
        s = Session(ws)
        try:
            fails = await SCENARIOS[name](s)
            fails += s.problems()
        except RuntimeError as err:
            fails = [f"error: {err}"]
        return {"scenario": name, "ok": not fails, "fails": fails, "calls": s.calls,
                "replies": [{"reason": r["reason"], "status": r["status"], "first_audio_ms": r["first_audio_ms"],
                             "messages": r["messages"], "calls": [c.get("name") for c in r["calls"]]}
                            for r in s.replies]}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--only", default="")
    ap.add_argument("--model", default=server.DEFAULTS["model"])
    ap.add_argument("--reasoning", default=server.DEFAULTS["reasoning"])
    ap.add_argument("--parallel", type=int, default=3)  # 8 at once hit rate limits
    a = ap.parse_args()
    names = [n for n in a.only.split(",") if n] or list(SCENARIOS)
    connector = aiohttp.TCPConnector(ssl=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT))
    sem = asyncio.Semaphore(a.parallel)
    async with aiohttp.ClientSession(connector=connector) as http:
        async def one(name):
            async with sem:
                try:
                    return await run_one(http, name, a.model, a.reasoning)
                except (aiohttp.ClientError, asyncio.TimeoutError) as err:
                    return {"scenario": name, "ok": False, "fails": [f"connection: {err}"], "replies": []}
        results = await asyncio.gather(*(one(n) for n in names for _ in range(a.runs)))
    server.RESULTS.mkdir(exist_ok=True)
    out = server.RESULTS / f"evals-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps({"model": a.model, "reasoning": a.reasoning, "results": results}, indent=1))
    print(f"{a.model} · reasoning {a.reasoning or 'default'} · {a.runs} runs per scenario\n")
    for name in names:
        rs = [r for r in results if r["scenario"] == name]
        audio = sorted(x["first_audio_ms"] for r in rs for x in r["replies"] if x.get("first_audio_ms"))
        p50 = audio[len(audio) // 2] if audio else None
        print(f"{'PASS' if all(r['ok'] for r in rs) else 'FAIL'}  {name:<27} {sum(r['ok'] for r in rs)}/{len(rs)}"
              f"   first audio p50 {p50} ms")
        for r in rs:
            if not r["ok"]:
                said = " | ".join(m["text"] for x in r["replies"] for m in x["messages"])
                print(f"        ✗ {'; '.join(r['fails'])}\n          she said: {said[:220]}")
    print(f"\nfull transcripts: {out}")


if __name__ == "__main__":
    asyncio.run(main())
