---
Category: Playwright in the cloud container lacked `chromium_headless_shell-1243`, so integration browser cases were all red at pre-push and looked like broken code
Source: Claude thread (2026-10-23)
Level: 2
Safeguard: The `#1395` SessionStart hook (`.claude/hooks/session-start.sh`) symlinks the missing browser revision to the preinstalled one in cloud containers
Intercepts: 0
Recurrences: 0
Notes: The old note called the hook automation unfinished; in fact #1395 (2026-10-20) had long landed, corrected and raised to level 2 with #1630; treating visual assertions on an old chromium as CI-authoritative is a judgment error no machine check can catch
---

