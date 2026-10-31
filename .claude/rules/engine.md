---
paths:
  - "engine/**"
---

# Interview engine rules

Start from [engine/README.md](../../engine/README.md): layout, configuration, and the "Verified / Not verified"
list. Design and its dated decisions: [docs/interview-engine-architecture.md](../../docs/interview-engine-architecture.md).

## Settled decisions (change only with new evidence or the user's say-so)

- Audio goes browser ⇄ OpenAI over WebRTC. The engine never carries audio; it steers each call over
  the sideband WebSocket.
- One voice agent (`gpt-realtime-2.1`, low reasoning) plus deterministic engine code and small stateless
  model calls (fact matcher, listening analyzer). Not multi-agent at runtime.
- The engine is the only turn authority: `create_response` and `interrupt_response` are off; it fires,
  holds and cancels replies from event timing.
- The conversation history equals what the candidate heard. Replies cancelled before audio are removed;
  tool calls run only when their reply completed.
- Run one replica: the page's socket must reach the instance that owns the call.
- Interviews are capped at 30 minutes.

## Working in the engine

- Run from `engine/` with `uv`: `uv run pytest -q` (no network, ~8 s). Never `pip install`; add
  dependencies with `uv add` and only after asking.
- Tests use a real server on a free port with fake OpenAI and fake Node (`tests/fakes.py`) and a
  fast clock. New behaviour gets a test of the same kind; do not mock the thing under test.
- `app/runtime/turns.py` is a pure reducer. Keep side effects out of it.
- Shutdown hands live interviews to the next instance; it does not drain or hang up. Anything that
  holds per-call state must survive a hand-off (see `tests/test_recovery.py`).
- Never log tokens, SDP bodies or the answer. Transcripts in `results/` are gitignored; keep them so.
- Case data lives in `cases/*.json` (fact trees). The case id is the file name. What counts as a fact or
  a lead comes from the data, not from code.

## The contract

`app/contract.py` is the source of truth for the wire format. After changing it: run
`uv run python tools/export_schemas.py`, update `docs/engine-contract.md`, and check the Node and page
sides (`server/modules/engine/`, `src/hooks/useEngineInterview.ts`). The `/contract-change` skill walks
through it. Never edit `contract/*.json` by hand.

## Deploying

Production is `https://srv2011824.hstgr.cloud` (Hostinger, Mumbai), deployed by `deploy/deploy.sh` over SSH.
Deploy only with the user's explicit yes, from committed code that passed the tests, and follow the
`/engine-deploy` runbook (health check, logs, rollback). Live interviews survive a deploy by design;
say so, but do not deploy during a known live session without asking.
