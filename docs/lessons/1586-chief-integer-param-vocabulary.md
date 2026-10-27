---
Category: The chief tool schema gained an integer parameter, but the daemon's conversion vocabulary only supports number
Source: #1586 (2026-10-24)
Level: 2
Safeguard: The existing `claude-t4-tools.test.ts` converts all of CHIEF_REMOTE_TOOLS; the server keeps safe-integer validation
Intercepts: 1
Recurrences: 0
Notes: Real negative control: offset type=integer throws not in vocabulary; green after keeping the number vocabulary and validating on the execution side, no provider declaration change needed
---

