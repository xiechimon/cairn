---
Category: GitHub fixture applied check-run mutations to a compare response
Source: Ticket 1408 (2026-10-30)
Level: 2
Safeguard: Gate fixture scopes mutations to check-run endpoints and rejection assertions require the expected check failure message
Intercepts: 0
Recurrences: 0
Notes: fixture-shape-red.log preserves three unintended gh failures; green.log verifies endpoint-specific mutations. Generic subprocess failure cannot satisfy the strengthened negative-control assertions.
---
