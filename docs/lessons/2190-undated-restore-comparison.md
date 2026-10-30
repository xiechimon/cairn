---
Category: Restore comparison accepted undated content corruption and rejected normal writes against old backups
Source: #2190 (2026-10-30)
Level: 2
Safeguard: Fresh backup comparison and separate hourly recovery mode with strict undated content and API key isolation regression tests; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: Review round 1 negative controls reject corrupted todo and project content with no later dating signal. Fresh mode narrows the concurrent-write window; hourly mode avoids live comparisons. Concurrent capture is not atomic and remains a documented limit.
---

Merged related control history:

Host feedback exposed lastSeenAt and capabilities changing between fresh backup and live snapshot. The new tests failed against 60ab20d8 before the comparator change. Only named heartbeat columns are exempt; all other machine fields and autonomy verdict/start/baseline fields stay strict. These are synthetic SQLite regressions, not host acceptance.
