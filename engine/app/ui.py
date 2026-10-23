"""The page's UI socket (docs/engine-contract.md, section 3): transcripts, stage, timers and notices out;
audio_live, end_session, activity and ping in. Audio never travels here; it goes over WebRTC."""
from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .auth import verify_ui_token

router = APIRouter()
BAD_TOKEN, CALL_ENDED = 4001, 4004
TRY_AGAIN = 1013  # the interview is moving between engine instances (a deploy): reconnect shortly


@router.websocket("/v1/calls/{call_id}/ui")
async def ui_socket(ws: WebSocket, call_id: str) -> None:
    app = ws.app
    settings = app.state.settings
    # Accept first: a socket closed before the handshake completes reaches the page as a bare HTTP 403,
    # without the contract's close codes.
    await ws.accept()
    origin = ws.headers.get("origin", "")
    if settings.origins and origin not in settings.origins:
        await ws.close(code=BAD_TOKEN, reason="Origin not allowed")
        return
    if not verify_ui_token(settings, ws.query_params.get("token", ""), call_id):
        await ws.close(code=BAD_TOKEN, reason="Bad or expired token")
        return
    registry = app.state.registry
    iv = registry.get(call_id)
    if iv is None:  # after a restart or a deploy: carry it on here if it is still going
        doc = await registry.services.store.get_session(call_id)
        if doc is not None and doc.get("state") != "ended":
            iv = await registry.take(call_id)
            if iv is None:
                await ws.close(code=TRY_AGAIN, reason="Reconnect in a moment")
                return
    if iv is None or iv.state in ("ending", "ended"):
        await ws.close(code=CALL_ENDED, reason="This interview has ended")
        return
    await iv.attach_ui(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict):
                await iv.on_ui(msg)
    except WebSocketDisconnect:
        pass
    finally:
        iv.detach_ui(ws)
