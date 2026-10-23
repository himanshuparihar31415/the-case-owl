"""In-process stand-ins for OpenAI and Node, so the whole flow runs in tests without either."""
from __future__ import annotations

import asyncio
import json

import httpx


class FakeSideband:
    def __init__(self, call_id: str):
        self.call_id = call_id
        self.sent: list[dict] = []
        self.closed = False
        self._q: asyncio.Queue = asyncio.Queue()

    async def send(self, event: dict) -> None:
        self.sent.append(event)

    async def events(self):
        while True:
            ev = await self._q.get()
            if ev is None:
                return
            yield ev

    async def close(self) -> None:
        self.closed = True
        self._q.put_nowait(None)

    def push(self, *events: dict) -> None:
        for ev in events:
            self._q.put_nowait(ev)

    def drop(self) -> None:
        """OpenAI closed the socket (the call ended, or the network broke)."""
        self._q.put_nowait(None)

    def creates(self) -> list[dict]:
        return [e for e in self.sent if e["type"] == "response.create"]

    def items(self, role: str | None = None) -> list[dict]:
        return [e["item"] for e in self.sent if e["type"] == "conversation.item.create"
                and (role is None or e["item"].get("role") == role)]

    async def wait_for(self, pred, timeout: float = 3.0) -> dict:
        async def poll():
            seen = 0
            while True:
                for ev in self.sent[seen:]:
                    if pred(ev):
                        return ev
                seen = len(self.sent)
                await asyncio.sleep(0.01)
        return await asyncio.wait_for(poll(), timeout)


class FakeRealtime:
    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.sidebands: dict[str, list[FakeSideband]] = {}
        self.hangups: list[str] = []
        self.refuse_connect: set[str] = set()
        self.refuse_calls = False

    async def create_call(self, sdp_offer: str, session: dict) -> tuple[str, str]:
        from app.errors import UpstreamError
        if self.refuse_calls:
            raise UpstreamError("OpenAI refused the call (500)", 500)
        call_id = f"rtc_fake_{len(self.calls) + 1}"
        self.calls.append((call_id, sdp_offer, session))
        return call_id, f"v=0\r\no=answer {call_id}\r\n"

    async def connect(self, call_id: str, attempts: int = 10) -> FakeSideband:
        from app.errors import UpstreamError
        if call_id in self.refuse_connect:
            raise UpstreamError("Sideband connect failed: call ended")
        sb = FakeSideband(call_id)
        self.sidebands.setdefault(call_id, []).append(sb)
        return sb

    async def hangup(self, call_id: str) -> None:
        self.hangups.append(call_id)

    async def sideband(self, call_id: str, n: int = 1, timeout: float = 3.0) -> FakeSideband:
        """The n-th sideband opened on a call, once the engine has opened it and sent its setup."""
        async def poll():
            while True:
                sbs = self.sidebands.get(call_id, [])
                if len(sbs) >= n and any(e["type"] == "session.update" for e in sbs[n - 1].sent):
                    return sbs[n - 1]
                await asyncio.sleep(0.01)
        return await asyncio.wait_for(poll(), timeout)


class FakeNode:
    """Node's settle endpoint, plus OpenAI's chat completions for the fact matcher and analyzer."""

    def __init__(self):
        self.settles: list[tuple[str, dict, dict]] = []   # (session id, payload, headers)
        self.fail_settles = 0
        self.match: dict = {"status": "unknown", "fact_ids": []}
        self.intent: dict = {"intent": "still_thinking", "wait_seconds": None}

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/internal/sessions/" in url and url.endswith("/settle"):
            if self.fail_settles > 0:
                self.fail_settles -= 1
                return httpx.Response(500, json={"error": "down"})
            session_id = url.split("/internal/sessions/")[1].split("/")[0]
            self.settles.append((session_id, json.loads(request.content), dict(request.headers)))
            return httpx.Response(200, json={"ok": True})
        if url.endswith("/v1/chat/completions"):
            body = json.loads(request.content)
            reply = self.match if "fact sheet" in body["messages"][0]["content"] else self.intent
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(reply)}}]})
        return httpx.Response(404, json={"error": "unexpected request " + url})


# --- OpenAI event sequences ---------------------------------------------------------------

def candidate_turn(item_id: str, text: str, start: int, end: int) -> list[dict]:
    """Speech, the commit and the transcript, as server VAD reports them (end includes the silence)."""
    return [{"type": "input_audio_buffer.speech_started", "audio_start_ms": start, "item_id": item_id},
            {"type": "input_audio_buffer.speech_stopped", "audio_end_ms": end, "item_id": item_id},
            {"type": "input_audio_buffer.committed", "item_id": item_id},
            {"type": "conversation.item.added", "item": {"id": item_id, "type": "message", "role": "user",
                                                         "content": [{"type": "input_audio"}]}},
            {"type": "conversation.item.input_audio_transcription.completed", "item_id": item_id, "transcript": text}]


def reply(response_id: str, item_id: str, text: str, audio: bool = True, status: str = "completed") -> list[dict]:
    """One spoken reply, from creation to the end of its audio."""
    evs = [{"type": "response.created", "response": {"id": response_id, "status": "in_progress"}},
           {"type": "response.output_item.added", "response_id": response_id,
            "item": {"id": item_id, "type": "message", "role": "assistant"}},
           {"type": "conversation.item.added", "item": {"id": item_id, "type": "message", "role": "assistant",
                                                        "content": []}}]
    if audio:
        evs.append({"type": "output_audio_buffer.started", "response_id": response_id})
    evs += [{"type": "response.output_audio_transcript.delta", "item_id": item_id, "delta": text},
            {"type": "response.output_audio_transcript.done", "item_id": item_id, "transcript": text},
            {"type": "response.output_item.done", "response_id": response_id,
             "item": {"id": item_id, "type": "message", "content": [{"transcript": text}], "phase": "final_answer"}},
            {"type": "response.done", "response": {"id": response_id, "status": status, "output": []}}]
    if audio:
        evs.append({"type": "output_audio_buffer.stopped", "response_id": response_id})
    return evs


def tool_reply(response_id: str, item_id: str, name: str, args: dict, call_id: str) -> list[dict]:
    """A reply that only calls a tool, silently."""
    item = {"id": item_id, "type": "function_call", "name": name, "arguments": json.dumps(args), "call_id": call_id}
    return [{"type": "response.created", "response": {"id": response_id, "status": "in_progress"}},
            {"type": "response.output_item.added", "response_id": response_id, "item": item},
            {"type": "response.output_item.done", "response_id": response_id, "item": item},
            {"type": "response.done", "response": {"id": response_id, "status": "completed", "output": []}}]
