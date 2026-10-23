"""Restarts and deploys: a shutdown hands live interviews to the next instance, which reattaches to the same
OpenAI calls; a crashed owner's interviews are taken over once its lease lapses; never one another
instance still holds."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

from app.auth import mint_ui_token
from app.config import DEV_SECRET
from app.runtime.interview import utcnow
from app.store import MemoryStore, case_files
from tests.conftest import UiClient, run_engine
from tests.fakes import candidate_turn, reply
from tests.test_flow import started

AUTH = {"authorization": f"Bearer {DEV_SECRET}"}


async def page(engine, call_id: str, session_id: str = "sess_9", user_id: str = "user_9") -> UiClient:
    """The page's UI socket, opened (or reopened) on this instance."""
    token = mint_ui_token(engine.app.state.settings, call_id, session_id, user_id, utcnow() + timedelta(minutes=30))
    return UiClient(await ws_connect(f"{engine.app.state.settings.public_ws_url}/v1/calls/{call_id}/ui?token={token}"))


async def close_code(ui: UiClient, timeout: float = 3.0) -> int:
    async def read():
        try:
            while True:
                await ui.ws.recv()
        except ConnectionClosed as closed:
            return closed.rcvd.code if closed.rcvd else None
    return await asyncio.wait_for(read(), timeout)


def when(wire: str) -> datetime:
    return datetime.fromisoformat(wire.replace("Z", "+00:00"))


def live_doc(call_id: str, lease_until, owner: str = "old-instance") -> dict:
    now = utcnow()
    return {"callId": call_id, "openaiCallId": call_id, "sessionId": "sess_9", "userId": "user_9", "caseId": "coffee",
            "caseVersion": 1, "state": "live", "stage": "case", "limits": {"maxMinutes": 30}, "config": {},
            "createdAt": now, "startedAt": now,  # tests run the clock 1,000x fast: "now" keeps the time cap far off
            "released": ["cost_total"], "counts": {}, "costUsd": 0.12, "owner": owner, "leaseUntil": lease_until,
            "ledger": [{"item_id": "i1", "role": "interviewer", "text": "Hi, I'm Maya.", "at": now},
                       {"item_id": "i2", "role": "candidate", "text": "Hello!", "at": now}],
            "settle": {"status": "pending", "attempts": 0, "lastError": ""}}


async def test_a_crashed_owners_interview_is_taken_over_and_reattached(engine):
    await engine.store.save_session(live_doc("rtc_old_1", lease_until=utcnow() - timedelta(seconds=5)))
    assert await engine.registry.recover() == 1
    iv = engine.registry.get("rtc_old_1")
    sb = await engine.realtime.sideband("rtc_old_1")  # the same OpenAI call: the candidate notices nothing
    assert sb is not None and iv.released == {"cost_total"} and iv.turn.stage == "case"
    for _ in range(100):  # a check-in is armed again, as after any pause
        if iv.turn.gen.get("nudge"):
            break
        await asyncio.sleep(0.01)
    assert iv.turn.gen.get("nudge")
    doc = await engine.store.get_session("rtc_old_1")
    assert doc["owner"] == engine.app.state.settings.instance_id


async def test_an_interview_another_instance_still_owns_is_left_alone(engine):
    """A fresh lease means its owner is still running it, so this instance does not steer the same call."""
    await engine.store.save_session(live_doc("rtc_old_2", lease_until=utcnow() + timedelta(seconds=20)))
    assert await engine.registry.recover() == 0
    assert engine.registry.get("rtc_old_2") is None


async def test_a_recovered_interview_the_call_is_gone_for_asks_the_page_to_reoffer(engine):
    await engine.store.save_session(live_doc("rtc_old_3", lease_until=utcnow() - timedelta(seconds=5)))
    engine.realtime.refuse_connect.add("rtc_old_3")
    assert await engine.registry.recover() == 1
    iv = engine.registry.get("rtc_old_3")
    from tests.conftest import UiClient
    from websockets.asyncio.client import connect as ws_connect
    from app.auth import mint_ui_token
    token = mint_ui_token(engine.app.state.settings, "rtc_old_3", "sess_9", "user_9", utcnow() + timedelta(minutes=30))
    url = f"{engine.app.state.settings.public_ws_url}/v1/calls/rtc_old_3/ui?token={token}"
    ui = UiClient(await ws_connect(url))
    snapshot = await ui.next("snapshot")
    assert [e["text"] for e in snapshot["transcript"]] == ["Hi, I'm Maya.", "Hello!"]
    assert snapshot["stage"] == "case"
    await ui.next("reoffer_required")
    assert iv.state == "awaiting_reoffer"


# --- hand-off on shutdown ----------------------------------------------------------------------

async def test_a_deploy_hands_a_live_interview_to_the_next_instance(engine):
    call, sb, ui = await started(engine)
    cid = call["callId"]
    sb.push(*reply("resp_1", "item_g", "Hi, I'm Maya. How are you?"))
    await ui.next("transcript")

    await engine.registry.shutdown(0.1)
    assert sb.closed and engine.realtime.hangups == []  # only the control socket closed: the call stays up
    assert await close_code(ui) == 1012                 # "service restart": the page reconnects
    doc = await engine.store.get_session(cid)
    assert doc["state"] == "live" and doc["leaseUntil"] is None  # released, not left to lapse

    async with run_engine(engine.realtime, engine.node, engine.store) as nxt:
        assert nxt.registry.get(cid) is not None  # taken over as the next instance starts
        sb2 = await engine.realtime.sideband(cid, n=2)  # the same OpenAI call, reattached
        ui2 = await page(nxt, cid, "sess_1", "user_1")
        snapshot = await ui2.next("snapshot")
        assert [e["text"] for e in snapshot["transcript"]] == ["Hi, I'm Maya. How are you?"]

        sb2.push(*candidate_turn("item_c1", "Good, thanks.", 5000, 6400))  # she carries on from the new instance
        await sb2.wait_for(lambda e: e["type"] == "response.create")
        await ui2.send({"type": "end_session"})
        settled = await nxt.wait_settled()
        assert [e["text"] for e in settled["transcript"]] == ["Hi, I'm Maya. How are you?", "Good, thanks."]
        assert engine.realtime.hangups == [cid]


async def test_a_page_reconnecting_mid_hand_off_is_told_to_retry_then_gets_in(engine):
    await engine.store.save_session(live_doc("rtc_m1", lease_until=utcnow() + timedelta(seconds=20)))
    assert await close_code(await page(engine, "rtc_m1")) == 1013  # the old instance still holds it

    doc = await engine.store.get_session("rtc_m1")
    await engine.store.save_session({**doc, "leaseUntil": None})  # it has handed off
    ui = await page(engine, "rtc_m1")
    assert [e["text"] for e in (await ui.next("snapshot"))["transcript"]] == ["Hi, I'm Maya.", "Hello!"]
    assert engine.registry.get("rtc_m1") is not None  # taken over on the page's reconnect, not on a scan
    await engine.realtime.sideband("rtc_m1")


async def test_nodes_end_mid_hand_off_is_retried_not_dropped(engine):
    await engine.store.save_session(live_doc("rtc_m2", lease_until=utcnow() + timedelta(seconds=20)))
    r = await engine.client.post(f"{engine.base}/v1/calls/rtc_m2/end", json={"reason": "admin"}, headers=AUTH)
    assert r.status_code == 503 and r.json()["error"]["code"] == "call_moving"

    doc = await engine.store.get_session("rtc_m2")
    await engine.store.save_session({**doc, "leaseUntil": None})
    r = await engine.client.post(f"{engine.base}/v1/calls/rtc_m2/end", json={"reason": "admin"}, headers=AUTH)
    assert r.status_code == 202
    settled = await engine.wait_settled()
    assert settled["endedReason"] == "admin" and "rtc_m2" in engine.realtime.hangups


async def test_an_interview_handed_off_while_ending_finishes_ending(engine):
    ended_at = utcnow() - timedelta(seconds=2)
    await engine.store.save_session({**live_doc("rtc_e1", lease_until=None), "state": "ending",
                                     "endedReason": "candidate_ended", "endedAt": ended_at})
    assert await engine.registry.recover() == 1
    settled = await engine.wait_settled()
    assert settled["endedReason"] == "candidate_ended"
    assert abs((when(settled["endedAt"]) - ended_at).total_seconds()) < 0.01  # the time it ended, not now
    assert "rtc_e1" in engine.realtime.hangups


async def test_a_settle_cut_short_by_a_deploy_is_delivered_by_the_next_instance(engine):
    engine.node.fail_settles = 10_000  # Node is down
    call, sb, ui = await started(engine)
    await ui.send({"type": "end_session"})
    await ui.next("session_ended")
    iv = engine.registry.get(call["callId"])
    assert iv is not None and iv.settle_state["status"] == "retrying"

    await engine.registry.shutdown(0.1)
    doc = await engine.store.get_session(call["callId"])
    assert (doc["state"], doc["settle"]["status"], doc["leaseUntil"]) == ("ended", "retrying", None)

    engine.node.fail_settles = 0  # Node is back
    async with run_engine(engine.realtime, engine.node, engine.store) as nxt:
        settled = await nxt.wait_settled()  # resumed as the next instance starts
        assert settled["callId"] == call["callId"] and settled["endedReason"] == "candidate_ended"
        await asyncio.sleep(0.05)
        assert (await nxt.store.get_session(call["callId"]))["settle"]["status"] == "acked"
        assert await nxt.store.claimable(utcnow()) == []  # nothing left to take


async def test_without_a_node_url_interviews_are_kept_but_not_settled():
    async with run_engine(node_url="") as eng:
        call, sb, ui = await started(eng)
        await ui.send({"type": "end_session"})
        await ui.next("session_ended")
        doc = await eng.store.get_session(call["callId"])
        assert doc["state"] == "ended" and doc["settle"]["status"] == "skipped" and eng.node.settles == []
        assert eng.registry.get(call["callId"]) is None


async def test_checked_in_cases_are_published_once_and_never_over_a_generated_version():
    store = MemoryStore(seed=False)
    coffee = [d for d in case_files() if d["caseId"] == "coffee"]
    assert await store.sync_file_cases(coffee) == ["coffee v1"]
    assert await store.sync_file_cases(coffee) == []  # unchanged
    assert await store.sync_file_cases([{**coffee[0], "statement": "Edited.", "contentHash": "edited"}]) == ["coffee v2"]
    await store.put_case({**coffee[0], "version": 3, "source": "generated", "contentHash": None})
    assert await store.sync_file_cases(coffee) == []  # phase 2's version stays the latest
    assert (await store.get_case("coffee"))["version"] == 3
