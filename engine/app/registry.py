"""The interviews this instance runs: capacity, leases, recovery and hand-off.

One engine instance owns each interview and renews a lease on it every few seconds. Another instance
takes an interview over only through an atomic claim, once the lease was released (a hand-off) or has
lapsed (the owner crashed), so two instances never steer the same call.

A shutdown hands off rather than drains: the audio runs browser <-> OpenAI and never through the
engine, so the next instance reattaches to the same OpenAI call and the candidate hears at most a
pause. Waiting for interviews to finish instead would hold a deploy for up to 30 minutes, and on one
server the new instance could not take new calls meanwhile.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from .errors import AppError
from .runtime import facts
from .runtime.interview import Interview, Services, utcnow

log = logging.getLogger("engine.registry")


class Registry:
    def __init__(self, max_calls: int):
        self.max_calls = max_calls
        self.calls: dict[str, Interview] = {}
        self.draining = False
        self.services: Services | None = None
        self._tasks: list[asyncio.Task] = []
        self._taking: dict[str, asyncio.Task] = {}

    # --- bookkeeping --------------------------------------------------------------------------

    def get(self, call_id: str) -> Interview | None:
        return self.calls.get(call_id)

    def live(self) -> list[Interview]:
        return [iv for iv in self.calls.values() if iv.state != "ended"]

    def for_session(self, session_id: str) -> Interview | None:
        return next((iv for iv in self.live() if iv.session_id == session_id), None)

    def admit(self) -> None:
        """Raise the contract's error if this instance should not take a new call."""
        if self.draining:
            raise AppError(503, "draining", "The engine is restarting; try again in a moment.")
        if len(self.live()) >= self.max_calls:
            raise AppError(429, "at_capacity", "The engine is at capacity; try again in a minute.")

    def add(self, iv: Interview) -> None:
        self.calls[iv.id] = iv

    def finished(self, iv: Interview) -> None:
        """Called once an interview's settle delivery is over (acknowledged or given up)."""
        self.calls.pop(iv.id, None)

    # --- background work -------------------------------------------------------------------

    def start(self, services: Services) -> None:
        self.services = services
        self._tasks = [asyncio.get_running_loop().create_task(self._renew()),
                       asyncio.get_running_loop().create_task(self._scan())]

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()

    async def _renew(self) -> None:
        while True:
            await asyncio.sleep(self.services.settings.lease_renew_s * self.services.settings.time_scale)
            for iv in list(self.calls.values()):
                if iv.owes_work():
                    await iv.persist()  # every save carries a fresh lease
                await iv.flush_events()

    async def _scan(self) -> None:
        """Take over interviews another instance handed off or stopped renewing."""
        while True:
            try:
                await self.recover()
            except Exception:
                log.exception("recovery scan failed")
            await asyncio.sleep(self.services.settings.recovery_scan_s * self.services.settings.time_scale)

    async def recover(self) -> int:
        if self.draining:
            return 0
        taken = 0
        for call_id in await self.services.store.claimable(utcnow()):
            if call_id not in self.calls and await self.take(call_id):
                taken += 1
        return taken

    async def take(self, call_id: str) -> Interview | None:
        """Claim one interview and carry it on here; None if another instance holds it. Concurrent
        takes of one call here (the scan, a page reconnecting, Node) share one attempt."""
        if self.draining:
            return None
        if call_id in self.calls:
            return self.calls[call_id]
        if call_id not in self._taking:
            task = asyncio.get_running_loop().create_task(self._take(call_id))
            task.add_done_callback(lambda _t: self._taking.pop(call_id, None))
            self._taking[call_id] = task
        return await asyncio.shield(self._taking[call_id])

    async def _take(self, call_id: str) -> Interview | None:
        svc = self.services
        now = utcnow()
        claimed = await svc.store.claim(call_id, svc.settings.instance_id, now + timedelta(seconds=svc.settings.lease_s),
                                        now)
        if not claimed:
            return None
        case_doc = await svc.store.get_case(claimed["caseId"])
        if case_doc is None:
            log.error("recover %s: case %s is gone", call_id, claimed["caseId"])
            return None
        iv = Interview.restore(svc, claimed, facts.Case.from_doc(case_doc))
        self.add(iv)
        asyncio.get_running_loop().create_task(iv.recover())
        log.info("took over interview %s (%s)", iv.id, claimed.get("state"))
        return iv

    async def shutdown(self, timeout_s: float) -> None:
        """Stop taking calls, give interviews already ending a moment to settle, then hand off the rest."""
        self.draining = True
        deadline = asyncio.get_running_loop().time() + timeout_s
        while any(iv.state == "ending" for iv in self.calls.values()) and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0.1)
        handed = [iv for iv in list(self.calls.values()) if iv.owes_work()]
        await asyncio.gather(*(iv.hand_off() for iv in handed), return_exceptions=True)
        if handed:
            log.info("handed off %d interview(s)", len(handed))
