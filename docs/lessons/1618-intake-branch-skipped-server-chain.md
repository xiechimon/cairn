---
Category: A new intake branch was verified only against the shared text, missing the server-side chain from real labels to orchestration messages
Source: #1618 (2026-10-24)
Level: 2
Safeguard: `apps/server/test/orchestration-source.test.ts` pins the bug label, the source fields and the orchestration request, and must pass after the implementation
Intercepts: 1
Recurrences: 0
Notes: negative control: the first integration test never entered the target branch without the source field in the fixture; green after filling the fixture
---
