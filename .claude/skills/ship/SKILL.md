---
name: ship
description: Commit the current work on a branch with a Conventional Commit message, bring it up to date with develop, push it, and open a pull request into develop with summary, verification and rollout notes; or open the release pull request from develop to main. Only when the user asks to ship, commit, open a PR or release.
argument-hint: "[optional: what this change is, in a few words]"
disable-model-invocation: true
---

# Ship

What is being shipped: $ARGUMENTS

!`git status --short --branch`

!`git log --oneline -5`

## 1. Preconditions (stop and say so if one fails)

- Not on `main` or `develop`: both change only through pull requests. If on one, propose a branch name
  (`<scope>/<short-slug>`, e.g. `engine/reoffer-timeout`) off `develop` and ask before creating it.
  A hotfix for production is the exception: it branches off `main` and is named `hotfix/<short-slug>`
  (the session brief then compares it with `main`).
- Up to date with its base, `develop` (`main` for a hotfix; never merge `develop` into a hotfix, it
  would carry unreleased work to production): `git fetch origin`, then if the base has
  commits this branch lacks, say so and ask before merging it in (in an app-made worktree, use the
  app's sync-with-base tool). Resolve conflicts with the user, never by discarding their side.
- Run `/check`. New type errors or failing tests stop the ship unless the user says otherwise.
- If the change is non-trivial and `/review-diff` has not run on it in this conversation, run it first
  and show the findings.
- If a spec in `docs/specs/` covers this work and it is finished, `/close-spec` it first.
- Nothing staged that should not be: no `.env*` (except `.env.example`), no `engine/results/`, no logs,
  no `dist/`, no stray scratch files. Stage files by name, not `git add -A`.

## 2. The commit

- Conventional Commit with a scope from the history: `feat(engine): …`, `fix(ui): …`, `chore(dev): …`,
  `docs(engine): …`. Scopes in use: `engine`, `ui`, `resume`, `voice`, `coaching`, `dashboard`, `report`,
  `score`, `casemap`, `billing`, `deploy`, `dev`, `docs`.
- Subject: plain English, what changed for whom, under ~72 characters. Body: why, anything a reviewer
  must know (env variables to set, deploy order), and `Spec: docs/specs/NNNN-….md` when there is one.
- Show the user the files and the message, and wait for a yes before committing.
- End the message with the attribution lines this session's instructions specify, if any.

## 3. Push, and the pull request

The branch model (spec 0001): work branches go into `develop` by pull request; a release is a pull
request from `develop` to `main`; a hotfix goes into `main`, then `main` is merged into `develop`.
CI (`.github/workflows/ci.yml`) must pass on each. Claude never pushes to `develop` or `main`.

- `git push -u origin <branch>` (the push asks for confirmation).
- `gh pr create --base develop` (`--base main` for a hotfix), body below.
- **A release**, only when the user asks for one: `gh pr create --base main --head develop`, listing
  the changes since the last release (`git log --oneline origin/main..origin/develop`) and the rollout.
  A person merges it with a merge commit, never squash, after one approving review.
- **After a hotfix is merged**, open a pull request from `main` into `develop` so the fix is not lost
  at the next release.

PR body:

```
## What
## Why
## How it was verified
(commands run and their results; screens looked at; eval pass rates)
## Not verified
## Rollout
(deploy order: engine / Railway / Vercel; env variables to set; how to roll back)
```

- Give the user the link. Do not merge, and do not enable auto-merge.

## Remember

`main` is production. Vercel builds every push to it whatever CI says; Railway builds it too, waiting
for CI once its "Wait for CI" setting is on. A Railway deploy drops the older pipeline's live voice
sockets; its watch patterns should skip engine-only and docs-only changes (not verified until the first
such release). Until the rulesets are on, nothing stops a merge with red CI: check it first. The
engine does not deploy on merge: someone clicks Actions → Engine deploy → Run workflow
(`/engine-deploy`). Say which of these a release sets off.
