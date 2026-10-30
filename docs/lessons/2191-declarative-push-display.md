---
Category: Receipt instrumentation removed native declarative push display and suppressed ordinary foreground notifications
Source: Ticket #2191 review round 1 (2026-10-30)
Level: 2
Safeguard: Payload regressions require web_push 8030 and mutable true for receipts; worker VM tests require foreground display
Intercepts: 0
Recurrences: 0
Notes: The original marker omission and foreground return fail the recorded red regressions. Safari native execution remains a device acceptance limit.
---
