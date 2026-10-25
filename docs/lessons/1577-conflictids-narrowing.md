---
Category: `'conflictIds' in result` was used to distinguish promotion results; the two branch object shapes were not mutually exclusive and tsc reported possibly undefined when reading fields
Source: #1577 (2026-10-25)
Level: 1
Safeguard: `promote` returns a union discriminated by an explicit `promoted: true / false` field, and callers narrow on the discriminator
Intercepts: 1
Recurrences: 0
Notes: real negative control: `pnpm typecheck` reported TS18048 with the `in` style and passed with the discriminated union
---
