---
Category: A lane appended a scheduler run slot in `index.ts` and reported pre-commit green, but never updated the positional wiring tests that pin the tail of the `createScheduler` call, so CI went red on two of them
Source: PR #1887 (2026-10-26)
Level: 2
Safeguard: The wiring tests in `issue-intake.test.ts` and `trajectory-outcome-backfill.test.ts` (plus the new one in `trajectory-export.test.ts`) assert the tail slots from the end; any appended slot shifts the indices and CI goes red until they are updated
Intercepts: 1
Recurrences: 0
Notes: Negative control: the updated assertions red against `origin/main`'s `index.ts` (no export slot) and green against the branch wiring; when appending a slot, run the two wiring tests in the same commit
---
