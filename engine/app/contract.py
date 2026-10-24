"""The engine ⇄ platform contract (docs/engine-contract.md) as validated models.

Wire format is camelCase JSON. Within v1 every change is additive: new optional fields or new
messages; each side ignores what it does not know (`extra="ignore"`). `tools/export_schemas.py`
writes these as JSON Schemas to engine/contract/ for the Node side's tests.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    def wire(self) -> dict:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


# --- Node -> engine (section 1) ------------------------------------------------------

InterviewerStyle = Literal["supportive", "neutral", "stress"]
EndedReason = Literal["candidate_ended", "time_cap", "candidate_disconnected", "abandoned", "admin",
                      "engine_error", "upstream_error"]
State = Literal["connecting", "live", "awaiting_reoffer", "ending", "ended"]
Stage = Literal["intro", "case", "wrap_up"]


class Limits(Wire):
    max_minutes: int = Field(ge=1, le=120)


class CallConfig(Wire):
    interviewer_style: InterviewerStyle = "neutral"
    difficulty: int | None = None
    candidate_first_name: str | None = Field(default=None, max_length=60)


class CreateCallRequest(Wire):
    session_id: str = Field(min_length=1, max_length=64)
    user_id: str = Field(min_length=1, max_length=64)
    case_id: str = Field(min_length=1, max_length=64)
    sdp_offer: str = Field(min_length=10, max_length=20_000)
    limits: Limits
    config: CallConfig = CallConfig()


class UiInfo(Wire):
    url: str
    token: str
    expires_at: datetime


class CreateCallResponse(Wire):
    call_id: str
    sdp_answer: str
    ui: UiInfo


class ReofferRequest(Wire):
    sdp_offer: str = Field(min_length=10, max_length=20_000)


class ReofferResponse(Wire):
    sdp_answer: str
    ui: UiInfo | None = None  # a fresh UI token: a page that reloaded has lost the first one


class EndRequest(Wire):
    reason: Literal["candidate_ended", "abandoned", "admin"] = "candidate_ended"


class CallStatus(Wire):
    state: State
    stage: Stage | None = None
    started_at: datetime | None = None
    elapsed_seconds: int = 0


class ErrorDetail(Wire):
    code: str
    message: str


class ErrorBody(Wire):
    error: ErrorDetail


# --- engine -> Node: the settle callback (section 2) ---------------------------------

class TranscriptEntry(Wire):
    role: Literal["interviewer", "candidate"]
    text: str
    timestamp: datetime


class SettleSummary(Wire):
    stage_reached: Stage | Literal["none"] = "none"
    facts_released: list[str] = []
    hints_used: int = 0
    guard_hits: int = 0
    cost_usd: float = 0.0


class SettlePayload(Wire):
    call_id: str
    ended_reason: EndedReason
    started_at: datetime
    ended_at: datetime
    duration_seconds: int
    transcript: list[TranscriptEntry]
    summary: SettleSummary


# --- page <-> engine: the UI socket (section 3) --------------------------------------

class SnapshotEntry(Wire):
    role: Literal["interviewer", "candidate"]
    text: str
    item_id: str


class SessionReady(Wire):
    type: Literal["session_ready"] = "session_ready"


class Snapshot(Wire):
    type: Literal["snapshot"] = "snapshot"
    transcript: list[SnapshotEntry]
    stage: Stage | None = None
    remaining_seconds: int | None = None


class TranscriptDelta(Wire):
    type: Literal["transcript_delta"] = "transcript_delta"
    role: Literal["interviewer", "candidate"]
    text: str
    item_id: str


class Transcript(Wire):
    type: Literal["transcript"] = "transcript"
    role: Literal["interviewer", "candidate"]
    text: str
    item_id: str


class Retract(Wire):
    type: Literal["retract"] = "retract"
    item_ids: list[str]


class StageMsg(Wire):
    type: Literal["stage"] = "stage"
    stage: Stage


class ThinkTimer(Wire):
    type: Literal["think_timer"] = "think_timer"
    state: Literal["started", "ended"]
    seconds: int = 0


class Hint(Wire):
    type: Literal["hint"] = "hint"
    text: str
    level: int
    used: int
    max: int


class TimeMsg(Wire):
    type: Literal["time"] = "time"
    remaining_seconds: int


class Notice(Wire):
    type: Literal["notice"] = "notice"
    code: str
    message: str


class ReofferRequired(Wire):
    type: Literal["reoffer_required"] = "reoffer_required"


class SessionEnded(Wire):
    type: Literal["session_ended"] = "session_ended"
    reason: EndedReason


class UiError(Wire):
    type: Literal["error"] = "error"
    code: str
    message: str
    fatal: bool = False


EngineToPage = Union[SessionReady, Snapshot, TranscriptDelta, Transcript, Retract, StageMsg, ThinkTimer, Hint,
                     TimeMsg, Notice, ReofferRequired, SessionEnded, UiError]


class AudioLive(Wire):
    type: Literal["audio_live"]


class EndSession(Wire):
    type: Literal["end_session"]


class Activity(Wire):
    type: Literal["activity"]
    source: Literal["scratchpad"] = "scratchpad"


class Ping(Wire):
    type: Literal["ping"]


PageToEngine = Annotated[Union[AudioLive, EndSession, Activity, Ping], Field(discriminator="type")]


class PageMessage(BaseModel):
    msg: PageToEngine


def parse_page_message(raw: dict) -> AudioLive | EndSession | Activity | Ping | None:
    """A message from the page, or None for anything unknown (ignored, per the versioning rule)."""
    try:
        return PageMessage.model_validate({"msg": raw}).msg
    except ValueError:
        return None


# Everything exported as a JSON Schema for the Node side.
SCHEMAS: dict[str, type[BaseModel]] = {
    "create-call-request": CreateCallRequest, "create-call-response": CreateCallResponse,
    "reoffer-request": ReofferRequest, "reoffer-response": ReofferResponse, "end-request": EndRequest,
    "call-status": CallStatus, "error": ErrorBody, "settle-payload": SettlePayload,
    "ui-session-ready": SessionReady, "ui-snapshot": Snapshot, "ui-transcript-delta": TranscriptDelta,
    "ui-transcript": Transcript, "ui-retract": Retract, "ui-stage": StageMsg, "ui-think-timer": ThinkTimer,
    "ui-hint": Hint, "ui-time": TimeMsg, "ui-notice": Notice, "ui-reoffer-required": ReofferRequired,
    "ui-session-ended": SessionEnded, "ui-error": UiError, "ui-audio-live": AudioLive,
    "ui-end-session": EndSession, "ui-activity": Activity, "ui-ping": Ping,
}
