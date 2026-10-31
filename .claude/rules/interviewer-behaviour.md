---
paths:
  - "engine/app/runtime/**"
  - "engine/cases/**"
  - "engine/tools/evals.py"
  - "engine/spike/**"
  - "server/ai/**"
  - "server/modules/voice/**"
---

# How the AI interviewer behaves, and how we change it

## Who she is

She is a real case interviewer who runs the interview, not a coach or a peer.

- Brief professional small talk, then she moves to the case herself. She does not keep asking permission.
- She never asks about the candidate's preparation or what they want to practise. No teaching, coaching
  or feedback during the interview; that is the report's job.
- Running the interview is hers: presenting the case, giving facts that were asked for, probing,
  resuming her own presentation after an interruption, steering a rambling candidate back.
- Solving the case is the candidate's: she never proposes an approach, framework, hypothesis or answer,
  and never answers her own question.

Phrase prompt rules as "running the interview vs solving the case". Blanket bans ("never carry on")
break legitimate behaviour like resuming.

## Judgment over rules

Let the model judge conversation flow (when small talk is over, what counts as asking for time, how to
handle off-topic talk) and act through tools; the engine executes the result. Hard engine rules exist
only for: the answer key and unasked facts, turns nobody heard, timing (the model has no clock), the hint
budget, the time limit, and security. Do not add turn counters or regexes for things judgment should
decide; keep phrase rules only as a backup net.

## Changing behaviour: root cause, structure, measure

1. Find the mechanism in the logs first (the session's event log, `engine/results/`). Form a hypothesis
   you can check.
2. Prefer a structural fix (what the engine allows, which tools exist when, what the history contains)
   over a new prompt rule. If the prompt must change, write a concept, not a banned phrase.
3. Measure over repeated runs: `uv run python tools/evals.py --runs 5` (add a scenario if none covers
   the bug). A fix is done when every run of every scenario passes, not when one try looks right.
   Evals cost money: say roughly how much and ask before running.
4. Report the pass rates, and list what still needs a human voice test (turn timing, VAD, coughs, echo,
   felt latency). Unit tests do not prove behaviour.

The `/debug-interview` skill and the `interview-analyst` agent follow this loop.

## The platform's own pipelines

`server/ai/prompts.ts` and `server/modules/voice/` run the older STT → LLM → TTS interviews for
every non-pilot user. The same persona applies. A prompt change there affects every live user at the
next Railway deploy; check it with a real session or `scripts/test_eval.ts`, and say what was not tested.
