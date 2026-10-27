---
Category: To move `DONE_ROW` out of `builds.ts`, the new import was inserted between an existing comment and the import it annotates; the comment was split, and the original comment counted as new comment lines
Source: #1659 (2026-10-25)
Level: 2
Safeguard: `node scripts/comment-discipline-gate.mjs` is always run at wrap-up; it reported `builds.ts:89` as a new comment; back to 0 once the comment was moved back with its import
Intercepts: 1
Recurrences: 0
Notes: Real negative control: the gate reported 1 line after the change, 0 after restoring; look at neighboring comments before inserting when moving constants
---

