# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp>=3.10", "truststore>=0.9"]
# ///
"""Pick the small text models: the fact matcher and the listening-mode analyzer, on their real prompts.

Each model answers the same labelled questions N times; the table shows accuracy and latency. These
calls are cheap (a few hundred tokens), so accuracy and speed decide, not price. The voice model is
chosen with evals.py --model instead.

Run from the repo root:  uv run engine/spike/bench.py --models gpt-5.4-nano,gpt-6-luna,gpt-5.6-luna --runs 3
"""
from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import sys
import time
from pathlib import Path

import aiohttp
import truststore

sys.path.insert(0, str(Path(__file__).resolve().parent))
import facts  # noqa: E402
import server  # noqa: E402

# (her restatement, the candidate's words, the fact ids that answer at the right level; empty: none should)
MATCHER = [
    ("Has there been an increase in costs, fixed or variable?", "", {"cost_split"}),
    ("Have costs gone up?", "", {"cost_total"}),
    ("Which cost categories increased, and is the increase fixed or variable?",  # 22 Oct evals: her broadening
     "Among those costs, has anything increased, and is it fixed or variable?", {"cost_split"}),
    ("Which variable costs went up?", "", {"variable_detail"}),
    ("What happened to coffee bean costs?", "", {"beans"}),
    ("Why did bean costs rise?", "", {"beans_why"}),
    ("Did they change supplier?", "", {"beans_why"}),
    ("What are the main cost lines?", "", {"cost_lines"}),
    ("What happened to labour and rent?", "", {"labour", "rent"}),
    ("Has the number of customers changed?", "", {"visits"}),
    ("What happened to price and volume?", "", {"revenue_drivers", "visits", "ticket"}),
    ("Did they open new stores?", "", {"footprint"}),
    ("What is their market share?", "", set()),
    ("Is my framework right?", "", set()),
    ("What would you look at first?", "", set()),
]
# (the candidate's words in listening mode, the intent, the seconds if they asked for time)
ANALYZER = [
    ("hmm revenue is price times volume", "still_thinking", None),
    ("uh", "still_thinking", None),
    ("okay", "still_thinking", None),
    ("Okay, so I'd split profit into revenue and costs, and look at costs first.", "hand_back", None),
    ("I'm ready.", "hand_back", None),
    ("What does the client mean by operating profit here?", "hand_back", None),
    ("Alright, I think I have a structure. Can I walk you through it?", "hand_back", None),
    ("Can I get one more minute?", "wants_time", 60),
    ("Give me thirty more seconds.", "wants_time", 30),
    ("Wait, hold on.", "wants_time", None),
]


async def timed(coro) -> tuple[object, float]:
    start = time.monotonic()
    try:
        result = await coro
    except Exception as err:  # a model that rejects the request shows up as a row of errors
        result = err
    return result, (time.monotonic() - start) * 1000


async def matcher_case(http, model, q, said, ok):
    verdict, ms = await timed(facts.match(http, server.auth(), server.CASE, q, said, model=model))
    if isinstance(verdict, Exception):
        return False, ms, f"{q} → error {verdict}"
    ids = set(verdict.get("fact_ids") or []) if verdict.get("status") == "match" else set()
    good = (ids <= ok and bool(ids)) if ok else not ids
    return good, ms, "" if good else f"{q} → {verdict.get('status')} {sorted(map(str, ids))}"


async def analyzer_case(http, model, text, intent, seconds):
    body = facts.chat_body(model, server.ANALYZER_PROMPT,
                           f"Interviewer's last words: Sure, take your time.\nCandidate: {text}", 40)

    async def call():
        async with http.post("https://api.openai.com/v1/chat/completions", json=body, headers=server.auth(),
                             timeout=aiohttp.ClientTimeout(total=server.ANALYZER_TIMEOUT_S)) as r:
            data = await r.json()
        if r.status != 200:
            raise ValueError((data.get("error") or {}).get("message", f"HTTP {r.status}"))
        return json.loads(data["choices"][0]["message"]["content"])
    verdict, ms = await timed(call())
    if isinstance(verdict, Exception):
        return False, ms, f"{text} → error {verdict}"
    good = verdict.get("intent") == intent and (seconds is None or verdict.get("wait_seconds") == seconds)
    return good, ms, "" if good else f"{text} → {verdict.get('intent')} {verdict.get('wait_seconds')}"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="gpt-5.4-nano,gpt-4o-mini,gpt-6-luna,gpt-5.6-luna")
    ap.add_argument("--runs", type=int, default=3)
    a = ap.parse_args()
    connector = aiohttp.TCPConnector(ssl=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT))
    async with aiohttp.ClientSession(connector=connector) as http:
        for task, cases, fn in (("fact matcher", MATCHER, matcher_case), ("analyzer", ANALYZER, analyzer_case)):
            print(f"\n{task} ({len(cases)} cases × {a.runs} runs)")
            for model in a.models.split(","):
                rows = []
                for _ in range(a.runs):  # one at a time, so latency is not inflated by our own concurrency
                    for case in cases:
                        rows.append(await fn(http, model, *case))
                ms = sorted(r[1] for r in rows)
                misses = sorted({r[2] for r in rows if r[2]})
                print(f"  {model:<16} {sum(r[0] for r in rows):>3}/{len(rows)} right   p50 {ms[len(ms) // 2]:>5.0f} ms"
                      f"   p95 {ms[int(len(ms) * 0.95)]:>5.0f} ms")
                for miss in misses[:6]:
                    print(f"      ✗ {miss[:150]}")


if __name__ == "__main__":
    asyncio.run(main())
