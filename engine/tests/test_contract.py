"""The contract's wire format, the exported schemas, and the ledger behind the transcript."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from app.contract import SCHEMAS, SettlePayload, TranscriptDelta, parse_page_message, AudioLive, Activity
from app.runtime.ledger import Ledger

CONTRACT_DIR = Path(__file__).resolve().parents[1] / "contract"


def test_the_wire_is_camel_case():
    msg = TranscriptDelta(role="interviewer", text="Hi", item_id="item_1").wire()
    assert msg == {"type": "transcript_delta", "role": "interviewer", "text": "Hi", "itemId": "item_1"}


def test_page_messages_unknown_ones_are_ignored():
    assert isinstance(parse_page_message({"type": "audio_live"}), AudioLive)
    assert isinstance(parse_page_message({"type": "activity", "source": "scratchpad"}), Activity)
    assert parse_page_message({"type": "audio_chunk", "data": "..."}) is None  # the old pipeline's message
    assert parse_page_message({"nonsense": True}) is None


def test_the_checked_in_schemas_match_the_code():
    """Run `uv run python tools/export_schemas.py` after changing app/contract.py."""
    for name, model in SCHEMAS.items():
        path = CONTRACT_DIR / f"{name}.json"
        assert path.exists(), f"missing {path.name}: run tools/export_schemas.py"
        assert json.loads(path.read_text()) == model.model_json_schema(by_alias=True), f"{path.name} is stale"


def test_a_settle_payload_round_trips():
    payload = SettlePayload.model_validate({
        "callId": "rtc_1", "endedReason": "time_cap", "startedAt": "2026-10-23T10:35:02Z",
        "endedAt": "2026-10-23T11:05:02Z", "durationSeconds": 1800,
        "transcript": [{"role": "candidate", "text": "Hello", "timestamp": "2026-10-23T10:35:10Z"}],
        "summary": {"stageReached": "wrap_up", "factsReleased": ["beans"], "hintsUsed": 0, "guardHits": 0,
                    "costUsd": 2.1}})
    assert SettlePayload.model_validate(payload.wire()) == payload


class TestLedger:
    def test_order_is_conversation_order_and_only_what_was_heard(self):
        ledger = Ledger()
        ledger.add("c1", "candidate")               # committed before its transcript arrives
        ledger.add("i1", "interviewer")
        ledger.append("i1", "Hi, I'm ")
        ledger.append("i1", "Maya.")
        ledger.set_text("c1", "Hello")
        ledger.add("i2", "interviewer")             # a reply that never played
        ledger.add("c2", "candidate")               # a cough, deleted at commit
        ledger.remove(["i2", "c2"])
        assert [(e["role"], e["text"]) for e in ledger.transcript()] == [("candidate", "Hello"),
                                                                       ("interviewer", "Hi, I'm Maya.")]

    def test_it_survives_a_restart(self):
        ledger = Ledger()
        ledger.add("i1", "interviewer", "Hi.", at=datetime(2026, 10, 23, tzinfo=timezone.utc))
        again = Ledger.load(json.loads(json.dumps(ledger.dump(), default=str)))
        assert again.snapshot() == [{"role": "interviewer", "text": "Hi.", "itemId": "i1"}]


def test_ui_tokens_never_reach_the_logs():
    import logging
    from app.main import RedactTokens
    record = logging.LogRecord("uvicorn.error", logging.INFO, "", 0, '%s - "WebSocket %s" [accepted]',
                               ("127.0.0.1:5", "/v1/calls/rtc_1/ui?token=eyJabc.def.ghi"), None)
    RedactTokens().filter(record)
    assert "eyJabc" not in record.getMessage() and "token=[redacted]" in record.getMessage()
