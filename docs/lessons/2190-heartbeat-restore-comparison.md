---
Category: Fresh restore comparison rejected periodic heartbeat metadata as content corruption
Source: #2190 (2026-10-30)
Level: 2
Safeguard: Snapshot-boundary fresh-mode heartbeat regression, per-column strict negative controls and report allowlist assertions; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: Host feedback exposed lastSeenAt and capabilities changing between fresh backup and live snapshot. The new tests failed against 60ab20d8 before the comparator change. Only named heartbeat columns are exempt; all other machine fields and autonomy verdict/start/baseline fields stay strict. These are synthetic SQLite regressions, not host acceptance.
---
