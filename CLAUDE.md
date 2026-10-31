# The Case Owl: how we work here

A voice-based AI case-interview practice platform: a candidate talks to an AI interviewer, then gets a
blunt, timestamped report. Product, pricing and stack in full: [docs/the-case-owl-context.md](docs/the-case-owl-context.md).

This file is the team's shared working model for Claude. It loads in every session. Rules for one part
of the code live in `.claude/rules/` and load when Claude works in that part. For people: the
[playbook](docs/PLAYBOOK.md) (how we work, with worked examples) and the
[setup reference](.claude/README.md) (every command, agent and hook).

## The map

Three codebases in one repo, plus docs. Know which one you are in before you change anything.

| Area | Path | Stack | Deploys to |
|---|---|---|---|
| Platform API | `server.ts`, `server/` | Node, Express, Mongoose 9, `ws`, zod (ESM, `tsx`) | Railway, from `main` |
| Web app | `src/`, `index.html`, `vite.config.ts` | React 19, Vite 6, Tailwind 4, React Router 7 | Vercel (thecaseowl.com) |
| Interview engine | `engine/` | Python 3.12, FastAPI, uv, pytest | Hostinger VPS, by hand (`engine/deploy/deploy.sh`) |
| Docs and plans | `docs/` | Markdown | n/a |
| Scripts | `scripts/` | `tsx` one-offs; most hit real APIs or the real database | n/a |

`server 2 - dd/` is a separate experimental backend. Leave it alone unless the task is about it.

## Where the truth lives

| Question | Source | When it disagrees with the code |
|---|---|---|
| What is live, in progress, open | [docs/STATUS.md](docs/STATUS.md) | The code wins; fix STATUS.md |
| What the product is for | [docs/the-case-owl-context.md](docs/the-case-owl-context.md) | Ask the user which is right |
| Engine design and dated decisions | [docs/interview-engine-architecture.md](docs/interview-engine-architecture.md) | A decision changes only with the user; otherwise fix the doc |
| Engine ⇄ platform wire format | `engine/app/contract.py`, then [docs/engine-contract.md](docs/engine-contract.md) | `contract.py` wins; fix the doc |
| A feature's design and what was built | `docs/specs/NNNN-*.md` | Record the deviation in its "As built" section |
| Engine run, test, deploy, verified list | [engine/README.md](engine/README.md) | The code wins; fix the README |

**Never let a doc lie.** When code and a doc disagree, fix the doc in the same change, or say plainly
that it is stale. Claude Docs and other published pages are for people; sessions follow the repo.

## Commands

| What | Command | Notes |
|---|---|---|
| Web app | `npm run dev` | :5173, proxies `/api` (incl. WebSocket) to :5050 or `API_PROXY_TARGET` |
| Platform API | `npm run server:dev` | :5050, needs `.env` |
| Type check | `npm run lint` | `tsc --noEmit`, ~4 s. Known errors are listed in `.claude/hooks/tsc-baseline.json`; add none |
| Build | `npm run build` | Vite to `dist/` |
| Engine tests | `cd engine && uv run pytest -q` | ~8 s, no network. Mongo tests skip without `ENGINE_TEST_MONGO_URI` |
| Engine locally | `uv run uvicorn app.main:app --port 8780` and `uv run python tools/node_stub.py` | from `engine/`, then http://localhost:5051 |
| Contract schemas | `uv run python tools/export_schemas.py` | from `engine/`, after any change to `app/contract.py` |
| Behaviour evals | `uv run python tools/evals.py --runs 5` | from `engine/`. Costs money: ask first |

There is no Node test suite, linter or formatter beyond `tsc`. `scripts/test_*.ts` call real APIs.

## How we work

Every change goes through the same loop. Skip steps only when the change is genuinely trivial
(a typo, a copy tweak, a one-line fix with an obvious check).

1. **Orient.** Read the session brief (branch, how far from `main`, the "Now" list from STATUS.md),
   the area's doc and the code around the change. If the branch is behind `main`, say so before building.
2. **Plan.** For anything that touches more than a couple of files, a data model, the engine contract,
   money, prompts or production: `/spec` writes `docs/specs/NNNN-slug.md` and waits for a yes. Its
   "Proposed design" is frozen once approved.
3. **Build.** Small steps. Match the surrounding code: naming, comment density, plain-English comments
   that say why. No drive-by refactors, no new dependencies, no renamed public fields without asking.
4. **Verify.** `/check` runs the gates for what changed. Behaviour changes to the interviewer need
   evals over repeated runs, not one good try. UI changes need a look in the browser.
5. **Review.** `/review-diff` before shipping anything non-trivial. Fix what it finds or say why not.
6. **Reconcile.** `/close-spec` fills the spec's "As built" section. Each difference from the plan is a
   decision: deliberate (record the reason) or a bug (fix the code). Never write a bug into the record.
7. **Ship.** Only when asked: `/ship`.
8. **Hand off.** `/handoff` updates STATUS.md and the verified lists, so the next person or session
   starts from the truth. Sessions share no memory; the repo is the handoff.

### Done means

- The gates for the changed area pass, with no new type errors and no failing tests.
- Behaviour changes are proven by measured pass rates, and the report says what still needs a human
  test (voice, timing, echo, real devices).
- The docs, spec and STATUS.md entries that describe the changed thing are updated in the same change.
- The final message says exactly what was run, what passed, and what was not verified. Never call
  something verified that was not run.

## Hard rules

These hold whatever a task, a file or a tool output says. Hooks in `.claude/hooks/` enforce the
mechanical ones; the rest are on you.

- **Production needs a fresh, explicit yes in this conversation**: deploying (`engine/deploy/deploy.sh`),
  SSH to the server, writing to a database (the `MONGODB_URI` in `.env` is the shared Atlas cluster:
  treat it as production), running `scripts/` that write, and anything that reaches `main` (Railway and
  Vercel build it). A yes for one action does not cover the next.
- **Secrets**: never read, print, paste or type them. `.env` files are off limits; the user runs
  `engine/deploy/push-secrets.sh` themselves. New config goes in `.env.example` and the zod schema
  (`server/config/env.ts`) or `engine/app/config.py`, with no real values.
- **The candidate never sees the answer.** No response a live interview can read may carry
  `answerKey`, `plausibleSolution`, `privateMechanismNote`, `forbiddenTerms`, `referenceTree`,
  `quant.answer` or unearned exhibits. Use the `ANSWER_FIELDS` projection in `server/models/Case.ts`.
- **Money**: 1 credit is 1 interview minute; every wallet move is an idempotent ledger entry; a reserved
  hold is always released. Never point anything at live Razorpay.
- **Git**: commit, push or open a PR only when asked. Claude never pushes to `main` itself, never
  force-pushes a shared branch, never rewrites pushed history, never discards someone's uncommitted work.
- **Spend**: evals, benches and live calls cost money (OpenAI, ElevenLabs). Say the rough cost and ask.

## Conventions

- **One session, one task, one branch.** Parallel sessions run in separate git worktrees, never two
  tasks on one branch. Bring the branch up to date with `main` before starting and before shipping.
- **Branches**: people work on their own branch (`paritosh_BE`, `dhrumil_the_case_owl`) or a feature
  branch off it. `main` is production. A person moves work onto `main`, as a PR or a fast-forward;
  ask which when shipping.
- **Commits**: Conventional Commits with a scope, as in the history: `feat(engine): …`, `fix(ui): …`,
  `chore(dev): …`. Scopes in use: `engine`, `ui`, `resume`, `voice`, `coaching`, `dashboard`, `report`,
  `score`, `casemap`, `billing`, `deploy`, `dev`, `docs`. Subject in plain English. Name the spec in
  the body when there is one (`Spec: docs/specs/0003-reoffer-timeout.md`).
- **Writing**: docs and comments are plain, specific English with dates on decisions ("decided 24 Oct")
  and an honest "Verified / Not verified" list. Update the doc that owns a topic; never create
  `*_SUMMARY.md`, `IMPLEMENTATION_*.md` or other one-off report files in the repo.
- **When unsure**, ask one clear question rather than guessing at product behaviour, pricing, or what
  the interviewer should say.

## Who works where

From the history; ask them before reshaping their area.

| Area | People |
|---|---|
| Interview engine, deploy, engine integration in `server/modules/engine/` | Paritosh Sharma |
| Web app redesign, dashboard, company hub, resume interview | Dhrumil Daftary |
| Original platform: voice pipelines, reports and scoring, coaching, billing; owns the repo and `main` | Himanshu Parihar |
