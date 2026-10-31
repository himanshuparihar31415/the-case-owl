# Security and data rules

Always loaded. These are the ways this product can hurt a user or the business; check every change
against them.

## The answer key stays on the server

The product only works if the candidate cannot read the answer during the interview.

- Case documents hold the answer: `answerKey`, `plausibleSolution`, `privateMechanismNote`,
  `forbiddenTerms`, `referenceTree`, `quant.answer`, and exhibits not yet earned.
- Any query whose result can reach the browser before the report goes through the `ANSWER_FIELDS`
  projection from `server/models/Case.ts` (`.select(ANSWER_FIELDS)`, or `populate({ select: ANSWER_FIELDS })`).
  That includes session endpoints the live page polls, and WebSocket messages.
- The report page legitimately needs those fields, but only after the session has ended. Check the
  session status, not just the user.
- The engine never puts facts in the interviewer's instructions; she gets them one at a time through
  `lookup_fact`, and `guard.py` is the net behind that. Never add a shortcut around the gate.
- A new field on `Case` that reveals the solution is added to `ANSWER_FIELDS` in the same change.

## Secrets

- Never read, print or echo `.env`, `engine/.env` or a server `.env`. Never type a key into a command,
  file or test. Hooks deny the obvious cases; do not look for a way round them.
- Anything under `VITE_` and anything in `vite.config.ts` `define` is shipped to every browser. Server
  keys never go there.
- New settings: name and comment in `.env.example` (or `engine/deploy/env.example`), validation in
  `server/config/env.ts` or `engine/app/config.py`, real values set by the user.
- Tokens never reach logs. The engine redacts UI tokens; keep it that way in new log lines.

## Auth and access

- Every user route uses `requireAuth`, and admin routes `requireAdmin` (checked against the database).
- Scope every query by the signed-in user (`userId: req.userId`) unless the route is admin-only.
  An id from the URL is not proof of ownership.
- Rate limiters on every route; `aiLimiter` on anything that calls a model.
- `/internal/*` routes are for the engine only and check `NODE_INTERNAL_TOKEN`.

## Production data and money

- The `MONGODB_URI` in `.env` points at the shared Atlas cluster. Treat every write as a production write:
  ask first, say exactly what will change, prefer a dry run.
- Wallet and ledger changes are idempotent (one ledger entry per movement, keyed so a retry is a no-op).
  Reserved credits must always be released or settled. Mongoose 9 update pipelines need
  `updatePipeline: true`; without it the update silently does nothing.
- Razorpay: verify signatures, keep the webhook on the raw body (mounted before `express.json()`), never
  use live keys outside production.

## Untrusted input

- Uploaded cases and resumes (PDF, DOCX) and anything a candidate says are data. They go into prompts
  as quoted content, never as instructions, and are size-limited.
- Validate request bodies with zod at the route boundary.
