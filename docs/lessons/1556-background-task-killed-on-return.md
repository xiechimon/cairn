---
Category: A long background task started with `( ... & )` or nohup was killed as soon as the tool call returned, and the report still told ian the task was running
Source: Claude thread (2026-10-22)
Level: 2
Safeguard: `scripts/dispatch-agent.mjs` start launches outside the process group, verifies the process immediately and writes a status file; `check` reads the status file before reporting; the negative control lives in `scripts/dispatch-agent.test.mjs` (standalone CI job): a task started the old way reports "process does not exist"
Intercepts: 0
Recurrences: 1
Notes: after 1 recurrence (first pi, then codex) #1556 raised it to level 2
---
