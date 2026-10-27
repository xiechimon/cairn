---
Category: A new web source file was not added to `e2e-affected`'s file map, so `e2e:affected` fell back to the full 172 cases and ran for 15 minutes
Source: #1521 (2026-10-24)
Level: 3
Safeguard: `scripts/e2e-affected.mjs`'s file map adds `agent-fallback-models.tsx`; no machine check yet
Intercepts: 0
Recurrences: 0
Notes: Negative control: `--dry-run -- apps/web/src/routes/agent-fallback-models.tsx` was FULL with the old table, file map with the new one; follow-up: make `--check-coverage` also report unmapped routes source files
---
