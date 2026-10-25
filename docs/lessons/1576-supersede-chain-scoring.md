---
Category: Staleness grading only looked at the direct successor of a stale entry: when a memory was corrected twice in a row (the successor itself superseded), the correct final state was graded 0, and a supersede cycle had no termination condition
Source: #1576 (2026-10-25)
Level: 2
Safeguard: the "corrected twice in a row" and "supersede cycle" fixture cases in `integration/test/memory-regression-grade.test.ts`; the grader walks `supersededBy` to the newest valid entry on the chain and grades 0 on a cycle
Intercepts: 1
Recurrences: 0
Notes: negative control: the one-hop implementation went red on "corrected twice in a row"; all 137 green after walking the chain
---
