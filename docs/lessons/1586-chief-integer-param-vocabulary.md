---
Category: The chief tool schema gained an integer parameter, but the daemon's conversion vocabulary only supports number
Source: #1586 (2026-10-24)
Level: 2
Safeguard: `claude-t4-tools.test.ts` converts every tool list exported from `@cairn/shared`, and the converter accepts `integer`; the server keeps safe-integer validation
Intercepts: 1
Recurrences: 1
Notes: Real negative control: offset type=integer throws not in vocabulary; green after keeping the number vocabulary and validating on the execution side, no provider declaration change needed
---
Recurrence 2026-11-19: `computer_act`, `desktop_act` and `user_computer_shell` declared `integer` in lists the test did not name, so a Coordinator on Claude Code failed to start; the test now enumerates the exports instead of naming lists.
