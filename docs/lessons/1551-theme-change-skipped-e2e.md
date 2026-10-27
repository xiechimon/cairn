---
Category: Changed UI theme variables and ran only lint and typecheck, not e2e; the PR's CI went red with about 60 failures (tests with hard-coded old values plus one real contrast problem)
Source: PR #1551 (2026-10-23)
Level: 5
Safeguard: Memory pacman-ui-theme-needs-e2e
Intercepts: 0
Recurrences: 0
Notes: Upgrade pending to level 2: `pnpm prepush` auto-runs e2e:affected on style or shared UI changes, see #1555
---

