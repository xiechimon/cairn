---
Category: Formatting the new integration test did not organize its imported names
Source: PR #1879 context propagation repair (2026-10-28)
Level: 2
Safeguard: Mandatory biome ci import-order validation runs before committing
Intercepts: 1
Recurrences: 0
Notes: pnpm lint rejected the import ordering before commit. The names were sorted and the same gate passed. Type systems do not enforce lexical import ordering, so the existing lint gate is the appropriate boundary.
---
