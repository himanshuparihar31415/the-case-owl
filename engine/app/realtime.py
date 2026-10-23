"""OpenAI Realtime: create a WebRTC call from the page's offer, steer it over the sideband, hang up.

Measured in the phase 0 spike: the multipart SDP exchange returns 201 with the call ID in the
`Location` header in about 1.0-1.6 s from India; the sideband attaches on the first try. Tests use a
fake with the same three methods (tests/fakes.py).
"""
from __future__ import annotations

import asyncio
import json
import logging
import ssl
from typing import AsyncIterator, Protocol

import httpx
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from .errors import UpstreamError

log = logging.getLogger("engine.realtime")
CALLS_URL = "https://api.openai.com/v1/realtime/calls"
SIDEBAND_URL = "wss://api.openai.com/v1/realtime"


class Sideband(Protocol):
    async def send(self, event: dict) -> None: ...
    def events(self) -> AsyncIterator[dict]: ...
    async def close(self) -> None: ...


class Realtime(Protocol):
    async def create_call(self, sdp_offer: str, session: dict) -> tuple[str, str]: ...
    async def connect(self, call_id: str, attempts: int = 10) -> Sideband: ...
    async def hangup(self, call_id: str) -> None: ...


class OpenAISideband:
    def __init__(self, ws):
        self.ws = ws

    async def send(self, event: dict) -> None:
        await self.ws.send(json.dumps(event))

    async def events(self) -> AsyncIterator[dict]:
        try:
            async for raw in self.ws:
                if isinstance(raw, str):
                    yield json.loads(raw)
        except ConnectionClosed:
            return

    async def close(self) -> None:
        await self.ws.close()


class OpenAIRealtime:
    def __init__(self, http: httpx.AsyncClient, api_key: str, ssl_context: ssl.SSLContext | None = None):
        self.http, self.api_key, self.ssl = http, api_key, ssl_context

    def _auth(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def create_call(self, sdp_offer: str, session: dict) -> tuple[str, str]:
        """Returns (call_id, sdp_answer). Explicit content types make this multipart/form-data, which
        /realtime/calls requires (a urlencoded body is refused with 400)."""
        files = {"sdp": (None, sdp_offer, "application/sdp"),
                 "session": (None, json.dumps(session), "application/json")}
        try:
            r = await self.http.post(CALLS_URL, files=files, headers=self._auth(), timeout=15.0)
        except httpx.HTTPError as err:  # a timeout's message is empty: name the error
            log.warning("OpenAI call setup failed: %s: %s", type(err).__name__, err)
            raise UpstreamError(f"OpenAI call setup failed: {type(err).__name__} {err}".strip()) from err
        if r.status_code not in (200, 201):
            raise UpstreamError(f"OpenAI refused the call ({r.status_code}): {r.text[:300]}", r.status_code)
        call_id = r.headers.get("location", "").rstrip("/").rsplit("/", 1)[-1]
        if not call_id:
            raise UpstreamError("OpenAI returned no call ID in the Location header")
        return call_id, r.text

    async def connect(self, call_id: str, attempts: int = 10) -> OpenAISideband:
        """The call may not accept a sideband until media is up, so retry briefly."""
        last: Exception | None = None
        for attempt in range(attempts):
            try:
                # Pings keep idle proxies from closing the socket while the candidate thinks in silence; a
                # late pong must not kill an interview (evals saw "keepalive ping timeout" drops).
                ws = await ws_connect(f"{SIDEBAND_URL}?call_id={call_id}", additional_headers=self._auth(),
                                      ssl=self.ssl, max_size=None, ping_interval=20, ping_timeout=None,
                                      open_timeout=10)
                return OpenAISideband(ws)
            except (OSError, InvalidStatus, asyncio.TimeoutError) as err:
                last = err
                await asyncio.sleep(0.5 + 0.5 * attempt)
        raise UpstreamError(f"Sideband connect failed: {last}")

    async def hangup(self, call_id: str) -> None:
        try:
            r = await self.http.post(f"{CALLS_URL}/{call_id}/hangup", headers=self._auth(), timeout=10.0)
            if r.status_code >= 400:
                log.warning("hangup %s returned %s", call_id, r.status_code)
        except httpx.HTTPError as err:
            log.warning("hangup %s failed: %s", call_id, err)
