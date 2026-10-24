"""End to end through the real server: fake OpenAI behind it, fake Node beside it (tests/fakes.py)."""
from __future__ import annotations

import asyncio
import json

from app.config import DEV_SECRET
from app.runtime import turns
from tests.fakes import candidate_turn, reply, tool_reply


def like(msg: dict, **expected) -> bool:
    return all(msg.get(k) == v for k, v in expected.items())


async def started(engine, **overrides):
    """A call with the page connected, audio live and the greeting asked for."""
    call = await engine.create_call(**overrides)
    sb = await engine.realtime.sideband(call["callId"])
    ui = await engine.ui(call)
    await ui.next("session_ready")
    await ui.send({"type": "audio_live"})
    await sb.wait_for(lambda e: e["type"] == "response.create")
    return call, sb, ui


async def test_a_whole_interview_reaches_node_as_heard(engine):
    call = await engine.create_call()
    assert call["callId"].startswith("rtc_fake_") and call["sdpAnswer"].startswith("v=0")
    session = engine.realtime.calls[0][2]
    detection = session["audio"]["input"]["turn_detection"]
    assert (detection["create_response"], detection["interrupt_response"]) == (False, False)  # the engine owns turns

    sb = await engine.realtime.sideband(call["callId"])
    ui = await engine.ui(call)
    await ui.next("session_ready")
    await ui.send({"type": "audio_live"})
    greeting = await sb.wait_for(lambda e: e["type"] == "response.create")
    assert greeting["response"] == {"tool_choice": "none"}  # speech only: no tool, so no preamble
    system = [i["content"][0]["text"] for i in sb.items("system")]
    assert any("Asha" in t for t in system) and turns.GREETING_PROMPT in system

    sb.push(*reply("resp_1", "item_g", "Hi, I'm Maya. How are you?"))
    assert like(await ui.next("transcript"), role="interviewer", text="Hi, I'm Maya. How are you?", itemId="item_g")

    sb.push(*candidate_turn("item_c1", "Good, thanks. How about you?", 5000, 7400))
    await sb.wait_for(lambda e: e["type"] == "response.create" and "response" not in e)
    assert like(await ui.next("transcript"), role="candidate", itemId="item_c1")

    sb.push(*tool_reply("resp_2", "fc_1", "start_case", {}, "call_1"))
    brief = await sb.wait_for(lambda e: e["type"] == "conversation.item.create"
                              and e["item"].get("type") == "function_call_output")
    assert "regional coffee chain" in json.loads(brief["item"]["output"])["case_brief"]
    assert "35 percent" not in brief["item"]["output"]  # she gets the statement, never the facts
    await ui.until("stage", stage="case")
    await sb.wait_for(lambda e: e["type"] == "response.create" and e.get("response") == {"tool_choice": "none"}
                      and e["event_id"].startswith("resp_case_brief"))
    sb.push(*reply("resp_3", "item_case", "I'm well, thanks. A regional coffee chain's profit fell."))

    engine.node.match = {"status": "match", "fact_ids": ["cost_split"]}
    sb.push(*candidate_turn("item_c2", "Did fixed or variable costs rise?", 20000, 22400))
    await sb.wait_for(lambda e: e["type"] == "response.create" and e["event_id"].startswith("resp_end_of_speech")
                      and int(e["event_id"].rsplit("_", 1)[1]) > int(greeting["event_id"].rsplit("_", 1)[1]) + 5)
    sb.push(*tool_reply("resp_4", "fc_2", "lookup_fact", {"question": "Did fixed or variable costs rise?"}, "call_2"))
    fact = await sb.wait_for(lambda e: e["type"] == "conversation.item.create"
                             and e["item"].get("call_id") == "call_2")
    assert json.loads(fact["item"]["output"])["facts"] == [
        "Most of the increase is in variable costs; fixed costs rose only slightly."]
    await sb.wait_for(lambda e: e["type"] == "response.create" and e["event_id"].startswith("resp_fact_answer"))
    sb.push(*reply("resp_5", "item_f", "Most of the increase is in variable costs."))
    await ui.next("transcript")

    await ui.send({"type": "end_session"})
    payload = await engine.wait_settled()
    session_id, _, headers = engine.node.settles[0]
    assert session_id == "sess_1" and headers["authorization"] == f"Bearer {DEV_SECRET}"
    assert payload["endedReason"] == "candidate_ended" and payload["callId"] == call["callId"]
    assert [(t["role"], t["text"]) for t in payload["transcript"]] == [
        ("interviewer", "Hi, I'm Maya. How are you?"),
        ("candidate", "Good, thanks. How about you?"),
        ("interviewer", "I'm well, thanks. A regional coffee chain's profit fell."),
        ("candidate", "Did fixed or variable costs rise?"),
        ("interviewer", "Most of the increase is in variable costs.")]
    assert payload["summary"]["factsReleased"] == ["cost_split"]
    assert payload["summary"]["stageReached"] == "case"
    assert like(await ui.next("session_ended"), reason="candidate_ended")
    assert call["callId"] in engine.realtime.hangups


async def test_a_reply_nobody_heard_is_taken_back(engine):
    """19 Oct: "Nice, let" stayed in her memory and on screen after the candidate kept talking."""
    call, sb, ui = await started(engine)
    sb.push(*reply("resp_1", "item_g", "Hi, I'm Maya. How are you?"))
    sb.push(*reply("resp_2", "item_x", "Nice, let", audio=False, status="cancelled"))
    assert like(await ui.next("retract"), itemIds=["item_x"])
    await sb.wait_for(lambda e: e["type"] == "conversation.item.delete" and e["item_id"] == "item_x")
    await ui.send({"type": "end_session"})
    payload = await engine.wait_settled()
    assert [t["text"] for t in payload["transcript"]] == ["Hi, I'm Maya. How are you?"]


async def test_the_time_cap_ends_the_interview_with_a_closing_line(engine):
    call, sb, ui = await started(engine, limits={"maxMinutes": 6})  # 6 minutes run in 0.36 s here
    sb.push(*reply("resp_1", "item_g", "Hi, I'm Maya. How are you?"))  # one reply at a time: each must finish
    assert like(await ui.next("time"), remainingSeconds=300)
    assert like(await ui.next("time"), remainingSeconds=120)
    await ui.until("stage", stage="wrap_up")
    await sb.wait_for(lambda e: e["type"] == "response.create" and e["event_id"].startswith("resp_wrap_up"))
    sb.push(*reply("resp_2", "item_w", "We have about two minutes left."))
    closing = await sb.wait_for(lambda e: e["type"] == "response.create" and e["event_id"].startswith("resp_closing"))
    assert closing["response"] == {"tool_choice": "none"}
    sb.push(*reply("resp_close", "item_bye", "That's time. Thank you, Asha."))
    payload = await engine.wait_settled()
    assert payload["endedReason"] == "time_cap"
    assert like(await ui.next("session_ended"), reason="time_cap")


async def test_a_dropped_call_is_reoffered_with_its_history(engine):
    call, sb, ui = await started(engine)
    sb.push(*reply("resp_1", "item_g", "Hi, I'm Maya. How are you?"))
    sb.push(*candidate_turn("item_c1", "Doing well.", 5000, 6400))
    await ui.next("transcript")
    await ui.next("transcript")
    engine.realtime.refuse_connect.add(call["callId"])  # the call is gone: reattaching fails
    sb.drop()
    await ui.next("reoffer_required")
    r = await engine.client.post(f"{engine.base}/v1/calls/{call['callId']}/reoffer", json={"sdpOffer": call_offer()},
                                 headers={"authorization": f"Bearer {DEV_SECRET}"})
    assert r.status_code == 200 and r.json()["sdpAnswer"].startswith("v=0")
    new_call = engine.realtime.calls[-1][0]
    assert new_call != call["callId"] and call["callId"] in engine.realtime.hangups
    sb2 = await engine.realtime.sideband(new_call)
    resume = await sb2.wait_for(lambda e: e["type"] == "response.create")
    assert resume["event_id"].startswith("resp_reconnect")
    replayed = [(i["role"], i["content"][0]["text"]) for i in sb2.items() if str(i.get("id", "")).startswith("rb_")]
    assert replayed[1:] == [("assistant", "Hi, I'm Maya. How are you?"), ("user", "Doing well.")]
    status = (await engine.client.get(f"{engine.base}/v1/calls/{call['callId']}",
                                      headers={"authorization": f"Bearer {DEV_SECRET}"})).json()
    assert status["state"] == "live"

    # A page that reloaded lost its UI token: the re-offer's fresh one opens the socket and catches it up.
    page = await engine.ui({"ui": r.json()["ui"]})
    snapshot = await page.next("snapshot")
    assert [e["text"] for e in snapshot["transcript"]] == ["Hi, I'm Maya. How are you?", "Doing well."]


async def test_no_reoffer_in_time_ends_as_disconnected(engine):
    engine.app.state.settings.reoffer_window_s = 1.0  # 1 ms at the test time scale
    call, sb, ui = await started(engine)
    engine.realtime.refuse_connect.add(call["callId"])
    sb.drop()
    payload = await engine.wait_settled()
    assert payload["endedReason"] == "candidate_disconnected"


async def test_settle_is_retried_until_node_answers(engine):
    engine.node.fail_settles = 2
    call, sb, ui = await started(engine)
    await ui.send({"type": "end_session"})
    await engine.wait_settled()
    doc = await engine.store.get_session(call["callId"])
    assert doc["settle"]["attempts"] == 3 and doc["settle"]["status"] == "acked"


def call_offer() -> str:
    from tests.conftest import OFFER
    return OFFER


async def test_node_can_fetch_the_settlement_once_the_interview_ends(engine):
    """The pull twin of the settle callback, for a Node the engine cannot reach (a laptop)."""
    from app.config import DEV_SECRET
    auth = {"authorization": f"Bearer {DEV_SECRET}"}
    call, sb, ui = await started(engine)
    url = f"{engine.base}/v1/calls/{call['callId']}/settlement"
    r = await engine.client.get(url, headers=auth)
    assert r.status_code == 409 and r.json()["error"]["code"] == "call_not_ended"
    assert (await engine.client.get(url)).status_code == 401

    sb.push(*reply("resp_1", "item_g", "Hi, I'm Maya. How are you?"))
    await ui.next("transcript")
    await ui.send({"type": "end_session"})
    pushed = await engine.wait_settled()
    pulled = (await engine.client.get(url, headers=auth)).json()
    assert pulled["callId"] == call["callId"] and pulled["endedReason"] == "candidate_ended"
    assert pulled["transcript"] == pushed["transcript"] and pulled["summary"] == pushed["summary"]

    engine.registry.calls.clear()  # long after: only engine_sessions has it
    from_db = (await engine.client.get(url, headers=auth)).json()
    assert [e["text"] for e in from_db["transcript"]] == ["Hi, I'm Maya. How are you?"]
    assert from_db["durationSeconds"] == pushed["durationSeconds"]
    r = await engine.client.get(f"{engine.base}/v1/calls/rtc_nope/settlement", headers=auth)
    assert r.status_code == 404
