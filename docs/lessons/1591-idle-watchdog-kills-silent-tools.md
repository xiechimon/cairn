---
Category: A tool execution with no stream events was killed by the idle watchdog by mistake
Source: #1591 (2026-10-24)
Level: 2
Safeguard: The runner maintains the set of in-flight tools by call ID; `runner-stream-timeout.test.ts` covers silent long tools, parallel tools, idle recovery after completion, and the duration cap
Intercepts: 1
Recurrences: 0
Notes: Negative control: the old implementation failed all 4 new cases (idle=80ms terminating early), 12 cases pass after the fix; survival depends on runtime events, so a behavioral test is required
---

