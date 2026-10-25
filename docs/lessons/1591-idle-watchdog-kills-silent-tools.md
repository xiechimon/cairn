---
Category: A tool execution with no stream events was killed by the idle watchdog by mistake
Source: #1591 (2026-10-24)
Level: 2
Safeguard: the runner tracks in-flight tools by call ID; `runner-stream-timeout.test.ts` covers silent long tools, parallel tools, idle recovery after completion and the duration ceiling
Intercepts: 1
Recurrences: 0
Notes: negative control: all 4 new cases failed on the old implementation (idle=80ms terminated early), 12 of 12 pass after the fix; liveness depends on runtime events, so it needs a behavioral test
---
