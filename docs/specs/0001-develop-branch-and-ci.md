---
id: 0001
title: A develop branch, CI on every change, and engine deploys from CI
status: building
owner: Paritosh Sharma
created: 2026-10-31
---

# 0001: A develop branch, CI on every change, and engine deploys from CI

Status moves draft → approved → building → done, or dropped (say why). Once approved, "Proposed
design" is frozen: later changes go in "As built", with their reasons.

**Revised 31 Oct, after approval and before anything was built.** Paritosh decided the repo will be
private. That changes three things, all of them forced by GitHub's plans:
- On a private personal repo, branch protection needs GitHub Pro.
- No plan below Enterprise gives a private repo environment reviewers, so the approval click becomes
  a "Run workflow" click.
- Actions logs are no longer public, so the deploy-log switch was dropped.

## Problem

Anything pushed to `main` goes straight to production with nothing checked first. There is no CI (no
`.github/`), no branch is protected (GitHub API, 31 Oct), and anyone with write access can push to `main`.
The engine is deployed by hand from a laptop with `engine/deploy/deploy.sh`, and its tests run only if
the person remembers. Personal branches (`dhrumil_the_case_owl`, `paritosh_BE`) also serve as the
place where everyone's work comes together, so there is no shared branch to combine and check work
before production. And Railway restarts on engine-only commits, which drops live voice sockets (open in
STATUS.md).

**Not in scope:**
- A staging environment (phase 2). `develop` deploys nowhere, and Vercel's preview of `develop` still
  calls the production API (`vercel.json`), as every branch preview does today.
- Removing the duplicate projects: two Railway projects and two Vercel projects all deploy `main` to
  production.
- Making the repo private: that is Himanshu's setting, not a change to the code. What was published
  while it was public cannot be recalled. On 31 Oct it had no forks and no stars.
- A Node test suite, and evals in CI (they cost money).

## Proposed design

**Branches**
- `develop` is the integration branch, made by renaming `dhrumil_the_case_owl` on GitHub. Its tip is
  `main` plus the team-setup docs and nothing else. `paritosh_BE` is fully merged into `main` and is deleted.
- Work goes on `<scope>/<slug>` branches off `develop`, then by PR into `develop`. A release is a PR from
  `develop` to `main`, merged with a merge commit (never squash, so the branches don't drift). A hotfix
  branches off `main`, goes by PR into `main`, and then `main` is merged into `develop`.
- `main` stays the default branch and the production branch. Railway and Vercel settings are unchanged.
- Protection, as a ruleset set by Himanshu (the only admin), applies to admins too. It needs GitHub Pro
  on his account (Open question 4); without Pro, these rules hold only by convention and Claude's
  shell guard.
  - on `main` and `develop`: PRs only, the checks `platform` and `engine` must pass, no force-push, no
    deletion;
  - on `main` only: one approving review as well.

**CI: `.github/workflows/ci.yml`**
- Runs on PRs into `develop` or `main`, and on pushes to them. Railway's "Wait for CI" only watches
  workflows that run on push.
- Job `platform`: Node 20, `npm ci`, `node .claude/hooks/stop-verify.mjs --check`, then `npm run build`.
  `--check` is a new flag: run the type check and fail on any error above `tsc-baseline.json`, the same
  rule the Stop hook applies.
- Job `engine`: uv with Python 3.12, `uv sync --frozen`, `uv run pytest -q`. This includes
  `test_contract.py`, which fails when the exported schemas are stale.
- Both jobs run on every change (a few minutes, not yet measured). A private repo gets 2,000 free
  Actions minutes a month on Free, 3,000 on Pro. `permissions: contents: read`. Third-party actions are
  pinned to commit SHAs.

**Engine deploy: `.github/workflows/engine-deploy.yml`**
- On a push to `main` that changes `engine/**`, it runs `test` and `preflight` only. The run summary
  then says the engine on `main` is not yet deployed.
- The approval click is "Run workflow" on this workflow, from `main`. That run repeats `test` and
  `preflight`, then runs `deploy`. The workflow refuses to deploy from any other branch.
- Job `test`: the same as the CI `engine` job.
- Job `preflight`: puts the deployed version (from `/healthz`), the commit about to ship and the
  live-interview count (from `/readyz`) in the run summary.
- Job `deploy`: writes the deploy key and the server's pinned host key, then runs
  `engine/deploy/deploy.sh` unchanged. `concurrency: engine-production`, never cancelled midway.
- The repo holds a new SSH key used only by CI, as a secret (added in hPanel, so it can be revoked
  without touching the laptop key), and the server's public host key, as a variable.
- Running `deploy.sh` by hand stays as the fallback, and still needs an explicit yes.

**Railway**
- `railway.toml` gets `[build] watchPatterns` listing the paths the Node service builds from:
  `server.ts`, `server/**`, `src/**`, `index.html`, `vite.config.ts`, `package.json`,
  `package-lock.json`, `tsconfig.json`, `railway.toml`, `nixpacks.toml`, and the other root config
  files. Engine, docs and scripts commits stop restarting it. It is a list of what to include, not
  "everything except engine", because Railway's docs don't document negation.
- "Wait for CI" is turned on in the Railway service settings (Himanshu), so a `main` commit deploys
  only after `ci.yml` passes on it.
- If Open question 2 is a yes: Railway installs with `npm ci` (`nixpacks.toml`), and `buildCommand`
  becomes `npm run build`, dropping `rm -f package-lock.json && npm install`. Production then runs the
  same versions CI checked.

**Rejected**
- Path-filtered workflows: a required check whose workflow a path filter skips blocks the PR forever.
  Both jobs are fast enough to always run.
- Making `develop` the default branch: Vercel can follow the default branch for production. `/ship`
  names `develop` explicitly instead.
- Pushing the engine image to a registry: it keeps going over SSH, as today, so there is no registry
  to manage or secure.
- An engine deploy with no approval: a deploy during a live interview has not been verified on the
  server yet.
- A GitHub environment with required reviewers: not available on a private repo below Enterprise. A
  third-party "manual approval" action was also rejected: it holds a runner, using minutes, while it waits.

### Files

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | New: `platform` and `engine` jobs |
| `.github/workflows/engine-deploy.yml` | New: test and preflight on merge; deploy on "Run workflow" from `main` |
| `.claude/hooks/stop-verify.mjs` | `--check` flag for CI |
| `railway.toml`, `nixpacks.toml` | Watch patterns; `npm ci` if Open question 2 is yes |
| `.claude/hooks/session-brief.mjs` | Compare with `origin/develop`; warn on `main` or `develop` |
| `.claude/hooks/guard-bash.mjs` | Deny force-pushing `develop`; ask before pushing straight to it |
| `.claude/skills/ship/SKILL.md` | Sync with and PR into `develop`; a release PR `develop` → `main` when asked |
| `.claude/skills/engine-deploy/SKILL.md` | Normal path is merge, then "Run workflow"; the script is the fallback |
| `.claude/skills/contract-change/SKILL.md` | Engine-first changes ship in two releases |
| `.claude/agents/code-reviewer.md` | Default diff against `develop` |
| `CLAUDE.md`, `docs/PLAYBOOK.md`, `.claude/README.md` | Branch model, CI, how deploys happen |
| `docs/STATUS.md`, `engine/README.md` | Deploy table; close "how work reaches main" and the Railway watch item |

### Data and contract

None. No app env variables. In GitHub: repo secret `ENGINE_SSH_KEY`, repo variable `ENGINE_KNOWN_HOSTS`.

## Risks

| Risk | Applies? | How it is handled |
|---|---|---|
| Answer key reaching the browser | No change | The engine image stays off registries. Making the repo private stops `engine/cases/coffee.json` being public |
| Secrets | Yes | A key with root on the VPS lives in GitHub as a repo secret. Any workflow a collaborator with write access pushes on any branch could read it; accepted for a three-person team. With Pro it can move into an environment limited to `main`. It is separate from the laptop key and revocable in hPanel; the host key is pinned; Actions are pinned to SHAs. Himanshu adds it (only the owner can, on a personal repo); Claude never types it |
| Auth and ownership | No | No routes change |
| Credits and ledger | No | |
| Production data writes | No | CI runs no scripts; engine Mongo tests skip without `ENGINE_TEST_MONGO_URI` |
| Live interviews dropped by a deploy | Yes | Watch patterns stop engine-only Railway restarts. Engine hand-off works by design but is not verified on the server, so a deploy is a deliberate click with the live count shown, and the first CI deploy is at a quiet time and watched. Railway deploys on merge and the engine on the click, so engine-first contract changes ship in two releases |
| Model cost | No | No evals in CI. Actions minutes come from the plan's free allowance |
| Deploys held or skipped | Yes | "Wait for CI" waits on every check suite, including the duplicate projects', and the forums report skipped deploys. Check on the first release; turn it off if it misbehaves |
| Vercel stops deploying | Yes, if Vercel is on Hobby | On Hobby, a private repo deploys only commits by the account owner (Vercel community reports, 2026). Himanshu checks the plan before switching to private |

## Verification

- Locally: `node .claude/hooks/stop-verify.mjs --check` passes on `develop`, and fails on a scratch
  type error above the baseline (reverted).
- The PR that adds this runs both jobs green. Two throwaway PRs, closed unmerged, should each fail
  one job: one with a type error (`platform`), one with a failing test (`engine`).
- Protection (with Pro): a direct push to `main` or `develop` is refused; a PR without green checks
  cannot merge.
- The first release touches `engine/**`, so its merge runs `test` and `preflight` with no deploy. Then
  "Run workflow" deploys. Check that:
  - `preflight` shows the deployed and new versions and the live count;
  - `/healthz` reports the new commit, and `POST /v1/calls` without a token returns 401;
  - Railway waited for CI before deploying.
- The first engine-only change merged to `main` shows Railway skipping the deploy.
- Himanshu confirms the GitHub, Railway and Vercel settings; we cannot see those dashboards.

## Rollout

1. Dhrumil confirms nothing is unpushed on his branch; Himanshu agrees to the admin steps.
2. Rename `dhrumil_the_case_owl` to `develop` on GitHub and delete `paritosh_BE`. Each person, in their clone:
   ```bash
   git fetch origin --prune && git branch -m dhrumil_the_case_owl develop && git branch -u origin/develop develop
   ```
3. Build on a branch off `develop`; PR into `develop`. The new workflows run on that PR.
4. Himanshu checks the Vercel plan, then makes the repo private, and takes GitHub Pro if agreed.
5. The CI key. On a personal repo only the owner can add secrets, so the private half never leaves
   Himanshu's machine:
   - Himanshu makes the key pair, adds the private half as `ENGINE_SSH_KEY`, and adds the server's
     `known_hosts` line for `187.126.115.114` (not the raw `.pub` file) as `ENGINE_KNOWN_HOSTS`;
   - he sends the public half to Paritosh, who adds it in hPanel.
6. Himanshu adds the rulesets on `main` and `develop` once the check names exist, and turns on
   "Wait for CI" on the Railway service that serves `casecoachaiv1-production`.
7. First release, `develop` → `main`, at a quiet time. Click "Run workflow" for the engine and watch it.

**Roll back:** revert the workflows PR; turn "Wait for CI" off; rename the branch back; `deploy.sh`
still works by hand; the engine image rolls back by re-tag, per `/engine-deploy`.

## Open questions

Answered by Paritosh on 31 Oct:

1. **Repo visibility:** first answered "public for now" at approval, then changed the same day to
   **private**.
2. **Include the Railway lockfile fix?** Yes, pending Himanshu's agreement. If he says no, it is
   dropped and recorded in "As built".
3. **Reviews:** one approving review on `main`, none required on `develop`.

Still open:

4. **GitHub Pro on Himanshu's account** (paid): without it, the private repo has no enforced branch
   protection. Himanshu's call.

## As built

Filled by `/close-spec` when the work is done. What exists now, in a few lines.

### Deviations from the design

Recorded on 31 Oct, after `/review-diff` (code-reviewer and security-reviewer), for `/close-spec`.

| What differs | Deliberate or bug | Reason, or the fix |
|---|---|---|
| Engine dependencies: `uv sync --locked` and `uv run --locked pytest`, not `--frozen` | Deliberate | `--frozen` does not check `uv.lock` against `pyproject.toml`, and `uv run` then re-locks quietly, so CI could pass on dependencies the image never installs (reproduced by the code reviewer) |
| The deploy job does more than run `deploy.sh`: it refuses a public repo, it fails if `ENGINE_KNOWN_HOSTS` has no line for `187.126.115.114`, and a last step waits for `/healthz` to report the shipped commit and checks that `/v1/calls` still answers 401. `deploy.sh` itself is unchanged | Deliberate | `deploy.sh` exits 0 even when the new container never comes up; with no pinned line, its `accept-new` trusts any host key; its log tail belongs only in a private repo's log |
| `ENGINE_KNOWN_HOSTS` holds the `known_hosts` line for the server's IP, not "the server's public host key" | Clarification | A raw `.pub` file is not a `known_hosts` line, so ssh would treat the server as new and trust whatever key it presented |
| The key reaches the deploy step as a file path (`ENGINE_SSH_KEY` set to a file under `$RUNNER_TEMP`); the step that writes it calls the secret `DEPLOY_KEY` | Deliberate | `deploy.sh` reads `ENGINE_SSH_KEY` as a path; one name for both the key and its path would put the key in the log if the env ever moved to job level |
| `.claude/hooks/guard-files.mjs` asks before edits under `.github/`; `guard-bash.mjs` also asks on `gh run rerun`, `gh pr merge` and `gh api` writes, and sees through `git -C`/`-c` and `refs/heads/` | Deliberate | Any workflow can read the root deploy key, and these commands reach `main` or production without a `git push`. Without GitHub Pro the guard is the only enforcement |
| `stop-verify.mjs --check` (and the Stop hook) fail when tsc does not run cleanly: timeout, crash, or an error with no file position | Deliberate | A tsconfig error stops tsc checking anything else, and CI would have shown green |
| Baseline matching keeps `[file, code]` pairs | Bug, fixed | Joining them with a space broke on `server 2 - dd/`: new errors there passed CI, and the Stop hook stopped catching them (a regression from the first version of this change) |
| Hotfix branches are named `hotfix/<slug>`; the session brief compares them with `origin/main` | Deliberate | Comparing a hotfix with `develop` told people to merge unreleased work into a production fix |
| `README.md` and `.claude/hooks/guard-files.mjs` changed, though not in the Files table; CI takes the Node version from `.nvmrc` (20) | Deliberate | The README's Contributing and Deployment sections would have been wrong; `.nvmrc` keeps one source for the version |

### Verified

### Not verified
