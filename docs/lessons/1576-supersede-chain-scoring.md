---
Category: Stale-entry grading only looked at the direct successor of the stale entry; when a memory was corrected twice in a row (the successor itself superseded), the correct final state was graded 0; a supersede cycle had no termination condition
Source: #1576 (2026-10-25)
Level: 2
Safeguard: `integration/test/memory-regression-grade.test.ts` has the "corrected twice in a row" and "supersede cycle" fixture cases; the grader follows `supersededBy` to the newest valid entry on the chain and grades 0 on a cycle
Intercepts: 1
Recurrences: 0
Notes: Negative control: the "corrected twice" case goes red under the one-hop implementation, all 137 green after walking the chain
---

