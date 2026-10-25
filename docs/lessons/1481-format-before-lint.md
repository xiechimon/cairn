---
Category: After changing a function signature and a long URL, formatting was not run first and lint reported three format differences
Source: #1481 (2026-10-24)
Level: 2
Safeguard: the existing Biome formatter and `pnpm lint`
Intercepts: 1
Recurrences: 0
Notes: this round's real differences were caught by lint and re-verified after `pnpm format`; reuses the existing gate, no new rule
---
