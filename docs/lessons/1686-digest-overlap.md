---
Category: A slow digest sweep overlapped the next scheduled slot and resent the same queue
Source: #1686 (2026-10-27)
Level: 2
Safeguard: The scheduler guards an in-flight digest; a test holds transport delivery open while ticking both daily slots
Intercepts: 1
Recurrences: 0
Notes: The original scheduler sent twice while the first sweep was pending; the test passes with the guard
---
