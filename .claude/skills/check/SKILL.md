---
name: check
description: Run the local verification gates for whatever changed (type check against the known-errors baseline, build, engine tests, contract schemas) and report pass/fail with exact failures. Use before saying work is done, before /review-diff and before /ship.
argument-hint: "[optional: files or area to check]"
context: fork
agent: verifier
---

Run the checks that apply to the current changes in this repo and report them.

Scope: $ARGUMENTS (if empty, everything uncommitted).

Current state:

!`git status --short --branch`

!`git diff HEAD --stat`

Follow your instructions for deciding which checks apply. Report the table, the exact failures, which
failures are new versus already in `.claude/hooks/tsc-baseline.json`, and what these checks cannot show
for this change (browser look, evals, voice).
