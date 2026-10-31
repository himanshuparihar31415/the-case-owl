---
paths:
  - "server.ts"
  - "server/**"
  - "scripts/**"
---

# Platform API rules (Node, Express, Mongoose)

## Shape of a module

Each feature is a folder in `server/modules/<name>/`:

- `<name>.routes.ts`: the router. Middleware order: `requireAuth` (or `requireAdmin`), a rate limiter
  (`generalLimiter`, or `aiLimiter` when the handler calls a model), then the controller.
- `<name>.controller.ts`: reads and validates the request (zod), calls the service, shapes the response.
  Errors go through `next(err)` as `AppError(status, message)`; never `res.status(500).send(...)` by hand.
- `<name>.service.ts`: the logic and the database. No `req`/`res` here.
- Mounted in `server.ts` under `/api/<name>`, before `errorHandler` and the static fallback.

The `/new-endpoint` skill scaffolds this.

## Conventions

- ESM with explicit `.js` extensions in relative imports (`'../../models/Case.js'`), even from `.ts`.
- Config comes from `env` in `server/config/env.ts` (zod), the only file in `server/` that reads
  `process.env`. A new variable is added there and in `.env.example` in the same change.
- Models live in `server/models/`, one per file, with an exported interface (`ICase`) and model (`Case`).
- Projections: any `Case` read that can reach a live interview uses `ANSWER_FIELDS` (see the security rule).
- Write updates that must not double-apply as conditional updates (`findOneAndUpdate` with a guard
  such as `'engine.settledAt': { $exists: false }`), as `engine.service.ts` does.
- Mongoose 9: update pipelines need `updatePipeline: true`; `new: true` to get the updated document.
- Long-running AI calls: time out, and log failures with enough context to find the session.
- Comments explain why and point at the doc section when there is one
  (`// docs/engine-contract.md, section 4`).

## The voice WebSocket

`/api/voice` and `/api/resume-interviews/voice` are upgraded in `server.ts` (noServer mode). A Railway
deploy drops every live socket, so changes here reach users as dropped interviews; batch them and say so.

## Scripts

`scripts/*.ts` run with `npx tsx` against the database in `MONGODB_URI` (production). Read-only
subcommands are fine to run when asked; anything that writes needs an explicit yes, and should print what
it will change before changing it.

## Verifying

- `npm run lint` must not add type errors (known ones: `.claude/hooks/tsc-baseline.json`).
- There is no test suite: exercise the route (curl against `npm run server:dev`, or through the app) and
  say what you exercised.
