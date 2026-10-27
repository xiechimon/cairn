---
Category: After resolving a `ci.yml` conflict, the new step landed in a different job and the job owning the hunk was not checked before pushing
Source: PR #1540 (2026-10-23)
Level: 2
Safeguard: `scripts/ci-job-structure-gate.mjs` pins each job's named steps against `scripts/ci-job-structure-baseline.json`; the CI check job's pre-install step shares it with `pnpm prepush`; negative control = the #1540 wrong hunk (the freshness step landed in comment-discipline-gate) goes red in `scripts/ci-job-structure-gate.test.mjs`
Intercepts: 1
Recurrences: 0
Notes: Landed by #1557, level 5 raised to 2; first interception: after a rebase the baseline missed an upstream step migration, and the gate caught it before the fix
---
