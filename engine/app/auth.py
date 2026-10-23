"""Who may call what (docs/engine-contract.md, section 6).

- Node calls the service API with a bearer service token.
- The page joins its interview's UI socket with a short-lived token the engine signs. It names one
  call, one session and one user, and expires at the time cap plus five minutes.
"""
from __future__ import annotations

import hmac
from datetime import datetime, timezone

import jwt
from fastapi import Request

from .config import Settings
from .errors import AppError

UI_AUDIENCE = "engine-ui"


def require_service(request: Request) -> None:
    settings: Settings = request.app.state.settings
    header = request.headers.get("authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else ""
    if not token or not hmac.compare_digest(token, settings.engine_service_token):
        raise AppError(401, "unauthorized", "A valid service token is required.")


def mint_ui_token(settings: Settings, call_id: str, session_id: str, user_id: str, expires_at: datetime) -> str:
    claims = {"aud": UI_AUDIENCE, "cid": call_id, "sid": session_id, "sub": user_id,
              "iat": int(datetime.now(timezone.utc).timestamp()), "exp": int(expires_at.timestamp())}
    return jwt.encode(claims, settings.engine_ui_secret, algorithm="HS256")


def verify_ui_token(settings: Settings, token: str, call_id: str) -> dict | None:
    """The token's claims if it is valid for this call, else None."""
    try:
        claims = jwt.decode(token, settings.engine_ui_secret, algorithms=["HS256"], audience=UI_AUDIENCE)
    except jwt.PyJWTError:
        return None
    return claims if claims.get("cid") == call_id else None
