---
Category: Broker listener configuration allowed the root group
Source: Ticket 2189 review round 2 (2026-10-30)
Level: 2
Safeguard: API and CLI regressions require zero and negative GIDs to fail before listening or reading the key
Intercepts: 0
Recurrences: 0
Notes: Red runs reject the old API and CLI behavior; green runs pass. Socket lifecycle checks still skip when the sandbox refuses binding.
---
