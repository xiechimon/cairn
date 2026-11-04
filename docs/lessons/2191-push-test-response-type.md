---
Category: The new status-route test destructured an unknown JSON response without a type
Source: Ticket #2191 review round 1 (2026-10-30)
Level: 2
Safeguard: Repository typecheck rejects untyped response destructuring; the test explicitly declares its expected response shape
Intercepts: 0
Recurrences: 0
Notes: The first round1 typecheck reports TS2339 on response id and the corrected typecheck passes. No runtime guarantee is inferred from the annotation.
---
