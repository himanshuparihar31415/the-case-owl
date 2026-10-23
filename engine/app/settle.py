"""The settle callback to Node (docs/engine-contract.md, section 2): sent once an interview ends, for
any reason, after its transcript is saved. Node's handler is idempotent, so repeats are safe.

Retries on any non-2xx: 1 s, 5 s, 30 s, then every 5 minutes for 24 h; an alert after the third failure.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

import httpx

from .contract import SettlePayload

log = logging.getLogger("engine.settle")
SCHEDULE_S = (1, 5, 30)
LATER_S = 300
GIVE_UP_S = 24 * 3600


class SettleClient:
    def __init__(self, http: httpx.AsyncClient, node_url: str, token: str, time_scale: float = 1.0):
        self.http, self.node_url, self.token, self.scale = http, node_url.rstrip("/"), token, time_scale

    @property
    def enabled(self) -> bool:
        """No NODE_URL: an engine deployed before the platform integration (stage 1) settles nowhere."""
        return bool(self.node_url)

    async def attempt(self, session_id: str, payload: SettlePayload) -> tuple[bool, str]:
        try:
            r = await self.http.post(f"{self.node_url}/internal/sessions/{session_id}/settle",
                                     json=payload.wire(), headers={"Authorization": f"Bearer {self.token}"},
                                     timeout=15.0)
        except httpx.HTTPError as err:
            return False, f"{type(err).__name__}: {err}"
        if 200 <= r.status_code < 300:
            return True, ""
        return False, f"HTTP {r.status_code}: {r.text[:200]}"

    async def deliver(self, session_id: str, payload: SettlePayload,
                      on_result: Callable[[bool, int, str], Awaitable[None]], waited_s: float = 0.0) -> bool:
        """Deliver with retries. `on_result(ok, attempts, error)` runs after every attempt, so the
        interview can record progress and release the page after the first. `waited_s`: time already
        spent, when a delivery resumes on another instance."""
        waited, attempts = waited_s, 0
        while True:
            attempts += 1
            ok, error = await self.attempt(session_id, payload)
            await on_result(ok, attempts, error)
            if ok:
                return True
            if attempts == 3:
                log.error("settle for session %s failed 3 times: %s", session_id, error)  # the alert hook
            delay = SCHEDULE_S[attempts - 1] if attempts <= len(SCHEDULE_S) else LATER_S
            if waited + delay > GIVE_UP_S:
                log.error("settle for session %s abandoned after %d attempts", session_id, attempts)
                return False
            waited += delay
            await asyncio.sleep(delay * self.scale)
