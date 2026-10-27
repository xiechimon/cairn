---
Category: Editing only the count numbers in existing comments still made the comment-discipline gate report those lines as new comments
Source: #1574 (2026-10-24)
Level: 2
Safeguard: `scripts/comment-discipline-allowlist.json` registers by full line, with the reason stating it only corrects the number; the gate itself (`scripts/comment-discipline-gate.mjs`) is already a machine check
Intercepts: 1
Recurrences: 0
Notes: Real negative control: after fixing the counts in the chief-tools.ts header and count comments the gate reported 3 lines, 0 after registering; the gate judges by line and cannot distinguish a number-only edit from a new comment — expect this before touching comment lines
---
