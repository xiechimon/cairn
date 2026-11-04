---
Category: Ran pnpm in parallel while reusing dependencies; the automatic dependency verification reinstalled node_modules and running tests lost packages
Source: #1514 (2026-10-24)
Level: 3
Safeguard: This round's verification commands with reused dependencies set `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` explicitly and start checks only after copying finishes
Intercepts: 1
Recurrences: 0
Notes: pnpm 12 does not read the npm_config switches that were tried; after switching to its PNPM_CONFIG switches, typecheck/lint/spec:parse pass. This is agent-side external command scheduling that in-repo types or lint cannot constrain; no global config or lockfile was changed
---
