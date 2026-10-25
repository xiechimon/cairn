---
Category: Under multi-lane sharing, `pkill -f vitest` killed test processes by name and could hit another lane's run
Source: #1635 (2026-10-25)
Level: 5
Safeguard: memory convention: only reap by the PID or process group you started
Intercepts: 0
Recurrences: 0
Notes: the processes live outside the repo with no ownership marker, so in-repo scripts cannot check them; for the next long run, watch a `tee` log for the completion marker instead
---
