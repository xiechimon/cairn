---
Category: When adding an entry to the family table in `scripts/e2e-affected.mjs`, the new entry was inserted after `];`, breaking the script syntax
Source: #1684 (2026-10-25)
Level: 2
Safeguard: `pnpm lint` (biome parses scripts/*.mjs and reports syntax errors); data-class errors are additionally caught by `--check-coverage` on the advisory surface
Intercepts: 1
Recurrences: 0
Notes: Negative control: reproducing that insertion makes `pnpm lint` report an error, restoring it reports 0; this round caught it with `node --check` before lint; the machine check already covers it, so no new gate was added
---
