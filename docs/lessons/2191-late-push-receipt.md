---
Category: A receipt posted after the deadline suppressed fallback when the event loop resumed late
Source: Ticket #2191 (2026-10-30)
Level: 2
Safeguard: Compare persisted receipt time with the send deadline and test delayed timer processing with a late receipt
Intercepts: 0
Recurrences: 0
Notes: The initial existence-only check failed the late-receipt assertion. The test waits for the poll timer before moving the fake clock; moving it before poll initialization produced a harness timeout instead of the intended negative control.
---
