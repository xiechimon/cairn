---
Category: A shell command used zsh's readonly variable `status` for the exit code and aborted the rest of the cleanup
Source: #1533 (2026-10-23)
Level: 3
Safeguard: tool commands use task-specific prefixes for variables, following the existing execution rules
Intercepts: 0
Recurrences: 0
Notes: the negative-control file was removed; interactive tool commands are not in-repo checked scripts, so in-repo lint cannot cover them
---
