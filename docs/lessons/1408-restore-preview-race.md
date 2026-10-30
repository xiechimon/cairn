---
Category: Restore preview missed writes committed while services were stopping
Source: Ticket 1408 (2026-10-30)
Level: 1
Safeguard: Preview stops configured writers and leaves them stopped until confirmation; the confirmation digest must equal the stopped-instance discard digest before backup; since 2026-10-30
Intercepts: 0
Recurrences: 2
Notes: Round 2 found heartbeat churn invalidated running previews; red.log rejects preview before stopping writers and green.log verifies stable preview and changed-set refusal.
---
