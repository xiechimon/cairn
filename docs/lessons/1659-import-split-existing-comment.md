---
Category: To move `DONE_ROW` out of `builds.ts`, a new import was inserted between an existing comment and the import it annotated; the comment was split and the original comment counted as added comment lines
Source: #1659 (2026-10-25)
Level: 2
Safeguard: `node scripts/comment-discipline-gate.mjs` runs at every wrap-up and reported `builds.ts:89` as an added comment; back to 0 once the comment moved with its import
Intercepts: 1
Recurrences: 0
Notes: real negative control: the gate reported 1 line after the change, 0 after restoring; look at neighbouring comments before inserting when moving constants
---
