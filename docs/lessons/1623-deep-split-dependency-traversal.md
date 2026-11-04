---
Category: Recursive split dependency traversal exhausted the call stack before a rejection verdict
Source: Issue #1623 production-shape 12000-node probe and five negative controls (2026-10-28)
Level: 1
Safeguard: Checker and persistence validation share an iterative dependency traversal; below-limit 12000-node chain and cycle regressions pin cap verdicts, human errors and auto/shadow confirm drafts without child references
Intercepts: 0
Recurrences: 0
Notes: A 12000-node dependency graph fits below the 1 MiB request boundary but the recursive checker failed before returning the six-child cap verdict. The independent human validator also overflowed on a long cycle. All five negative controls failed with RangeError before repair and pass using an explicit traversal stack without changing input limits, dependency edges or policy defaults. The delivery single-use gate also caught a locally bound test closure used only by a returned property; that closure is now inline without an allowlist.
---
