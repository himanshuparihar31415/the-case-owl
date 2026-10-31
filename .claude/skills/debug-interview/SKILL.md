---
name: debug-interview
description: Fix an AI interviewer behaviour problem the project's way - evidence from logs, root cause, a structural fix, then proof over repeated eval runs. Use when someone reports the interviewer did something wrong in an interview (talked over them, repeated herself, leaked a fact, coached, stalled, answered late, ignored a request).
argument-hint: "[what she did, and the session or call id if known]"
---

# Debug the interviewer

The report: $ARGUMENTS

The rules for this are in `.claude/rules/interviewer-behaviour.md`; follow them.

## 1. Evidence

- Pilot interviews run on the engine: look in `engine/results/settled/` (local runs) for the call, or
  ask the user for the production logs (reading them needs SSH, so their OK:
  `docker compose --env-file settings.env logs engine` on the server, filtered to the call id).
- Platform (non-pilot) interviews run on `server/modules/voice/`: ask for the session id and the Railway
  logs around it.
- If there is no log, say what is needed to reproduce it (the candidate's lines, the stage, the case)
  rather than guessing from the description.

## 2. Root cause

Launch the `interview-analyst` agent with the report and the evidence paths. Check its mechanism against
the code yourself. A fix without a named mechanism is a guess.

## 3. Propose before changing

Tell the user the mechanism and the proposed fix (structural first: what the engine allows, what the
history holds; prompt change last and as a concept) and the eval scenario that will prove it. Wait for a yes.

## 4. Fix and prove

- Make the change. Add a unit test if the mechanism is in `turns.py`, `facts.py` or `guard.py`.
- Add the eval scenario to `engine/tools/evals.py` if none covers it.
- `cd engine && uv run pytest -q`, then `/engine-evals` (asks about cost) on the affected scenarios and
  then all of them, since a prompt change can break another scenario.
- Done only when every run of every scenario passes.

## 5. Report

Mechanism, the change, pass rates before and after, and what still needs a human voice test.
