---
Category: A confirmed database restore failure left all services stopped
Source: Ticket 1408 review round 1 (2026-10-30)
Level: 2
Safeguard: Confirmed restores attempt every configured service and backup timer start in finally, with injected backup and start failure tests
Intercepts: 0
Recurrences: 0
Notes: red.log shows missing start attempts; green.log covers backup failure and continued recovery after one start fails
---
