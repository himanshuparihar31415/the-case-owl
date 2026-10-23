"""A real engine server on a free port, with fake OpenAI and fake Node behind it."""
from __future__ import annotations

import asyncio
import json
import socket
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
import pytest
import uvicorn
from websockets.asyncio.client import connect as ws_connect

from app.config import DEV_SECRET, Settings
from app.main import create_app
from app.store import MemoryStore
from tests.fakes import FakeNode, FakeRealtime

OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@dataclass
class Engine:
    base: str
    app: object
    realtime: FakeRealtime
    node: FakeNode
    store: MemoryStore
    client: httpx.AsyncClient

    @property
    def registry(self):
        return self.app.state.registry

    async def create_call(self, expect: int = 201, **overrides) -> dict:
        body = {"sessionId": "sess_1", "userId": "user_1", "caseId": "coffee", "sdpOffer": OFFER,
                "limits": {"maxMinutes": 30}, "config": {"candidateFirstName": "Asha"}}
        body.update(overrides)
        r = await self.client.post(f"{self.base}/v1/calls", json=body,
                                   headers={"authorization": f"Bearer {DEV_SECRET}"})
        assert r.status_code == expect, r.text
        return r.json()

    async def ui(self, call: dict):
        ws = await ws_connect(f"{call['ui']['url']}?token={call['ui']['token']}")
        return UiClient(ws)

    async def wait_settled(self, n: int = 1, timeout: float = 5.0) -> dict:
        async def poll():
            while len(self.node.settles) < n:
                await asyncio.sleep(0.02)
            return self.node.settles[n - 1][1]
        return await asyncio.wait_for(poll(), timeout)


class UiClient:
    def __init__(self, ws):
        self.ws = ws
        self.got: list[dict] = []

    async def send(self, msg: dict) -> None:
        await self.ws.send(json.dumps(msg))

    async def next(self, kind: str, timeout: float = 3.0) -> dict:
        """The next message of this type, keeping everything seen in `got`."""
        for msg in self.got:
            if msg.get("type") == kind and not msg.get("_taken"):
                msg["_taken"] = True
                return msg

        async def read():
            while True:
                msg = json.loads(await self.ws.recv())
                self.got.append(msg)
                if msg.get("type") == kind:
                    msg["_taken"] = True
                    return msg
        return await asyncio.wait_for(read(), timeout)

    async def until(self, kind: str, timeout: float = 3.0, **fields) -> dict:
        """The next message of this type whose fields match, skipping others of the type."""
        async def read():
            while True:
                msg = await self.next(kind, timeout)
                if all(msg.get(k) == v for k, v in fields.items()):
                    return msg
        return await asyncio.wait_for(read(), timeout)

    async def close(self) -> None:
        await self.ws.close()


@asynccontextmanager
async def run_engine(realtime: FakeRealtime | None = None, node: FakeNode | None = None,
                     store: MemoryStore | None = None, **overrides):
    """One engine instance. Pass another instance's fakes and store to start its successor."""
    port = free_port()
    settings = Settings(**{"environment": "dev", "openai_api_key": "test-key", "public_ws_url": f"ws://127.0.0.1:{port}",
                           "node_url": "http://node.test", "time_scale": 0.001, "settle_ack_wait_s": 2.0,
                           "shutdown_wait_s": 0.5, "reoffer_window_s": 60.0, "start_timeout_s": 10_000.0,
                           "recovery_scan_s": 1e6, "_env_file": None, **overrides})
    realtime, node, store = realtime or FakeRealtime(), node or FakeNode(), store or MemoryStore()
    http = httpx.AsyncClient(transport=httpx.MockTransport(node.handler))
    app = create_app(settings, realtime=realtime, store=store, http=http)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    client = httpx.AsyncClient()
    try:
        yield Engine(f"http://127.0.0.1:{port}", app, realtime, node, store, client)
    finally:
        await client.aclose()
        server.should_exit = True
        await task
        await http.aclose()


@pytest.fixture
async def engine():
    async with run_engine() as eng:
        yield eng
