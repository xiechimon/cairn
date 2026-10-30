---
Category: Concurrent worker credential writes could restore stale credentials after logout
Source: Ticket #2191 (2026-10-30)
Level: 2
Safeguard: Serialize credential cache writes and run apps/web/test/push-auth.test.ts
Intercepts: 0
Recurrences: 0
Notes: The delayed old-token write is the negative control; unsynchronized writes failed and the queue preserves write order.
---
