---
name: review-diff
description: Review the current changes with the project's reviewers in parallel - code-reviewer always, security-reviewer when routes, models, sockets, billing, uploads or config changed, contract-keeper when the engine contract changed - then verify and merge their findings. Use before shipping anything non-trivial.
argument-hint: "[optional: branch, commit range or files; default is uncommitted changes]"
---

# Review the diff

Target: $ARGUMENTS (default: uncommitted changes, `git diff HEAD` plus untracked files).

!`git status --short`

!`git diff HEAD --stat`

## 1. Pick the reviewers

Always `code-reviewer`. Add:

- `security-reviewer` if anything changed in `server/` routes, controllers or services, `server/models/`,
  `server/middleware/`, `server.ts`, `server/modules/voice/`, `server/modules/billing/`, `engine/app/`
  (api, ui, auth, config), `vite.config.ts`, `.env.example`, or any upload handling.
- `contract-keeper` if anything changed in `engine/app/contract.py`, `engine/contract/`,
  `docs/engine-contract.md`, `server/modules/engine/` or `src/hooks/useEngineInterview.ts`.

## 2. Run them in parallel

Launch the chosen agents in one message, each with the same target. Give each the target only; do not
give them your opinion of the change, so their read is independent.

## 3. Verify and merge

- Drop duplicates (same file, same root cause).
- For each remaining finding, read the code yourself and confirm it. Mark anything you could not
  confirm as "plausible" rather than dropping it silently.
- Order by severity: answer-key or secret exposure, money, data loss, auth, correctness, missing tests.

## 4. Report

A short list: `path:line`, the defect, the scenario, the fix, confirmed/plausible. Then one line per
reviewer on what it checked. Ask whether to fix the findings now; do not fix them unasked.
