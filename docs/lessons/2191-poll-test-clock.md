---
Category: A successful CLI polling test used a 100 millisecond wall-clock budget and failed under concurrent load
Source: Ticket #2191 review round 1 (2026-10-30)
Level: 2
Safeguard: Use node:test controlled Date time for deadline expiry instead of a wall-clock scheduling assumption
Intercepts: 0
Recurrences: 0
Notes: The combined ops run captured the load-sensitive deadline failure. The controlled-clock test checks deadline expiry without requiring fast scheduling.
---
