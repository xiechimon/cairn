---
Category: Building the "previous round" by reading all history for a buildId mixed rounds 1 and 2 into round 3 once the same build was reused for rework several times
Source: #1615 re-review (2026-10-24)
Level: 2
Safeguard: `apps/server/test/retry-lessons.test.ts` "reuse mixes in old rounds" seeds two reuses and asserts the third contains only the previous round; the implementation bounds by the time of the last restart feedback
Intercepts: 1
Recurrences: 0
Notes: Negative control: without the time bound the case is red (blocking-round1 appears), with it green
---

