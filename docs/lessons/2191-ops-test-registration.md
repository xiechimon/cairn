---
Category: New ops regression tests were absent from both local and CI execution plans
Source: Ticket #2191 review round 1 (2026-10-30)
Level: 2
Safeguard: Worker test asserts both ops test files are in prepush selfTests and the ops-backup-test CI job
Intercepts: 0
Recurrences: 0
Notes: The original selfTests omission fails the red assertion. Local execution of the backup CI test line is limited by missing GNU rsync. Extending selfTests also exposed two old fixture assumptions: all files shared one directory and no other CI job could name them. The fixture now creates parent directories and the exclusivity assertion is scoped to check-core. The exact self-test command supplied both negative controls before these fixes.
---
