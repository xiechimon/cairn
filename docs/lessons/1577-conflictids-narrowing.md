---
Category: Used `'conflictIds' in result` to distinguish promote outcomes; the two branch object shapes were not mutually exclusive, so tsc reported possibly-undefined when reading fields
Source: #1577 (2026-10-25)
Level: 1
Safeguard: `promote` returns a union discriminated by an explicit `promoted: true / false` field, and callers narrow on the discriminant
Intercepts: 1
Recurrences: 0
Notes: Real negative control: `pnpm typecheck` reports TS18048 under the `in` form, passing after the discriminated union
---
