---
Category: Long tests (`vitest run --changed` measured at 1598s) did not tee their logs; when they went red there was no way to see which files failed without rerunning the whole round
Source: pi thread #1574 (2026-10-24)
Level: 3
Safeguard: Global AGENTS.md testing rule 4: long tests log with `... 2>&1` piped to `tee /tmp/<lane>.log`
Intercepts: 0
Recurrences: 2
Notes: pi has no PreToolUse hook, so the command shape cannot be machine-intercepted; in the same round macOS's missing `timeout` was also used in a command and removed after failure; #1575 used `timeout` once more (command not found), changed to running directly with tee logging
---

