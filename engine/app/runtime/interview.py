"""One live interview: the sideband, the turn rules, the fact gate, the guard, the clock and the end.

Ported from the phase 0 spike's `Call` (engine/spike/server.py) without its probes and test-page
plumbing. What the spike established, and this keeps:
- The engine is the only turn authority (turns.py), and the conversation equals what the candidate
  heard: unheard replies are deleted, cut-off replies trimmed, with a note of what was missed.
- Tools are called silently and she speaks once after them; lines the engine asks for are speech only.
- She holds only the case statement; facts come one at a time through lookup_fact (facts.py).

New for the service (docs/engine-contract.md): the ledger of what was heard, the page's messages,
the time cap, ending and the settle callback, re-offer after a dropped call, recovery after a restart.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

import httpx

from ..config import Settings
from ..contract import (CallConfig, CallStatus, ReofferRequired, Retract, SessionEnded, SessionReady, SettlePayload,
                        SettleSummary, Snapshot, SnapshotEntry, StageMsg, ThinkTimer, TimeMsg, Transcript,
                        TranscriptDelta, TranscriptEntry, Wire, parse_page_message, AudioLive, EndSession, Activity)
from ..errors import AppError, UpstreamError
from ..realtime import Realtime, Sideband
from ..settle import SettleClient
from ..store import SETTLE_OWED, Store
from . import facts, guard, prompts, turns
from .ledger import Ledger

log = logging.getLogger("engine.interview")

PREFIX_PADDING_MS = 400
CLOSING_GRACE_S = 20.0  # the closing line gets this long before the call ends anyway
ANALYZER_TIMEOUT_S = 3.5  # from India a cold first call took 2.6 s; warm calls 0.7-1.2 s
# USD per million tokens (OpenAI pricing page, Oct 2026). gpt-realtime-2 and 2.1 are priced the same.
PRICES = {"text_in": 4.0, "text_in_cached": 0.40, "audio_in": 32.0, "audio_in_cached": 0.40,
          "text_out": 24.0, "audio_out": 64.0}
MODEL_PRICES = {"gpt-realtime-2.1-mini": {"text_in": 0.60, "text_in_cached": 0.06, "audio_in": 10.0,
                                          "audio_in_cached": 0.30, "text_out": 2.40, "audio_out": 20.0}}
FOLLOW_UP = {"case_brief", "fact_answer", "tool_ack"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Services:
    settings: Settings
    realtime: Realtime
    store: Store
    http: httpx.AsyncClient
    settle: SettleClient
    on_finished: Callable[["Interview"], None]


class Interview:
    def __init__(self, svc: Services, *, session_id: str, user_id: str, case: facts.Case, max_minutes: int,
                 config: CallConfig, call_id: str | None = None):
        s = svc.settings
        self.svc, self.settings = svc, s
        self.id = call_id or ""              # the interview's id: the first OpenAI call's id
        self.openai_call_id = ""             # the current OpenAI call (changes on re-offer)
        self.session_id, self.user_id, self.case = session_id, user_id, case
        self.max_minutes, self.config = max_minutes, config
        self.state = "connecting"
        self.created_at = utcnow()
        self.started_at: datetime | None = None   # when the greeting was asked for: the clock starts
        self.ended_at: datetime | None = None
        self.ended_reason: str | None = None
        self.wrap_up = False
        self.closing = False
        self.audio_live = False
        self.started = False
        self.ledger = Ledger()
        self.released: set[str] = set()
        self.counts: dict[str, int] = {}
        self.cost_usd = 0.0
        self.settle_state: dict = {"status": "pending", "attempts": 0, "lastError": ""}
        self.handed_off = False              # shut down here; the next instance carries on
        self.ui: set = set()
        self.sb: Sideband | None = None
        self.queue: asyncio.Queue = asyncio.Queue()
        self.tasks: set[asyncio.Task] = set()
        self.timers: list[asyncio.TimerHandle] = []
        self.reoffer_timer: asyncio.TimerHandle | None = None
        self.events: list[dict] = []
        self.persist_task: asyncio.Task | None = None
        self.settle_task: asyncio.Task | None = None
        self.epoch = 0                       # bumps on re-offer, so timers from the old call are ignored
        self.t0 = time.monotonic()
        self._reset_conversation(stage="waiting")
        self.actor = self._spawn(self._actor())

    # --- conversation state (reset when a re-offer starts a new OpenAI call) --------------------

    def _reset_conversation(self, stage: str) -> None:
        s = self.settings
        silence = s.case_silence_ms if stage == "case" and s.case_silence_ms else s.silence_ms
        self.turn = turns.TurnState(stage=stage, prefix_padding_ms=PREFIX_PADDING_MS, silence_ms=silence,
                                    case_silence_ms=s.case_silence_ms)
        self.responses: dict[str, dict] = {}     # response id -> {items, calls, audio, spoke, reason}
        self.reasons: dict[str, str | None] = {}  # response id -> why it was asked for (kept after it ends)
        self.sent_reasons: list[str] = []
        self.current_reason: str | None = None
        self.current_text = ""
        self.current_item: str | None = None
        self.guarded = False
        self.item_text: dict[str, str] = {}      # interviewer item id -> what she said
        self.spoken_items: list[str] = []        # interviewer message items, in playback order
        self.preambles: dict[str, str] = {}
        self.guard_items: set[str] = set()
        self.watchers: list[tuple] = []
        self.note_n, self.note_id = 0, None
        self.intro_started: float | None = None
        self.candidate_said = getattr(self, "candidate_said", "")
        self.last_candidate = getattr(self, "last_candidate", "")
        self.last_interviewer = getattr(self, "last_interviewer", "")
        self.seq = getattr(self, "seq", 0)
        self.turn_marks: dict | None = None

    # --- plumbing ----------------------------------------------------------------------------

    def _spawn(self, coro) -> asyncio.Task:
        task = asyncio.get_running_loop().create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    def next_id(self, tag: str) -> str:
        self.seq += 1
        return f"{tag}_{self.seq}"

    def event(self, kind: str, **payload) -> None:
        self.events.append({"sessionId": self.session_id, "callId": self.id, "type": kind, "payload": payload,
                            "t": round((time.monotonic() - self.t0) * 1000), "at": utcnow()})
        if len(self.events) >= 50:
            self._spawn(self.flush_events())

    async def flush_events(self) -> None:
        batch, self.events = self.events, []
        if batch:
            try:
                await self.svc.store.add_events(batch)
            except Exception:  # the decision log must never break an interview
                log.exception("could not store %d events", len(batch))

    def count(self, name: str) -> None:
        self.counts[name] = self.counts.get(name, 0) + 1

    async def send(self, event: dict, eid: str | None = None) -> None:
        if eid:
            event["event_id"] = eid
        if self.sb is None:
            return
        try:
            await self.sb.send(event)
        except Exception as err:
            log.warning("%s: sideband send failed: %s", self.id, err)

    async def system_item(self, text: str, tag: str) -> str:
        item_id = self.next_id(tag)
        await self.send({"type": "conversation.item.create", "item": {
            "id": item_id, "type": "message", "role": "system",
            "content": [{"type": "input_text", "text": text}]}}, eid=f"evt_{item_id}")
        return item_id

    def watch(self, pred) -> asyncio.Future:
        fut = asyncio.get_running_loop().create_future()
        self.watchers.append((pred, fut))
        return fut

    async def ui_send(self, msg: Wire) -> None:
        payload = msg.wire()
        for ws in list(self.ui):
            try:
                await ws.send_json(payload)
            except Exception:
                self.ui.discard(ws)

    def _later(self, seconds: float, fn) -> asyncio.TimerHandle:
        """A clock timer (scaled in tests), firing a coroutine function."""
        handle = asyncio.get_running_loop().call_later(seconds * self.settings.time_scale,
                                                       lambda: self._spawn(fn()))
        self.timers.append(handle)
        return handle

    # --- OpenAI session --------------------------------------------------------------------

    def turn_detection(self, silence_ms: int) -> dict:
        """The whole object, every time: a partial update could switch auto replies back on."""
        return {"type": "server_vad", "threshold": self.settings.vad_threshold, "prefix_padding_ms": PREFIX_PADDING_MS,
                "silence_duration_ms": silence_ms, "create_response": False, "interrupt_response": False}

    def initial_session(self) -> dict:
        """Sent with the SDP offer, so no auto-reply can happen before the sideband connects."""
        return {"type": "realtime", "model": self.settings.realtime_model, "instructions": prompts.BASE_INSTRUCTIONS,
                "audio": {"input": {"turn_detection": self.turn_detection(self.turn.silence_ms)},
                          "output": {"voice": self.settings.voice}}}

    def session_update(self) -> dict:
        s = self.settings
        session = {"type": "realtime", "tools": prompts.TOOLS, "tool_choice": "auto",
                   "audio": {"input": {"transcription": {"model": s.transcription_model},
                                       "noise_reduction": {"type": s.noise_reduction}}}}
        if s.reasoning:
            session["reasoning"] = {"effort": s.reasoning}
        return {"type": "session.update", "session": session}

    async def open(self, sdp_offer: str) -> str:
        """Create the OpenAI call from the page's offer and start steering it. Returns the SDP answer."""
        call_id, answer = await self.svc.realtime.create_call(sdp_offer, self.initial_session())
        self.id = self.id or call_id
        self.openai_call_id = call_id
        self.event("call_created", openaiCallId=call_id)
        await self.persist()
        self._spawn(self._attach(rebuild=False))
        return answer

    async def _attach(self, rebuild: bool, attempts: int = 10) -> bool:
        call_id = self.openai_call_id
        try:
            sb = await self.svc.realtime.connect(call_id, attempts=attempts)
        except UpstreamError as err:
            log.warning("%s: sideband attach failed: %s", self.id, err)
            self.event("sideband_failed", detail=str(err))
            if not rebuild and not self.started:
                self._spawn(self.end("upstream_error"))
            return False
        if call_id != self.openai_call_id or self.state in ("ending", "ended"):
            await sb.close()  # superseded by a re-offer, or over
            return False
        self.sb = sb
        await self.send(self.session_update(), eid=self.next_id("setup"))
        self._spawn(self._reader(sb))
        self.state = "live"
        self.event("sideband_ready", rebuild=rebuild)
        if rebuild:
            await self._restore_context()
        await self.persist()
        if not self.started:
            self._later(self.settings.start_timeout_s, self._start_timeout)
        await self.maybe_start()
        return True

    async def _start_timeout(self) -> None:
        if not self.started and self.state == "live":
            await self.end("candidate_disconnected")  # the page never brought its audio up

    async def maybe_start(self) -> None:
        if self.started or not self.audio_live or self.sb is None or self.state != "live":
            return
        self.started = True
        self.started_at = utcnow()
        if self.config.candidate_first_name:
            await self.system_item(prompts.candidate_name_note(self.config.candidate_first_name), "name")
        self.queue.put_nowait({"type": "start"})
        self._start_clock(self.max_minutes * 60)
        await self.persist()

    # --- the event loop: reader feeds the actor ---------------------------------------------

    async def _reader(self, sb: Sideband) -> None:
        async for ev in sb.events():
            if sb is not self.sb:
                break
            mapped = self.to_turn_event(ev)
            if mapped:  # the turn rules see this event before anything observe() derives from it
                self.queue.put_nowait(mapped)
            try:
                await self.observe(ev)
            except Exception:
                log.exception("%s: observe failed on %s", self.id, ev.get("type"))
            for pred, fut in list(self.watchers):
                if not fut.done() and pred(ev):
                    fut.set_result(ev)
                    self.watchers.remove((pred, fut))
        if sb is self.sb and self.state == "live":
            self._spawn(self._sideband_lost())

    async def _actor(self) -> None:
        while (ev := await self.queue.get()) is not None:
            try:
                for effect in turns.handle(self.turn, ev):
                    await self.apply(effect)
            except Exception:
                log.exception("%s: turn rules failed on %s", self.id, ev.get("type"))

    @staticmethod
    def to_turn_event(ev: dict) -> dict | None:
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
                self.intro_started = time.monotonic()
            if e["stage"] in ("intro", "case") and not self.wrap_up:
                await self.ui_send(StageMsg(stage=e["stage"]))
            self.event("stage", stage=e["stage"])
        elif do == "analyze":
            self._spawn(self.analyze(e["item_id"], e["text"]))
        elif do == "cancel_response":
            await self.send({"type": "response.cancel"}, eid=self.next_id("cancel"))
        elif do == "clear_audio":
            await self.send({"type": "output_audio_buffer.clear"}, eid=self.next_id("clear"))
        elif do == "delete_item":
            await self.send({"type": "conversation.item.delete", "item_id": e["item_id"]}, eid=self.next_id("del"))
            self.ledger.remove([e["item_id"]])
            self.event("deleted", item=e["item_id"], reason=e["reason"])
        elif do == "set_timer":
            epoch = self.epoch
            loop = asyncio.get_running_loop()
            loop.call_later(e["ms"] / 1000, lambda: epoch == self.epoch and self.queue.put_nowait(
                {"type": "timer", "kind": e["kind"], "gen": e["gen"]}))
            if e["kind"] == "think" and self.turn.mode == "listening":
                await self.ui_send(ThinkTimer(state="started", seconds=round(e["ms"] / 1000)))
        elif do == "mode":
            if e["mode"] == "conversation":
                await self.ui_send(ThinkTimer(state="ended"))
            self.event("mode", mode=e["mode"])
        elif do == "silence":
            await self.send({"type": "session.update", "session": {"type": "realtime", "audio": {"input": {
                "turn_detection": self.turn_detection(e["ms"])}}}}, eid=self.next_id("silence"))
        elif do == "metric":
            self.count(e["name"])
            self.event("metric", **{k: v for k, v in e.items() if k != "do"})

    async def speak(self, reason: str, prompt: str | None = None) -> None:
        """Ask the interviewer for a reply. The steering note goes in first, so it steers this reply."""
        if prompt:
            await self.system_item(prompt, reason)
        if reason in prompts.STEERED:
            await self.write_note()
        if self.turn_marks is not None and "sent" not in self.turn_marks and reason in prompts.REACTIVE:
            self.turn_marks.update(sent=time.monotonic(), reason=reason)
        self.sent_reasons.append(reason)
        create = {"type": "response.create"}
        if options := prompts.response_options(reason):
            create["response"] = options
        await self.send(create, eid=self.next_id(f"resp_{reason}"))

    async def write_note(self) -> None:
        """The steering note: one system item at the end of the conversation; the previous one is deleted."""
        self.note_n += 1
        chatting = (time.monotonic() - self.intro_started) * 1000 if self.intro_started else 0
        note = prompts.steering_note(self.turn.stage, self.turn.mode, self.note_n, chatting)
        if self.wrap_up:
            note += " About two minutes are left: help them land a recommendation."
        previous, self.note_id = self.note_id, await self.system_item(note, "note")
        if previous:
            await self.send({"type": "conversation.item.delete", "item_id": previous}, eid=self.next_id("note_del"))

    # --- what happened: the ledger, the page, the replies ------------------------------------

    async def observe(self, ev: dict) -> None:
        t = ev.get("type", "")
        if t == "input_audio_buffer.speech_stopped":
            self.turn_marks = {"stopped": time.monotonic()}
        elif t == "conversation.item.added":
            self._ledger_add(ev.get("item") or {})
        elif t == "conversation.item.input_audio_transcription.completed":
            text, item_id = ev.get("transcript", ""), ev.get("item_id")
            self.candidate_said += " " + text
            self.last_candidate = text
            if item_id in self.ledger:  # a blip or noise deleted at commit is gone already
                self.ledger.set_text(item_id, text)
                if text.strip():
                    await self.ui_send(Transcript(role="candidate", text=text, item_id=item_id))
                self.schedule_persist()
        elif t == "response.created":
            self.current_reason = self.sent_reasons.pop(0) if self.sent_reasons else None
            self.current_text, self.guarded = "", False
            rid = (ev.get("response") or {}).get("id")
            if rid:
                self.responses[rid] = {"items": [], "calls": [], "audio": False, "spoke": False,
                                       "reason": self.current_reason}
                self.reasons[rid] = self.current_reason
        elif t == "response.output_item.added":
            rec, item = self.responses.get(ev.get("response_id")), ev.get("item") or {}
            if rec is not None and item.get("id"):
                rec["items"].append(item["id"])
        elif t == "output_audio_buffer.started":
            rec = self.responses.get(ev.get("response_id"))
            if rec is not None:
                rec["audio"] = True
            self._turn_audio()
        elif t == "output_audio_buffer.stopped":
            if self.closing and self.reasons.get(ev.get("response_id")) == "closing":
                self._spawn(self.end("time_cap"))
        elif t == "response.output_audio_transcript.delta":
            delta, item_id = ev.get("delta", ""), ev.get("item_id")
            self.current_text += delta
            self.current_item = item_id or self.current_item
            if item_id:
                if item_id not in self.item_text:
                    self.spoken_items.append(item_id)
                self.item_text[item_id] = self.item_text.get(item_id, "") + delta
                self.ledger.append(item_id, delta)
                await self.ui_send(TranscriptDelta(role="interviewer", text=delta, item_id=item_id))
            if self.turn.stage == "case" and not self.guarded and self.current_reason not in prompts.GUARD_EXEMPT:
                hit = guard.check(self.current_text, self.candidate_said, self.case, self.released)
                if hit:
                    self.guarded = True
                    self._spawn(self.stop_leak(hit))
        elif t == "conversation.item.truncated":
            await self.note_interruption(ev.get("item_id"), ev.get("audio_end_ms"))
        elif t == "response.output_audio_transcript.done":
            text, item_id = ev.get("transcript", ""), ev.get("item_id")
            self.last_interviewer = text
            if item_id:
                if item_id not in self.item_text:
                    self.spoken_items.append(item_id)
                self.item_text[item_id] = text
                self.ledger.set_text(item_id, text)
                await self.ui_send(Transcript(role="interviewer", text=text, item_id=item_id))
                self.schedule_persist()
        elif t == "response.output_item.done":
            item, rec = ev.get("item") or {}, self.responses.get(ev.get("response_id"))
            if item.get("type") == "function_call":
                if rec is not None:
                    rec["calls"].append(item)  # run once the reply completes; a cancelled reply never happened
                else:
                    self._spawn(self.run_tools([item], spoke=False))
            elif item.get("type") == "message":
                if rec is not None and any(c.get("transcript") or c.get("text") for c in item.get("content") or []):
                    rec["spoke"] = True
                self.count_preamble(ev.get("response_id"), item)
        elif t == "response.done":
            await self.add_usage(ev.get("response") or {})
            await self.settle_response(ev.get("response") or {})
        elif t == "error":
            err = ev.get("error") or {}
            if err.get("code") == "response_cancel_not_active":  # the reply finished as the cancel went out
                self.count("cancel_raced")
            else:
                self.event("openai_error", code=err.get("code"), message=err.get("message"),
                           eventId=err.get("event_id"))

    def _ledger_add(self, item: dict) -> None:
        if item.get("type") != "message" or item.get("role") not in ("user", "assistant"):
            return
        if str(item.get("id", "")).startswith("rb_"):
            return  # history replayed into a new call after a drop: already in the ledger
        text = " ".join((c.get("text") or c.get("transcript") or "") for c in item.get("content") or []).strip()
        self.ledger.add(item["id"], "candidate" if item["role"] == "user" else "interviewer", text)

    def _turn_audio(self) -> None:
        marks = self.turn_marks
        if not marks or "sent" not in marks or "audio" in marks:
            return
        marks["audio"] = time.monotonic()
        self.event("turn", reason=marks.get("reason"), toAudioMs=round((marks["audio"] - marks["stopped"]) * 1000))
        self.turn_marks = None

    async def settle_response(self, response: dict) -> None:
        """A reply has ended. Keep the conversation equal to what the candidate heard: a reply that ended
        unheard is deleted, so nothing builds on words nobody heard. Tool calls run only if it completed."""
        rec = self.responses.pop(response.get("id"), None)
        if rec is None:
            return
        if response.get("status") == "completed":
            if rec["calls"]:  # a task: lookup_fact waits on a matcher call and must not hold up the reader
                self._spawn(self.run_tools(rec["calls"], spoke=rec["spoke"]))
            return
        calls = {c.get("id") for c in rec["calls"]}
        unheard = [i for i in rec["items"] if not rec["audio"] or i in calls]
        for item_id in unheard:
            await self.send({"type": "conversation.item.delete", "item_id": item_id}, eid=self.next_id("unheard"))
            if item_id in self.spoken_items:
                self.spoken_items.remove(item_id)
            self.item_text.pop(item_id, None)
        if unheard:
            self.ledger.remove(unheard)
            self.count("unheard_reply_dropped")
            await self.ui_send(Retract(item_ids=unheard))

    def count_preamble(self, response_id: str | None, item: dict) -> None:
        """Measured only: speech before a tool call is prevented upstream (speech-only replies)."""
        text = " ".join(c.get("transcript", "") for c in item.get("content") or []).strip()
        if item.get("phase") == "commentary":
            if text:
                self.count("preamble_spoken")
            self.preambles[response_id or ""] = text
            return
        said = self.preambles.pop(response_id or "", None)
        if item.get("phase") == "final_answer" and said and said.lower() == text.lower():
            self.count("repeated_preamble")

    async def note_interruption(self, item_id: str | None, heard_ms: int | None) -> None:
        """OpenAI trimmed her reply to what was played. Mirror it in the ledger and tell her what the
        candidate missed, so she can pick up from there."""
        if not item_id or item_id in self.guard_items or heard_ms is None:
            return  # cut by the guard on purpose
        later = self.spoken_items[self.spoken_items.index(item_id) + 1:] if item_id in self.spoken_items else []
        if heard_ms < prompts.UNHEARD_MS:
            # A word at most: nothing to pick up. Treat it as never said, so she does not resume an
            # acknowledgement ("As I was saying, got it").
            gone = [item_id] + later
            for unheard in gone:
                await self.send({"type": "conversation.item.delete", "item_id": unheard}, eid=self.next_id("unheard"))
                if unheard in self.spoken_items:
                    self.spoken_items.remove(unheard)
            self.ledger.remove(gone)
            await self.ui_send(Retract(item_ids=gone))
            self.count("barely_heard_dropped")
            return
        heard, missed = turns.heard_portion(self.item_text.get(item_id, ""), heard_ms)
        self.ledger.set_text(item_id, heard)
        for unheard in later:
            missed = f"{missed} {self.item_text.get(unheard, '')}".strip()
            await self.send({"type": "conversation.item.delete", "item_id": unheard}, eid=self.next_id("unheard"))
            self.spoken_items.remove(unheard)
        if later:
            self.ledger.remove(later)
            await self.ui_send(Retract(item_ids=later))
        if not missed:
            return
        if not heard:
            earlier = self.spoken_items[:self.spoken_items.index(item_id)] if item_id in self.spoken_items else []
            heard = self.item_text.get(earlier[-1], "") if earlier else ""
        await self.system_item(prompts.INTERRUPTED_NOTE.format(heard_tail=" ".join(heard.split()[-12:]),
                                                               missed=missed), "interrupted")
        self.count("interrupted_note")
        self.event("interruption", item=item_id, heardMs=heard_ms, droppedUnheard=later)

    async def stop_leak(self, hit: dict) -> None:
        """She started to answer her own question, state an unasked fact or name a branch first: cut her
        off, drop the queued audio, and hand the floor back."""
        self.count("guard_hit")
        if self.current_item:
            self.guard_items.add(self.current_item)
        self.event("guard", kind=hit["kind"], term=hit["term"])
        done = self.watch(lambda e: e.get("type") == "response.done")
        await self.apply({"do": "cancel_response"})
        await self.apply({"do": "clear_audio"})
        try:
            await asyncio.wait_for(done, 1.5)
        except asyncio.TimeoutError:
            pass
        self.queue.put_nowait({"type": "say", "reason": "guard", "prompt": prompts.GUARD_PROMPT})

    # --- tools ------------------------------------------------------------------------------

    async def run_tools(self, calls: list[dict], spoke: bool) -> None:
        """Run a completed reply's tool calls in order, then ask for one spoken follow-up."""
        wanted = [r for r in [await self.on_tool_call(call, spoke) for call in calls] if r]
        if wanted:
            self.queue.put_nowait({"type": "say", "reason": min(wanted, key=prompts.FOLLOW_UP_RANK.index)})

    async def on_tool_call(self, item: dict, spoke: bool) -> str | None:
        name, call_id = item.get("name"), item.get("call_id")
        try:
            args = json.loads(item.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        self.count(f"tool_{name}")
        self.event("tool_call", name=name, args=args, spokeFirst=spoke)
        if name == "start_case":
            if self.turn.stage == "case":
                await self.tool_output(call_id, {"ok": False, "detail": "The case has already started."})
                return None
            self.queue.put_nowait({"type": "case_started"})
            await self.tool_output(call_id, {"case_brief": prompts.case_brief(self.case.statement)})
            return "case_brief"
        if name == "wait_for_candidate":
            wait_ms = turns.wait_ms_for(args.get("seconds"))
            self.queue.put_nowait({"type": "tool_wait", "wait_ms": wait_ms})
            await self.tool_output(call_id, {"ok": True, "waiting_seconds": round(wait_ms / 1000),
                                             **({} if spoke else {"next": prompts.WAIT_RESULT})})
            return None if spoke else "tool_ack"
        if name == "lookup_fact":
            question = str(args.get("question") or "")[:300]
            if self.turn.stage != "case":
                await self.tool_output(call_id, {"facts": [], "say": "The case has not started yet; there is "
                                                                     "nothing to look up."})
                return "fact_answer"
            self.candidate_said += " " + question  # her restatement: cleaner than the transcript, for the guard
            s = self.settings
            start = time.monotonic()
            result = await facts.lookup(self.svc.http, s.openai_api_key, s.fact_model, self.case, question,
                                        self.released, said=self.last_candidate)
            self.count(f"fact_{result['status']}")
            self.event("fact", question=question, status=result["status"], ids=result.get("ids", []),
                       ms=round((time.monotonic() - start) * 1000), error=result.get("error"))
            await self.tool_output(call_id, {k: result[k] for k in ("facts", "say")})
            self.schedule_persist()
            return "fact_answer"
        await self.tool_output(call_id, {"ok": False, "detail": f"Unknown tool {name}."})
        return None

    async def tool_output(self, call_id: str, result: dict) -> None:
        await self.send({"type": "conversation.item.create", "item": {
            "type": "function_call_output", "call_id": call_id, "output": json.dumps(result)}},
            eid=self.next_id("tool_out"))

    async def analyze(self, item_id: str, text: str) -> None:
        """Listening mode: still thinking, handing back, or asking for more time? A small LLM decides;
        keyword rules take over if it fails or is slow."""
        s, start, source = self.settings, time.monotonic(), "llm"
        try:
            body = facts.chat_body(s.analyzer_model, prompts.ANALYZER_PROMPT,
                                   f"Interviewer's last words: {self.last_interviewer or '(none)'}\nCandidate: {text}", 40)
            verdict = await facts.chat_json(self.svc.http, s.openai_api_key, body, ANALYZER_TIMEOUT_S)
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
        except (httpx.HTTPError, asyncio.TimeoutError, ValueError, KeyError, IndexError, json.JSONDecodeError):
            source, result = "fallback", turns.classify_fallback(text)
        self.event("analysis", intent=result["intent"], source=source, ms=round((time.monotonic() - start) * 1000))
        self.queue.put_nowait({"type": "analysis", "item_id": item_id, **result})

    # --- usage -------------------------------------------------------------------------------

    async def add_usage(self, response: dict) -> None:
        u = response.get("usage") or {}
        itd, otd = u.get("input_token_details") or {}, u.get("output_token_details") or {}
        ctd = itd.get("cached_tokens_details") or {}
        audio_in, text_in, cached = itd.get("audio_tokens", 0), itd.get("text_tokens", 0), itd.get("cached_tokens", 0)
        if ctd:
            cached_audio, cached_text = ctd.get("audio_tokens", 0), ctd.get("text_tokens", 0)
        else:
            total = audio_in + text_in
            cached_audio = round(cached * audio_in / total) if total else 0
            cached_text = cached - cached_audio
        p = MODEL_PRICES.get(self.settings.realtime_model, PRICES)
        self.cost_usd += (max(0, text_in - cached_text) * p["text_in"] + cached_text * p["text_in_cached"]
                          + max(0, audio_in - cached_audio) * p["audio_in"] + cached_audio * p["audio_in_cached"]
                          + otd.get("text_tokens", 0) * p["text_out"] + otd.get("audio_tokens", 0) * p["audio_out"]) / 1e6
        if u:
            self.event("usage", input=u.get("input_tokens", 0), cached=cached, audioOut=otd.get("audio_tokens", 0),
                       status=response.get("status"))

    # --- the page ----------------------------------------------------------------------------

    def stage_name(self) -> str | None:
        if self.wrap_up:
            return "wrap_up"
        return self.turn.stage if self.turn.stage in ("intro", "case") else None

    def remaining_seconds(self) -> int | None:
        if not self.started_at:
            return None
        elapsed = (utcnow() - self.started_at).total_seconds() / self.settings.time_scale
        return max(0, round(self.max_minutes * 60 - elapsed))

    async def attach_ui(self, ws) -> None:
        self.ui.add(ws)
        await ws.send_json(SessionReady().wire())
        if self.started or self.ledger.heard():
            await ws.send_json(Snapshot(transcript=[SnapshotEntry(**e) for e in self.ledger.snapshot()],
                                        stage=self.stage_name(), remaining_seconds=self.remaining_seconds()).wire())
        if self.state == "awaiting_reoffer":
            await ws.send_json(ReofferRequired().wire())

    def detach_ui(self, ws) -> None:
        self.ui.discard(ws)

    async def on_ui(self, raw: dict) -> None:
        msg = parse_page_message(raw)
        if isinstance(msg, AudioLive):
            self.audio_live = True
            await self.maybe_start()
        elif isinstance(msg, EndSession):
            self._spawn(self.end("candidate_ended"))
        elif isinstance(msg, Activity):
            self.queue.put_nowait({"type": "activity"})

    # --- the clock ----------------------------------------------------------------------------

    def _start_clock(self, remaining_s: float) -> None:
        if remaining_s - 300 > 0:
            self._later(remaining_s - 300, self._five_left)
        if remaining_s - 120 > 0:
            self._later(remaining_s - 120, self._two_left)
        self._later(max(0.0, remaining_s), self._time_up)

    async def _five_left(self) -> None:
        await self.ui_send(TimeMsg(remaining_seconds=300))

    async def _two_left(self) -> None:
        self.wrap_up = True
        await self.ui_send(TimeMsg(remaining_seconds=120))
        await self.ui_send(StageMsg(stage="wrap_up"))
        self.queue.put_nowait({"type": "say", "reason": "wrap_up", "prompt": prompts.WRAP_UP_PROMPT})

    async def _time_up(self) -> None:
        if self.state != "live":
            return
        self.closing = True
        self.queue.put_nowait({"type": "say", "reason": "closing", "prompt": prompts.CLOSING_PROMPT})
        self._later(CLOSING_GRACE_S, lambda: self.end("time_cap"))

    # --- dropped calls, re-offer and recovery ----------------------------------------------------

    async def _sideband_lost(self) -> None:
        """Our control socket closed. Try the same call once more; if it is gone, the page re-offers."""
        self.sb = None
        self.event("sideband_lost")
        if await self._attach(rebuild=False, attempts=2):
            return
        await self.await_reoffer()

    async def await_reoffer(self) -> None:
        if self.state in ("ending", "ended"):
            return
        self.state = "awaiting_reoffer"
        await self.ui_send(ReofferRequired())
        if self.reoffer_timer:
            self.reoffer_timer.cancel()
        self.reoffer_timer = self._later(self.settings.reoffer_window_s, self._reoffer_expired)
        await self.persist()

    async def _reoffer_expired(self) -> None:
        if self.state == "awaiting_reoffer":
            await self.end("candidate_disconnected")

    async def reoffer(self, sdp_offer: str) -> str:
        """A new OpenAI call for the same interview, its context rebuilt from the ledger."""
        if self.state in ("ending", "ended"):
            raise AppError(410, "call_ended", "This interview has ended.")
        stage = self.turn.stage if self.turn.stage in ("intro", "case") else "waiting"
        self.epoch += 1
        self._reset_conversation(stage)
        old_call, old_sb = self.openai_call_id, self.sb
        self.sb = None
        new_call, answer = await self.svc.realtime.create_call(sdp_offer, self.initial_session())
        self.openai_call_id = new_call
        if self.reoffer_timer:
            self.reoffer_timer.cancel()
            self.reoffer_timer = None
        if old_sb:
            self._spawn(old_sb.close())
        if old_call and old_call != new_call:
            self._spawn(self.svc.realtime.hangup(old_call))
        self.state = "connecting"
        self.event("reoffer", openaiCallId=new_call)
        self._spawn(self._attach(rebuild=True))
        return answer

    async def _restore_context(self) -> None:
        """Replay what was heard into the new call, then let her pick up."""
        note = ["[ENGINE NOTE] The call dropped and has been restored. Everything below happened before the drop."]
        if self.turn.stage == "case":
            note.append("The case you are running:\n" + prompts.case_brief(self.case.statement))
        if self.released:
            note.append("Facts already given to the candidate: " +
                        " ".join(self.case.facts[i].answer for i in sorted(self.released) if i in self.case.facts))
        await self.system_item("\n\n".join(note), "rb_note")
        for n, entry in enumerate(self.ledger.heard()):
            role, kind = ("user", "input_text") if entry.role == "candidate" else ("assistant", "output_text")
            await self.send({"type": "conversation.item.create", "item": {
                "id": f"rb_{n}_{self.epoch}", "type": "message", "role": role,
                "content": [{"type": kind, "text": entry.text}]}}, eid=self.next_id("rb"))
        if self.started:
            self.queue.put_nowait({"type": "say", "reason": "reconnect", "prompt": prompts.RECONNECT_PROMPT})

    @classmethod
    def restore(cls, svc: Services, doc: dict, case: facts.Case) -> "Interview":
        """An interview from engine_sessions, taken over from an instance that shut down or crashed."""
        iv = cls(svc, session_id=doc["sessionId"], user_id=doc["userId"], case=case,
                 max_minutes=doc["limits"]["maxMinutes"], config=CallConfig.model_validate(doc.get("config") or {}),
                 call_id=doc["callId"])
        iv.openai_call_id = doc.get("openaiCallId", "")
        iv.created_at = doc.get("createdAt") or iv.created_at
        iv.started_at = doc.get("startedAt")
        iv.started = iv.started_at is not None
        iv.audio_live = iv.started
        iv.wrap_up = doc.get("stage") == "wrap_up"
        iv.ledger = Ledger.load(doc.get("ledger") or [])
        iv.released = set(doc.get("released") or [])
        iv.counts = dict(doc.get("counts") or {})
        iv.cost_usd = float(doc.get("costUsd") or 0.0)
        iv.ended_at, iv.ended_reason = doc.get("endedAt"), doc.get("endedReason")
        iv.settle_state = dict(doc.get("settle") or iv.settle_state)
        stage = {"wrap_up": "case"}.get(doc.get("stage"), doc.get("stage") or ("intro" if iv.started else "waiting"))
        iv._reset_conversation(stage if stage in ("intro", "case") else "waiting")
        if doc.get("state") == "ended":  # only the settle callback is left
            iv.state = "ended"
            iv.queue.put_nowait(None)
        else:
            iv.state = "connecting"  # until recover() reattaches, or asks the page to re-offer
        return iv

    async def recover(self) -> None:
        """After a hand-off or a crash: reattach to the same OpenAI call if it is still up (the candidate
        hears at most a pause), else wait for the page to re-offer. An interview that was ending finishes
        ending; one that had ended gets its settle callback delivered."""
        self.event("recovering")
        if self.state == "ended":
            self._start_settle()
            return
        if self.ended_reason:
            await self.end(self.ended_reason)
            return
        if self.started_at:
            remaining = self.remaining_seconds() or 0
            if remaining <= 0:
                await self.end("time_cap")
                return
            self._start_clock(remaining)
        if self.openai_call_id and await self._attach(rebuild=False, attempts=2):
            # The turn rules start fresh here, with no check-in pending: arm one as after any pause, so
            # a silence that began on the previous instance still gets "are you still with me?".
            self.queue.put_nowait({"type": "activity"})
            return
        await self.await_reoffer()

    # --- the end ----------------------------------------------------------------------------

    async def end(self, reason: str) -> None:
        """Idempotent. Hang up, save, settle with Node, then tell the page."""
        if self.state in ("ending", "ended"):
            return
        # An interview taken over mid-ending keeps the time it ended at.
        self.state, self.ended_reason, self.ended_at = "ending", reason, self.ended_at or utcnow()
        self.event("ended", reason=reason)
        for handle in self.timers:
            handle.cancel()
        if self.reoffer_timer:
            self.reoffer_timer.cancel()
        if self.openai_call_id:
            await self.svc.realtime.hangup(self.openai_call_id)
        sb, self.sb = self.sb, None
        if sb:
            try:
                await sb.close()
            except Exception:
                pass
        self.queue.put_nowait(None)  # stops the actor
        await self.persist()
        await self.flush_events()
        first = self._start_settle()
        try:  # the contract sends session_ended after Node's ack; a slow Node does not hold the page forever
            await asyncio.wait_for(first.wait(), self.settings.settle_ack_wait_s)
        except asyncio.TimeoutError:
            pass
        await self.ui_send(SessionEnded(reason=reason))
        for ws in list(self.ui):
            try:
                await ws.close(code=1000)
            except Exception:
                pass
        self.ui.clear()
        self.state = "ended"
        await self.persist()

    def _start_settle(self) -> asyncio.Event:
        """Deliver the settle callback in the background. The event is set after the first attempt."""
        first = asyncio.Event()

        async def on_result(ok: bool, attempts: int, error: str) -> None:
            self.settle_state = {"status": "acked" if ok else "retrying", "attempts": attempts, "lastError": error}
            await self.persist()
            first.set()

        if not self.svc.settle.enabled:  # stage 1 without a Node: the transcript stays in engine_sessions
            self.settle_state = {"status": "skipped", "attempts": 0, "lastError": "NODE_URL is not set"}
            first.set()
            self._spawn(self.persist())
            self.svc.on_finished(self)
            return first
        # A settle resumed after a restart keeps its 24-hour window, counted from the end of the interview.
        waited = (utcnow() - self.ended_at).total_seconds() / self.settings.time_scale if self.ended_at else 0.0
        self.settle_task = asyncio.get_running_loop().create_task(
            self.svc.settle.deliver(self.session_id, self.settle_payload(), on_result, waited_s=waited))
        self.settle_task.add_done_callback(lambda t: self._settle_finished(t))
        return first

    def _settle_finished(self, task: asyncio.Task) -> None:
        if self.handed_off:  # cancelled at shutdown: the next instance delivers it
            self.svc.on_finished(self)
            return
        error = None if task.cancelled() else task.exception()
        if error is not None:
            log.error("%s: settle crashed: %r", self.id, error)
        if task.cancelled() or error is not None or task.result() is not True:
            self.settle_state["status"] = "failed"
            self._spawn(self.persist())
        self.svc.on_finished(self)

    # --- hand-off -----------------------------------------------------------------------------

    def owes_work(self) -> bool:
        return self.state != "ended" or self.settle_state.get("status") in SETTLE_OWED

    async def hand_off(self) -> None:
        """Shutdown: stop steering, release the interview and leave its OpenAI call up. The next instance
        claims it and reattaches to the same call, so the candidate hears at most a pause. Nothing is
        hung up: only the engine's control socket closes."""
        if self.handed_off:
            return
        self.handed_off = True
        self.epoch += 1  # turn timers already set are ignored
        self.event("handed_off", state=self.state)
        for handle in self.timers:
            handle.cancel()
        if self.reoffer_timer:
            self.reoffer_timer.cancel()
        if self.settle_task and not self.settle_task.done():
            self.settle_task.cancel()
        sb, self.sb = self.sb, None
        if sb:
            try:
                await sb.close()
            except Exception:
                pass
        self.queue.put_nowait(None)
        for ws in list(self.ui):
            try:  # 1012 "service restart": the page reconnects and lands on the next instance
                await ws.close(code=1012)
            except Exception:
                pass
        self.ui.clear()
        await self.persist(final=True)
        await self.flush_events()

    def settle_payload(self) -> SettlePayload:
        started = self.started_at or self.created_at
        duration = max(0, round(((self.ended_at or utcnow()) - self.started_at).total_seconds())) if self.started_at else 0
        reached = self.stage_name() or ("intro" if self.started else "none")
        return SettlePayload(
            call_id=self.id, ended_reason=self.ended_reason or "engine_error", started_at=started,
            ended_at=self.ended_at or utcnow(), duration_seconds=duration,
            transcript=[TranscriptEntry(**e) for e in self.ledger.transcript()],
            summary=SettleSummary(stage_reached=reached, facts_released=sorted(self.released), hints_used=0,
                                  guard_hits=self.counts.get("guard_hit", 0), cost_usd=round(self.cost_usd, 4)))

    # --- persistence ---------------------------------------------------------------------------

    def doc(self) -> dict:
        return {"callId": self.id, "openaiCallId": self.openai_call_id, "sessionId": self.session_id,
                "userId": self.user_id, "caseId": self.case.id, "caseVersion": self.case.version, "state": self.state,
                "stage": self.stage_name(), "limits": {"maxMinutes": self.max_minutes},
                "config": self.config.model_dump(by_alias=True), "createdAt": self.created_at,
                "startedAt": self.started_at, "endedAt": self.ended_at, "endedReason": self.ended_reason,
                "released": sorted(self.released), "counts": self.counts, "costUsd": round(self.cost_usd, 4),
                "ledger": self.ledger.dump(), "settle": self.settle_state, "updatedAt": utcnow(),
                "owner": self.settings.instance_id,
                # No lease once handed off (the next instance claims it at once) or once nothing is owed.
                "leaseUntil": None if self.handed_off or not self.owes_work()
                else utcnow() + timedelta(seconds=self.settings.lease_s)}

    async def persist(self, final: bool = False) -> None:
        # After a hand-off only the hand-off's own save may write: a late one would overwrite the next owner's.
        if not self.id or (self.handed_off and not final):
            return
        try:
            await self.svc.store.save_session(self.doc())
        except Exception:
            log.exception("%s: could not save the session", self.id)

    def schedule_persist(self) -> None:
        """Ledger changes are saved within a second, a write per burst rather than per delta."""
        if self.persist_task and not self.persist_task.done():
            return

        async def later() -> None:
            await asyncio.sleep(1.0)
            await self.persist()
        self.persist_task = self._spawn(later())

    def status(self) -> CallStatus:
        elapsed = round((utcnow() - self.started_at).total_seconds()) if self.started_at else 0
        return CallStatus(state=self.state, stage=self.stage_name(), started_at=self.started_at, elapsed_seconds=elapsed)
