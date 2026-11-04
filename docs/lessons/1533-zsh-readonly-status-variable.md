---
Category: Used the zsh read-only variable `status` to capture an exit code in a shell command, aborting the cleanup that followed
Source: #1533 (2026-10-23)
Level: 3
Safeguard: Tool-command variables use a task-specific prefix, following the existing execution rules
Intercepts: 0
Recurrences: 0
Notes: The negative-control file has been removed; interactive tool commands are not in-repo checked scripts, so in-repo lint cannot cover them
---
