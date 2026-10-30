---
Category: A new hillclimb flow landed with no capability row, so the CI gates job went red on the feature map staleness gate while every local check a lane runs stayed green
Source: 1966 (2026-10-30)
Level: 2
Safeguard: `scripts/eval-coverage.test.mjs` asserts that every flow committed under `.claude/hillclimb` is named by `scripts/eval-capabilities.json` through `loadRepoEvalCoverage`, and `scripts/prepush.mjs` now runs that test in its required list, so the mismatch reds a local `pnpm prepush` instead of reaching CI.
Intercepts: 0
Recurrences: 1
Notes: The gate that caught it, `scripts/feature-map-staleness-gate.mjs`, already refused an unlisted flow, but it sat in `ciOnlyScripts` and its unit test was named by no CI step and no prepush check, so nothing a lane runs before pushing could see it. Negative control: the new repo-data test asserts `unlisted` is `[]` and was red with `actual: ['plan-revision']` before the row was added, green after; the prepush assertion failed on the missing `node --test scripts/eval-coverage.test.mjs` step before that step was added. Level 1 is not reached because the capability list is data the flow directory cannot type against.
---
