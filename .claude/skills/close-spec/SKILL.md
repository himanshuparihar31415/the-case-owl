---
name: close-spec
description: Close out a spec in docs/specs/ - compare its frozen Proposed design with what the code now does, draft the As built section listing every deviation, have the user classify each one (deliberate, with its reason, or a bug to fix), and mark the spec done. Use when the work a spec describes is finished, before /ship or /handoff.
argument-hint: "[spec number or path]"
---

# Close a spec

Spec: $ARGUMENTS (if empty, the spec with `status: building` or `approved`; ask if there are several).

!`ls docs/specs/ 2>/dev/null`

## 1. Gather what was built

- Read the spec in full. Never edit its "Proposed design".
- Commits that name it: `git log --oneline --grep "docs/specs/NNNN"`, plus anything uncommitted
  (`git diff HEAD --stat`).
- Read every file in its "Files" table and any other file those commits touched.

## 2. Compare, item by item

For each design bullet, file, data or contract change, risk mitigation, verification step and rollout
step: is it in the code as designed, done differently, partly done, or missing? Note anything built
that the spec never mentioned.

## 3. Draft "As built"

- A few lines on what exists now.
- **Deviations** table: what differs, then leave "Deliberate or bug" for the user.
- **Verified**: only what was actually run, with the command and the result, or what was seen.
- **Not verified**: everything else that matters (voice tests, production checks, real devices).

## 4. The user classifies each deviation

Ask about all of them in one message. For each:

- **Deliberate**: record the reason in the table.
- **Bug**: do not record it as a design change. Fix the code (back to building), then come back here.

Never present a bug as a deliberate choice to make the record tidy.

## 5. Finish

- Set `status: done` (or `building` if bugs went back for fixing), and update the row in
  `docs/specs/README.md`.
- If what is live or open changed, update `docs/STATUS.md`.
- If the work changed something an owning doc describes (the contract, the engine README, a feature
  README), check that doc is now true too.
