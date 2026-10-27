---
Category: Started long background tasks with `( ... & )` or nohup; they were killed as soon as the tool call returned, and ian was then told the task was running
Source: Claude thread (2026-10-22)
Level: 2
Safeguard: `scripts/dispatch-agent.mjs` start launches outside the process group, immediately checks the process and writes a status file; reports run `check` on the status file first; negative control in `scripts/dispatch-agent.test.mjs` (separate CI job): a task started the old way reports the process as missing on check
Intercepts: 0
Recurrences: 1
Notes: Recurred once (pi first, then codex), after which #1556 raised it to level 2
---

