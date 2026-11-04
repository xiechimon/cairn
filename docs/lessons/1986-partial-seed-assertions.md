---
Category: Seed-fragment assertions missed partial mutation and ambiguous read or handoff results
Source: Issue #1986 review (2026-10-27)
Level: 2
Safeguard: Complete file equality, exact relay messages, private executor payloads, and mutation negative controls verify isolation
Intercepts: 5
Recurrences: 0
Notes: Appending a payload while preserving the stub fails all three mutation cases; empty-read and prompt-leak mutations also fail
---
