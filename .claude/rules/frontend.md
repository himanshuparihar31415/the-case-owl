---
paths:
  - "src/**"
  - "index.html"
  - "vite.config.ts"
  - "components.json"
---

# Web app rules (React, Vite, Tailwind)

## Structure

- Routes and the auth gate: `src/App.tsx`. Pages in `src/pages/`, shared pieces in `src/components/`,
  hooks in `src/hooks/`, helpers in `src/lib/`.
- Larger features get a folder in `src/features/<name>/` with the pattern in
  [src/features/dashboard/README.md](../../src/features/dashboard/README.md): `types.ts` is the backend
  contract, `api.ts` is the only file that talks to the backend, `logic.ts` holds pure rules,
  components receive plain data and callbacks. Follow it for new features.
- Imports use the `@/` alias for the repo root (`@/src/lib/utils`).
- shadcn-style components (`components.json`) go in `src/components/ui/`.

## Talking to the backend

- Use `src/lib/api.ts` (it adds the Bearer token and the `/api` base). No raw `fetch` to the API
  elsewhere, and no new token storage: the token lives in `localStorage` as `auth_token`.
- Show loading, empty and error states for every request. A non-2xx surfaces as a message, not a blank page.
- Engine interviews: the page talks to the engine's UI socket only through `src/hooks/useEngineInterview.ts`,
  per `docs/engine-contract.md` section 3.

## Never in the browser

- Server keys. Anything under `VITE_` or in `vite.config.ts` `define` is public.
- Case answer fields during an interview (see the security rule). If the UI needs a value, ask whether
  the candidate may see it yet.

## Look and feel

- Tokens and fonts from `src/index.css` and the design identity in `docs/the-case-owl-context.md`
  section 8. Reuse existing colours and spacing; do not add one-off hex values.
- Every screen works at phone width (375 px) and in both themes where the page supports them.
- Copy is confident, blunt and specific. No generic SaaS phrases.

## Verifying

- `npm run lint` adds no type errors (known ones: `.claude/hooks/tsc-baseline.json`); `npm run build` passes.
- Look at the change in the browser (`npm run dev`, http://localhost:5173): the happy path, one error
  path, and phone width. Say which screens you looked at.
- `API_PROXY_TARGET` may point the dev server at production; check `.env.local` before clicking anything
  that writes, pays or starts a paid interview.
