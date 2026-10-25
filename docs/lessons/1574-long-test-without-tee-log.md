---
Category: A long run (`vitest run --changed`, measured 1598s) had no `tee` log; when it went red there was no way to see which files failed and the whole round had to rerun
Source: pi thread #1574 (2026-10-24)
Level: 3
Safeguard: global AGENTS.md testing rule 4: long runs use `... 2>&1 | tee /tmp/<lane>.log`
Intercepts: 0
Recurrences: 2
Notes: pi has no PreToolUse hook, so the command shape cannot be machine-blocked; the same round also used macOS's missing `timeout` command and dropped it after failure; #1575 used `timeout` again (command not found), then switched to running directly with a `tee` log
---
