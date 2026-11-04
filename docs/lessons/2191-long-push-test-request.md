---
Category: A long-running push test POST exceeded the HTTP client header timeout
Source: Ticket #2191 review round 1 (2026-10-30)
Level: 2
Safeguard: Return 202 with an id before provider settlement and test authenticated status polling with a client deadline
Intercepts: 0
Recurrences: 0
Notes: The old synchronous route times out under fake timers; the old CLI fails the two-request and pending-state assertions.
---
