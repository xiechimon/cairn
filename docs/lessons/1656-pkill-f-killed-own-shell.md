---
Category: `pkill -f <pattern>` used to reap background vite matched the shell's own command line and killed the whole command together with the following steps
Source: Claude thread (2026-10-23)
Level: 5
Safeguard: memory: record the PID when starting a background process (`echo $! > pidfile`) and reap by PID, never `pkill -f`; start `node_modules/.bin/vite` directly instead of through pnpm
Intercepts: 0
Recurrences: 0
Notes: an agent-level shell operation the repo gates cannot see
---
