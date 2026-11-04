---
Category: On a shared machine with multiple lanes, `pkill -f vitest` was used to wrap up by name, possibly killing another lane's test processes
Source: #1635 (2026-10-25)
Level: 5
Safeguard: Memory convention: only wrap up by the PID or process group you started
Intercepts: 0
Recurrences: 0
Notes: The processes are outside the repo and carry no ownership marks, so in-repo scripts cannot see them; next long test will watch the completion marker through a `tee` log instead
---
