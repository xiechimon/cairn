---
Category: The chief tool schema grew an integer parameter, but the daemon conversion vocabulary only supported number
Source: #1586 (2026-10-24)
Level: 2
Safeguard: the existing `claude-t4-tools.test.ts` converts all CHIEF_REMOTE_TOOLS end to end; the server keeps the safe-integer validation
Intercepts: 1
Recurrences: 0
Notes: real negative control: offset with type=integer threw "not in vocabulary"; reusing the number vocabulary with execution-side validation turned green, no provider declaration change needed
---
