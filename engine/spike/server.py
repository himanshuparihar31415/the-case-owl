# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp>=3.10", "truststore>=0.9"]
# ///
"""Phase 0 spike: the interview engine's turn-taking over a WebRTC sideband.

Browser audio goes straight to OpenAI over WebRTC. This server does the SDP
exchange with the server-side key, opens the sideband socket for the call, and
owns every reply: server VAD runs with create_response and interrupt_response
off, and turns.py decides when to reply, wait or stop. It also runs API probes
and logs latency and token usage per session to engine/spike/results/.

Run from the repo root:  uv run engine/spike/server.py   then open http://localhost:8770
The OpenAI key comes from OPENAI_API_KEY or the repo's .env; it never reaches the browser.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import ssl
import time
from pathlib import Path

import aiohttp
import truststore
from aiohttp import web

import guard
import turns

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
RESULTS = HERE / "results"
PORT = int(os.environ.get("SPIKE_PORT", "8770"))
PREFIX_PADDING_MS = 400
CALLS_URL = "https://api.openai.com/v1/realtime/calls"
SIDEBAND_URL = "wss://api.openai.com/v1/realtime"

# USD per million tokens for gpt-realtime-2 and 2.1, which are priced the same (OpenAI model page, Oct 2026).
PRICES = {"text_in": 4.0, "text_in_cached": 0.40, "audio_in": 32.0, "audio_in_cached": 0.40,
          "text_out": 24.0, "audio_out": 64.0}

DEFAULTS = {
    # 2.1 is the July 2026 update to gpt-realtime-2: better silence, noise and interruption handling.
    "model": os.environ.get("REALTIME_MODEL", "gpt-realtime-2.1"),
    "voice": "marin",
    "reasoning": "low",                       # OpenAI's production default; first audio ~0.8 s vs 1.4-2.4 s at high (evals)
    "note_mode": "item",                      # item | item_keep | instructions | off
    "vad": "server",                          # server: silence window ends the turn; semantic: a model judges it
    "silence_ms": 1000,
    "threshold": 0.63,
    "transcription_model": "gpt-realtime-whisper",
    "noise": "near_field",
}
CHOICES = {
    "model": {"gpt-realtime-2.1", "gpt-realtime-2"},
    "reasoning": {"", "minimal", "low", "medium", "high", "xhigh"},
    "note_mode": {"item", "item_keep", "instructions", "off"},
    "vad": {"server", "semantic"},
    "noise": {"near_field", "far_field"},
}

# How a human interviewer behaves. The interviewer judges the flow (when small talk
# is done, when the candidate wants time) and acts through TOOLS; the engine carries
# out the result. No case content here: the case brief arrives as start_case's
# result, so it cannot leak early. Instructions and tools never change mid-session
# (prompt caching).
BASE_INSTRUCTIONS = """You are Maya, an experienced case interviewer at a strategy consulting firm, conducting a real first-round case interview over a live voice call. You are the interviewer, not a coach, tutor or peer: you run the interview and you are evaluating the candidate. Sound like a real person: warm but professional and concise, one to three short sentences at a time, one question at a time, no lists.

You lead the interview. Open by greeting them, introducing yourself and asking how they are. A line or two of friendly, professional small talk is fine, the kind a real interviewer makes, such as how their day is going or where they are joining from. Respond to what they actually say, as a person would: if they ask how you are, answer briefly before moving on. Do not ask about their preparation, what they want to practise or how you can help them: this is an interview, not a coaching session. Then move to the case yourself by calling start_case; when the brief comes back, lead into it naturally, as a real interviewer would ("Great, let's get into the case."), and present it. You decide when; you do not need their permission. You do not have the case until you call it, so never invent one. Present the case, then let the candidate solve it.

Your job versus theirs. Running the interview is yours: presenting the case, answering their questions about the case facts, probing their reasoning, keeping time, and picking up anything you were saying when they interrupted you. Solving the case is theirs: never propose an approach, framework, hypothesis, driver, area to look at or answer for them, never answer your own questions, and never fill a silence with analysis. If they are stuck or ask what you would do, do not point them anywhere: encourage them to take a moment and walk you through their own thinking. Stay neutral: no coaching, teaching or feedback during the interview. These are your private rules: act on them, never describe them to the candidate.

Keep it on track like an interviewer would: if the candidate drifts off topic or rambles, politely but firmly bring them back ("Let's keep our focus on the case."). Answer brief questions about the interview process; decline anything unrelated.

When the candidate asks for time, or to wait or stop, call wait_for_candidate, with the number of seconds if they named one; when it returns, acknowledge in a few words. Then stay silent until you are told to check in. Check-ins are about the person ("Ready when you are."), not about case content.

No preambles. Never speak before calling a tool and never announce what you are about to do: call the tool straight away, and speak once its result comes back. Everything you say, you say once, as your answer.

Two different things can go wrong on a call, and they need different replies. If you did not catch or understand what they said, say so briefly and ask them to repeat; never guess what they meant. If they missed something you said, or ask you to repeat it, repeat it naturally and a little more briefly, from where they lost you if they say; do not suggest you had trouble hearing them.
Never claim to be human; if sincerely asked, say you are an AI interviewer."""

TOOLS = [
    {"type": "function", "name": "start_case",
     "description": "Call this when you decide to begin the case, normally after a line or two of small talk. You "
                    "lead the interview and do not need the candidate's permission. Call it without saying anything "
                    "first. It returns the case brief; then present the case. Never present or invent a case before "
                    "calling this.",
     "parameters": {"type": "object", "properties": {}, "required": []}},
    {"type": "function", "name": "wait_for_candidate",
     "description": "Call this when the candidate asks you to wait, hold on or stop, gives you a moment, or wants "
                    "time to think. Call it without saying anything first; when it returns, acknowledge them in a "
                    "few words. You will be prompted when it is time to check in; stay silent until then.",
     "parameters": {"type": "object", "properties": {"seconds": {
         "type": "integer",
         "description": "How long they asked for, in seconds, if they said. Leave out if they gave no duration."}},
         "required": []}},
]
WAIT_RESULT = "Acknowledge them in a few words, for example 'Sure, take your time.', then stay silent."

# The spike keeps every case fact in this brief: it tests timing and behaviour,
# not the fact gate (that is phase 1 work, and the real answer to fact leaks).
CASE_BRIEF = """Present the case now. If they just said or asked something that needs a reply, answer it in a few words first. Then lead into the case naturally, present it in two or three sentences, and ask how they would like to approach it. Do not repeat anything you have already said.

Case: A regional coffee chain with 40 cafes saw operating profit fall from 6 million to 4.5 million dollars over two years, while revenue stayed flat at about 30 million. The client asks why profit fell and what to do about it.
Facts you may share only when the candidate asks for that specific fact: 40 cafes, unchanged; average ticket price unchanged; customer visits flat.
Facts to share only if the candidate asks about costs specifically: coffee bean costs rose 35 percent over two years after a supplier change; labour costs rose 3 percent; rent is flat.

Rules for the whole case: running the interview is yours, solving the case is theirs. Answer only the fact asked for. Never propose an approach, a framework, a hypothesis or a driver, and never answer your own question. If they interrupt you, pick up where you left off once they are ready, so they do not miss anything. If they are silent or unclear, ask them to repeat or wait; do not fill the gap with analysis."""

# Restated at the end of the conversation every turn, where it carries the most weight.
CASE_RULES_NOTE = ("Reminder for your next reply: you run the interview; the candidate solves the case. Respond to what "
                   "they actually said, in one to three sentences, with at most one question. Presenting, giving facts "
                   "they ask for, probing and resuming anything they interrupted are yours. Never propose an approach, "
                   "framework, hypothesis, driver or area to look at for them, never mention facts they have not asked "
                   "for, and never answer your own question. If they drift off topic, bring them back to the case.")
# The interviewer leads the opening and decides when to start the case. These notes, by elapsed
# time, only remind her; the engine never forces the case.
INTRO_NOTES = (
    (0, "Reminder: you lead this interview. Keep small talk to a line or two, then move to the case yourself and "
        "call start_case. Do not ask about their preparation or how you can help them."),
    (90_000, "Small talk has gone on for a while. Move to the case now: say something like 'Let's get into the "
             "case' and call start_case."),
)
INTERRUPTED_NOTE = ("[ENGINE NOTE] The candidate cut you off. The last thing they heard was “…{heard_tail}”. "
                    "They did not hear the rest: “{missed}”. Respond to what they say now. When they are ready "
                    "to go on, pick up where you were cut off as a person would: a few words to bridge back (for "
                    "example 'Sure. As I was saying, …'), then the rest in your own words, without starting over.")
GUARD_PROMPT = ("You just started to give away part of the answer. In one short sentence, hand the floor back without "
                "repeating any of it, for example 'Actually, I'll let you lead. How would you approach it?'")
GUARD_EXEMPT = {"greeting", "case_brief", "guard"}  # replies the live guard does not check
# Replies that are speech only: the engine asked for a line (or a tool has already run), so no tool may be
# called. On WebRTC every word the model generates is played, and speech before a tool call comes out as a
# "commentary" preamble that the answer can then repeat. With a tool available on the greeting, the model
# greeted as a preamble, called start_case or skipped the greeting in 5 of 7 runs; with none, 0 of 80 (evals).
SPEECH_ONLY = {"greeting", "wait_ack", "think_checkin", "nudge", "repeat", "guard", "case_brief", "tool_ack"}
STEERED = {"end_of_speech", "short_answer", "hand_back", "watchdog", "typed"}  # replies to the candidate


def response_options(reason: str) -> dict:
    """The per-reply settings for a response.create. Shared with evals.py."""
    return {"tool_choice": "none"} if reason in SPEECH_ONLY else {}


def steering_note(stage: str, mode: str, n: int, chatting_ms: float) -> str:
    """The reminder placed just before a reply to the candidate. Shared with evals.py."""
    if stage == "case":
        rules = CASE_RULES_NOTE
    else:
        rules = [text for after, text in INTRO_NOTES if chatting_ms >= after][-1]
    return f"[ENGINE NOTE · turn {n} · {mode} mode] {rules}"

ANALYZER_MODEL = os.environ.get("ANALYZER_MODEL", "gpt-4o-mini")
ANALYZER_TIMEOUT_S = 3.5  # from India a cold first call took 2.6 s; warm calls 0.7-1.2 s
ANALYZER_PROMPT = """You classify one utterance from a candidate in a live case interview. Earlier the candidate asked the interviewer for time, so the interviewer is waiting silently. Decide what this utterance is:
- hand_back: they are done thinking and are now talking to the interviewer: giving an answer or framework, asking a question, or saying they are ready.
- wants_time: they ask for (more) time, or ask the interviewer to wait, hold on or stop. If they name a duration, give it in seconds.
- still_thinking: thinking aloud, talking to themselves, fragments, fillers or acknowledgements such as "okay" or "hmm".
Reply with JSON only: {"intent": "hand_back" | "wants_time" | "still_thinking", "wait_seconds": number or null}"""
CONTROL_MARKER = "BROWSER_CONTROL_MARKER"
REACTIVE = {"end_of_speech", "short_answer", "hand_back", "watchdog"}
ITEM_ADDED = {"conversation.item.created", "conversation.item.added", "conversation.item.done"}

CALLS: dict[str, "Call"] = {}
HTTP: aiohttp.ClientSession | None = None


def now_ms() -> float:
    return time.monotonic() * 1000


def load_key() -> str:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            name, sep, value = line.strip().partition("=")
            if sep and name.strip() == "OPENAI_API_KEY":
                key = value.strip().strip('"').strip("'")
    if not key:
        raise SystemExit("OPENAI_API_KEY not found in the environment or the repo's .env")
    return key


KEY = load_key()
SAFETY_ID = hashlib.sha256(b"case-owl-phase0-spike").hexdigest()[:32]


def auth() -> dict:
    return {"Authorization": f"Bearer {KEY}"}


def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    vals = sorted(values)
    return round(vals[min(len(vals) - 1, int(q * (len(vals) - 1) + 0.5))])


def sanitize(raw: dict) -> dict:
    s = dict(DEFAULTS)
    for key, default in DEFAULTS.items():
        if key not in raw:
            continue
        value = raw[key]
        if isinstance(default, (int, float)) and not isinstance(default, bool):
            try:
                value = type(default)(value)
            except (TypeError, ValueError):
                continue
        elif not isinstance(value, str):
            continue
        if key in CHOICES and value not in CHOICES[key]:
            continue
        s[key] = value
    s["silence_ms"] = max(200, min(3000, s["silence_ms"]))
    s["threshold"] = max(0.1, min(0.95, s["threshold"]))
    return s


def initial_session(s: dict) -> dict:
    """Sent with the SDP offer. Turn detection is set here so no auto-reply can happen
    before the sideband connects."""
    if s["vad"] == "semantic":  # a model judges whether they finished, so a mid-thought pause need not end the turn
        detection = {"type": "semantic_vad", "eagerness": "auto"}
    else:
        detection = {"type": "server_vad", "threshold": s["threshold"], "prefix_padding_ms": PREFIX_PADDING_MS,
                     "silence_duration_ms": s["silence_ms"]}
    return {
        "type": "realtime",
        "model": s["model"],
        "instructions": BASE_INSTRUCTIONS,
        "audio": {
            "input": {"turn_detection": {**detection, "create_response": False, "interrupt_response": False}},
            "output": {"voice": s["voice"]},
        },
    }


class Call:
    """One interview: the sideband socket, the turn state and the measurements."""

    def __init__(self, call_id: str, settings: dict, probes: dict):
        self.id, self.settings, self.probes = call_id, settings, probes
        server_vad = settings["vad"] == "server"  # its timestamps include padding and the silence window
        self.state = turns.TurnState(prefix_padding_ms=PREFIX_PADDING_MS if server_vad else 0,
                                     silence_ms=settings["silence_ms"] if server_vad else 0)
        self.queue: asyncio.Queue = asyncio.Queue()
        self.ws: aiohttp.ClientWebSocketResponse | None = None
        self.ui: set[web.WebSocketResponse] = set()
        self.watchers: list[tuple] = []
        self.tasks: list[asyncio.Task] = []
        self.closed = False
        self.seq = 0
        # measurements
        self.turn: dict | None = None
        self.turn_log: list[dict] = []
        self.committed_at: dict[str, float] = {}
        self.transcript_ms: list[float] = []
        self.felt_ms: list[float] = []
        self.counts: dict[str, int] = {}
        self.usage = {k: 0 for k in ("responses", "input", "cached", "audio_in", "text_in", "cached_audio",
                                     "cached_text", "audio_out", "text_out", "cancelled")}
        self.cost_usd = 0.0
        self.seen_audio_buffer_events = False
        self.vad_has_timestamps: bool | None = None
        self.note_n = 0
        self.note_id: str | None = None
        self.last_interviewer = ""
        self.candidate_said = ""                 # everything the candidate has said, for the fact gates
        self.sent_reasons: list[str] = []        # reasons of response.create calls not yet created
        self.current_reason: str | None = None   # reason of the response being generated
        self.current_text = ""                   # its transcript so far
        self.guarded = False                     # the guard already stopped this response
        self.intro_started: float | None = None  # when small talk began, for the steering notes
        self.item_text: dict[str, str] = {}      # interviewer item id -> what she said (for interruptions)
        self.spoken_items: list[str] = []        # interviewer message items, in playback order
        self.preambles: dict[tuple, str] = {}    # (response id, "commentary") -> what the preamble said
        # response id -> {"items", "calls", "audio", "spoke"}: what each reply produced and whether any of it
        # was played, so a reply that ends unheard can be taken out of the conversation.
        self.responses: dict[str, dict] = {}
        self.current_item: str | None = None     # interviewer item being generated
        self.guard_items: set[str] = set()       # items the guard cut on purpose
        self.analyzer_ms: list[float] = []
        self.analyzer_source = {"llm": 0, "fallback": 0}
        self.started = time.strftime("%Y%m%d-%H%M%S")
        RESULTS.mkdir(exist_ok=True)
        self.log_file = open(RESULTS / f"{self.started}-{call_id}.jsonl", "w", buffering=1)  # line-buffered: readable live
        self.t0 = now_ms()

    # --- plumbing --------------------------------------------------------------

    def next_id(self, tag: str) -> str:
        self.seq += 1
        return f"{tag}_{self.seq}"

    def log(self, direction: str, ev: dict) -> None:
        if not self.log_file.closed:
            self.log_file.write(json.dumps({"t": round(now_ms() - self.t0), "dir": direction, "ev": ev}) + "\n")

    async def send(self, obj: dict, eid: str | None = None) -> None:
        if eid:
            obj["event_id"] = eid
        self.log("out", obj)
        if self.ws and not self.ws.closed:
            await self.ws.send_str(json.dumps(obj))

    async def ui_send(self, obj: dict) -> None:
        for ws in list(self.ui):
            try:
                await ws.send_json(obj)
            except (ConnectionResetError, RuntimeError):
                self.ui.discard(ws)

    def watch(self, pred) -> asyncio.Future:
        fut = asyncio.get_running_loop().create_future()
        self.watchers.append((pred, fut))
        return fut

    async def system_item(self, text: str, tag: str) -> str:
        item_id = self.next_id(tag)
        await self.send({"type": "conversation.item.create", "item": {
            "id": item_id, "type": "message", "role": "system",
            "content": [{"type": "input_text", "text": text}]}}, eid=f"evt_{item_id}")
        return item_id

    # --- lifecycle -------------------------------------------------------------

    async def start(self) -> None:
        """Connect the sideband. Retries because the call may not accept it until media is up."""
        last = None
        for attempt in range(10):
            try:
                self.ws = await HTTP.ws_connect(f"{SIDEBAND_URL}?call_id={self.id}", headers=auth(),
                                                heartbeat=20, max_msg_size=0)
                self.probes["sideband_connect"] = {"ok": True, "attempts": attempt + 1}
                break
            except (aiohttp.ClientError, asyncio.TimeoutError) as err:
                last = err
                await asyncio.sleep(0.5 + 0.5 * attempt)
        else:
            self.probes["sideband_connect"] = {"ok": False, "detail": str(last)}
            await self.ui_send({"type": "error", "message": f"Sideband connect failed: {last}"})
            return
        self.tasks = [asyncio.create_task(self.reader()), asyncio.create_task(self.actor())]
        update = {"type": "realtime", "tools": TOOLS, "tool_choice": "auto", "audio": {"input": {
            "transcription": {"model": self.settings["transcription_model"]},
            "noise_reduction": {"type": self.settings["noise"]}}}}
        if self.settings["reasoning"]:
            update["reasoning"] = {"effort": self.settings["reasoning"]}
        result = await self.probe(lambda: self.send({"type": "session.update", "session": update}, eid="setup"),
                                  lambda e: e.get("type") == "session.updated", "setup")
        self.probes["session_update_transcription_and_reasoning"] = result
        await self.ui_send({"type": "ready", "probes": self.probes})

    async def end(self) -> dict:
        if self.closed:
            return self.summary()
        self.closed = True
        summary = self.summary()
        (RESULTS / f"{self.started}-{self.id}-summary.json").write_text(json.dumps(summary, indent=2))
        await self.ui_send({"type": "summary", "summary": summary})
        if self.ws and not self.ws.closed:
            await self.ws.close()
        for task in self.tasks:
            task.cancel()
        self.log_file.close()
        CALLS.pop(self.id, None)
        return summary

    # --- the event loop: reader feeds the actor --------------------------------

    async def reader(self) -> None:
        async for msg in self.ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                continue
            ev = json.loads(msg.data)
            self.log("in", ev)
            mapped = self.to_turn_event(ev)
            if mapped:  # the turn rules see this event before anything observe() derives from it
                self.queue.put_nowait(mapped)
            await self.observe(ev)  # bookkeeping (unheard items, interruption note, tool calls), then waiters
            for pred, fut in list(self.watchers):
                if not fut.done() and pred(ev):
                    fut.set_result(ev)
                    self.watchers.remove((pred, fut))
        await self.ui_send({"type": "error", "message": "Sideband closed"})
        self.queue.put_nowait(None)

    async def actor(self) -> None:
        while (ev := await self.queue.get()) is not None:
            for effect in turns.handle(self.state, ev):
                await self.apply(effect)

    def to_turn_event(self, ev: dict) -> dict | None:
        t = ev.get("type")
        if t == "input_audio_buffer.speech_started":
            return {"type": "speech_started", "audio_start_ms": ev.get("audio_start_ms")}
        if t == "input_audio_buffer.speech_stopped":
            return {"type": "speech_stopped", "audio_end_ms": ev.get("audio_end_ms")}
        if t == "input_audio_buffer.committed":
            return {"type": "committed", "item_id": ev.get("item_id")}
        if t == "conversation.item.input_audio_transcription.completed":
            return {"type": "transcript", "item_id": ev.get("item_id"), "text": ev.get("transcript", "")}
        if t == "conversation.item.input_audio_transcription.failed":
            return {"type": "transcript", "item_id": ev.get("item_id"), "text": ""}
        if t == "response.created":
            return {"type": "response_created"}
        if t == "response.done":
            return {"type": "response_done"}
        if t == "output_audio_buffer.started":
            return {"type": "audio_started"}
        if t in ("output_audio_buffer.stopped", "output_audio_buffer.cleared"):
            return {"type": "audio_stopped"}
        return None

    async def apply(self, e: dict) -> None:
        do = e["do"]
        if do == "create_response":
            await self.speak(e["reason"], e.get("prompt"))
        elif do == "stage":
            if e["stage"] == "intro":
                self.intro_started = now_ms()
            await self.ui_send({"type": "stage", "stage": e["stage"]})
        elif do == "analyze":
            asyncio.create_task(self.analyze(e["item_id"], e["text"]))
        elif do == "cancel_response":
            await self.send({"type": "response.cancel"}, eid=self.next_id("cancel"))
            await self.ui_send({"type": "engine", "text": "cancel response"})
        elif do == "clear_audio":
            await self.send({"type": "output_audio_buffer.clear"}, eid=self.next_id("clear"))
        elif do == "delete_item":
            await self.send({"type": "conversation.item.delete", "item_id": e["item_id"]}, eid=self.next_id("del"))
            await self.ui_send({"type": "engine", "text": f"deleted {e['reason']} item, no reply"})
        elif do == "set_timer":
            asyncio.get_running_loop().call_later(
                e["ms"] / 1000, self.queue.put_nowait, {"type": "timer", "kind": e["kind"], "gen": e["gen"]})
        elif do == "mode":
            await self.ui_send({"type": "mode", "mode": e["mode"]})
        elif do == "metric":
            self.counts[e["name"]] = self.counts.get(e["name"], 0) + 1
            await self.ui_send({"type": "engine", "text": e["name"].replace("_", " ")})

    async def speak(self, reason: str, prompt: str | None = None) -> None:
        """Ask the interviewer for a reply. The steering note goes in first, so it steers this reply rather than
        the next one (it used to follow the transcript, which lands after the reply has already started)."""
        if prompt:
            await self.system_item(prompt, reason)
        if reason in STEERED:
            await self.write_note()
        if self.turn is not None and "create_sent" not in self.turn and reason in REACTIVE:
            self.turn.update(create_sent=now_ms(), reason=reason)
        self.sent_reasons.append(reason)
        create = {"type": "response.create"}
        if options := response_options(reason):
            create["response"] = options
        await self.send(create, eid=self.next_id(f"resp_{reason}"))
        await self.ui_send({"type": "engine", "text": f"reply: {reason}"})

    async def write_note(self) -> None:
        """The steering note: a system item (cache-friendly) or, for comparison, the
        instructions (expected to lower the cache rate)."""
        mode = self.settings["note_mode"]
        if mode == "off":
            return
        self.note_n += 1
        chatting = now_ms() - (self.intro_started or now_ms())
        note = steering_note(self.state.stage, self.state.mode, self.note_n, chatting)
        if mode == "instructions":
            await self.send({"type": "session.update", "session": {
                "type": "realtime", "instructions": f"{BASE_INSTRUCTIONS}\n\n{note}"}},
                eid=self.next_id("note_instr"))
            return
        previous, self.note_id = self.note_id, await self.system_item(note, "note")
        if previous and mode == "item":  # item_keep leaves old notes in place, so the cached prefix survives
            await self.send({"type": "conversation.item.delete", "item_id": previous}, eid=self.next_id("note_del"))

    async def analyze(self, item_id: str, text: str) -> None:
        """Listening mode: is the candidate still thinking, handing back, or asking for more time?
        A small LLM decides; keyword rules take over if it fails or is slow."""
        start, source = now_ms(), "llm"
        try:
            body = {"model": ANALYZER_MODEL, "temperature": 0, "max_tokens": 40,
                    "response_format": {"type": "json_object"},
                    "messages": [{"role": "system", "content": ANALYZER_PROMPT},
                                 {"role": "user", "content": f"Interviewer's last words: "
                                                             f"{self.last_interviewer or '(none)'}\nCandidate: {text}"}]}
            async with HTTP.post("https://api.openai.com/v1/chat/completions", json=body, headers=auth(),
                                 timeout=aiohttp.ClientTimeout(total=ANALYZER_TIMEOUT_S)) as r:
                data = await r.json()
            if r.status != 200:
                raise ValueError((data.get("error") or {}).get("message", f"HTTP {r.status}"))
            verdict = json.loads(data["choices"][0]["message"]["content"])
            intent = verdict.get("intent")
            if intent not in ("hand_back", "wants_time", "still_thinking"):
                raise ValueError(f"unexpected intent {intent!r}")
            wait_ms = None
            if intent == "wants_time":
                seconds = verdict.get("wait_seconds")
                named = (max(turns.MIN_WAIT_MS, min(turns.MAX_WAIT_MS, int(seconds * 1000) + turns.WAIT_GRACE_MS))
                         if isinstance(seconds, (int, float)) and seconds > 0 else None)
                wait_ms = turns.requested_wait_ms(text) or named or turns.THINK_MS
            result = {"intent": intent, "wait_ms": wait_ms}
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, KeyError, IndexError,
                json.JSONDecodeError) as err:
            source, result = "fallback", turns.classify_fallback(text)
            await self.ui_send({"type": "error", "message": f"analyzer: {err or type(err).__name__}; "
                                                            "using keyword fallback"})
        ms = round(now_ms() - start)
        self.analyzer_ms.append(ms)
        self.analyzer_source[source] += 1
        self.log("analysis", {"item_id": item_id, "text": text, **result, "source": source, "ms": ms})
        await self.ui_send({"type": "engine", "text": f"listening: {result['intent']} ({source}, {ms} ms)"})
        self.queue.put_nowait({"type": "analysis", "item_id": item_id, **result})

    # --- measurements ----------------------------------------------------------

    async def observe(self, ev: dict) -> None:
        t, now = ev.get("type", ""), now_ms()
        if t == "input_audio_buffer.speech_started":
            if self.vad_has_timestamps is None:
                self.vad_has_timestamps = "audio_start_ms" in ev
        elif t == "input_audio_buffer.speech_stopped":
            self.vad_has_timestamps = bool(self.vad_has_timestamps) and "audio_end_ms" in ev
            self.turn = {"stopped": now}
        elif t == "input_audio_buffer.committed":
            self.committed_at[ev.get("item_id")] = now
        elif t == "conversation.item.input_audio_transcription.completed":
            started = self.committed_at.pop(ev.get("item_id"), None)
            if started is not None:
                self.transcript_ms.append(now - started)
            self.candidate_said += " " + ev.get("transcript", "")
            await self.ui_send({"type": "transcript", "role": "candidate", "text": ev.get("transcript", "")})
        elif t == "response.created":
            if self.turn is not None and "create_sent" in self.turn and "created" not in self.turn:
                self.turn["created"] = now
            self.current_reason = self.sent_reasons.pop(0) if self.sent_reasons else None
            self.current_text, self.guarded = "", False
            rid = (ev.get("response") or {}).get("id")
            if rid:
                self.responses[rid] = {"items": [], "calls": [], "audio": False, "spoke": False}
        elif t == "response.output_item.added":
            rec = self.responses.get(ev.get("response_id"))
            if rec is not None and (ev.get("item") or {}).get("id"):
                rec["items"].append(ev["item"]["id"])
        elif t.startswith("output_audio_buffer."):
            self.seen_audio_buffer_events = True
            if t == "output_audio_buffer.started":
                if ev.get("response_id") in self.responses:
                    self.responses[ev["response_id"]]["audio"] = True
                await self.audio_began(now)
        elif t == "response.output_audio_transcript.delta":  # current name only; legacy duplicates ignored
            if not self.seen_audio_buffer_events:
                await self.audio_began(now)
            self.current_text += ev.get("delta", "")
            self.current_item = ev.get("item_id") or self.current_item
            if self.current_item:
                if self.current_item not in self.item_text:
                    self.spoken_items.append(self.current_item)
                self.item_text[self.current_item] = self.item_text.get(self.current_item, "") + ev.get("delta", "")
            await self.ui_send({"type": "delta", "role": "interviewer", "item_id": ev.get("item_id"),
                                "text": ev.get("delta", "")})
            if self.state.stage == "case" and not self.guarded and self.current_reason not in GUARD_EXEMPT:
                hit = guard.check(self.current_text, self.candidate_said)
                if hit:
                    self.guarded = True
                    asyncio.create_task(self.stop_leak(hit))
        elif t == "conversation.item.truncated":
            await self.note_interruption(ev.get("item_id"), ev.get("audio_end_ms"))
        elif t == "response.output_audio_transcript.done":
            self.last_interviewer = ev.get("transcript", "")
            if ev.get("item_id"):
                if ev["item_id"] not in self.item_text:
                    self.spoken_items.append(ev["item_id"])
                self.item_text[ev["item_id"]] = self.last_interviewer
            await self.ui_send({"type": "transcript", "role": "interviewer", "item_id": ev.get("item_id"),
                                "text": self.last_interviewer})
        elif t == "response.output_item.done" and (ev.get("item") or {}).get("type") == "function_call":
            rec = self.responses.get(ev.get("response_id"))
            if rec is not None:
                rec["calls"].append(ev["item"])  # run once the reply completes; a cancelled reply never happened
            else:
                asyncio.create_task(self.on_tool_call(ev["item"], spoke=False))
        elif t == "response.output_item.done" and (ev.get("item") or {}).get("type") == "message":
            rec = self.responses.get(ev.get("response_id"))
            if rec is not None and any(c.get("transcript") or c.get("text") for c in ev["item"].get("content") or []):
                rec["spoke"] = True
            await self.count_preamble(ev.get("response_id"), ev["item"])
        elif t == "response.done":
            await self.add_usage(ev.get("response") or {})
            await self.settle(ev.get("response") or {})
        elif t == "error":
            err = ev.get("error") or {}
            await self.ui_send({"type": "error", "message": err.get("message"), "event_id": err.get("event_id")})

    async def settle(self, response: dict) -> None:
        """A reply has ended. Keep the conversation equal to what the candidate heard: a reply that ended
        unheard (cancelled before any audio, e.g. because they kept talking after a pause) is deleted, so the
        model never builds on words nobody heard. A partly heard reply is trimmed by OpenAI and handled by
        note_interruption. Tool calls run only when their reply completed."""
        rec = self.responses.pop(response.get("id"), None)
        if rec is None:
            return
        if response.get("status") == "completed":
            for call in rec["calls"]:
                await self.on_tool_call(call, spoke=rec["spoke"])
            return
        if not self.seen_audio_buffer_events:
            return  # cannot tell what was played
        calls = {c.get("id") for c in rec["calls"]}
        unheard = [i for i in rec["items"] if not rec["audio"] or i in calls]
        for item_id in unheard:
            await self.send({"type": "conversation.item.delete", "item_id": item_id}, eid=self.next_id("unheard"))
            if item_id in self.spoken_items:
                self.spoken_items.remove(item_id)
            self.item_text.pop(item_id, None)
        if unheard:
            self.counts["unheard_reply_dropped"] = self.counts.get("unheard_reply_dropped", 0) + 1
            self.log("unheard_reply_dropped", {"response_id": response.get("id"), "items": unheard})
            await self.ui_send({"type": "retract", "item_ids": unheard})
            await self.ui_send({"type": "engine", "text": "reply cancelled before it was heard: removed from the "
                                                          "conversation"})

    async def on_tool_call(self, item: dict, spoke: bool) -> None:
        """The interviewer decided something should happen; the engine checks it is allowed and does it.
        Tools are called silently and she speaks after the result, so every tool that needs words gets
        exactly one spoken follow-up (none if she already spoke in the same reply)."""
        name, call_id = item.get("name"), item.get("call_id")
        try:
            args = json.loads(item.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        self.counts[f"tool_{name}"] = self.counts.get(f"tool_{name}", 0) + 1
        self.log("tool_call", {"name": name, "args": args, "spoke_first": spoke})
        if name == "start_case":
            if self.state.stage == "case":
                await self.tool_output(call_id, {"ok": False, "detail": "The case has already started."})
                return
            self.queue.put_nowait({"type": "case_started"})
            await self.tool_output(call_id, {"case_brief": CASE_BRIEF})
            self.queue.put_nowait({"type": "say", "reason": "case_brief"})  # the turn rules pick the moment
            await self.ui_send({"type": "engine", "text": "interviewer called start_case: presenting the case"})
        elif name == "wait_for_candidate":
            wait_ms = turns.wait_ms_for(args.get("seconds"))
            self.queue.put_nowait({"type": "tool_wait", "wait_ms": wait_ms})
            await self.tool_output(call_id, {"ok": True, "waiting_seconds": round(wait_ms / 1000),
                                             **({} if spoke else {"next": WAIT_RESULT})})
            if not spoke:
                self.queue.put_nowait({"type": "say", "reason": "tool_ack"})
            await self.ui_send({"type": "engine",
                                "text": f"interviewer called wait_for_candidate: check in after {round(wait_ms / 1000)} s"})
        else:
            await self.tool_output(call_id, {"ok": False, "detail": f"Unknown tool {name}."})

    async def tool_output(self, call_id: str, result: dict) -> None:
        await self.send({"type": "conversation.item.create", "item": {
            "type": "function_call_output", "call_id": call_id, "output": json.dumps(result)}},
            eid=self.next_id("tool_out"))

    async def count_preamble(self, response_id: str | None, item: dict) -> None:
        """gpt-realtime-2.x can speak a preamble ("commentary") before its answer ("final_answer"), and the
        answer can repeat it word for word. On WebRTC both are played and cannot be told apart in the audio,
        so the fix is upstream (no preambles, no tools on speech-only replies); this only measures it."""
        text = " ".join(c.get("transcript", "") for c in item.get("content") or []).strip()
        key = (response_id, "commentary")
        if item.get("phase") == "commentary":
            if text:
                self.counts["preamble_spoken"] = self.counts.get("preamble_spoken", 0) + 1
            self.preambles[key] = text
            return
        said = self.preambles.pop(key, None)
        if item.get("phase") == "final_answer" and said and said.lower() == text.lower():
            self.counts["repeated_preamble"] = self.counts.get("repeated_preamble", 0) + 1
            await self.ui_send({"type": "engine", "text": "answer repeated the preamble word for word"})

    async def note_interruption(self, item_id: str | None, heard_ms: int | None) -> None:
        """OpenAI trimmed her reply to what was played. Tell her where she was cut off, so she can
        pick up from there instead of losing her place."""
        if not item_id or item_id in self.guard_items or heard_ms is None:
            return  # cut by the guard on purpose
        heard, missed = turns.heard_portion(self.item_text.get(item_id, ""), heard_ms)
        # Messages queued behind the cut one were never played: drop them from her memory, since a fact
        # only counts as said if it was heard, and tell her what the candidate missed.
        later = self.spoken_items[self.spoken_items.index(item_id) + 1:] if item_id in self.spoken_items else []
        for unheard in later:
            missed = f"{missed} {self.item_text.get(unheard, '')}".strip()
            await self.send({"type": "conversation.item.delete", "item_id": unheard}, eid=self.next_id("unheard"))
            self.spoken_items.remove(unheard)
        if not missed:
            return  # they heard all of it
        if not heard:  # the cut message was barely heard: show the last thing that was
            earlier = self.spoken_items[:self.spoken_items.index(item_id)] if item_id in self.spoken_items else []
            heard = self.item_text.get(earlier[-1], "") if earlier else ""
        note = INTERRUPTED_NOTE.format(heard_tail=" ".join(heard.split()[-12:]), missed=missed)
        await self.system_item(note, "interrupted")
        self.counts["interrupted_note"] = self.counts.get("interrupted_note", 0) + 1
        self.log("interruption", {"item_id": item_id, "heard_ms": heard_ms, "heard": heard, "missed": missed,
                                  "dropped_unheard": later})
        await self.ui_send({"type": "engine", "text": f"cut off after ~{round(heard_ms / 1000)} s; told her what "
                                                      f"they missed (“{missed[:70]}…”)"})

    async def stop_leak(self, hit: dict) -> None:
        """The interviewer started to answer her own question or state an unasked fact: cut her off,
        drop the queued audio, and hand the floor back."""
        name = f"guard_{hit['kind']}"
        self.counts[name] = self.counts.get(name, 0) + 1
        if self.current_item:
            self.guard_items.add(self.current_item)  # cut on purpose: no "pick up where you left off" note
        self.log("guard", {**hit, "reply_so_far": self.current_text})
        await self.ui_send({"type": "engine", "text": f"guard: {hit['kind']} “{hit['term']}”, cutting in"})
        done = self.watch(lambda e: e.get("type") == "response.done")
        await self.apply({"do": "cancel_response"})
        await self.apply({"do": "clear_audio"})
        await self.outcome(done, lambda e: {"ok": True}, timeout=1.5)
        self.queue.put_nowait({"type": "say", "reason": "guard", "prompt": GUARD_PROMPT})

    async def audio_began(self, now: float) -> None:
        turn = self.turn
        if not turn or "create_sent" not in turn or "audio" in turn:
            return
        turn["audio"] = now
        row = {
            "reason": turn.get("reason"),
            "decision_ms": round(turn["create_sent"] - turn["stopped"]),
            "to_created_ms": round(turn["created"] - turn["stopped"]) if "created" in turn else None,
            "to_audio_ms": round(now - turn["stopped"]),
        }
        self.turn_log.append(row)
        self.turn = None
        await self.ui_send({"type": "turn", "row": row})

    async def add_usage(self, response: dict) -> None:
        u = response.get("usage") or {}
        itd, otd = u.get("input_token_details") or {}, u.get("output_token_details") or {}
        ctd = itd.get("cached_tokens_details") or {}
        audio_in, text_in = itd.get("audio_tokens", 0), itd.get("text_tokens", 0)
        cached = itd.get("cached_tokens", 0)
        if ctd:
            cached_audio, cached_text = ctd.get("audio_tokens", 0), ctd.get("text_tokens", 0)
        else:  # no breakdown reported: split cached tokens in proportion to the input mix
            total = audio_in + text_in
            cached_audio = round(cached * audio_in / total) if total else 0
            cached_text = cached - cached_audio
        audio_out, text_out = otd.get("audio_tokens", 0), otd.get("text_tokens", 0)
        for key, value in (("input", u.get("input_tokens", 0)), ("cached", cached), ("audio_in", audio_in),
                           ("text_in", text_in), ("cached_audio", cached_audio), ("cached_text", cached_text),
                           ("audio_out", audio_out), ("text_out", text_out)):
            self.usage[key] += value
        self.usage["responses"] += 1
        if response.get("status") == "cancelled":
            self.usage["cancelled"] += 1
        p = PRICES
        self.cost_usd += (max(0, text_in - cached_text) * p["text_in"] + cached_text * p["text_in_cached"]
                          + max(0, audio_in - cached_audio) * p["audio_in"] + cached_audio * p["audio_in_cached"]
                          + text_out * p["text_out"] + audio_out * p["audio_out"]) / 1e6
        await self.ui_send({"type": "usage", "usage": self.usage, "cost_usd": round(self.cost_usd, 4)})

    def summary(self) -> dict:
        def stats(values):
            return {"n": len(values), "p50": pct(values, 0.5), "p95": pct(values, 0.95)}
        cached_share = self.usage["cached"] / self.usage["input"] if self.usage["input"] else None
        return {
            "call_id": self.id,
            "settings": self.settings,
            "minutes": round((now_ms() - self.t0) / 60000, 2),
            "latency_ms": {
                "decision (speech_stopped to response.create sent)": stats([r["decision_ms"] for r in self.turn_log]),
                "speech_stopped to response.created": stats([r["to_created_ms"] for r in self.turn_log
                                                             if r["to_created_ms"] is not None]),
                "speech_stopped to audio start (engine clock)": stats([r["to_audio_ms"] for r in self.turn_log]),
                "felt: mic end to remote audio (browser)": stats(self.felt_ms),
                "committed to transcript": stats(self.transcript_ms),
            },
            "silence_window_ms": self.settings["silence_ms"],
            "analyzer": {"model": ANALYZER_MODEL, "latency_ms": stats(self.analyzer_ms),
                         "sources": self.analyzer_source},
            "counts": self.counts,
            "usage": self.usage,
            "cached_share_of_input": round(cached_share, 3) if cached_share is not None else None,
            "cost_usd_estimate": round(self.cost_usd, 4),
            "probes": {
                **self.probes,
                "sideband_sees_output_audio_buffer": self.seen_audio_buffer_events,
                "vad_events_have_audio_ms": self.vad_has_timestamps,
            },
            "turns": self.turn_log,
        }

    # --- probes ----------------------------------------------------------------

    async def probe(self, send, ok, eid: str, timeout: float = 5.0) -> dict:
        fut = self.watch(lambda e: ok(e) or (e.get("type") == "error"
                                             and (e.get("error") or {}).get("event_id") == eid))
        start = now_ms()
        await send()
        try:
            ev = await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            return {"ok": None, "detail": f"no answer within {timeout:.0f} s"}
        if ev.get("type") == "error":
            return {"ok": False, "detail": (ev.get("error") or {}).get("message"), "ms": round(now_ms() - start)}
        return {"ok": True, "event": ev.get("type"), "ms": round(now_ms() - start)}

    async def run_probes(self) -> None:
        p = self.probes
        item = self.next_id("probe_sys")
        p["system_role_item_create"] = await self.probe(
            lambda: self.send({"type": "conversation.item.create", "item": {
                "id": item, "type": "message", "role": "system",
                "content": [{"type": "input_text", "text": "Probe note: ignore this."}]}}, eid="probe_sys"),
            lambda e: e.get("type") in ITEM_ADDED and (e.get("item") or {}).get("id") == item, "probe_sys")
        p["item_delete"] = await self.probe(
            lambda: self.send({"type": "conversation.item.delete", "item_id": item}, eid="probe_del"),
            lambda e: e.get("type") == "conversation.item.deleted" and e.get("item_id") == item, "probe_del")

        await self.system_item("Say exactly this, slowly: probe check, one, two, three, four, five, six, seven, "
                               "eight, nine, ten.", "probe_say")
        p["sideband_response_create"] = await self.probe(
            lambda: self.send({"type": "response.create"}, eid="probe_resp"),
            lambda e: e.get("type") == "response.created", "probe_resp")
        if p["sideband_response_create"]["ok"]:
            await asyncio.sleep(1.5)  # let audio start
            done = self.watch(lambda e: e.get("type") == "response.done")
            cleared = self.watch(lambda e: e.get("type") == "output_audio_buffer.cleared"
                                 or (e.get("type") == "error" and (e.get("error") or {}).get("event_id") == "probe_clear"))
            await self.send({"type": "response.cancel"}, eid="probe_cancel")
            await self.send({"type": "output_audio_buffer.clear"}, eid="probe_clear")
            p["sideband_response_cancel"] = await self.outcome(done, lambda e: {
                "ok": True, "status": (e.get("response") or {}).get("status")})
            p["output_audio_buffer_clear"] = await self.outcome(cleared, lambda e: {
                "ok": e.get("type") != "error", "detail": (e.get("error") or {}).get("message") or e.get("type")})
        await self.ui_send({"type": "probes", "probes": self.summary()["probes"]})

    async def outcome(self, fut: asyncio.Future, describe, timeout: float = 4.0) -> dict:
        try:
            return describe(await asyncio.wait_for(fut, timeout))
        except asyncio.TimeoutError:
            return {"ok": None, "detail": f"no answer within {timeout:.0f} s"}

    async def browser_control_check(self) -> None:
        """The page sent session.update over its data channel; did it change the session?"""
        fut = self.watch(lambda e: e.get("type") == "session.updated"
                         and CONTROL_MARKER in ((e.get("session") or {}).get("instructions") or ""))
        result = await self.outcome(fut, lambda e: {"ok": True, "detail": "the browser CAN change the session"})
        if result["ok"] is None:
            result = {"ok": False, "detail": "no change seen: the browser could not change the session"}
        self.probes["browser_can_control_session"] = result
        await self.send({"type": "session.update", "session": {"type": "realtime", "instructions": BASE_INSTRUCTIONS}},
                        eid="restore_instructions")
        await self.ui_send({"type": "probes", "probes": self.summary()["probes"]})

    # --- messages from the page ------------------------------------------------

    async def on_ui(self, m: dict) -> None:
        kind = m.get("type")
        if kind == "start":
            self.queue.put_nowait({"type": "start"})  # the turn rules own the opening
        elif kind == "run_probes":
            asyncio.create_task(self.run_probes())
        elif kind == "browser_control_check":
            asyncio.create_task(self.browser_control_check())
        elif kind == "playback" and not self.seen_audio_buffer_events:
            # Fallback when the sideband does not see output_audio_buffer events.
            self.queue.put_nowait({"type": "audio_started" if m.get("state") == "started" else "audio_stopped"})
            if m.get("state") == "started":
                await self.audio_began(now_ms())
        elif kind == "text_turn" and isinstance(m.get("text"), str) and m["text"].strip():
            # A typed candidate turn, for testing without a mic. It skips voice activity detection.
            text = m["text"].strip()[:500]
            if self.state.response_active or self.state.assistant_audio:  # interrupts her, as speech would
                done = self.watch(lambda e: e.get("type") == "response.done")
                trimmed = self.watch(lambda e: e.get("type") == "conversation.item.truncated")
                if self.state.response_active:
                    await self.apply({"do": "cancel_response"})
                    await self.outcome(done, lambda e: {"ok": True}, timeout=1.5)
                if self.state.assistant_audio:  # wait for OpenAI's trim, so the interruption note lands first
                    await self.apply({"do": "clear_audio"})
                    await self.outcome(trimmed, lambda e: {"ok": True}, timeout=1.5)
            await self.send({"type": "conversation.item.create", "item": {
                "type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}},
                eid=self.next_id("typed"))
            self.candidate_said += " " + text
            await self.ui_send({"type": "transcript", "role": "candidate", "text": f"{text} (typed)"})
            self.queue.put_nowait({"type": "typed"})
        elif kind == "simulate_interrupt":
            # Testing hook: cut the interviewer off the way a barge-in does, without a mic.
            await self.apply({"do": "cancel_response"})
            await self.apply({"do": "clear_audio"})
        elif kind == "felt" and isinstance(m.get("ms"), (int, float)):
            self.felt_ms.append(float(m["ms"]))
        elif kind == "client_probe" and m.get("name") in ("call_without_data_channel",):
            self.probes[m["name"]] = m.get("result")
        elif kind == "summary":
            await self.ui_send({"type": "summary", "summary": self.summary()})
        elif kind == "end":
            await self.end()


# --- HTTP routes -----------------------------------------------------------------

async def index(_request: web.Request) -> web.FileResponse:
    return web.FileResponse(HERE / "client.html")


async def create_call(request: web.Request) -> web.Response:
    body = await request.json()
    settings = sanitize(body.get("settings") or {})
    # Explicit content types make aiohttp send multipart/form-data; plain string
    # fields would go as a URL-encoded form, which /realtime/calls rejects.
    form = aiohttp.FormData()
    form.add_field("sdp", body.get("sdp", ""), content_type="application/sdp")
    form.add_field("session", json.dumps(initial_session(settings)), content_type="application/json")
    start = now_ms()
    try:
        async with HTTP.post(CALLS_URL, data=form, headers={**auth(), "OpenAI-Safety-Identifier": SAFETY_ID}) as r:
            answer, status, location = await r.text(), r.status, r.headers.get("Location")
    except aiohttp.ClientError as err:
        return web.json_response({"error": f"Could not reach OpenAI: {err}"}, status=502)
    probes = {"server_sdp_exchange": {"ok": 200 <= status < 300, "status": status, "ms": round(now_ms() - start)},
              "location_header_has_call_id": {"ok": bool(location), "detail": location}}
    if not 200 <= status < 300:
        return web.json_response({"error": f"OpenAI /realtime/calls returned {status}", "detail": answer[:600],
                                  "probes": probes}, status=502)
    call_id = location.rstrip("/").rsplit("/", 1)[-1] if location else None
    if not call_id:
        return web.json_response({"sdp": answer, "call_id": None, "probes": probes,
                                  "error": "No Location header: the sideband cannot attach to this call"})
    call = Call(call_id, settings, probes)
    CALLS[call_id] = call
    asyncio.create_task(call.start())  # the browser needs the answer before media (and perhaps the sideband) is up
    return web.json_response({"sdp": answer, "call_id": call_id, "settings": settings, "probes": probes})


async def ui_socket(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    call = CALLS.get(request.query.get("call_id", ""))
    if not call:
        await ws.send_json({"type": "error", "message": "Unknown call"})
        await ws.close()
        return ws
    call.ui.add(ws)
    await ws.send_json({"type": "hello", "settings": call.settings, "probes": call.probes})
    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.TEXT:
            await call.on_ui(json.loads(msg.data))
    call.ui.discard(ws)
    return ws


async def on_startup(_app: web.Application) -> None:
    global HTTP
    # Verify TLS against the OS trust store, as curl does; python.org builds and
    # corporate TLS inspection often break Python's bundled CA list.
    connector = aiohttp.TCPConnector(ssl=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT))
    HTTP = aiohttp.ClientSession(connector=connector, timeout=aiohttp.ClientTimeout(total=30))


async def on_cleanup(_app: web.Application) -> None:
    for call in list(CALLS.values()):
        await call.end()
    await HTTP.close()


def main() -> None:
    app = web.Application()
    app.add_routes([web.get("/", index), web.post("/call", create_call), web.get("/ui", ui_socket)])
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    print(f"Phase 0 spike on http://localhost:{PORT}  (results in {RESULTS})")
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
