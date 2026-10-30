---
Category: Deployment fixture mutations and clock stubs did not model the runtime assertion
Source: Ticket 1408 review round 2 (2026-10-30)
Level: 2
Safeguard: Stop-time writes have distinct row identities and the advanced clock retains monotonic and sleep APIs; regressions execute real restart and digest paths
Intercepts: 0
Recurrences: 0
Notes: fixture-distinct-rows-red.log catches duplicate rows hidden by SQLite EXCEPT and fixture-clock-red.log catches missing monotonic; corrected baseline controls fail at the intended deadline assertion and the full suite passes
---
