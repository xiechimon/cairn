---
Category: Piping the multi-minute full-e2e output into `head -30` for a preview closed the pipe early; the process took SIGPIPE and was truncated at case 8, wasting one rerun
Source: #1684 (2026-10-25)
Level: 3
Safeguard: Long commands redirect to a log file only, viewed with a separate `tail` — a pipe variant of the AGENTS tee-watches-the-completion-marker discipline
Intercepts: 0
Recurrences: 0
Notes: Behavior class; in-repo scripts cannot police shell pipe combinations
---
