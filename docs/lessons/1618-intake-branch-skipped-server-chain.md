---
Category: The new intake branch verified only the shared text first, missing the server-side chain from real labels to orchestration messages
Source: #1618 (2026-10-24)
Level: 2
Safeguard: `apps/server/test/orchestration-source.test.ts` pins the bug label, the source fields, and the orchestration request; the related tests must pass after implementation
Intercepts: 1
Recurrences: 0
Notes: Negative control: the first integration test without the source fields never entered the target branch; green after adding the source fixtures
---

