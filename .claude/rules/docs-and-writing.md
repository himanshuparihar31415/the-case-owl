---
paths:
  - "docs/**"
  - "**/README.md"
  - "CLAUDE.md"
  - ".claude/**/*.md"
---

# Writing docs here

Docs in this repo are read by teammates and by Claude in later sessions. They must say what is true now.

- Plain, specific English. Short sentences. Explain a term the first time it appears.
- Date every decision and measurement ("decided 24 Oct", "results on 23 Oct"), and give the reason.
- Keep an honest **Verified / Not verified** list where a doc describes something that runs. Move items
  between them only on evidence, and say what the evidence was.
- Numbers come from a run, with the command that produced them. No estimates presented as results.
- Tables for layouts, commands and settings; prose for reasons.
- Update the doc in the same change as the code it describes. A stale doc is worse than none.
- Update the doc that owns the topic (CLAUDE.md, "Where the truth lives"). Never add one-off report
  files (`*_SUMMARY.md`, `IMPLEMENTATION_*.md`, `NOTES.md`): they go stale at once and compete with the
  real doc. Status goes in `docs/STATUS.md`, designs in `docs/specs/`.
- In a spec, never rewrite the frozen "Proposed design"; what changed goes in "As built", with reasons.
- No secrets, tokens, real user emails or transcripts of real users in docs.
- Links are relative paths so they work on GitHub and in the editor.
