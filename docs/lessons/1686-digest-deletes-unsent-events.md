---
Category: Digest delivery deleted newly queued events and transiently failed deliveries
Source: #1686 (2026-10-27)
Level: 2
Safeguard: The digest sweep deletes only snapshot item IDs after successful delivery; regression tests insert during send and reject transport delivery
Intercepts: 1
Recurrences: 0
Notes: Both original cases failed before the fix and pass after it
---
