"""The transcript of what the candidate actually heard, in conversation order.

It feeds the page's snapshot after a reconnect and the settle callback, so Node's report grades the
interview that happened: interviewer turns cut to what was played, replies nobody heard left out,
coughs and noise left out. Entries keep the order their conversation items were created in, which is
conversation order (a candidate's item at commit, an interviewer's when her reply starts).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Literal

Role = Literal["interviewer", "candidate"]


@dataclass
class Entry:
    item_id: str
    role: Role
    at: datetime
    text: str = ""


class Ledger:
    def __init__(self) -> None:
        self._entries: dict[str, Entry] = {}  # insertion-ordered: conversation order

    def add(self, item_id: str, role: Role, text: str = "", at: datetime | None = None) -> None:
        if item_id not in self._entries:
            self._entries[item_id] = Entry(item_id, role, at or datetime.now(timezone.utc), text)
        elif text:
            self._entries[item_id].text = text

    def append(self, item_id: str, delta: str) -> None:
        if item_id in self._entries:
            self._entries[item_id].text += delta

    def set_text(self, item_id: str, text: str) -> None:
        if item_id in self._entries:
            self._entries[item_id].text = text

    def remove(self, item_ids) -> None:
        for item_id in item_ids:
            self._entries.pop(item_id, None)

    def text(self, item_id: str) -> str:
        entry = self._entries.get(item_id)
        return entry.text if entry else ""

    def __contains__(self, item_id: str) -> bool:
        return item_id in self._entries

    def heard(self) -> list[Entry]:
        return [e for e in self._entries.values() if e.text.strip()]

    def transcript(self) -> list[dict]:
        """The settle callback's transcript (contract section 2)."""
        return [{"role": e.role, "text": e.text.strip(), "timestamp": e.at} for e in self.heard()]

    def snapshot(self) -> list[dict]:
        """The page's snapshot after a reconnect (contract section 3)."""
        return [{"role": e.role, "text": e.text.strip(), "itemId": e.item_id} for e in self.heard()]

    def dump(self) -> list[dict]:
        return [asdict(e) for e in self._entries.values()]

    @classmethod
    def load(cls, rows: list[dict]) -> "Ledger":
        ledger = cls()
        for row in rows:
            at = row["at"]
            if isinstance(at, str):
                at = datetime.fromisoformat(at)
            if at.tzinfo is None:  # Mongo hands back naive UTC unless tz-aware
                at = at.replace(tzinfo=timezone.utc)
            ledger._entries[row["item_id"]] = Entry(row["item_id"], row["role"], at, row.get("text", ""))
        return ledger
