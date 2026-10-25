---
Category: New explanatory comments were written while renaming or rewriting e2e helper functions; the comment-discipline check reported 14 lines
Source: #1471 (2026-10-24)
Level: 2
Safeguard: `scripts/comment-discipline-gate.mjs` runs at every wrap-up; real mistake as negative control: 14 new comment lines across helpers.ts, hotkeys.spec.ts and five search specs reported red, 0 lines after removal
Intercepts: 1
Recurrences: 0
Notes: the check covers it, no further safeguard needed; the check is still advisory in CI
---
