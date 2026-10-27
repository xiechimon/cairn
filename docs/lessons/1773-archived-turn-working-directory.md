---
Category: Archiving the turn's original worktree invalidated the terminal's default working directory
Source: PR #1879 delivery continuation (2026-10-28)
Level: 2
Safeguard: Native execution rejects a missing cwd before creating a process; continued calls bind the existing active worktree through explicit workdir
Intercepts: 1
Recurrences: 0
Notes: Attaching another worktree updated the app but not this turn's terminal default. One read-only status check failed before execution; the same check passed with explicit workdir. The existing evaluation session remained alive and was not restarted. Repository types cannot alter the desktop executor's per-turn cwd snapshot.
---
