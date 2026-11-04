---
Category: A provider watchdog timeout was reported as a definitive delivery failure
Source: Ticket #2191 review round 1 (2026-10-30)
Level: 2
Safeguard: Must-reach watchdog outcomes use unknown and still invoke fallback; fake-timer regression checks the result
Intercepts: 0
Recurrences: 0
Notes: The old failed result fails the unknown assertion. A provider request may deliver after the watchdog; duplicate email is acceptable, a missing alert is not. Reading web-push 3.6.7 source also showed its socket timeout can reject before the watchdog. That real Socket timeout error supplies an additional red regression; required sends now treat transport errors without an HTTP rejection as unknown.
---
