---
Category: Restore preview missed writes committed while services were stopping
Source: Ticket 1408 (2026-10-30)
Level: 1
Safeguard: The confirmation contract requires the preview discard digest to equal the stopped-instance discard digest before backup can run; since 2026-10-30
Intercepts: 0
Recurrences: 1
Notes: Review round 1 found that a new stop-time report was not bound to the approved preview; red.log rejects the prior contract and green.log verifies mismatch refusal without discarding rows.
---
