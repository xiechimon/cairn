---
Category: The cloud container's Playwright was missing `chromium_headless_shell-1243`; all integration browser cases went red in pre-push, looking like broken code
Source: Claude thread (2026-10-23)
Level: 2
Safeguard: the SessionStart hook from #1395 (`.claude/hooks/session-start.sh`) symlinks the missing browser revision to the preinstalled one in cloud containers
Intercepts: 0
Recurrences: 0
Notes: the old note claimed the hook automation was unfinished, but #1395 (2026-10-20) had already landed; corrected and raised to level 2 with #1630; judging visual assertions against the old chromium by eye is a judgment error no machine check can make
---
