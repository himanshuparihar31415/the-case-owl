# Status

What is live, what is moving, and what is open. Every Claude session starts with the "Now" list
(a SessionStart hook prints it), so keep that list short and true. Update this file with `/handoff`.
When it disagrees with the code, the code is right: fix this file.

Last updated: 31 Oct 2026

## Now

- **Engine pilot is live.** Consulting interviews of users on the pilot list run on the interview engine,
  all on one case (`engine/cases/coffee.json`, decided 24 Oct). Everyone else uses the older STT → LLM →
  TTS pipeline. Pilot list: `npx tsx scripts/engine-pilot.ts status` (reads production).
- **Engine, not verified yet**: a full voice interview on the deployed engine, a deploy during a live
  interview on the server, re-offer after a real WebRTC drop (`engine/README.md`).
- **Branch model and CI are in `develop`, not yet in production** ([spec 0001](specs/0001-develop-branch-and-ci.md),
  decided 31 Oct).
  - `develop` exists (renamed from `dhrumil_the_case_owl`), and work goes on branches off it by pull request.
  - PR #6 merged into `develop` on 31 Oct. CI (`platform` and `engine`) passed on GitHub on the pull
    request (run 41212761370) and on the push to `develop` (run 41213539188).
  - Until the first release to `main`, Railway still redeploys on engine-only commits (dropping live
    voice sockets), and the engine still deploys by hand.
  - Waiting on Himanshu (spec 0001, Rollout): making the repo private, the CI key, branch protection
    (needs GitHub Pro), and Railway's "Wait for CI".
- **Dashboard runs on mock data** unless `VITE_DASHBOARD_SOURCE=api`; the `/api/dashboard/*` endpoints
  it expects (`src/features/dashboard/README.md`) do not exist yet. Checked in code 31 Oct.
- **Billing has open bugs**, from a code-reading audit on 31 Oct (nothing run or fixed yet): credit holds
  leaked in production from 14 Jun to 24 Oct and those wallets still show inflated `reserved` credits;
  holds can still leak (nothing settles abandoned sessions); plans never expire or renew; on the older
  voice pipelines a page refresh restarts the time cap for free. Check each against the code, and
  `/spec` before fixing: it is money.
- **Type check has 11 known errors** (`.claude/hooks/tsc-baseline.json`); there is no Node test suite.

## Live

| Service | Where | Deploys from |
|---|---|---|
| Web app | Vercel, thecaseowl.com; `/api/*` rewritten to Railway (`vercel.json`) | `main` |
| Platform API | Railway, `casecoachaiv1-production.up.railway.app` | `main` (`railway.toml`, Nixpacks) |
| Interview engine | Hostinger VPS, `https://srv2011824.hstgr.cloud` | `engine/deploy/deploy.sh`, by hand; after spec 0001's first release, Actions → Engine deploy → Run workflow, on `main` |
| Databases | MongoDB Atlas: the platform's database, and `engine` for the engine | n/a |

## Fixed recently

- **Answer key no longer sent to the browser** by the session and case APIs: `ANSWER_FIELDS` projection
  (`server/models/Case.ts`). Committed 24 Oct (d3bea10), now on `main`.
- **Releasing a wallet hold works again**: `wallet.service.ts` sets `updatePipeline: true` (Mongoose 9
  refused the update without it). Same commit, now on `main`. The holds stuck before it are not repaired
  (see "Now").

## Decisions to make

- Engine-owned voice detection, so the interviewer can talk through a cough (open since the spike,
  `engine/spike/README.md`).
- Repairing wallets with a stuck `reserved` balance: count them with a read-only query first, then a
  production write only after a yes.
- Which billing bugs to fix first, and how plans should expire and renew.
- GitHub Pro on Himanshu's account, so the repo keeps enforced branch protection once it is private
  (spec 0001). Without it, the branch rules hold only by convention.
- Two Railway projects (`appealing-abundance`, `inspiring-nurturing`) and two Vercel projects
  (`casecoachai-v1`, `casecoachai-v1-tbvb`) all deploy `main` to production (GitHub deployments,
  31 Oct). Which are live, and remove the rest (Himanshu).

## Next

- A voice interview on the deployed engine, then phase 2 (case generation) per
  `docs/interview-engine-architecture.md` "Build order".
