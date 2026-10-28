---
Category: An ordinary fast-forward accepted a default ref rewound after the final readiness read
Source: #1625 (2026-10-27)
Level: 2
Safeguard: Real Git race test rewinds the default ref immediately before landing; a prepared ref transaction checks the exact judged base and records the landing receipt atomically
Intercepts: 1
Recurrences: 0
Notes: The fast-forward implementation merges despite the changed base; the transaction returns recheck and preserves the competing ref. Real Git tests also caught the no-deref requirement for symref verification and the duplicate HEAD update when verifying a checked-out default branch
---
