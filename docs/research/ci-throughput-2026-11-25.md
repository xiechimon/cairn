# CI throughput prior art (2026-11-25)

| Source | What it does | Trade-off for cairn | Evidence |
|---|---|---|---|
| GitHub Actions concurrency docs: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency | A concurrency group permits one running job/workflow; pending entries can be replaced or queued with `queue: max`. It does not provide priority across different workflows. | Useful to prevent superseded duplicate work, not useful as a preflight priority mechanism. Priority must come from submitting less doomed or less parallel work. | measured: read the current GitHub documentation |
| GitHub Actions matrix docs: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations | A matrix creates one runner job per combination; `fail-fast: false` keeps sibling shards visible. | More shards shorten the longest shard but directly increase runner-slot demand, so shard increases have to be paired with packing or fewer wasted runs. | measured: read the current GitHub documentation |
| GitHub status-check docs: https://docs.github.com/en/pull-requests/reference/status-checks | A skipped job reports success even when required. | The existing aggregate contexts (`check`, `pack-smoke`, `e2e-gate`) must keep explicit `always()` verdict logic; packing jobs cannot change those context names or meanings. | measured: read the current GitHub documentation |
| GitHub ruleset docs: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets | Required checks are attached to the commit/ruleset and can require an up-to-date branch. | Cairn's green-main ruleset is the final gate; preflight is an admission optimization and must not replace exact-SHA evidence. | measured: read the current GitHub documentation |
| Mergify merge-queue priority: https://docs.mergify.com/merge-queue/priority | Urgent entries can be ordered ahead of normal entries with priority rules. | Confirms the product value of urgent-first admission, but GitHub Actions itself has no equivalent cross-workflow priority primitive for cairn's preflight refs. | measured: read the current Mergify documentation |
| Mergify parallel speculative checks: https://docs.mergify.com/merge-queue/performance/ | Speculative queue validation is parallelized up to a configured `max_parallel_checks`; the operator chooses a value CI can handle. | Matches cairn's existing speculative queue. The bottleneck is inside each ci run and wasted preflight demand, not the merge-queue algorithm this lane may not touch. | measured: read the current Mergify documentation |

Recommendation: keep the required contexts and the speculative queue unchanged; make preflight fail locally before consuming a CI run when biome, touched-package typechecks, or `pnpm test:changed` already fail on the exact pushed tree; shorten the critical path by splitting the measured long vitest/e2e shards while keeping runner-slot demand bounded. Every before/after claim must come from real ci runs. The hand-written ref lease in the inherited diff is not recommended: it is a second distributed locking protocol beside the merge queue, while GitHub offers no atomic compare-and-swap over those refs.

## Measured 48h baseline and fast-gate catch rate

From 707 completed `ci` runs in the prior 48 hours (571 on `preflight/*`, 212 failed `preflight/*` runs):
- `preflight/*` wall time: p50 `7.7m`, p90 `31.8m`, avg `17.9` active jobs per run.
- Per-job compute p50/p90: `e2e` `292s / 343s`, `vitest-light` `232s / 299s`, `vitest-integration` `162s / 193s`, `check-core` `141s / 193s`.
- Local fast-gate replay (`pnpm lint` + `typecheckPackagesForPaths` + `pnpm test:changed`) across all 212 failed `preflight/*` runs (measured against the exact failed SHAs and job logs):
  - `pnpm lint` failures: **23 / 212** runs
  - Touched-package `typecheck` failures: **20 / 21** runs (`typecheckPackagesForPaths` matched 20 / 20 typecheck failures)
  - `vitest-light` test failures caught by `pnpm test:changed`: **62 / 84** parsed test-failure runs (60 direct/audit/contract + 2 identifier-reference; 22 outside `test:changed`)
  - Unique failed `preflight/*` runs blocked before pushing to GitHub: **103 / 212 (48.6%)**.

## Measured before/after CI runs (`ci-exp-base-20261125` vs `ci-exp-shards-20261125`)

Both probe runs modified `apps/web/src/main.tsx` from the same base (`518b83732`) and ran at `2026-11-25T09:20Z`:

| Metric | Before: `ci-exp-base-20261125` (`45584432690`, `518b83732`) | After: `ci-exp-shards-20261125` (`45584537243`, `2e88f65b0`) | Production shard config (`45602038730`, `3d0dc6c53`, ops-only diff) |
|---|---|---|---|
| Shards (`vitest-light` / `e2e` / `e2e-affected`) | `4 / 5 / 2` | `6 / 8 / 2` | `6 / 6 / 4` |
| Active / total jobs | `15 / 19` (`vitest-integration` skipped) | `22 / 25` (`vitest-integration` ran 2 shards) | `14 / 18` (`e2e` skipped, `vitest-integration` ran 2 shards) |
| Run wall time (`created_at` → last `completed_at`) | `375s (6.25m)` | `315s (5.25m)` (`-60s`, `-16.0%`) | `293s (4.88m)` |
| First-job / max-job / avg-job queue wait | `2s / 2s / 1.4s` | `3s / 70s / 9.5s` (`vitest-light (4)` queued 70s) | `2s / 3s / 2.1s` |
| Critical path & longest compute | `e2e (4)` `349s` (`e2e-gate` at `375s`); `vitest-light` max `322s` | `vitest-integration (1)` `278s`; `vitest-light (4)` finished `309s` (max compute `221s`); `e2e` max `253s` (`e2e-gate` at `286s`) | `vitest-integration (1)` `267s`; `vitest-light` max `228s`; `check` at `293s` |

Note on `20` vs `6` `e2e` shards: `ci-exp-shards-20261125` (`6/8/2`, 22 active jobs) pushed past the ~20-runner concurrent limit and incurred a `70s` queue wait on `vitest-light (4)`. Keeping `vitest-light: 6`, `e2e: 6`, `e2e-affected: 4` caps active jobs at 18–20 per run while retaining the `vitest-light` (`322s → 221–228s`) and `e2e` shard speedups.
