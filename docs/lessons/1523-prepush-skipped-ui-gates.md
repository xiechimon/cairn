---
Category: A web PR was pushed before the ui-debt and dead-class gates ran; CI went red twice
Source: PR #1523 (2026-10-22)
Level: 2
Safeguard: `pnpm prepush` and CI share `scripts/prepush.mjs`; `scripts/prepush.test.mjs` checks the same entry
Intercepts: 4
Recurrences: 0
Notes: #1533: the `mt-[3px]` negative control tripped D5, and the static check turned green after removal; dead-class stays advisory in CI
---
