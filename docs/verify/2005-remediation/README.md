# Baseline owner gate remediation (after #2139)

PR #2139 landed on main while the independent review gate was BLOCK. This follow-up fixes the three blocking findings without amending that merge.

## Findings addressed

1. **Enforcement.** Removed the separate unprotected `baseline-owner-gate` job. The gate now runs inside the required `check` job step `CI job structure gate (#1557)` on `pull_request` events, so a red ownership check fails `check`.
2. **Curated main-red.** `isCuratedMainRed` requires `main-red` plus gardener curation labels `batch:now` and `by:pi` or `by:cairn`, and rejects titles matching `/^main\s+red:/i`. Raw main-watch alerts and `main-red` alone fail.
3. **Baseline JSON.** Reverted the `#2139` addition of `baseline-owner-gate` in `scripts/ci-job-structure-baseline.json`. No new step name was added to the structure pin (the gate folds into an existing `check` step). The structure pin remains outside the debt-baseline ownership set so this revert can land.

## Overlap

Lookup after #2139 merge: open issue #2005 is CLOSED; recent PR #2139 is the same-ask predecessor. No open PR path overlap on the gate or `ci.yml`.

## Logs

| Command | Log |
| --- | --- |
| tests before predicate fix | `red.log` |
| tests after fix (22 pass) | `green.log` |
| acceptance simulation | `acceptance-sim.log` |
| `node scripts/ci-job-structure-gate.mjs` | `ci-structure.log` |
| `node --test scripts/prepush.test.mjs` | `prepush-selftest.log` |
| `node scripts/prepush-vitest.mjs` | `prepush-vitest.log` |
| `pnpm lint` / `typecheck` / `spec:parse` | matching `*.log` files |
