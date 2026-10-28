---
Category: Serial open-PR file reads exceeded the chief relay budget on the real repository
Source: PR #1848 and issue #1834 (2026-10-28)
Level: 1
Safeguard: A three-worker file-read pool preserves input order, waits for outstanding reads and stops queued work after failure; deterministic controls enforce its concurrency bound and failure behavior
Intercepts: 0
Recurrences: 0
Notes: The serial HTTP observation aborts after 18 requests at 8,362 ms. The pre-repair scheduling control observes only one concurrent read and fails. The repaired real HTTP run completes all 25 requests in 6,473 ms. Network and repository state can change, so this is an observed success, not a latency guarantee.
---
