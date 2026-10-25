---
Category: After resolving a `ci.yml` conflict the new step landed in a different job and nobody checked which job the hunk was in before pushing
Source: PR #1540 (2026-10-23)
Level: 2
Safeguard: `scripts/ci-job-structure-gate.mjs` pins every job's named steps against `scripts/ci-job-structure-baseline.json`, and the CI check job's pre-install step shares `pnpm prepush`; negative control: the #1540 bad hunk (freshness step landing in comment-discipline-gate) goes red in `scripts/ci-job-structure-gate.test.mjs`
Intercepts: 1
Recurrences: 0
Notes: landed with #1557, level raised 5 to 2; first interception: the baseline missed an upstream step migration after a rebase and the gate caught it before it was fixed
---
