---
Category: A 122 ms single-file unit test was wrapped in the shared `/tmp/cairn-heavy.lock` and queued behind another lane until the tool call timed out with no output
Source: lane/1801 (2026-10-26)
Level: 3
Safeguard: Lane rule: the heavy lock is for full suites, e2e and builds; single-file unit runs go direct, and `flock -n /tmp/cairn-heavy.lock -c true` shows held/free before queueing
Intercepts: 0
Recurrences: 0
Notes: The lock lives on the host, not in the repo, so no in-repo gate can enforce it
---

