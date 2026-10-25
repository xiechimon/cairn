---
Category: A new web source file was not added to the `e2e-affected` file map, so `e2e:affected` fell back to the full 172-case suite and ran for 15 minutes
Source: #1521 (2026-10-24)
Level: 3
Safeguard: the `scripts/e2e-affected.mjs` file map gained `agent-fallback-models.tsx`; no machine check yet for this class
Intercepts: 0
Recurrences: 0
Notes: negative control: `--dry-run -- apps/web/src/routes/agent-fallback-models.tsx` said FULL with the old table and file map with the new one; pending upgrade: #1599 makes `--check-coverage` also report unmapped route source files
---
