# Specs

One file per change that needs a design: `NNNN-short-slug.md`, numbered in order. Written with
`/spec`, closed with `/close-spec`. Template: [.claude/skills/spec/template.md](../../.claude/skills/spec/template.md).

**Needs a spec:** a change to a data model, the engine contract, an API or socket message, money,
prompts or the interviewer's behaviour, auth, a deploy setup, or anything spanning more than a couple
of files. Plain bug fixes and copy changes need none.

**Lifecycle:** `draft` → `approved` (the "Proposed design" is frozen from here) → `building` → `done`,
or `dropped` with the reason. At close, "As built" records what exists and every difference from the
design, each marked deliberate (with the reason) or fixed as a bug.

The engine's design predates this folder and lives in
[interview-engine-architecture.md](../interview-engine-architecture.md) and
[engine-contract.md](../engine-contract.md); new engine work gets a spec here.

## Index

| # | Title | Status | Owner |
|---|---|---|---|
