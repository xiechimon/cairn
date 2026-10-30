---
Category: In-memory alert timers left pending alerts stranded after restart
Source: Ticket #2191 review round 1 (2026-10-30)
Level: 2
Safeguard: Persist the original message before dispatch and sweep pending rows at scheduler startup and on ticks; test a reopened SQLite file
Intercepts: 0
Recurrences: 0
Notes: The removed scheduler sweep is a negative control that leaves the startup row pending. Missing fallback becomes persistently undelivered. At-least-once fallback may duplicate email after a crash.
---
