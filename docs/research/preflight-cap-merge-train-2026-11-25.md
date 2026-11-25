# Preflight capacity and merge-train prior art (2026-11-25)

Question: how should cairn stop doomed preflights, cap preflight runner demand, and land queued green heads without weakening the `green-main` checks?

Claims are marked measured, inferred, or guessed.

| Source | What it does | Trade-off for cairn | Evidence |
|---|---|---|---|
| GitHub merge-queue docs: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue | Every queued entry is tested against the base branch plus entries ahead of it. Successful `merge_group` branches land together; a failing entry is removed and following groups are recreated. GitHub exposes `Build concurrency` as the maximum number of concurrent merge-group CI builds and merge limits for batching landings. | This is the native shape cairn's `enqueue/*` + `queue/try/*` train already follows. GitHub's product requires PR-based entry, so cairn keeps its own no-PR train but should copy the bounded-build-concurrency policy. | measured: read current GitHub docs |
| GitHub Actions concurrency docs: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency and workflow syntax https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax | A concurrency group permits one running workflow/job. `queue: max` can keep up to 100 pending runs instead of replacing the pending run, but a group still runs only one at a time and cannot express a global limit of two. `queue: max` cannot combine with `cancel-in-progress: true`. | Actions concurrency is the right primitive for one-at-a-time serialization, not for a two-at-a-time preflight semaphore. It also cannot share capacity fairly across arbitrary lane refs without a second allocation mechanism. | measured: read current GitHub docs |
| GitHub ruleset docs: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets | Branch/tag/push rulesets layer; the most restrictive applicable rule wins. Required checks are attached to the commit being pushed. | The safety invariant stays exact-SHA evidence for `check`, `pack-smoke`, and `e2e-gate`. Capacity control is an admission optimization and must never replace those checks. | measured: read current GitHub docs |
| Mergify merge-queue performance: https://docs.mergify.com/merge-queue/performance/ | Mergify separates reliability, cost, and velocity. Parallel speculative checks test predicted cumulative states; the operator sets `max_parallel_checks` according to CI capacity. Two-step CI runs fast preliminary tests before queue entry and exhaustive tests before merge. | This directly supports a local fast gate before preflight and a small configured preflight concurrency limit. It also warns that capacity must be sized to measured CI demand rather than a theoretical maximum alone. | measured: read current Mergify docs |
| Mergify batches: https://docs.mergify.com/merge-queue/batches/ | Batches test several queued pull requests in one CI run; failures split the batch to isolate the culprit. Dynamic batching keeps batches small when the queue is light and grows them when it backs up. | Cairn's train uses per-position attribution rather than opaque batches: each green head is stacked on the green prefix and the furthest green prefix lands as one batch. This preserves attribution while avoiding serial landing. | measured: read current Mergify docs |
| Existing cairn merge-train research: `docs/research/2026-11-22-merge-train.md` | GitLab merge trains, GitHub merge queue, Zuul, Bors, and Uber SubmitQueue all converge on ordered candidates tested on cumulative prefixes, culprit eviction, and follower rebuild. The prior cairn measurement was ~6.2 preflight runs per landing and one lane with 23 preflight runs. | Confirms the queue shape. The missing piece in the current implementation is admission policy: direct fast-forward bypasses train formation when the queue looks empty, and unlimited preflight pushes consume runner capacity before the train can help. | measured: read the in-repo research and current scripts |
| Cairn's own scripts: `scripts/ops/preflight.mjs`, `scripts/ops/push-queue.mjs`, `scripts/ops/speculative-queue.mjs` | `preflight.mjs` already runs `preflight-fast-gate.mjs` before pushing. `speculative-queue.mjs` already builds cumulative `queue/try/*` refs and promotes the furthest green prefix. `push-queue.mjs` still fast-forwards `main` itself when the queue is empty, so train use depends on timing rather than being the default path. | Reuse the existing train; remove the direct landing path rather than adding a second queue. Add a small admission wait in preflight rather than a new required CI job. | measured: read the current source |

## Measured baseline before this change

Window: latest 23 completed `ci` runs on `preflight/*`, read through the GitHub API on 2026-11-25T13:47Z. `wall` is run creation to last job completion; job queue wait is each non-skipped job's `started_at - created_at`.

| Metric | Median | p90 | Max |
|---|---:|---:|---:|
| Run wall time | 642s (10.7m) | 905s (15.1m) | 1332s (22.2m) |
| Max per-job queue wait in a run | 99s | 297s | 393s |
| Mean per-job queue wait in a run | 49.4s | 148.9s | 240.5s |
| Non-skipped jobs per run | 20 | 20 | 20 |

Concrete saturated examples (measured):

| Run | Wall | Max job wait | Mean job wait | Note |
|---|---:|---:|---:|---|
| `45615563160` | 905s | 393s | 240.5s | `e2e`/`vitest-light` shards waited 2-6 minutes for runners |
| `45615735508` | 650s | 313s | 154.5s | saturated preflight burst |
| `45618332378` | 678s | 297s | 123.6s | saturated preflight burst |
| `45623673701` | 262s | 3s | 1.9s | later ops-only run with spare capacity |

At 2026-11-25T13:47Z there were four simultaneous preflight runs (`45626428019`, `45626769316`, `45627058577`, `45627100856`), matching the report's observation that admission is currently unbounded (measured).

## Negative control from the real past mistake

The real overcapacity experiment was commit `2e88f65b0` / run `45584537243` (`ci-exp-shards-20261125`): shard config `vitest-light=6`, `e2e=8`, `e2e-affected=2` produced 22 active jobs and `vitest-light (4)` waited 70s for a runner. A capacity gate must go red on that diff. The clean current production shape (`vitest-light=6`, `e2e=6`, `e2e-affected=4`) must go green; its measured ops-only production run `45602038730` had max job wait 3s (measured).

## Recommendation

1. Keep exact-SHA `green-main` evidence unchanged.
2. Keep the existing speculative train as the only landing path: `push-queue.mjs` should enqueue even when the queue is empty; the promoter already treats a verified first entry on current `main` as green and can promote it without a duplicate queue CI run.
3. Cap normal preflight admission at two active (`queued` + `in_progress`) preflight CI runs. This is an efficiency gate, not a security gate: if the GitHub run-count API is unreadable, preflight may proceed after the mandatory local fast gate, and `CAIRN_PREFLIGHT_CONCURRENCY_BYPASS=1` is the emergency escape hatch for the wait only.
4. Add a fast static capacity gate to the existing `check-core` job (no new required job): worst-case parallel heavy-job fanout in one `ci` run must stay within 20 runner slots, and the configured preflight cap must remain at most two. Locally, the preflight fast gate runs the same static gate and targeted ops tests for merge-queue/CI scheduling changes before any preflight push.
