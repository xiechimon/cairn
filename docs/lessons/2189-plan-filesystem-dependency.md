---
Category: Building the prepush plan enumerated an optional on-disk directory and crashed in isolated CLI fixtures before the intended gate ran
Source: Ticket 2189 (2026-10-30)
Level: 1
Safeguard: The required prepush plan names secret-reach tests explicitly and performs no filesystem discovery to assemble the command
Intercepts: 0
Recurrences: 0
Notes: The existing prepush CLI fixtures caught ENOENT in prepush-plan-red.log. Removing discovery lets plan construction work without the full checkout; review.test.mjs pins coverage of the suite in the plan and CI.
---
