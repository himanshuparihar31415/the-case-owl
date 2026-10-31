---
name: engine-evals
description: Run the interviewer's behaviour evals (engine/tools/evals.py) against the real models over repeated runs, then report pass rates per scenario and compare with the previous run. Use after any change to engine prompts, tools, the fact gate, the guard, turn rules or case data, before calling a behaviour fixed. Costs money, so it asks first.
argument-hint: "[runs=5] [only=scenario1,scenario2] [model=...]"
---

# Behaviour evals

Arguments: $ARGUMENTS (defaults: 5 runs, every scenario, the configured models).

## 1. Ask first

Evals call OpenAI's Realtime API. The tool's docstring estimates about $0.02 a run; a full sweep is
16 scenarios × the number of runs. Tell the user the scenarios, the runs and that estimate, and wait for
a yes. Never run evals in a loop or re-run "to see if it passes this time" without asking again.

## 2. Run

From `engine/`, in the background (a full sweep takes minutes):

```bash
uv run python tools/evals.py --runs 5
```

Add `--only a,b` for named scenarios, `--model …` / `--fact-model …` to compare models. Keep
`--parallel` at its default (3); 8 at once hit rate limits before.

## 3. Report

- Read the newest `engine/results/evals-*.json`, and the one before it for comparison.
- A table: scenario, passes / runs, and for every failure the failing check and the line she said.
- A scenario passes only if every run passed. Say plainly if anything regressed against the previous run.
- What evals cannot show: VAD, turn timing, coughs, echo, felt latency. List what needs a voice test.

## 4. If something failed

Hand the failure to the `interview-analyst` agent with the results file and the scenario names, or run
`/debug-interview`. Do not patch the prompt with a phrase ban to make one scenario pass.
