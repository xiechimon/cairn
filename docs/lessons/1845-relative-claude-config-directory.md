---
Category: A relative Claude configuration directory was read in the daemon cwd although the CLI runs in per-step worktrees
Source: #1845 (2026-10-27)
Level: 2
Safeguard: The credential reader refuses relative overrides and tests that a readable relative directory yields no expiry
Intercepts: 1
Recurrences: 0
Notes: Negative control: docs/verify/1845/relative-red.log shows the old reader returning a cwd-specific clock
---
