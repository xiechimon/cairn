# Merge train: prior art for moving queue/main past one candidate at a time

Why: overnight 2026-11-21/22, `queue/main` admitted one candidate at a time
while up to ~8 lanes competed for the slot. Every waiting lane ran
`push-queue.mjs --wait`, which rebases onto the live candidate and re-runs a
full `ci` on `preflight/<lane>` after every rebase. One lane rebased 7 times
(reported); measured below, the heaviest lane produced 23 preflight runs for a
single commit. Separately, the `promote` workflow repeatedly raced GitHub's
check-context propagation and had `git push <sha>:main` refused by the
`green-main` ruleset. This note is research only; no code changes.

Claims are marked **verified** (read or measured first-hand this session),
**inferred** (derived from verified facts), or **guessed**.

## What the current queue actually does (verified, source + runs)

- `queue/main` holds one live candidate (`docs/design/tested-sha-landing.md`,
  `scripts/ops/guard-queue.mjs`). `queue-guard.yml` restores the candidate on
  any stacked, replacing or deleting push that is not the promoter.
- `push-queue.mjs --wait` polls; while a candidate is live it rebases the
  lane's commits onto it, pushes the rebased head to `preflight/<lane>` for
  green evidence (`check`, `pack-smoke`, `e2e-gate`), and pushes to
  `queue/main` when the slot opens. A rebase changes the tree, so each rebase
  invalidates the previous preflight run and triggers a new full `ci` run.
- `promote.yml` fires on every completed `ci` run on `queue/**`, evaluates the
  head, and on green runs `git push <sha>:refs/heads/main`. The `green-main`
  ruleset requires the three check contexts green on the pushed SHA.
- `ci.yml` triggers on push to `main`, `queue/**`, `preflight/**` with
  per-SHA concurrency groups (`ci-push-<ref>-<sha>`) that never cancel — so
  every push head already gets its own independent `ci` run, in parallel.
- `rebuild-queue.mjs` already replays queue commits above a dropped SHA in a
  scratch worktree and force-pushes with `--force-with-lease` — the exact
  "rebuild followers after an eviction" primitive a train needs; today it is
  an operator tool.

## Measured in the last ~29h (verified, `gh run list` + run logs)

Window: 200 most recent `ci` runs, 2026-11-20T20:19Z → 2026-11-22T01:07Z.

| Metric | Value |
| --- | --- |
| `queue/main` candidates | 24, every completed run green |
| Candidate `ci` duration on queue head | p50 5.0m, p90 11.6m, max 19.8m |
| Docs-only `ci` run | ~0.9–1.1m (verified: queue run 23:43Z + its main run) |
| `preflight/<lane>` runs | 149 across 22 lanes; p50 11.1m, p90 18.3m, max 28.6m |
| Preflight runs per landing | 149 / 24 ≈ 6.2 |
| Heaviest lane | `notify-en`: 23 preflight runs, same commit title, ~1h wait |
| Landing-to-landing gap on main | median 9.5m, min 4.4m, max 21.5m |
| Candidate-run-end → main landing (promote latency) | median ~0.6m |
| `promote` push refusals | 8 × `GH013 … Required status check "check" is expected` — the check-runs API read green but the ruleset's view lagged; the run crashes instead of retrying, and landing waits for the next promote trigger (measured promote-latency outliers ~8–10m) |
| Burst 23:40–01:00Z | 8 distinct lanes, 32 preflight runs, ~6 landings |
| Commits landed on main in ~48h | 276, carrying ~133 distinct `Lane:` trailers |

The serial slot is therefore ~9.5m (median landing gap) and each waiting lane
pays ~1 rebase + ~1 full `ci` (~11m median) per slot it crosses. "Half the
lane's time waiting" is consistent with these numbers (inferred).

## Prior art

Every mature system converges on one shape: order the candidates, test each
position on the cumulative prefix (base + all earlier candidates), evict the
culprit on failure, rebuild the followers. They differ on how much is tested
per position, whether eviction is strict or tolerant, and whether the tested
SHA itself lands.

| System | N concurrent candidates | Speculative prefix testing | Failure eviction & follower rebuild | Batching / bisection | Tested tree == landed tree |
| --- | --- | --- | --- | --- | --- |
| GitLab merge trains | Yes — one pipeline per position, parallel limit default 20 (project setting, since 19.0) | Yes — merged-results pipeline for position N = target + MRs 1..N | Automatic: MR k dropped, followers' pipelines canceled and restarted on the new prefix; "merge immediately" restarts the whole train | No batching, no bisection (per-position pipelines give attribution instead) | Same tree, not same SHA for the default merge method (new merge commit); fast-forward/semi-linear land the validated ref exactly |
| GitHub merge queue | Yes — build concurrency (`max_entries_to_build`) 1–100 merge_group dispatches | Yes — `merge_group` branch for entry N = base + PRs ahead | Entry removed; every merge_group containing it is `destroyed` (`dequeued`/`invalidated`) and recreated without it | `min/max_entries_to_merge` batch *landings*, not builds; `grouping_strategy` ALLGREEN (every position commit must pass, per-PR attribution) vs HEADGREEN (only the group head must pass); no documented bisection | Yes — base fast-forwards to the tested `head_sha` |
| Zuul (dependent pipeline) | Yes — all queued items in parallel, bounded by a self-tuning window (default 20, +1 per merge, ÷2 per failure, floor 3) | Yes — core mechanism: item N's jobs run on target + items 1..N | Automatic: failing item dequeued, followers' builds discarded and re-speculated without it | No batching, no bisection (speculation instead); dependency cycles land/fail as a unit | Same content by construction (`project.merge-mode` must match the remote); the review system creates the landing commit — not the tested SHA |
| Bors-NG / homu | Effectively 1 running batch per repo | No — the waiting batch is not built until the running batch resolves | Failed PR evicted from the batch; a failed batch auto-bisects into halves, requeues each half (O(E·log N)); `is_single` extracted first | Batching is the model; bisection is the failure path | Yes, bitwise — `staging`/`auto` SHA fast-forwards to the base branch |
| Uber SubmitQueue | Yes — bounded by a CI build budget, allocated over ranked speculation paths | Beyond prefix: a speculation *tree* over outcome assumptions of conflicting changes (C3 built under "C1 lands, C2 rejected" etc.) | Assumptions resolve → losing paths refuted and canceled; survivors keep building; no full reset | Changes enter as land-batches; no bisection — the tree itself isolates the offender ("isolates the offending change and retries the rest") | Yes on the normal path; BLRD out-of-order landings guarantee target-hash equivalence instead of the exact tested commit |
| Shopify Shipit v2 | One cumulative "predictive branch"; CI on ~3 batches of queued PRs | Single hypothesized future state only | Eject after N *consecutive* CI failures (~3–4) — tolerant to flakes, slow on real breakage; reconciler rebuilds the branch | Batches = deploy granularity (8 PRs), not speculation units | Predictive branch replays the merge commits GitHub would create — content-equal (inferred; not stated bitwise) |
| Aviator MergeQueue | Yes — `max_parallel_builds` draft PRs in flight | Yes — draft PR N = PRs 1..N | Default is a cascading reset (culprit dequeued, all later drafts closed); `use_optimistic_validation` lets a later green draft stand in for an earlier failure | `batch_size` + `batch_max_wait_minutes`; failed batches requeued into bisected halves; `skip_line` never batched | Fast-forwarding mode fast-forwards base to the tested branch (exact SHA); default mode merges the original PR (tested tree as proxy) |
| Mergify merge queue | Yes — `merge_queue.max_parallel_checks` (default ~5) | Yes — batch PRs for cumulative groups run in parallel | Evicted PR leaves the queue; checks built on it canceled and restarted; `max_checks_retries` | Most documented bisection: failed batch splits into cumulative parts tested in parallel, parts ahead of the first failure merge, culprit isolated by elimination; `batch_max_failure_resolution_attempts` | `fast-forward` strategy lands the exact tested SHA (serial mode only); other strategies merge the original PRs |
| Graphite merge queue | Yes — parallel CI over a configurable number of stacks; unit is a *stack*, not a PR | Yes — `gtmq_` draft branches, cumulative per stack | Offending stack evicted atomically; groupings containing it canceled; followers regrouped fresh | Batching (private beta) with parallel-isolation or bisect strategies | Exact tested change lands for rebase/fast-forward strategies; PRs show `closed` not `merged` |
| Chromium commit queue (baseline) | Per-CL tryjobs, no queue-wide speculation | No — each CL rebased onto tip at build time | n/a | n/a | n/a; interesting failure triage: rerun failing suites *without* the patch to classify tip breakage vs patch-caused |

Non-PR availability: GitHub native, GitLab, Mergify, Aviator, Graphite and
Shipit are all PR-scoped — none accept a pushed commit as a queue entry
(verified across the docs above). Zuul needs Gerrit/GitHub review items. Only
Uber SubmitQueue is PR-optional (provider model; the `git` provider works on
branches) and only bors/homu's staging-SHA fast-forward is directly portable
to our no-PR flow — which is exactly what our tested-SHA promotion already
implements.

## Options for cairn, with expected waits

Constraints (verified): `main` accepts only commits whose `check`,
`pack-smoke`, `e2e-gate` contexts are already green (ruleset enforced at
push); standard runners are free and already run in parallel per pushed SHA;
docs-only `ci` ~1m, median candidate `ci` ~5m, e2e-tier runs ~12–20m; up to
~10 lanes; ownership grouped by `Lane:`/`Amp-Thread-ID:` trailers; no PR flow.

### A — Status quo: serial single candidate

Wait for a lane at queue depth k: ~k × 9.5m serial slots + ~5–12m own slot,
plus ~1 rebase + ~11m preflight per crossed slot — paid in wall-clock by the
agent and in redundant CI (measured: ~6.2 runs per landing, one lane 23).
Throughput capped at ~6 landings/hour under load (measured burst ≈ that).

Changes: none.

### B — Stacked candidates on `queue/main` (GitLab/Zuul train, no PRs) — recommended

Allow lanes to push their commits *on top of* the current queue chain in
arrival order. Every stacked push already triggers its own `ci` run on the
new head (per-SHA groups, verified in `ci.yml`), and that run tests the exact
tree that lands — position N's tree is main + candidates 1..N by
construction. `promote` lands the newest element of the contiguous green
prefix; landing the tip lands the whole verified prefix at once.

- Speculation: free. Position N's run IS the speculative test "as if 1..N-1
  landed" — identical to GitLab merged-results / GitHub merge_group / Zuul,
  but the tested object is a real pushed commit, so tested SHA == landed SHA
  bitwise (the bors property; stronger than GitLab's default merge method and
  Zuul's remote-created merge).
- Eviction: a red head drops tip-owner commits (existing `planDrop`). A red
  middle element evicts and `rebuild-queue.mjs` replay mechanics rebuild the
  suffix onto last-good (new SHAs → fresh runs). This is Zuul/GitLab
  follower-rebuild semantics with tooling we already have.
- Batching: implicit and free — the tip's green run batch-lands everything
  below. Per-commit attribution is preserved because each position had its
  own run (the ALLGREEN property); a HEADGREEN-style "land on tip green even
  if a middle run is red" stays available as a policy knob (Mergify exposes
  exactly this toggle).
- Ordering: arrival order = stack order; a push racing another gets a non-ff
  rejection → one rebase → retry. Bounded contention instead of a slot race.
- Expected wait (inferred from measured slot data): own `ci` (~5m median,
  ~12m p90) + ~0.6m per below-entry landing after it. 10 lanes pushing in a
  burst → all runs parallel, last lands ~15–20m vs ~95m serial today. Runs
  per landing ≈ 1 (+rebuilds on eviction) vs ~6.2 today. Rebases per lane ≈
  1 (push-race retries) vs ~1 per crossed slot.
- Cost accepted: an unverified candidate can evict mid-chain and force a
  suffix rebuild (~1 extra run per follower). Mitigations: keep the
  rerun-once policy, keep optional `preflight/<lane>` for lane confidence.
- Risk worth naming: under stacking, position N's green includes the commits
  below it — if a below element is red, promoting the tip would land a
  red-in-isolation commit inside a green tree. The recommendation is the
  strict rule (land only the contiguous green prefix; evict leftmost red
  element) matching Zuul/GitLab; the permissive HEADGREEN variant is a
  documented knob, not the default.

Changes: `scripts/ops/guard-queue.mjs` + `.github/workflows/queue-guard.yml`
(allow stacked fast-forward pushes; keep refusing replace/recreate/delete —
the ref becomes append-only); `scripts/ops/push-queue.mjs` (`--wait` becomes
enqueue: rebase onto chain tip and push, retry only on non-ff races; the
green-evidence gate on entry becomes advisory since the queue-head run is
itself the test — preflight stays for lane-side confidence);
`scripts/ops/promote-queue.mjs` (evaluate the chain's contiguous green prefix
instead of head-only; on a red middle element, drop it and trigger the
rebuild path); `scripts/ops/rebuild-queue.mjs` (replay logic moves from
operator tool to promote-called eviction path); `guard-queue.test.mjs`,
`push-queue.test.mjs`, `promote-queue.test.mjs` (semantics flip);
`docs/design/tested-sha-landing.md` + `AGENTS.md` ship steps (the
one-candidate pilot section is superseded). `ci.yml`, the `green-main`
ruleset and `queue-state/main`'s reachability role are unchanged.

### C — Bounded retry of the promote push (GH013 race) — recommended regardless

The `green-main` ruleset's view of check state lags the check-runs API the
promoter reads; measured 8 refusals in ~29h, each adding ~10–25m because the
run crashes instead of retrying. Bors-NG hit the identical GitHub behavior
and shipped `push_with_retry` (9 attempts, exponential). Add a bounded
retry/backoff around `git push <sha>:main` in `promote-queue.mjs`, or verify
against the same check-status endpoint the ruleset consumes. ~10 lines, one
script plus its test; orthogonal to every other option.

### D — Outcome-tree speculation (Uber SubmitQueue)

Speculating over "candidate k fails" branches in advance would cut rebuild
cost under high failure rates. Our measured queue-head red rate in the window
is ~0% (24/24 green after one rerun); the full tree machinery (conflict
analysis, build-budget allocator, refutation) is not justified at this scale
and failure profile. Revisit if eviction rebuilds become hot or e2e-tier runs
dominate the slot time.

### E — Vendor/native merge queue (GitHub merge queue, Mergify, Aviator, Graphite)

All require PR-based entry; adopting one means adopting PR flow for zero
semantic gain — our SHA-promotion already reproduces their tested-tree-lands
property bitwise. Rejected (same conclusion as
`docs/research/2026-11-18-green-main-landing.md`).

## Recommendation

B + C. B turns `queue/main` into the GitLab/Zuul-style train the mechanism was
already shaped like before the one-candidate pilot — stacking was removed
because stacked pushes canceled each other's runs (fixed since by per-SHA
groups) and a red head could only be removed by hand (fixed since by
`promote --enforce` + `rebuild-queue.mjs`). The pilot's blockers are gone;
what remains is the serialization tax measured above. C is a small
independent fix for the measured GH013 race and should ship first or
together. A stacked queue also deletes the `push-queue --wait`
rebase-and-repreflight loop that produced 149 preflight runs for 24 landings.

## Sources

Read first-hand this session (three research agents fetched; I verified the
mechanism-level claims against the reports and repo behavior):

**GitLab** — READ
- https://docs.gitlab.com/ci/pipelines/merge_trains/
- https://docs.gitlab.com/ci/pipelines/merged_results_pipelines/
- https://docs.gitlab.com/api/merge_trains/
- https://gitlab.com/gitlab-org/gitlab/-/work_items/207187 (tested ref vs landed SHA; ff/semi-linear exception)
- https://gitlab.com/gitlab-org/gitlab/-/work_items/14863 (merged-result ref overwrite race)

**GitHub** — READ
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
- https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#merge_group
- https://docs.github.com/en/webhooks/webhook-events-and-payloads?actionType=checks_requested#merge_group
- https://docs.github.com/public/fpt/schema.docs.graphql (MergeQueue*, ALLGREEN/HEADGREEN, solo/jump)
- https://docs.github.com/en/rest/repos/rules (merge_queue ruleset params)
- https://github.blog/changelog/2021-10-27-pull-request-merge-queue-limited-beta/ (base fast-forwards to tested head)
- https://github.blog/engineering/engineering-principles/how-github-uses-merge-queue-to-ship-hundreds-of-changes-every-day/

**Zuul** — READ
- https://zuul-ci.org/docs/zuul/discussion/gating.html
- https://zuul-ci.org/docs/zuul/discussion/concepts.html
- https://zuul-ci.org/docs/zuul/config/pipeline.html (window 20/floor 3, +1/÷2, dequeue-on-new-patchset)
- https://zuul-ci.org/docs/zuul/config/project.html (merge-mode matching caveat)
- https://zuul-ci.org/docs/zuul/config/queue.html
- https://zuul-ci.org/docs/zuul/drivers/github.html

**Bors lineage** — READ
- https://bors.tech/documentation/ and /documentation/getting-started/
- https://raw.githubusercontent.com/bors-ng/bors-ng/master/README.md (staging fast-forward "bit-for-bit", O(E·log N))
- https://raw.githubusercontent.com/bors-ng/bors-ng/master/lib/worker/batcher.ex (`push_with_retry`, staging.tmp, clone_batch on non-ff)
- https://raw.githubusercontent.com/bors-ng/bors-ng/master/lib/worker/batcher/divider.ex (bisection, is_single)
- https://github.com/rust-lang/homu + homu/main.py + homu/server.py (serial auto-branch, fast-forward to merge_sha, rollup)
- https://web.archive.org/web/2023/https://graydon.livejournal.com/186550.html ("Not Rocket Science" essay; livejournal URL 404s today)

**Uber SubmitQueue** — READ
- https://www.uber.com/us/en/blog/slashing-ci-costs-at-uber/
- https://www.uber.com/us/en/blog/bypassing-large-diffs-in-submitqueue/
- https://github.com/uber/submitqueue/ + https://uber.github.io/submitqueue/
- https://uber.github.io/submitqueue/rfc/submitqueue/speculation/ and .../workflow/
- FOUND-NOT-READ: EuroSys'19 paper (paywalled), original 2019 research post (404; abstract via web.archive.org)

**Shopify** — READ
- https://shopify.engineering/successfully-merging-work-1000-developers
- https://github.com/Shopify/shipit-engine (v1 knobs; v2 predictive-branch machinery is internal)

**Aviator** — READ
- https://docs.aviator.co/mergequeue/concepts/parallel-mode
- https://docs.aviator.co/mergequeue/concepts/fast-forwarding
- https://docs.aviator.co/mergequeue/concepts/batching
- https://docs.aviator.co/mergequeue/configuration-file
- https://docs.aviator.co/mergequeue/concepts/managing-flaky-tests-in-mergequeue

**Mergify** — READ
- https://docs.mergify.com/merge-queue/performance/
- https://docs.mergify.com/merge-queue/batches/ and .../batches/failures
- https://docs.mergify.com/merge-queue/merge-strategies
- https://docs.mergify.com/merge-queue/two-step

**Graphite** — READ
- https://graphite.com/docs/merge-queue-optimizations
- https://graphite.com/docs/graphite-merge-queue

**Baseline** — READ
- https://chromium.googlesource.com/chromium/src/+/HEAD/docs/infra/cq.md

**Cairn mechanism (this repo)** — verified first-hand: `scripts/ops/push-queue.mjs`,
`scripts/ops/promote-queue.mjs`, `scripts/ops/guard-queue.mjs`,
`scripts/ops/rebuild-queue.mjs`, `scripts/ops/preflight.mjs`,
`.github/workflows/ci.yml`, `.github/workflows/promote.yml`,
`.github/workflows/queue-guard.yml`, `docs/design/tested-sha-landing.md`,
plus `gh run list`/`gh run view` logs and `git log` for the numbers above.
