"""The service API's error contract (docs/engine-contract.md, section 1) and the UI socket's gate."""
from __future__ import annotations

import pytest
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

from app.config import DEV_SECRET
from tests.conftest import OFFER

AUTH = {"authorization": f"Bearer {DEV_SECRET}"}


async def post(engine, path: str, body: dict, headers=AUTH):
    return await engine.client.post(f"{engine.base}{path}", json=body, headers=headers)


def call_body(**overrides) -> dict:
    return {"sessionId": "sess_1", "userId": "user_1", "caseId": "coffee", "sdpOffer": OFFER,
            "limits": {"maxMinutes": 30}, **overrides}


@pytest.mark.parametrize("headers", [{}, {"authorization": "Bearer wrong"}])
async def test_the_service_api_needs_the_service_token(engine, headers):
    r = await post(engine, "/v1/calls", call_body(), headers=headers)
    assert (r.status_code, r.json()["error"]["code"]) == (401, "unauthorized")


@pytest.mark.parametrize("sdp, code", [
    (OFFER + "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n", "data_channel_not_allowed"),
    ("not an sdp offer at all", "invalid_offer"),
    ("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n", "invalid_offer")])
async def test_offers_are_checked(engine, sdp, code):
    r = await post(engine, "/v1/calls", call_body(sdpOffer=sdp))
    assert (r.status_code, r.json()["error"]["code"]) == (400, code)


async def test_a_case_without_a_published_fact_tree_is_refused(engine):
    r = await post(engine, "/v1/calls", call_body(caseId="no-such-case"))
    assert (r.status_code, r.json()["error"]["code"]) == (409, "case_not_ready")


async def test_one_live_call_per_session(engine):
    await engine.create_call()
    r = await post(engine, "/v1/calls", call_body())
    assert (r.status_code, r.json()["error"]["code"]) == (409, "call_exists")


async def test_capacity_and_draining(engine):
    engine.registry.max_calls = 1
    await engine.create_call()
    r = await post(engine, "/v1/calls", call_body(sessionId="sess_2"))
    assert (r.status_code, r.json()["error"]["code"]) == (429, "at_capacity")
    engine.registry.draining = True
    r = await post(engine, "/v1/calls", call_body(sessionId="sess_3"))
    assert (r.status_code, r.json()["error"]["code"]) == (503, "draining")
    assert (await engine.client.get(f"{engine.base}/readyz")).status_code == 503


async def test_openai_refusing_is_upstream_unavailable(engine):
    engine.realtime.refuse_calls = True
    r = await post(engine, "/v1/calls", call_body())
    assert (r.status_code, r.json()["error"]["code"]) == (502, "upstream_unavailable")


async def test_bad_requests_say_which_field(engine):
    r = await post(engine, "/v1/calls", call_body(limits={"maxMinutes": 0}))
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_request"
    assert "maxMinutes" in r.json()["error"]["message"] or "limits" in r.json()["error"]["message"]


async def test_unknown_calls(engine):
    for method, path, body in (("post", "/v1/calls/rtc_nope/reoffer", {"sdpOffer": OFFER}),
                               ("post", "/v1/calls/rtc_nope/end", {"reason": "admin"}),
                               ("get", "/v1/calls/rtc_nope", None)):
        r = await getattr(engine.client, method)(f"{engine.base}{path}", headers=AUTH,
                                                 **({"json": body} if body else {}))
        assert (r.status_code, r.json()["error"]["code"]) == (404, "call_not_found"), path


async def test_hints_wait_for_phase_3(engine):
    call = await engine.create_call()
    r = await post(engine, f"/v1/calls/{call['callId']}/hint", {})
    assert (r.status_code, r.json()["error"]["code"]) == (501, "not_implemented")


async def test_status_of_a_live_call(engine):
    call = await engine.create_call()
    await engine.realtime.sideband(call["callId"])
    r = await engine.client.get(f"{engine.base}/v1/calls/{call['callId']}", headers=AUTH)
    assert r.status_code == 200 and r.json()["state"] == "live"


async def test_the_ui_socket_needs_its_own_token(engine):
    call = await engine.create_call()
    other = await engine.create_call(sessionId="sess_2")
    for token in ("", "garbage", other["ui"]["token"]):  # another call's token does not open this one
        ws = await ws_connect(f"{call['ui']['url']}?token={token}")
        with pytest.raises(ConnectionClosed) as closed:
            await ws.recv()
        assert closed.value.rcvd.code == 4001


async def test_ending_twice_is_fine(engine):
    call = await engine.create_call()
    await engine.realtime.sideband(call["callId"])
    for _ in range(2):
        r = await post(engine, f"/v1/calls/{call['callId']}/end", {"reason": "admin"})
        assert r.status_code == 202
    payload = await engine.wait_settled()
    assert payload["endedReason"] == "admin" and payload["durationSeconds"] == 0  # the audio never went live
    assert len(engine.node.settles) == 1
