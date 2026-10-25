---
Category: Editing only the count digits inside an existing comment still made the comment-discipline gate count those lines as added comments and go red
Source: #1574 (2026-10-24)
Level: 2
Safeguard: `scripts/comment-discipline-allowlist.json` registers the exact full lines with a reason stating digit-only correction; the gate itself (`scripts/comment-discipline-gate.mjs`) is already a machine check
Intercepts: 1
Recurrences: 0
Notes: real negative control: after editing the chief-tools.ts header and count comments the gate reported 3 lines, 0 after registering; the gate judges added lines and cannot distinguish a digit-only edit from a newly written comment, so expect this before touching comment lines
---
