"""Settings, all from the environment (or engine/.env, then the repo's .env, in development).

Production refuses to start without its secrets; development fills in fixed local ones so the Node
stub and the test page work out of the box.
"""
from __future__ import annotations

import uuid
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-not-a-secret-change-me-in-prod"  # 32+ bytes: HS256 needs a long key


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore")

    environment: Literal["dev", "prod"] = "dev"

    # Secrets (docs/engine-contract.md, section 6)
    openai_api_key: str = ""
    engine_service_token: str = DEV_SECRET   # Node -> engine
    node_internal_token: str = DEV_SECRET    # engine -> Node
    engine_ui_secret: str = DEV_SECRET       # signs UI-socket tokens
    mongo_uri: str = ""                      # empty: in-memory store, seeded from cases/*.json
    mongo_db: str = "engine"

    engine_version: str = "dev"                      # the git commit, set by the image build

    # Where things are
    node_url: str = "http://localhost:5051"          # settle callback base; empty: no settling (stage 1)
    public_ws_url: str = "ws://localhost:8780"       # base of the UI-socket URL handed to the page
    allowed_origins: str = ""                        # comma-separated; empty: any (development only)

    # The interview (defaults from the phase 0 spike)
    realtime_model: str = "gpt-realtime-2.1"
    reasoning: str = "low"
    voice: str = "marin"
    transcription_model: str = "gpt-realtime-whisper"
    noise_reduction: str = "near_field"
    vad_threshold: float = 0.63
    silence_ms: int = 1000
    case_silence_ms: int = 1300
    # Picked with tools/bench.py on 23 Oct: matcher 45/45 for gpt-5.6-luna (gpt-5.4-nano 41/45, it widened
    # "fixed or variable?"); analyzer 30/30 for gpt-5.4-nano (gpt-4o-mini missed a question).
    analyzer_model: str = "gpt-5.4-nano"
    fact_model: str = "gpt-5.6-luna"

    # Operations
    max_calls: int = 50
    reoffer_window_s: float = 60.0          # a dropped call not re-offered within this ends
    start_timeout_s: float = 60.0           # a call whose page never brings its audio up ends
    settle_ack_wait_s: float = 8.0          # how long the page waits for Node's settle ack
    # A shutdown hands live interviews to the next instance; first it waits this long for ones already
    # ending. Keep it, plus uvicorn's graceful timeout, inside the platform's stop timeout (Docker: 10 s).
    shutdown_wait_s: float = 5.0
    time_scale: float = 1.0                 # tests only: shrinks every interview timer
    instance_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])  # owns its live interviews
    lease_s: float = 30.0                   # a crashed owner's interviews are taken over after this
    lease_renew_s: float = 10.0             # how often an owner renews its leases
    recovery_scan_s: float = 3.0            # how often an instance looks for interviews handed off to it

    @property
    def origins(self) -> set[str]:
        return {o.strip() for o in self.allowed_origins.split(",") if o.strip()}

    def check(self) -> None:
        """Fail fast on a production config that would run with development secrets."""
        if self.environment != "prod":
            return
        needed = ["openai_api_key", "engine_service_token", "engine_ui_secret", "mongo_uri"]
        if self.node_url:
            needed.append("node_internal_token")
        missing = [name for name in needed if getattr(self, name) in ("", DEV_SECRET)]
        if missing:
            raise RuntimeError(f"Production config is missing: {', '.join(missing).upper()}")
        if len(self.engine_ui_secret.encode()) < 32:
            raise RuntimeError("ENGINE_UI_SECRET must be at least 32 bytes (it signs HS256 tokens)")
        if not self.origins:
            raise RuntimeError("Production config needs ALLOWED_ORIGINS")
        if self.time_scale != 1.0:
            raise RuntimeError("TIME_SCALE is for tests only")


@lru_cache
def get_settings() -> Settings:
    return Settings()
