"""The service API Node calls (docs/engine-contract.md, section 1), and health checks."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from .auth import mint_ui_token, require_service
from .contract import (CallStatus, CreateCallRequest, CreateCallResponse, EndRequest, ReofferRequest, ReofferResponse,
                       UiInfo)
from .errors import AppError, UpstreamError
from .registry import Registry
from .runtime import facts
from .runtime.interview import Interview, settlement_from_doc, utcnow

router = APIRouter()
service = APIRouter(prefix="/v1", dependencies=[Depends(require_service)])
UI_GRACE = timedelta(minutes=5)


def check_offer(sdp: str) -> None:
    """A usable audio offer with no data channel: a page with one could rewrite the session."""
    lines = [line.strip() for line in sdp.replace("\r\n", "\n").split("\n")]
    if any(line.startswith("m=application") for line in lines):
        raise AppError(400, "data_channel_not_allowed", "The offer asks for a data channel, which is not allowed.")
    if not lines or lines[0] != "v=0" or not any(line.startswith("m=audio") for line in lines):
        raise AppError(400, "invalid_offer", "Not a usable SDP audio offer.")


def registry(request: Request) -> Registry:
    return request.app.state.registry


async def interview(request: Request, call_id: str) -> Interview | None:
    """The interview, run here or taken over now; None once it is over. During a hand-off another
    instance may still hold it for a moment: Node retries."""
    reg = registry(request)
    if (iv := reg.get(call_id)) is not None:
        return iv
    doc = await reg.services.store.get_session(call_id)
    if doc is None:
        raise AppError(404, "call_not_found", "No interview with that call ID.")
    if doc.get("state") == "ended":
        return None
    if (iv := await reg.take(call_id)) is not None:
        return iv
    raise AppError(503, "call_moving", "This interview is moving to another engine instance; retry in a second.")


@service.post("/calls", status_code=201, response_model=None)
async def create_call(body: CreateCallRequest, request: Request) -> JSONResponse:
    reg, settings = registry(request), request.app.state.settings
    check_offer(body.sdp_offer)
    reg.admit()
    if reg.for_session(body.session_id):
        raise AppError(409, "call_exists", "This session already has a live call; use re-offer.")
    case_doc = await reg.services.store.get_case(body.case_id)
    if case_doc is None:
        raise AppError(409, "case_not_ready", "This case has no published fact tree in the engine.")
    iv = Interview(reg.services, session_id=body.session_id, user_id=body.user_id,
                   case=facts.Case.from_doc(case_doc), max_minutes=body.limits.max_minutes, config=body.config)
    try:
        answer = await iv.open(body.sdp_offer)
    except UpstreamError as err:
        iv.queue.put_nowait(None)
        raise AppError(502, "upstream_unavailable", str(err)) from err
    reg.add(iv)
    return JSONResponse(CreateCallResponse(call_id=iv.id, sdp_answer=answer, ui=ui_info(settings, iv)).wire(),
                        status_code=201)


def ui_info(settings, iv: Interview) -> UiInfo:
    """The page's UI socket and its token, good until the time cap plus a grace period."""
    expires = iv.created_at + timedelta(minutes=iv.max_minutes) + UI_GRACE
    return UiInfo(url=f"{settings.public_ws_url.rstrip('/')}/v1/calls/{iv.id}/ui",
                  token=mint_ui_token(settings, iv.id, iv.session_id, iv.user_id, expires), expires_at=expires)


@service.post("/calls/{call_id}/reoffer", response_model=None)
async def reoffer(call_id: str, body: ReofferRequest, request: Request) -> JSONResponse:
    check_offer(body.sdp_offer)
    iv = await interview(request, call_id)
    if iv is None:
        raise AppError(410, "call_ended", "This interview has ended.")
    try:
        answer = await iv.reoffer(body.sdp_offer)
    except UpstreamError as err:
        raise AppError(502, "upstream_unavailable", str(err)) from err
    return JSONResponse(ReofferResponse(sdp_answer=answer, ui=ui_info(request.app.state.settings, iv)).wire())


@service.post("/calls/{call_id}/end", status_code=202, response_model=None)
async def end_call(call_id: str, body: EndRequest, request: Request) -> JSONResponse:
    iv = await interview(request, call_id)
    if iv is not None:  # None: already over, and ending is idempotent
        iv._spawn(iv.end(body.reason))
    return JSONResponse({"ok": True}, status_code=202)


@service.post("/calls/{call_id}/hint", response_model=None)
async def hint(call_id: str, request: Request) -> JSONResponse:
    if await interview(request, call_id) is None:
        raise AppError(410, "call_ended", "This interview has ended.")
    raise AppError(501, "not_implemented", "Hints arrive in phase 3.")


@service.get("/calls/{call_id}", response_model=None)
async def call_status(call_id: str, request: Request) -> JSONResponse:
    iv = registry(request).get(call_id)
    if iv is not None:
        return JSONResponse(iv.status().wire())
    doc = await registry(request).services.store.get_session(call_id)
    if doc is None:
        raise AppError(404, "call_not_found", "No interview with that call ID.")
    started, ended = doc.get("startedAt"), doc.get("endedAt")
    elapsed = round((ended - started).total_seconds()) if started and ended else 0
    return JSONResponse(CallStatus(state=doc["state"], stage=doc.get("stage"), started_at=started,
                                   elapsed_seconds=elapsed).wire())


@service.get("/calls/{call_id}/settlement", response_model=None)
async def settlement(call_id: str, request: Request) -> JSONResponse:
    """The settle payload, for Node to fetch once the interview has ended: the pull twin of the settle
    callback, for when the engine cannot reach Node (a laptop in development) or the callback is late."""
    reg = registry(request)
    iv = reg.get(call_id)
    if iv is not None and iv.state == "ended":
        return JSONResponse(iv.settle_payload().wire())
    doc = await reg.services.store.get_session(call_id)
    if doc is None:
        raise AppError(404, "call_not_found", "No interview with that call ID.")
    if doc.get("state") != "ended":
        raise AppError(409, "call_not_ended", f"The interview is still {doc.get('state')}; retry after it ends.")
    return JSONResponse(settlement_from_doc(doc).wire())


@router.get("/healthz")
async def healthz(request: Request) -> dict:
    return {"ok": True, "version": request.app.state.settings.engine_version}


@router.get("/readyz", response_model=None)
async def readyz(request: Request) -> JSONResponse:
    if registry(request).draining:
        return JSONResponse({"ok": False, "draining": True}, status_code=503)
    return JSONResponse({"ok": True, "live": len(registry(request).live())})


router.include_router(service)
