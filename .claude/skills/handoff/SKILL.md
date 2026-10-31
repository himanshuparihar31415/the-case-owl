---
name: handoff
description: Close out a stretch of work so a teammate or a later session starts from the truth - update docs/STATUS.md, the Verified / Not verified lists and specs the work touched, record dated decisions, and write a short handoff note. Use at the end of a work session, before switching tasks, or when the user says they are stopping.
---

# Hand off

Sessions share no memory: what is not in the repo is lost. This makes the repo true.

!`git status --short --branch`

!`git log --oneline -8`

## 1. Make the docs true

- **`docs/STATUS.md`**: update "Now" (keep it to the five or so things a new session must know),
  "Fixed recently", "Decisions to make" and "Next". Remove what is no longer true. Set "Last updated".
- **Specs**: if the work finished a spec, run `/close-spec`; if it is mid-way, set `status: building`.
- **Owning docs** (the "Where the truth lives" table in CLAUDE.md): move items between "Verified" and
  "Not verified" only on evidence from this work, with the date and what the evidence was.
- Record decisions made with the user, dated, with the reason, where that doc keeps decisions.
- Show the user the doc diffs.

## 2. Write the handoff note

In the conversation, under these headings, a few lines each:

- **Done**: what changed, with commits or "uncommitted".
- **Verified**: what was run and its result.
- **Not verified**: what still needs a test, a voice check, or a production check.
- **Decisions**: made today, and any the user still has to make.
- **Next**: the next concrete step, and who it is for if it belongs to a teammate's area.

## 3. Loose ends

- Uncommitted work: say so and ask whether to `/ship` it.
- Background processes started in this session (dev servers, the engine, the stub): list them and
  offer to stop them.
- If the same correction came up twice this session, propose a line for the right rule file in
  `.claude/rules/` so the next session does not need it again.
