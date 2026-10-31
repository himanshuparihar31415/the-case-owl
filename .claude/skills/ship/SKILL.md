---
name: ship
description: Commit the current work on a branch with a Conventional Commit message, bring it up to date with main, push it, and (if the team wants one for this change) open a pull request into main with summary, verification and rollout notes. Only when the user asks to ship, commit or open a PR.
argument-hint: "[optional: what this change is, in a few words]"
disable-model-invocation: true
---

# Ship

What is being shipped: $ARGUMENTS

!`git status --short --branch`

!`git log --oneline -5`

## 1. Preconditions (stop and say so if one fails)

- Not on `main`. If on `main`, propose a branch name (`<scope>/<short-slug>`, e.g. `engine/reoffer-timeout`)
  and ask before creating it.
- Up to date with `main`: `git fetch origin`, then if `origin/main` has commits this branch lacks, say
  so and ask before merging it in (in an app-made worktree, use the app's sync-with-base tool). Resolve
  conflicts with the user, never by discarding their side.
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

## 3. Push, and how it reaches main

- `git push -u origin <branch>` (the push asks for confirmation).
- Ask how this change should reach `main` (production): a pull request for review, or the person
  moves it themselves. Claude never pushes to `main`.
- For a PR, `gh pr create --base main`, body:

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

`main` is production: Railway and Vercel build it, and a Railway deploy drops live voice sockets
(including on engine-only changes, until Railway has watch patterns). Say so when it applies.
