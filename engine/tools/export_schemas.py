"""Write the contract's JSON Schemas to engine/contract/, for the Node side's tests.

Run from engine/:  uv run python tools/export_schemas.py
tests/test_contract.py fails when the checked-in schemas fall behind app/contract.py.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.contract import SCHEMAS  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "contract"


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, model in SCHEMAS.items():
        (OUT / f"{name}.json").write_text(json.dumps(model.model_json_schema(by_alias=True), indent=2) + "\n")
    print(f"wrote {len(SCHEMAS)} schemas to {OUT}")


if __name__ == "__main__":
    main()
