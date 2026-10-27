---
Category: A grader landed with an unused parameter over the frozen zero-warning cap; local prepush stayed green because `biome ci` exits 0 on warnings and the cap gate ran only in CI
Source: PR #1881 (2026-10-26)
Level: 2
Safeguard: `scripts/lint-warning-cap.mjs` and `scripts/lane-file-gate.mjs` joined the local prepush plan (`localOnly` in `scripts/prepush.mjs`); the prepush self-test now collects `node scripts/*.mjs` lines from block-form CI steps too, so a gate that stays CI-only must be listed in `ciOnlyScripts`
Intercepts: 1
Recurrences: 0
Notes: Negative control: the unused `forbidden` parameter reds `node scripts/lint-warning-cap.mjs` against the old grader and greens after `forbiddenHits` lands; the hardened self-test was red until the cap gate joined the local plan and also classified `npm-command-gate` (npm registry network) and `check-closing-keyword` (PR event payload) as CI-only
---
