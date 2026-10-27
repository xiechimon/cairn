---
Category: When renaming or rewriting e2e helper functions, new explanatory comments were written along the way; the comment-discipline check reported 14 lines
Source: #1471 (2026-10-24)
Level: 2
Safeguard: `scripts/comment-discipline-gate.mjs` is always run at wrap-up; the real mistake as negative control: the 14 new comment lines in helpers.ts, hotkeys.spec.ts, and five search specs were reported red, 0 after deletion
Intercepts: 1
Recurrences: 0
Notes: Already covered, no additional protection needed; the check is still advisory in CI
---

