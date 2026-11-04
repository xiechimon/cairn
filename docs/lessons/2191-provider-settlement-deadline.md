---
Category: An unsettled provider promise prevented a must-reach alert from invoking fallback
Source: Ticket #2191 (2026-10-30)
Level: 2
Safeguard: Race every provider request against a ten-second settlement deadline, clear the timer on completion, and test a provider promise that never settles with fake timers
Intercepts: 0
Recurrences: 0
Notes: The original alert awaited sendPushToUser without an absolute settlement bound. The never-settling stub failed the fallback assertion before the watchdog and passes after it. The library socket inactivity timeout alone is insufficient.
---
