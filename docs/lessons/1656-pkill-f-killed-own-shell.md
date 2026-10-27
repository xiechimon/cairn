---
Category: Killing a background vite with `pkill -f <pattern>` matches the agent's own shell command line and kills the whole command plus its later steps
Source: Claude thread (2026-10-23); recurred 2026-10-26 (menu surfaces thread, killed a running full e2e; sidebar focus ring thread, killed a rebuild)
Level: 5
Safeguard: memory: record the PID when starting a background process (`echo $! > pidfile`) and kill by PID, never `pkill -f`; start `node_modules/.bin/vite` directly, not through pnpm
Intercepts: 0
Recurrences: 2
Notes: agent-side shell action outside the repo, no repo gate can see it
---

