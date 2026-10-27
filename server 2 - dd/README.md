# Server 2 - DD

New backend, separate from `server/` + `server.ts`. Same database and tech stack
(Express, Mongoose, OpenAI, ws, zod); new AI logic for case building, solving/voice,
and evaluation. Shared plumbing (config, models, middleware, auth) is imported from `../server`.

Run: `npm run server2:dev` (port 5051, override with `SERVER2_PORT`).

- `ai/caseBuilder/` multi-step case-building pipeline
- `modules/{cases,sessions,voice,reports,coaching}/` new API contract
