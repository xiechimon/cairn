---
Category: Ordinary pushes allocated receipt rows with no lifecycle bound
Source: Ticket #2191 review round 1 (2026-10-30)
Level: 2
Safeguard: Allocate push_delivery rows only for required receipts and test unknown receipt ids return 404 without insertion
Intercepts: 0
Recurrences: 0
Notes: The old ordinary-send insert fails the zero-row assertion. Required alert history remains durable and is not covered by a retention guarantee.
---
