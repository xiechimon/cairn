---
Category: A UI theme-variable change ran only lint and typecheck, no e2e; CI went red with about 60 failures on the PR (tests hardcoding old values plus one real contrast issue)
Source: PR #1551 (2026-10-23)
Level: 5
Safeguard: memory pacman-ui-theme-needs-e2e
Intercepts: 0
Recurrences: 0
Notes: pending upgrade to level 2: `pnpm prepush` should run e2e:affected automatically on style or shared UI changes, see #1555
---
