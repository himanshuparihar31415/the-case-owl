---
name: contract-change
description: Change the interview engine ⇄ platform contract safely across all three sides - engine/app/contract.py and its exported schemas, docs/engine-contract.md, the Node client in server/modules/engine/, and the page hook src/hooks/useEngineInterview.ts. Use whenever a request, response, callback or socket message between them changes.
argument-hint: "[the change, e.g. add a reason field to session_ended]"
---

# Change the engine contract

The change: $ARGUMENTS

## 1. Classify it

Read `docs/engine-contract.md` section 8. Within `/v1` only additive changes are allowed: a new optional
field or a new message type. A rename, a removal, a type change, a field becoming required, or a change
of meaning is breaking and needs `/v2` served alongside v1. If it is breaking, stop and plan it with
the user (`/spec`).

## 2. Change all three sides, in this order

1. **Engine model**: `engine/app/contract.py` (camelCase alias on the wire, optional with a default for
   additions). Then the code that sends or reads it (`api.py`, `ui.py`, `settle.py`, `runtime/interview.py`).
2. **Schemas**: from `engine/`, `uv run python tools/export_schemas.py`. Never hand-edit `engine/contract/*.json`.
3. **Doc**: `docs/engine-contract.md`, the section for that message, with "(added <date>)" on the new
   field or message, and section 9 if what exists when changed.
4. **Node**: types and handling in `server/modules/engine/engine.client.ts` / `engine.service.ts` /
   `engine.routes.ts`, and `server/models/Session.ts` if it is stored.
5. **Page**: `src/hooks/useEngineInterview.ts` (and `src/pages/Session.tsx` if it shows it). Unknown
   messages must keep being ignored, not crash the page.

## 3. Verify

- `cd engine && uv run pytest -q` (includes `test_contract.py`, which fails on stale schemas). Add or
  extend a test in `test_api.py` / `test_flow.py` that sends or receives the new shape.
- `npm run lint` adds no type errors.
- Run the `contract-keeper` agent and fix any mismatch it finds.
- If the shape travels over the UI socket, exercise it through `tools/node_stub.py` and the test page,
  or a real pilot interview, and say which.

## 4. Deploy order

Additive: either side can go first, since each ignores what it does not know; usually the engine first
(`/engine-deploy`), then the Node and page change. A release to `main` deploys Railway and Vercel at
once but the engine only on the "Run workflow" click, so a change that needs the engine first ships in
two releases: the engine side, deployed, then the Node and page side. Say the order in the PR.
