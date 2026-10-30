---
Category: Permission refusal on process maps was reported as an unavailable memory probe
Source: Ticket 2189 review round 2 (2026-10-30)
Level: 2
Safeguard: Injected EACCES and EPERM executions require BLOCKED while ENOENT remains SKIPPED
Intercepts: 0
Recurrences: 0
Notes: The old implementation reports SKIPPED in red.log; corrected executions pass in green.log. This is error classification evidence, not a real cross-user ptrace result.
---
