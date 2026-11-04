---
Category: dispatch-agent wait treated a missing child exitCode as rc 0 after start returned
Source: PR 2086 (2026-10-28)
Level: 2
Safeguard: start detaches a record-exit supervisor that writes exitCode into the status file; wait fails when exitCode is absent; dispatch-agent.test.mjs covers a late non-zero exit after start returns
Intercepts: 0
Recurrences: 0
Notes: negative control is wait fails when the child exits non-zero after start returns; the start process exit listener alone cannot survive start's return
---
