---
name: spec
description: Write a decision-ready spec for a change before building it - problem, design, files, data and contract changes, risks (answer key, money, production, live interviews), verification and rollout - save it under docs/specs/, and get the user's go-ahead. Use for anything touching more than a couple of files, a data model, the engine contract, prompts, billing or production.
argument-hint: "[what you want to build or change]"
---

# Spec before building

The change: $ARGUMENTS

Existing specs:

!`ls docs/specs/ 2>/dev/null`

## 1. Find out before writing

- Read the code the change touches and one level around it (callers, consumers, the model, the route).
- Read the doc that owns the area (the "Where the truth lives" table in CLAUDE.md) and `docs/STATUS.md`.
- Check whether an existing spec already covers this; if so, work from it instead of starting another.
- If a product question decides the design (pricing, what the candidate sees, what the interviewer
  says), ask it now in one short question rather than guessing.

## 2. Decide where it goes

- **A file**, `docs/specs/NNNN-short-slug.md` (next free number, four digits), when the change touches
  a data model, the engine contract, an API or socket message, money, prompts or interviewer behaviour,
  auth, a deploy setup, or spans more than a couple of files. Start from
  [template.md](template.md), fill every section (write "none" where a risk does not apply), set
  `status: draft`, `owner`, `created`, and add a row to the index in `docs/specs/README.md`.
- **The conversation only**, for anything smaller: the same headings, one screen.

Keep it short. A spec is read in two minutes or it is not read.

## 3. Stop and ask

Show the spec (or its path and a summary) and ask one question: go ahead as written, or change
something. Do not start building until the user says yes. On a yes, set `status: approved`; from then
on "Proposed design" is frozen, and differences go in "As built" via `/close-spec`.
