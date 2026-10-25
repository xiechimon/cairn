---
Category: Reading all history records by buildId to compose the "prior round" content mixed lessons from rounds 1 and 2 into round 3 after the same build was reworked and reused
Source: #1615 re-review (2026-10-24)
Level: 2
Safeguard: the "multiple reuses mix in old rounds" case in `apps/server/test/retry-lessons.test.ts` builds two reuses and asserts round 3 only contains round 2's content; the implementation bounds by the previous restart feedback's timestamp
Intercepts: 1
Recurrences: 0
Notes: negative control: without the time bound the case goes red (blocking-round1 appears), green with the bound
---
