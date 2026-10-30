---
Category: Changed a function signature and a long URL without formatting first; lint reported three formatting diffs
Source: #1481 (2026-10-24)
Level: 2
Safeguard: The existing Biome formatter and pnpm lint
Intercepts: 1
Recurrences: 0
Notes: This round's real diffs were caught by lint and re-verified after `pnpm format`; reused the existing gate, no new rule. Ticket 1408 round 3 also hit a long test assertion and array formatting diff; targeted Biome formatting fixed it, with lint-round3-red.log retaining the rejection
---
