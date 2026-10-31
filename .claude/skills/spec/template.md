---
id: NNNN
title: <short title>
status: draft
owner: <person>
created: <date>
---

# NNNN: <short title>

Status moves draft → approved → building → done, or dropped (say why). Once approved, "Proposed
design" is frozen: later changes go in "As built", with their reasons.

## Problem

What is wrong or missing, for whom, and how we know. One short paragraph.

**Not in scope:** what this will not do.

## Proposed design

The approach in a few bullets. The alternative we rejected, and why.

### Files

| File | Change |
|---|---|

### Data and contract

New or changed model fields, API shapes, socket messages, env variables. For the engine contract:
additive (fine within `/v1`) or breaking (needs `/v2`).

## Risks

| Risk | Applies? | How it is handled |
|---|---|---|
| Answer key reaching the browser | | |
| Secrets | | |
| Auth and ownership | | |
| Credits and ledger | | |
| Production data writes | | |
| Live interviews dropped by a deploy | | |
| Model cost | | |

## Verification

The exact commands and checks that will prove it (tests, type check, evals with the number of runs,
screens to look at), and what will still need a human (voice, real device).

## Rollout

Deploy order (engine, Railway, Vercel), switches or pilot flags, env variables to set and where, how to
roll back.

## Open questions

Only the ones the user must answer.

## As built

Filled by `/close-spec` when the work is done. What exists now, in a few lines.

### Deviations from the design

| What differs | Deliberate or bug | Reason, or the fix |
|---|---|---|

### Verified

### Not verified
