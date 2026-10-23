"""A stand-in for Node, so the engine runs end to end before the platform is wired in (stage 1).

It plays Node's part of docs/engine-contract.md: forwards the page's offer to the engine
(`POST /api/voice/call`), forwards re-offers, receives the settle callback, and serves the test page.
Settled interviews are written to engine/results/settled/ (gitignored: they hold transcripts).

Run from engine/ (with the engine on :8780):  uv run python tools/node_stub.py   then open http://localhost:5051
"""
from __future__ import annotations

import hmac
import json
import os
import sys
import uuid
from pathlib import Path

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.config import get_settings  # noqa: E402

SETTLED = ROOT / "results" / "settled"
ENGINE_URL = os.environ.get("ENGINE_URL", "http://localhost:8780")
PORT = int(os.environ.get("NODE_STUB_PORT", "5051"))
settings = get_settings()
app = FastAPI(title="Node stub for the interview engine")
calls: dict[str, str] = {}  # session id -> call id, as Node would keep on the Session document


def engine_headers() -> dict:
    return {"authorization": f"Bearer {settings.engine_service_token}"}


@app.get("/")
async def page() -> FileResponse:
    return FileResponse(ROOT / "web" / "test.html")


@app.post("/api/voice/call")
async def voice_call(request: Request) -> JSONResponse:
    """Node's new route: in the platform it also checks the user, the session and the pilot switch."""
    body = await request.json()
    session_id = body.get("sessionId") or f"dev_{uuid.uuid4().hex[:10]}"
    payload = {"sessionId": session_id, "userId": "dev-user", "caseId": body.get("caseId") or "coffee",
               "sdpOffer": body.get("sdpOffer", ""), "limits": {"maxMinutes": int(body.get("maxMinutes") or 30)},
               "config": {"candidateFirstName": body.get("firstName") or None}}
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.post(f"{ENGINE_URL}/v1/calls", json=payload, headers=engine_headers())
    if r.status_code != 201:
        return JSONResponse(r.json(), status_code=r.status_code)
    out = r.json()
    calls[session_id] = out["callId"]
    return JSONResponse({"sessionId": session_id, **out})


@app.post("/api/voice/call/{session_id}/reoffer")
async def reoffer(session_id: str, request: Request) -> JSONResponse:
    call_id = calls.get(session_id)
    if not call_id:
        return JSONResponse({"error": {"code": "not_engine_session", "message": "No engine call for this session"}},
                            status_code=409)
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.post(f"{ENGINE_URL}/v1/calls/{call_id}/reoffer", json=await request.json(),
                            headers=engine_headers())
    return JSONResponse(r.json(), status_code=r.status_code)


@app.post("/internal/sessions/{session_id}/settle")
async def settle(session_id: str, request: Request) -> JSONResponse:
    """Node's settle endpoint: idempotent, service token only."""
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not hmac.compare_digest(token, settings.node_internal_token):
        return JSONResponse({"error": {"code": "unauthorized", "message": "bad token"}}, status_code=401)
    payload = await request.json()
    SETTLED.mkdir(parents=True, exist_ok=True)
    path = SETTLED / f"{session_id}.json"
    if path.exists() and json.loads(path.read_text()).get("callId") == payload.get("callId"):
        return JSONResponse({"ok": True, "repeat": True})
    path.write_text(json.dumps(payload, indent=2))
    s = payload["summary"]
    print(f"settled {session_id}: {payload['endedReason']}, {payload['durationSeconds']} s, "
          f"{len(payload['transcript'])} turns, facts {s['factsReleased']}, ${s['costUsd']}", flush=True)
    return JSONResponse({"ok": True})


@app.get("/api/sessions/{session_id}")
async def session(session_id: str) -> JSONResponse:
    path = SETTLED / f"{session_id}.json"
    if not path.exists():
        return JSONResponse({"error": {"code": "not_found", "message": "not settled yet"}}, status_code=404)
    return JSONResponse(json.loads(path.read_text()))


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
