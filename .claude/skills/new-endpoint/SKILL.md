---
name: new-endpoint
description: Add an API endpoint to the Node platform the way this codebase does it - route with requireAuth and a rate limiter, zod-validated controller, service with user-scoped queries, mounted in server.ts, plus the client call in src/lib or the feature's api.ts. Use when adding or extending a REST route under /api.
argument-hint: "[METHOD /api/path - what it does]"
---

# New API endpoint

The endpoint: $ARGUMENTS

## 1. Look before writing

- Find the module it belongs to in `server/modules/`. Read its `*.routes.ts`, `*.controller.ts` and
  `*.service.ts` and copy their shape. `server/modules/sessions/` is a good reference.
- If the frontend already has a contract for it (e.g. `src/features/dashboard/types.ts`), the response
  must match that type exactly.
- If the endpoint returns or touches a `Case`, read the "answer key" section of `.claude/rules/security.md`.

## 2. Write it

- **Route** (`<module>.routes.ts`): `router.<method>(path, requireAuth, generalLimiter, handler)`. Use
  `aiLimiter` if the handler calls a model, `requireAdmin` for admin routes. Static paths before `/:id`.
- **Controller**: validate `req.body` / `req.query` / `req.params` with zod; on failure
  `next(new AppError(400, '…'))`. Pass `req.userId` to the service. Shape the response here.
- **Service**: the logic and queries. Every query on user data filters by `userId`. Use
  `.select(ANSWER_FIELDS)` for any `Case` read that can reach a live interview. Updates that must not
  double-apply are conditional (`findOneAndUpdate` with a guard).
- **New module**: mount it in `server.ts` with the other `app.use('/api/…')` lines, before `errorHandler`.
- Relative imports end in `.js`. Config only through `env` from `server/config/env.ts`.
- **Client**: add the call to the feature's `api.ts`, or a function using `request()` from `src/lib/api.ts`.

## 3. Verify

- `npm run lint`: no new type errors.
- Exercise it against `npm run server:dev`: the happy path, no token (401), another user's id
  (404 or 403, never their data), bad input (400). Show the requests and responses (with tokens redacted).
- If it reads cases: confirm the response has no answer fields while a session is live.
