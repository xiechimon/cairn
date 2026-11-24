# Merge train and batch landing for `queue/main`: primary-source research and concrete design

Date: 2026-11-24
Base commit inspected: `bb12a7008` (`origin/main`)
Scope: Research only — no edits to `scripts/ops/**`, `.github/workflows/**`, or `AGENTS.md`.
Epistemic tags: `[Measured]` (read or measured first-hand in this session from repo source, live GitHub Actions data, or official primary docs/repos), `[Inferred]` (derived logically from `[Measured]` facts and verifiable), `[Guessed]` (unconfirmed).

---

## 0. Who Meets This Change and What Changes for Them

An engineer or agent who joins Cairn today learns one rule from `AGENTS.md`: never push to `main`; run `node scripts/ops/preflight.mjs --wait` and then `node scripts/ops/push-queue.mjs --wait` to land through `queue/main` `[Measured]`. Today, when ~10 agent lanes finish per hour and `eval`-touching changes take ~30 minutes per CI run, a lane spends hours looping on `push-queue --wait` — rebasing onto every slot occupant, firing redundant `preflight/*` CI runs (measured **12.1 preflight runs per landing** on 2026-11-24), and paying a **second identical 30-minute CI run** on `queue/main` even after `preflight` already went green on the exact same commit SHA `[Measured]`.

- **What an agent or contributor must know**: only one handoff command (`enqueue`) after committing and rebasing onto `origin/main`; no accounts, payments, or new keys are requested (the existing GitHub repo login pushes a `ready/<lane>` ref, and the existing `cairn-release` GitHub App token in Actions already operates `queue/main` and `main`) `[Measured]`.
- **Where state lives**: purely in Git refs (`refs/heads/ready/<lane>`, `refs/heads/queue/*`, `refs/heads/queue-state/main`) and GitHub commit comments / workflow runs — zero external queue database or SaaS subscription `[Inferred]`.
- **Owner-only actions**: none exposed to end users; only repo maintainers deploy workflow edits in `.github/workflows/` and configure `EVAL_ENABLED` / `EVAL_MAX_DEVIN_RUNS` `[Measured]`.

### Scenario table (recommended conductor-assembled train vs. today)

| Situation an agent or operator meets | What happens today (`queue/main` serial slot) | What happens with the recommended train | Expected wait & CI cost |
| --- | --- | --- | --- |
| 1. Single fast (non-`eval`) lane finishes while queue is idle | Runs `preflight --wait` (~6m), pushes `queue/main`, runs full CI **again** (~6m), then promotes (~13m total) `[Measured]` | Lane pushes `ready/<lane>` and exits immediately (or, if it already ran green `preflight` directly on `origin/main`, conductor fast-forwards immediately without a 2nd CI run) `[Inferred]` | **~6–7m** wall-clock, **1** CI run (`0` extra if preflight already green on `origin/main`) `[Inferred]` |
| 2. Burst of 10 non-`eval` lanes finishes within an hour | All 10 loop in `push-queue --wait`, rebase after each slot, burn ~60–120 preflight runs, queue for 1–3+ hours `[Measured]` | Each lane pushes `ready/<lane>` once and exits; conductor groups waiting lanes into opportunistic batches (size 2–4, up to 2–3 speculative positions) `[Inferred]` | **~8–15m** to land, **~0.3–0.5** CI runs per lane, **0** agent polling loops `[Inferred]` |
| 3. One `eval`-touching lane (~30m) arrives alongside 5 fast UI/test lanes (~6m) | Manual `train-3` stacked them together, dragging all 6 commits through 32.5m `preflight` + 30.9m `queue/main` = **63.4m** `[Measured]` | Conductor partitions non-`eval` lanes into a fast batch that lands in ~6m ahead of the `eval` batch; `eval` lanes batch together with an anti-starvation ceiling (~20m / 2 fast batches) `[Inferred]` | Fast lanes: **~6–8m**; `eval` lanes: **~30m** (1× CI, never 2×) `[Inferred]` |
| 4. One lane in a batch has a merge conflict against earlier lanes | Manual cherry-picking skipped it by hand; in `push-queue --wait` the lane aborts locally `[Measured]` | Conductor tries each `ready/<lane>` atomically in a scratch worktree; conflicting lane is skipped, its `ready/<lane>` ref is deleted, a commit comment names the conflicting tip, and non-conflicting lanes keep moving `[Inferred]` | Non-conflicting lanes: **0m** delay; conflicting lane: notified within ~1m `[Inferred]` |
| 5. One lane in a 4-lane batch breaks `check-core` or a test | `train-1` failed `check-core` at 1.7m, still burned **29.7m** on `eval` before failing at 30.9m; operator rebuilt `train-3` by hand; `train-3` clobbered all `Lane:` trailers with `train-3` `[Measured]` | `eval` cancels/skips fast when `check-core` fails; conductor reruns failed jobs once, checks optimistic successor, then binary-bisects by preserved `Lane:`/`Amp-Thread-ID:` group (`O(log M)`), landing the 3 healthy lanes and commenting only on the broken lane `[Inferred]` | Culprit isolated in **~2 rounds (~12m non-eval)**; healthy lanes land without manual rebuild `[Inferred]` |
| 6. Transient CI flake hits batch `A` while speculative batch `A+B` is running | Rerun failed jobs once (+6–30m); if rerun also flakes, entire candidate dropped `[Measured]` | Rerun failed jobs once; simultaneously, if speculative successor `A+B` finishes green (`pending_failure_depth = 1`), conductor fast-forwards `main` straight to `A+B` (exact tested SHA == landed SHA) `[Inferred]` | **0** evictions and **0** suffix rebuilds on single-run flakes `[Inferred]` |

---

## 1. Evidence Boundary, Continuity with 2026-11-22, and Blocked Sources

### Relationship to `docs/research/2026-11-22-merge-train.md`

An earlier research note ([docs/research/2026-11-22-merge-train.md](2026-11-22-merge-train.md)) evaluated serial `queue/main` on 2026-11-22 and recommended **Option B (per-lane stacked candidates on `queue/main`) + Option C (GH013 backoff retry)** `[Measured]`. Three material facts changed between 2026-11-22 and 2026-11-24:

1. **Option C is already shipped**: `scripts/ops/promote-queue.mjs:276-328` now implements `pushToMain` with 8-attempt exponential backoff (10s to 120s) on `GH013` check-lag refusals `[Measured]`.
2. **The 30-minute `eval` gate changed the CI latency distribution**: On 2026-11-22, candidate `queue/main` CI had p50 5.0m, p90 11.6m, max 19.8m `[Measured]`. On 2026-11-24, `eval` (`.github/workflows/ci.yml:599-699`) runs sequential baseline + candidate Devin CLI arms taking **~29.5–29.7m** on every `queue/*` and `preflight/*` diff touching coordinator/routing/eval paths (`ci.yml:72`), pushing p90 preflight latency to **31.0m** (max **34.4m**) and turning `preflight` + `queue/main` into **63.4m** wall-clock for one `eval`-touching batch `[Measured]`.
3. **Pure per-lane stacking without batching or `eval` separation breaks down under `eval` contagion**: Because `ci.yml:55-56` computes `base_ref = git merge-base origin/main HEAD`, stacking 5 fast non-`eval` lanes *on top of* 1 `eval` lane causes **all 6** cumulative stack positions to run the 30-minute `eval` job in parallel (burning `6 ×` Devin CLI eval quota and holding all 5 fast lanes for 30+ minutes) `[Measured/Inferred]`. Meanwhile, the operator began hand-assembling `train-1`, `train-3`, and `train-5` branches to batch lanes into one preflight `[Measured]`.

This note expands the prior art from 10 to all **12** requested systems (adding **Trunk Merge Queue** and **Bazel / Google TAP**, plus updated 2025–2026 primary sources for **Uber SubmitQueue** ICSE '25 and open-source Go rewrite, **Mergify** scopes/capacities, **Aviator** fast-forwarding + flaky test management, and **Chromium LUCI CV**), measures today's failure modes first-hand, and produces a concrete script/workflow design.

### Blocked primary sources (explicit report)

1. **Uber SubmitQueue EuroSys '19 full PDF** — Ananthanarayanan et al., *"Keeping Master Green at Scale"*, EuroSys '19 (`DOI: 10.1145/3302424.3303970`): `BLOCKED: HTTP 403 Cloudflare anti-bot challenge (cf-mitigated: challenge)` on both `dl.acm.org` and `researchgate.net` `[Measured]`. **Mitigation (no bypass)**: read official Semantic Scholar abstract/metadata, Uber's open-access ICSE '25 follow-up paper (`arXiv:2501.03440v2`, 11 pages in full, which directly recaps EuroSys '19's speculation-tree design), two Uber Engineering posts, and Uber's live open-source Go repo `uber/submitqueue` at `d477ef53` `[Measured]`.
2. **Google TAP ICSE-SEIP '17 full PDF** — Memon et al., *"Taming Google-Scale Continuous Testing"*, ICSE-SEIP '17 (`DOI: 10.1109/ICSE-SEIP.2017.16`): `BLOCKED: IEEE Xplore paywall; Google Research archive PDF returned HTTP 404; Semantic Scholar returned HTTP 429` `[Measured]`. **Mitigation (no bypass)**: read the official publication abstract on `research.google`, *Software Engineering at Google* Chapter 23 + Aside 3 ("TAP: Google's Global Continuous Build" by Adam Bender), Bazel Query `rdeps`/`allrdeps` official docs, and Google Testing Blog (2011, 2016, 2017) `[Measured]`.

---

## 2. Measured Cairn Baseline Today (2026-11-24)

### 2.1 Current repo mechanics (`scripts/ops/**` and `.github/workflows/**`)

Verified first-hand from repository source `[Measured]`:

- **Single-candidate enforcement**: `scripts/ops/guard-queue.mjs:15-21` and `.github/workflows/queue-guard.yml` allow only `cairn-release[bot]` (`PROMOTER`) to alter or delete `queue/main` while a live candidate exists (tracked in `refs/heads/queue-state/main`). Any stacked, replacing, or deleting push by a user/agent is undone, commented, and its `ci` run cancelled (`guard-queue.mjs:135-176`) `[Measured]`.
- **Per-SHA non-cancelling CI**: `.github/workflows/ci.yml:9-11` uses concurrency group `ci-push-${{ github.ref }}-${{ github.sha }}` with `cancel-in-progress: false` for all pushes on `main`, `queue/**`, and `preflight/**` `[Measured]`.
- **Identical `ci.yml` classification on `preflight/*` and `queue/*`**: `ci.yml:55-56`, `ci.yml:110-115`, and `ci.yml:601-604` treat `refs/heads/preflight/*` and `refs/heads/queue/*` identically — both diff `git merge-base origin/main HEAD..HEAD`, both run `eval` when `eval-needed == 'true' && vars.EVAL_ENABLED == 'true'`, and both enforce the identical `check`, `pack-smoke`, and `e2e-gate` contexts `[Measured]`.
- **Entry gate & polling loop**: `scripts/ops/push-queue.mjs:43-50, 152-240` loops in `--wait` mode (polling every `PUSH_QUEUE_POLL_SECONDS`, default 60s, up to 120m): whenever a live candidate occupies `queue/main`, the waiting lane rebases onto that live SHA and pushes to `refs/heads/preflight/<lane>` to trigger a full `ci` run; if that candidate is dropped, it rebases back to `origin/main` and preflights again. Before pushing `queue/main`, lines 251–264 stamp any commit lacking `Amp-Thread-ID:` or `Lane:` with `Lane: <host>/<worktree>` and require green `check`, `pack-smoke`, `e2e-gate` on the same git tree (`preflightEvidence`) `[Measured]`.
- **Promotion & drop rules**: `scripts/ops/promote-queue.mjs:53-93` triggers via `.github/workflows/promote.yml` on `workflow_run` (`workflows: [ci], types: [completed], branches: ['queue/**']`, serialized in `concurrency: group: promote-main, cancel-in-progress: false`). It requires a completed `ci` run with **`r.head_branch.startsWith('queue/')`** (`promote-queue.mjs:54`), retries failed jobs once (`rerun-failed-jobs`) before dropping (`promote-queue.mjs:58-76`), drops consecutive tip commits sharing the same `ownerOf(body)` key (`planDrop`, lines 25–34), fast-forwards `main` with 8-attempt `GH013` retry (`pushToMain`, lines 276–328), and closes `Closes #N` issues via API (`closeLandedIssues`, lines 137–160) `[Measured]`.
- **Manual mid-chain rebuild**: `scripts/ops/rebuild-queue.mjs:47-62` already replays commits above a dropped SHA in a scratch worktree (`git worktree add --detach` + `git rebase --onto <dropSha>^ <dropSha>`) and force-pushes with `--force-with-lease` `[Measured]`.

### 2.2 Live GitHub Actions measurements (last 100 `ci` runs, `2026-11-24T03:52Z → 09:22Z`, 5.5 hours)

Measured directly via `gh run list` and `gh api repos/xiechimon/cairn/actions/runs/<id>/jobs` `[Measured]`:

| Metric (5.5-hour window, 100 `ci` runs) | Measured value |
| --- | --- |
| `preflight/*` runs | **85** across **29 distinct lane refs** (55 success, 19 failure, 1 cancelled, 10 in-progress/queued); completed duration: min 1.7m, **p50 8.4m**, **p90 31.0m**, max **34.4m** `[Measured]` |
| `queue/main` runs | **7** (7/7 success); duration: min 1.1m (docs), **p50 6.1m**, p90 6.8m, **max 30.9m** (`train-3`) `[Measured]` |
| `main` post-land runs (`eval` skipped on `main`) | **8** (8/8 success); duration: min 1.0m, **p50 6.8m**, p90 7.9m, max **8.0m** `[Measured]` |
| Preflight runs per `queue/main` landing | **85 / 7 = 12.1×** (up from 6.2× on 2026-11-22) `[Measured]` |
| Inter-run gaps on `queue/main` | `9.7m, 8.3m, 10.2m, 39.6m, 23.8m, 176.9m` (nearly **3 hours** between `a2a816bd7` at 05:46Z and `bb12a7008` at 08:43Z during manual train assembly + `eval` runs) `[Measured]` |

### 2.3 Four concrete bottlenecks exposed by today's manual `train-1` / `train-3` / `train-5` runs

1. **Defect #1 — 2× identical CI tax (`preflight` → `queue/main` on the exact same SHA)**:
   - `train-3` (`bb12a7008`, 6 commits) passed `preflight/xmonsMac-3574.local/train-3` (run `45353705974`) in **32.5m** (`08:09:40Z → 08:42:13Z`; `e2e-gate` done at `08:19:03Z`, `eval` `08:12:29Z → 08:42:09Z` = **29.7m**) `[Measured]`.
   - One minute later, pushing **that exact same SHA `bb12a7008`** to `queue/main` triggered run `45358556450` (`08:43:04Z → 09:14:00Z`, **30.9m**, `eval` `08:43:35Z → 09:13:03Z` = **29.5m**) solely because `promote-queue.mjs:54` requires `r.head_branch.startsWith('queue/')` and `ci.yml:6` triggers fresh on `queue/**` `[Measured]`.
   - Total wall-clock to land `bb12a7008` once green: **63.4 minutes** (and 2× Devin CLI eval cost) for **one identical commit** `[Measured]`.
2. **Defect #2 — 30-minute `eval` contagion + zero fail-fast cancellation**:
   - In `train-3`, 3 of 6 commits (`439606238`, `b5f0a763c`, `bb12a7008`) touched **zero** `eval`-triggering files (`ci.yml:72`), yet waited 63.4m because they shared a stack with 3 commits touching `dispatch-eligibility.ts`, `machine-routing.ts`, and `coordinator-steps.ts` `[Measured]`.
   - In `train-1` (`77922e38b`, run `45350393987`), `check-core` failed in **1.7m** (`07:45:22Z → 07:47:01Z`) and `vitest-light (2)` failed in **4.0m** (`07:45:22Z → 07:49:20Z`), yet `eval` ran to completion for **29.7m** (`07:45:23Z → 08:15:02Z`) and `check` only finished at **30.9m** (`08:15:51Z`) because `eval` declares `needs: changes` (not `needs: [changes, check-core]`) and does not cancel on fast-job failure `[Measured]`.
3. **Defect #3 — `push-queue --wait` preflight storm (12.1 runs/landing)**:
   - With 29 active lane branches and one serial slot, waiting lanes rebase and re-preflight repeatedly while waiting for `queue/main` to clear, flooding GitHub Actions and stalling agent sessions `[Measured]`.
4. **Defect #4 — Manual cherry-pick trains destroy owner trailers and break `planDrop`**:
   - On `origin/main` (`88c33945c..bb12a7008`), all 6 commits in `train-3` were stamped by `push-queue.mjs:251-264` with the single trailer `Lane: xmonsMac-3574.local/train-3` `[Measured]`.
   - On `refs/heads/train-5` (`8ceace280..9fe12cedd`), all 6 cherry-picked commits carry **no** `Lane:` or `Amp-Thread-ID:` trailer (only the tip manual fixup `9fe12cedd` carries `Lane: xmonsMac-3574.local/train-5`) `[Measured]`.
   - Because `planDrop` (`promote-queue.mjs:25-34`) groups consecutive tip commits by identical `ownerOf(body)` key, clobbering every commit in a train with `train-N` destroys per-lane attribution — forcing all-or-nothing eviction instead of bisecting or dropping the single offending lane `[Measured/Inferred]`.

---

## 3. Prior Art Comparison (12 Industry Systems + Cairn Today)

### 3.1 Master comparison table

*(Cairn today appears as row 13 for side-by-side comparison; every cell carries its primary evidence tag.)*

| # | System | Entry unit | Concurrency / speculation | Batching & max group size | Failure attribution, bisection & follower rebuild | Flaky test handling | Tested SHA == landed SHA? | Non-PR / push usability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **GitHub Merge Queue** | PRs only `[Measured]` | Linear speculative `merge_group` branches; `max_entries_to_build` 1–100 (API 0–100) `[Measured]` | **No build batching**; `min`/`max_entries_to_merge` (0–100) batch *merges* only `[Measured]` | **No bisection**; evicts failing PR, destroys (`invalidated`) & rebuilds follower `merge_group`s `[Measured]` | `grouping_strategy: HEADGREEN` lets later green group merge earlier red PR; no auto-retry `[Measured]` | **No** (only `MERGE`/`SQUASH`/`REBASE`; no fast-forward method; synthetic `gh-readonly-queue/*` commits) `[Measured/Inferred]` | **No** (PR-only, org/Enterprise) `[Measured]` |
| 2 | **GitLab Merge Trains** | MRs only `[Measured]` | Linear cumulative speculative train, default max **20** parallel pipelines `[Measured]` | **None** (1 pipeline per MR) `[Measured]` | **No bisection**; drops failing MR, auto-cancels & restarts downstream pipelines `[Measured]` | Cannot retry failed train pipeline; relies on `.gitlab-ci.yml` job `retry:` `[Measured]` | **Only with fast-forward merge** (`--ff-only`); merge/semi-linear adds merge commit `[Measured/Inferred]` | **No** (MR-only, Premium/Ultimate) `[Measured]` |
| 3 | **Bors-NG** (`homu` lineage) | GitHub PRs (`bors r+`) `[Measured]` | **None** (strictly 1 `:running` batch/project; priority preempts via `put_incomplete_on_hold`) `[Measured]` | **Yes** — greedy batch up to `max_batch_size` (default unbounded), `is_single` opt-out `[Measured]` | **Binary half-split bisection** (`div(N,2)`, `O(E log N)`), plus conflict-first isolation (`split_batch_with_conflicts`) `[Measured]` | No automatic retry/skip (manual `bors retry`; `timeout_sec` default 3600s) `[Measured]` | **Yes — bit-for-bit fast-forward** from `staging` via `push_with_retry` (9× backoff) in merge & squash modes `[Measured]` | **No** (GitHub PR webhooks/comments; staging algorithm directly portable) `[Measured]` |
| 4 | **Mergify** | GitHub PRs & stacks `[Measured]` | `serial` (linear speculative, `max_parallel_checks` default 5), `parallel` (DAG via `scopes` + per-scope `capacities` + `barrier_files`), `isolated` `[Measured]` | **Yes** — `batch_size` 1–128 (or `{min, max}`), `batch_max_wait_time` (default 30s) `[Measured]` | **N-way parallel cumulative split** (`N=2→1,3,7,15`; `N=3→1,4,13`); last PR eliminated by deduction without retesting; `batch_max_failure_resolution_attempts`; optional Fail First `[Measured]` | `max_checks_retries` (default 0), `skip_intermediate_results: true`, `checks_timeout: auto` (7d P95) `[Measured]` | **Yes ONLY in `fast-forward` (`serial` mode only!)** or `merge-batch`; **No** in `parallel`/squash/merge/rebase `[Measured]` | **No** (GitHub PRs only) `[Measured]` |
| 5 | **Graphite MQ** | **Stack-atomic** PRs `[Measured]` | Parallel CI speculative draft PRs (`gtmq_*`), configurable concurrency `[Measured]` | **Yes** (private beta) — groups of stacks; max size undocumented `[Measured]` | Offending stack evicted atomically; batched mode offers **full parallel isolation** (default) or **binary bisection** `[Measured]` | No optimistic skip; docs warn flakes invalidate followers & advise lower concurrency `[Measured]` | **Yes** with Fast-Forward Merge (marks original PRs closed, not merged) `[Measured]` | **No** (GitHub PRs + `graphite-app`) `[Measured]` |
| 6 | **Trunk MQ** | GitHub PRs / stacks `[Measured]` | Predictive Testing (5/25/50/custom concurrency) + **Direct Merge to Main** + **Parallel Queues** via `impactedTargets` (`"ALL"` barrier) `[Measured]` | **Yes** — `Target batch size` (rec. 4) + `Max wait time` (rec. 5m; `0`=opportunistic), `--no-batch` `[Measured]` | **Binary half-split** with separate **Bisection Concurrency** (`2–5×` main) + `bisectionSkipRedundantTests` memoization `[Measured]` | **`pending_failure_depth`** (≥1) + **Optimistic Merging** (downstream green clears upstream flake, incl. newly arriving PRs) `[Measured]` | **No** (squash/merge/rebase; PRs always merged individually one-by-one) `[Measured]` | **Partial CI only** (`trunk-merge/*` push trigger); **No** for enqueue `[Measured]` |
| 7 | **Aviator MQ** | GitHub PRs / Changesets `[Measured]` | Parallel Mode (`max_parallel_builds`, `max_topup_builds`) + **Affected Targets** multi-queue (up to 1M targets) `[Measured]` | **Yes** — `batch_size` (default 1), `batch_max_wait_minutes` (default 0), `batch_wait_when_idle` `[Measured]` | **Binary split** on batch failure (1–5 → 1–3, 4–5), immediate requeue; follower drafts reset `[Measured]` | 3 layers: `use_optimistic_validation` + `failure_depth`, `max_requeue_attempts`, beta **Flaky Test Mgmt** (overlap + cross-batch fingerprint + LLM single-job rerun) `[Measured]` | **Yes** with `use_fast_forwarding: true` (`mq-tmp-*` → GitHub Refs API `force: false`); **No** otherwise `[Measured]` | **No** (GitHub PRs only) `[Measured]` |
| 8 | **Zuul** | Gerrit CLs, GitHub PRs, GitLab MRs `[Measured]` | Dependent pipeline linear speculative git state + **AIMD dynamic window** (default 20, floor 3, +1 merge / ÷2 failure); cross-repo `Depends-On` `[Measured]` | **None** (1 queue item per change) `[Measured]` | **No bisection**; evicts failing change, resets & retests suffix `[Measured]` | `disable-after-consecutive-failures` circuit breaker + job `attempts` `[Measured/Inferred]` | **Content equivalent, SHA usually differs** (Zuul builds speculative git state; forge API executes merge) `[Measured/Inferred]` | **Limited** (`git` driver is `ref-updated` trigger-only, no merge reporter) `[Measured]` |
| 9 | **Chromium CQ (LUCI CV)** | Gerrit CLs (opt-in `CQ-Depend:` stacks) `[Measured]` | **No merge train / no cross-CL speculation**; parallel per-CL tryjobs on ToT + build reuse (`1300` commits) + `submit_options` burst throttle (`max_burst: 2/60s`) `[Measured]` | **None** in presubmit `[Measured]` | Mid-air collisions caught **postsubmit** by Gardeners + **Tree Closers** (`TreeStatus`) + **LUCI Bisection** culprit finder/auto-revert `[Measured]` | Recipe **`(with patch)` → `(retry shards)` → `(without patch)`** on clean ToT + CV weighted `retry_config` (`single: 1, global: 2`) `[Measured]` | **No** (tests CL on build-start ToT; submits onto newer ToT) `[Measured]` | **No** (Gerrit-native) `[Measured]` |
| 10 | **Uber SubmitQueue** | Universal **Change URI**: `github://`, `phab://`, **`git://{host}/{repo}/{ref}/{sha}`** `[Measured]` | **Probabilistic binary speculation tree** (branches on pass AND fail) + `Tango` conflict graph + **BLRD** out-of-order landing + NGBoost build-time & `P_needed` pruning `[Measured]` | Production ICSE '25: **None** (Future Work); 2026 OSS Go rewrite: `Batch` (1+ requests) core entity `[Measured]` | Speculation tree already runs `¬A` bypass branch (avoids full reset); BLRD early-rejects when all paths fail; no OSS bisection RFC yet `[Measured]` | Logit-linear `evidence` outcome scorer tracks per-path pass/fail probabilities; non-blocking tree routes around flakes `[Measured]` | **Yes** with Runway `PROMOTE = 4` (`--ff-only`); **No** for `REBASE`/`SQUASH_REBASE`/`MERGE` `[Measured]` | **YES — native `git://` provider** (reads bare git refs/SHAs, promotes via `--ff-only`) `[Measured]` |
| 11 | **Shopify MQ / Shipit v2** | GitHub PRs (`/shipit`) `[Measured]` | Single **predictive branch** maintained by stateless GraphQL Virtual-DOM reconciler; **3 batches (24 PRs)** running CI concurrently `[Measured]` | **Yes** — deploy batches of **8 PRs** (CI per commit on predictive branch) `[Measured]` | Evicts first failing commit once failure propagates to **4th consecutive** commit; reconciler rebuilds suffix `[Measured]` | **Consecutive failure threshold = 3** (ejection on 4th → 0.39% FP at 25% flake rate) `[Measured]` | **No / Unverified** (v1 OSS `shipit-engine` uses `merge_pull_request`; v2 uses merge commits + 8-PR batches) `[Measured/Inferred]` | **No** (GitHub PRs only; stateless reconciler pattern is portable) `[Measured]` |
| 12 | **Bazel / Google TAP & Critique** | Piper CLs in Critique (`>50k`/day) `[Measured]` | **No blocking merge train**; fast hermetic presubmit (~11m) → optimistic submit to `true head` → async postsubmit **TAP** via global `rdeps`/`allrdeps` → `green head` `[Measured]` | **Postsubmit batching** in TAP (when >1 CL/sec arrives) `[Measured]` | TAP auto-splits failing postsubmit batch into isolated CLs + binary culprit search + Build Cop / **TAP automated rollback** `[Measured]` | 3× rerun flag, statistical flake classifier, auto-quarantine + bug, flakiness-change culprit detector `[Measured]` | **No** for presubmit; **Yes** for `true head` → `green head` certified revision pointer `[Measured/Inferred]` | **Conceptually push/commit-stream based**, tied to Piper/Blaze/Forge `[Measured/Inferred]` |
| 13 | **Cairn today (`queue/main`)** | Raw Git commits via `push-queue.mjs` (`Lane:` / `Amp-Thread-ID:` trailers) `[Measured]` | **None** (1 candidate at a time, enforced by `queue-guard.yml` + `queue-state/main`) `[Measured]` | **Manual only** (operator cherry-picks `train-1`/`train-3`/`train-5` by hand) `[Measured]` | `planDrop` drops tip-owner commits after 1 rerun; `rebuild-queue.mjs` is manual operator tool; **no bisection** `[Measured]` | `rerun-failed-jobs` once (`promote-queue.mjs:63-75`); no optimistic skip `[Measured]` | **Yes — bit-for-bit `--ff-only`** (`green-main` ruleset enforces required check runs on exact SHA) `[Measured]` | **Yes — 100% push-based, non-PR** `[Measured]` |

### 3.2 High-signal transferable mechanisms from primary sources

1. **Exact tested-SHA (`--ff-only`) eliminates 7 of 12 forge queues — and explains Mergify's `serial`-only constraint** `[Measured/Inferred]`:
   - Cairn's `green-main` ruleset verifies `check`, `pack-smoke`, and `e2e-gate` on the exact commit SHA pushed to `main` (`docs/design/tested-sha-landing.md:259-263`) `[Measured]`.
   - Only **5** systems preserve tested SHA == landed SHA bitwise: **Bors-NG** (`staging` fast-forward + `push_with_retry`), **Mergify** (`fast-forward` — *`serial` mode ONLY*), **Graphite MQ** (Fast-Forward Merge), **Aviator MQ** (`use_fast_forwarding` via Refs API `force: false`), and **Uber SubmitQueue** (`Runway` `PROMOTE = 4`, `--ff-only`) `[Measured]`.
   - Only **1** system (**Uber SubmitQueue**) natively supports non-PR raw Git refs (`git://{host}/{repo}/{ref}/{sha}`) `[Measured]`.
   - Why does Mergify explicitly forbid `fast-forward` in `parallel` scope mode (`docs.mergify.com/merge-queue/merge-strategies/`) `[Measured]`? Because two parallel queues testing disjoint changes `A` and `B` both branch off `main₀`: once `A` fast-forwards `main` to `main₀+A`, `B` can no longer fast-forward without creating a new commit `main₀+A+B` whose SHA has **never been tested** `[Inferred]`. Under GitHub's SHA-bound `green-main` ruleset, Cairn MUST keep landed commits in a **linear fast-forward ancestry chain** (`main₀ → B₁ → B₁+B₂ → ...`) — which means **out-of-order partitioning (`fast` ahead of `eval`) happens at batch-assembly / scheduling time, NOT by letting two unrelated parallel branches race to push `main`** `[Inferred]`.
2. **Why Cairn needs *opportunistic batching + bisection* on top of speculation (not just pure per-lane stacking)** `[Inferred]`:
   - In **Trunk MQ** (`Max wait time = 0`) and **Aviator** (`batch_max_wait_minutes: 0`, `batch_wait_when_idle: false`), a batch never delays an idle queue: if 1 lane arrives when the queue is idle, batch size is **1** (zero batching latency); if 4 lanes arrive while slot 1 is testing, they coalesce automatically into a single batch of 4 `[Measured]`.
   - **Mergify's N-way cumulative split** (`docs.mergify.com/merge-queue/batches/`) and **Bors-NG's binary split** (`lib/worker/batcher/divider.ex`) isolate a single broken lane inside a batch of `M` lanes in `O(log M)` CI runs — and Mergify's deduction trick never retests the last unit when all prefix splits pass `[Measured]`.
   - **Trunk's `bisectionSkipRedundantTests`** memoizes already-failed combinations so bisection never re-runs a subset already proven red `[Measured]`.
3. **Why Cairn's `eval` problem is Uber's BLRD + Mergify's `scopes.capacities` problem** `[Inferred]`:
   - In Uber's Go monorepo, slow large diffs stalled fast small diffs behind them; **BLRD** (Bypassing Large Diffs, Aug 2023) cut P95 wait by **74%** by letting fast diffs overtake slow diffs `[Measured]`.
   - In Mergify (`docs.mergify.com/merge-queue/scopes/`), per-scope `capacities` (e.g., `e2e: 1`) cap expensive runs while letting unaffected scopes pass ahead of them, and `priority_rules` prevent starvation `[Measured]`.
   - For Cairn, `eval` is a deterministic path predicate already defined at `.github/workflows/ci.yml:72` (`eval-needed`) `[Measured]`. Scheduling non-`eval` lanes ahead of `eval` lanes — while coalescing waiting `eval` lanes into a single `eval` batch with a bounded max-wait / anti-starvation cap (e.g., 20 min or 2 fast batches) — keeps fast lanes at **~6m** and avoids wasting Devin CLI eval runs on unaffected commits `[Inferred]`.
4. **Flake resilience without breaking tested-SHA guarantees** `[Measured/Inferred]`:
   - **Trunk's `pending_failure_depth = 1` + Optimistic Merging**, **Aviator's `use_optimistic_validation`**, **GitHub's `HEADGREEN`**, and **Shopify's consecutive-failure threshold** all share one insight: on a linear cumulative chain `main₀ → B₁ → B₁+B₂`, if `B₁` fails due to a transient flake while `B₁+B₂` passes the **full** required suite, fast-forwarding `main` straight to `B₁+B₂` lands an **exact tested green SHA** (`B₁+B₂`) with zero eviction and zero follower rebuild `[Measured/Inferred]`.
   - Pairing `pending_failure_depth = 1` with Cairn's existing **rerun-failed-jobs once** (`promote-queue.mjs:63-75`) handles both lone batches (via rerun-once) and backlogged chains (via optimistic forward skip) `[Inferred]`.
   - **Zuul's AIMD dynamic window** (`window` +1 on success, ÷2 on failure down to `floor`) prevents a broken runner/dependency outage from burning unbounded speculative CI runs `[Measured]`.
5. **Stateless reconciler + inbox refs beats client-side polling loops** `[Measured/Inferred]`:
   - **Shopify Shipit v2** proves a stateless reconciler (compare current branch state vs. desired queue state, rebuild diff) needs no external database and self-heals on crash `[Measured]`.
   - **Uber SubmitQueue's `git://` provider** proves raw pushed Git refs (`refs/heads/ready/<lane>`) are a first-class queue inbox with zero PR ceremony `[Measured]`.
   - **Trunk's Direct Merge to Main** proves that if the queue is idle and a candidate already passed full CI directly on `origin/main`, re-running CI on a second queue ref is pure waste `[Measured]`.

---

## 4. What Fits Cairn: Comparing Four Candidate Architectures

All four candidates below satisfy Cairn's hard invariants (`green-main` ruleset requires green `check` + `pack-smoke` + `e2e-gate` on the exact pushed SHA; no PRs; public repo with free standard Ubuntu runners; finite Devin CLI quota for `eval`; `Lane:` / `Amp-Thread-ID:` ownership trailers) `[Measured]`.

| Architecture | Speculation & batching | Failure isolation | `eval` (~30m) handling | Agent handoff | Expected latency (10 lanes/hr) | CI runs / lane | Implementation surface |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Option 0: Status quo (serial 1-candidate + manual `train-N`)** | 1 candidate; manual cherry-pick | Tip-owner drop only (broken when `train-N` clobbers trailers) | Contagious (~63m for mixed batches via 2× CI) | `preflight --wait` + `push-queue --wait` loop | 30–180m (measured 176.9m gap today) `[Measured]` | **~13×** (12.1 preflight + 1 queue) `[Measured]` | 0 |
| **Option 1: Pure per-lane speculative stack on `queue/main`** *(2026-11-22 Option B)* | Linear stack of individual lanes (1 CI run per lane; no batching) | Evict leftmost red lane, `rebuild-queue.mjs` suffix | **Poor**: 1 `eval` lane at pos 1 drags all followers behind it into 30m `eval` (`ci.yml:55`) | `push-queue` rebases onto `queue/main` tip, retries non-ff | Fast: ~8m when no `eval` ahead; **30–60m** whenever 1 `eval` lane enters `[Inferred]` | ~1.0–1.5× (bursts Devin `eval` quota linearly with stack depth) `[Inferred]` | Small (guard + push + promote + rebuild) |
| **Option 2: Serial Bors-style batch + binary bisect (no speculation)** | 1 active batch at a time (`max_batch_size = 6`); waiting lanes accumulate in `ready/*` | Owner-grouped binary bisection (`O(log M)`) | Can partition fast vs. `eval` batches between rounds, but no overlap while active batch runs | Push `ready/<lane>`, exit (fire-and-forget) | Fast: ~8–14m (waits behind active batch); behind an `eval` batch: **+30m stall** `[Inferred]` | **~0.25–0.4×** (lowest CI usage) `[Inferred]` | Medium (inbox refs + conductor + bisect) |
| **Option 3 (Recommended): Conductor-assembled batched speculative train + owner-grouped bisection + fast/`eval` separation + zero double-CI** | Opportunistic batches (`min=1, max=4–6, wait=0`) on a **2–3 slot** speculative chain (`AIMD` window 1..3), assembled from `ready/*` refs | **Owner-grouped binary/cumulative bisection** on preserved `Lane:`/`Amp-Thread-ID:` + `pending_failure_depth=1` optimistic promotion + rerun-once | **Partitioned**: fast non-`eval` batches assemble ahead of queued `eval` lanes (anti-starvation cap: 20m or 2 fast batches); `eval` lanes batch together (cap 1 active `eval` batch); `eval` gated on `check-core` fail-fast | **`enqueue-lane`** stamps `Lane:`, pushes `refs/heads/ready/<lane>`, **exits immediately** (0 polling; optional `preflight` directly fast-forwards when idle) | Idle fast: **~6m**; burst fast: **~8–14m**; `eval`: **~30m** (1× CI, never 2×) `[Inferred]` | **~0.35–0.6×** for fast lanes; **~0.5×** for batched `eval` lanes (cuts total runs by **>90%** vs. today's 13×) `[Inferred]` | Medium, split cleanly into **Phase 1 (Day 1 quick wins)** + **Phase 2 (Conductor & bisection)** |

### Why Option 3 beats Options 1 and 2 for Cairn

1. **Why not pure per-lane stacking (Option 1)?** Option 1 was right on 2026-11-22 when CI was homogeneous (~5–11m) `[Measured]`. Today, `eval` is 5× slower (~30m) and consumes Devin CLI runs (`EVAL_MAX_DEVIN_RUNS`) `[Measured]`. Under Option 1, 1 `eval` commit at position 1 causes positions 2..6 to inherit `eval-needed=true` via `git merge-base origin/main HEAD`, burning 6× Devin eval runs and delaying 5 unrelated UI/test lanes by 30 minutes `[Measured/Inferred]`. Furthermore, direct agent pushes to `queue/main` still contend on non-ff push races and tempt agents into preflight loops `[Inferred]`.
2. **Why not strictly serial batching (Option 2)?** When an `eval` batch occupies the single slot for 30 minutes, every fast UI/docs lane that arrives at minute 1 sits idle for 29 minutes before even starting CI, then runs another 6 minutes (35m wait) `[Inferred]`. Allowing **1–2 speculative successor batch slots** (bounded by Zuul-style AIMD window `max=3, floor=1`) lets fast lanes start testing immediately on top of the active batch (or overtake an unstarted `eval` batch during assembly) AND enables Trunk/Aviator-style `pending_failure_depth=1` optimistic flake absorption `[Inferred]`.
3. **Why Option 3 stays simple (no database, no PRs, no Uber speculation tree)**:
   - Cairn is at ~10 lanes/hr, not Uber's 1,000+ diffs/hr; Uber's full probabilistic binary speculation tree + NGBoost + Tango target graph is overkill when Cairn's `queue/main` historical pass rate is high and GitHub Ubuntu runners are free `[Measured/Inferred]`.
   - Instead, Option 3 borrows ONLY the lightest, highest-ROI pieces that map 1:1 onto Git refs and Cairn's existing scripts:
     - **Uber `git://` inbox refs** (`refs/heads/ready/<lane>`) — zero PRs, zero agent polling.
     - **Shopify stateless reconciler** — conductor derives all state from Git refs + GitHub Actions API on every wake; crash-safe by construction.
     - **Bors-NG / Mergify owner-grouped bisection** — reuses `ownerOf(commit.body)` already in `promote-queue.mjs:15-23` and scratch worktree replay already in `rebuild-queue.mjs:47-62`.
     - **Mergify `scopes` / Uber BLRD fast-overtakes-slow** — reuses the exact `eval-needed` regex already in `ci.yml:72`.
     - **Trunk `Direct Merge to Main` + `pending_failure_depth=1`** — eliminates the 63.4m double-CI tax and flake-cascade rebuilds while preserving bit-for-bit `tested SHA == landed SHA`.

---

## 5. Concrete Design: Scripts, Workflows, and Failure Behavior

### 5.1 Phased rollout (ship quick wins in hours, train conductor next)

#### Phase 1 — Immediate quick wins (cuts 63.4m → ~30m and stops `train-1` waste on Day 1)

1. **Eliminate the 2× identical-SHA CI tax (`scripts/ops/promote-queue.mjs`, `.github/workflows/promote.yml`)**:
   - In `promote-queue.mjs:53-55`, relax `r.head_branch.startsWith('queue/')` to accept a completed green `ci` run on **either** `queue/*` or `preflight/*` for `head_sha === queueHead`, **provided** `candidateContainsMain === true` (already checked at line 45) and the run's `changes` / required check-runs (`check`, `pack-smoke`, `e2e-gate`) all concluded `success`/`skipped` `[Measured/Inferred]`.
   - **Why this is sound**: Verified in `ci.yml:55, 110, 604` that `preflight/*` and `queue/*` run the exact same `merge-base origin/main HEAD` diff, exact same `eval` gate, and exact same aggregate `check` job; and the `green-main` ruleset independently enforces the three required check contexts on `queueHead` at push time `[Measured]`.
   - **Triggering promotion without a redundant `queue/main` run**: Add `on: push: branches: [queue/main]` to `.github/workflows/promote.yml` (or dispatch `promote.yml` from `push-queue.mjs` right after pushing `queue/main`), AND add an early skip guard in `ci.yml` (`changes` job or job-level check on `queue/*`): if `github.sha` **already** has green `check` + `pack-smoke` + `e2e-gate` check runs from a completed `ci` run whose `base-sha` is an ancestor of `origin/main` (and `origin/main` is an ancestor of `github.sha`), skip re-running `eval` / tests and let `promote.yml` fast-forward `main` in ~30 seconds `[Inferred]`. *(Note: verify that skipping `ci.yml` on `queue/main` does not overwrite the existing green `check`/`pack-smoke`/`e2e-gate` check-run conclusions with a new skipped run — safer still: have `push-queue.mjs` skip pushing `queue/main` and let `promote.yml` directly fast-forward an already-green `preflight/*` SHA via a `ready/` ref, OR trigger `ci.yml` ONLY when no green run exists by having the conductor push to `queue/main` ONLY for untested batches while promoting already-green singletons directly to `main`!)* `[Inferred]`.
   - **Critical GitHub check-run gotcha to respect**: In GitHub Actions, a second workflow run on the same SHA creates *new* check runs with the same names (`check`, `pack-smoke`, `e2e-gate`), and GitHub's ruleset evaluates the **latest** check run of each name (`docs.github.com/.../about-status-checks`) `[Measured/Inferred]`. Therefore, **do NOT emit a skipped duplicate `ci.yml` run on an already-green SHA** — instead, let the conductor promote an already-green `ready/<lane>` SHA straight to `main` (Trunk's Direct Merge to Main) without pushing it to `queue/main` at all, so zero duplicate `ci.yml` run is ever triggered `[Inferred]`!
2. **Fail-fast `eval` on `check-core` failure (`.github/workflows/ci.yml`)**:
   - Change `eval` at `ci.yml:600` from `needs: changes` to `needs: [changes, check-core]` (costs ~2.5–3.5m of serial `check-core` latency, well within the 40m job budget, and prevents burning 29.7m + Devin CLI quota whenever typecheck/lint/gates fail as in `train-1` run `45350393987`) `[Measured/Inferred]`.
   - Alternatively, keep `eval` parallel with `check-core` for zero latency increase and add a lightweight cancellation step / sibling watcher job (`if: failure()` on `check-core` or `vitest-light`) that cancels the in-progress `eval` job/run early — or simply `needs: [changes, check-core]` for zero extra workflow complexity (+3m on green `eval`, **-26m** on every red `check-core` `eval` run) `[Inferred]`.
3. **Preserve per-lane owner trailers before cherry-picking**:
   - Stamp `Lane: <host>/<worktree>` at **commit / preflight / enqueue time** (inside `preflight.mjs` or `enqueue-lane.mjs`), never only inside `push-queue.mjs` when an operator runs from a `train-N` worktree `[Measured/Inferred]`. Because `stampCommand` (`push-queue.mjs:88`) skips commits that already carry `^(Amp-Thread-ID|Lane):`, stamping at the originating lane guarantees every cherry-picked commit keeps its true owner trailer `[Measured]`.

#### Phase 2 — Automated Conductor-Driven Merge Train (eliminates manual `train-N` and `push-queue --wait`)

##### Git ref topology (zero external state store)

| Ref pattern | Writer | Triggers `ci.yml`? | Purpose |
| --- | --- | --- | --- |
| `refs/heads/ready/<lane>` | Agent / user via `enqueue-lane.mjs` (create/update); Conductor (`cairn-release[bot]`) deletes on land or eviction | **No** | Lane submission inbox (replaces `push-queue --wait`). Each commit already carries its `Lane:` or `Amp-Thread-ID:` trailer. |
| `refs/heads/queue/main` | Conductor (`cairn-release[bot]`) ONLY | **Yes** | Active linear speculative chain (slot 1, optionally slot 2..W stacked linearly on top). Exact tested SHA fast-forwards to `main`. |
| `refs/heads/queue/bisect/<batch-id>-<side>` | Conductor (`cairn-release[bot]`) ONLY | **Yes** | Temporary bisection branches (`L` and `R` halves) when an active batch fails after rerun-once; deleted as soon as bisection resolves. |
| `refs/heads/queue-state/main` | Conductor / `queue-guard.yml` | **No** | Existing reachability anchor & lock state (keeps in-flight SHAs reachable and stores lightweight JSON metadata in an orphan/state commit or tag if AIMD window/retry counters are needed, though most state is derivable statelessly from refs + Actions runs). |
| `refs/heads/preflight/<lane>` | Agent via `preflight.mjs` (optional) | **Yes** | Unchanged optional lane-side confidence check. No longer mandatory before enqueueing. |

##### Core state machine & conductor reconciliation loop (`scripts/ops/train-conductor.mjs` + `.github/workflows/train.yml`)

`.github/workflows/train.yml` runs on:
- `push` to `ready/**` (new lane submitted)
- `workflow_run` on `ci` completed for `queue/**` (and `preflight/**` if direct-promote enabled)
- `workflow_dispatch` (manual operator nudge)
- `schedule: '*/5 * * * *'` (5-minute backstop against dropped GitHub webhook events, same pattern as `desktop-release`)

Concurrency: `group: train-main`, `cancel-in-progress: false`, authenticated with the existing `cairn-release` GitHub App token (`environment: desktop-release`) `[Measured/Inferred]`.

On every wake, the **stateless reconciler** runs these 6 deterministic steps:

1. **Step 1 — Reconcile active `queue/main` chain (Promote / Optimistic Skip / Retry / Bisect)**:
   - Fetch `origin/main`, `origin/queue/main`, `origin/queue/bisect/*`, and `origin/ready/*`.
   - Partition commits in `origin/main..origin/queue/main` into **atomic lane groups** `[G₁, G₂, ..., Gₖ]` by contiguous `ownerOf(commit.body)` key (extending `queueCandidates` + `planDrop` in `promote-queue.mjs:25-34, 204-213`) `[Measured/Inferred]`.
   - Identify **tested batch checkpoints** along `origin/main..origin/queue/main` (every commit SHA that has an associated `ci` workflow run on `queue/**` — i.e., slot 1 tip `S₁`, slot 2 tip `S₂`, ..., up to current AIMD window `W ∈ [1, 3]`) `[Inferred]`.
   - **Stale check**: If `!isAncestor(origin/main, queue/main)`, `main` moved externally — rebuild all non-landed lane groups onto `origin/main` without bisecting (matching Bors-NG `clone_batch` on 422 non-ff) `[Measured/Inferred]`.
   - **Promote deepest contiguous green / optimistic-green checkpoint**:
     - If the newest checkpoint `Sⱼ` is green (`check` + `pack-smoke` + `e2e-gate` all `success`/`skipped`):
       - Under **Optimistic Forward Validation (`pending_failure_depth = 1`)** (Trunk/Aviator/GitHub `HEADGREEN`): if `S₁` failed once (likely flake) AND `S₂` (which contains `S₁` + new lanes) is **green**, fast-forward `main` straight to `S₂` via `pushToMain` (with existing 8-attempt GH013 retry + `closeLandedIssues`)! Delete landed `ready/<lane>` refs whose commits are now ancestors of `main` (or match landed patch-id/tree). Increment AIMD window `W = min(3, W + 1)`.
       - Otherwise, promote the highest green prefix `Sᵢ` whose predecessors are green (or skipped within depth 1).
   - **Handle red head / leftmost red checkpoint `Sᵢ`**:
     - If `Sᵢ` completed red on `run_attempt == 1`: trigger `rerun-failed-jobs` once (existing `promote-queue.mjs:63-75`), unless a newer checkpoint `Sᵢ₊₁` is already green (handled above) `[Measured/Inferred]`.
     - If `Sᵢ` completed red on `run_attempt >= 2` (confirmed failure):
       - Halve AIMD window: `W = max(1, Math.floor(W / 2))` (Zuul AIMD).
       - If `Sᵢ` contains **1 lane group** (`|G| == 1`): evict that lane group! Post commit comment with run URL + failing job names (`dropNotice`), delete its `ready/<lane>` ref, and replay any remaining downstream lane groups (`Sᵢ..queue/main`) onto `origin/main` using `rebuild-queue.mjs` scratch-worktree mechanics (cancelling now-obsolete downstream `ci` runs on old SHAs).
       - If `Sᵢ` contains **M ≥ 2 lane groups**: enter **Owner-Grouped Binary Bisection** (Step 2).

2. **Step 2 — Owner-Grouped Binary Bisection (Bors-NG `divider.ex` + Mergify cumulative deduction)**:
   - Given failed batch `B = [G₁, ..., Gₘ]` on base `origin/main`:
     - Split at `mid = Math.floor(M / 2)` into `L = [G₁..G_mid]` and `R = [G_{mid+1}..Gₘ]`.
     - Push `L` rebased onto `origin/main` to `refs/heads/queue/bisect/<id>-L`, and `R` rebased onto `origin/main` to `refs/heads/queue/bisect/<id>-R` **in parallel** (2 concurrent `ci` runs, matching Trunk's separate bisection concurrency) `[Measured/Inferred]`.
     - Cancel any obsolete speculative downstream slots (`S₂`, `S₃`) that sat on top of `B` (they are preserved as `ready/*` refs and will be re-assembled once `B` resolves).
     - When `L` and `R` finish:
       - **`L` green, `R` red**: Fast-forward `main` to `L` immediately! Delete `L`'s `ready/*` refs. If `|R| == 1`, evict `R`'s sole lane group (deduced culprit without retesting); if `|R| ≥ 2`, bisect `R` onto the new `main` (= `L`).
       - **`L` red, `R` green**: Fast-forward `main` to `R` immediately! (Because `R` was tested directly on `origin/main`, its tested SHA fast-forwards cleanly to `main`!). Delete `R`'s `ready/*` refs. If `|L| == 1`, evict `L`'s sole lane group; if `|L| ≥ 2`, bisect `L` onto the new `main` (= `R`).
       - **Both `L` and `R` red**: Each half holds at least one broken lane; bisect `L` first (or both sequentially/in parallel up to bisection concurrency limit), evicting confirmed singleton culprits.
       - **Both `L` and `R` green (semantic cross-lane collision!)**: `L` and `R` passed individually on `main₀` but failed when combined in `L+R`! Fast-forward `main` to `L` immediately, then re-queue `R` onto the new `main` (= `L`) — on that run, `R` will either fail deterministically against `L` (and bisect to the exact interacting lane) or pass (proving the original `L+R` failure was a rare double-flake!). Either way, **every landed SHA was tested green and zero infinite loops occur** `[Inferred]`.
   - **Why `R` rebased on `main₀` works better here than strictly cumulative `L` + `L+R`**: When `L` is bad and `R` is healthy, testing `R` directly on `main₀` lets `R` fast-forward straight to `main` in **1 round** (half the latency for healthy lanes!) while still detecting cross-lane collisions cleanly `[Inferred]`.

3. **Step 3 — Direct-Promote Fast Path (Trunk "Direct Merge to Main")**:
   - If `queue/main` is empty (no active slots and no active bisection) AND a `ready/<lane>` ref has `origin/main` as an ancestor AND its exact `head_sha` **already** carries green `check` + `pack-smoke` + `e2e-gate` from a completed `preflight/*` `ci` run:
   - Fast-forward `main` directly to that SHA via `pushToMain`, close issues, delete `ready/<lane>`, and skip `queue/main` CI entirely! (Zero duplicate CI!) `[Inferred]`.

4. **Step 4 — Partitioning and Batch Assembly (`eval` separation + conflict isolation)**:
   - Collect all remaining `refs/heads/ready/*` refs not already in `queue/main` or `queue/bisect/*`.
   - Classify each lane locally inside the conductor runner using the exact `ci.yml:72` `eval` path regex (extracted into a shared helper `scripts/ops/classify-eval.mjs` consumed by both `ci.yml` and `train-conductor.mjs` so the two can never drift!) `[Inferred]`:
     - **`fast` bucket**: `eval-needed == false` (~1m docs, ~6m code/e2e).
     - **`eval` bucket**: `eval-needed == true` (~30m Devin CLI eval).
   - **Ordering & anti-starvation policy**:
     - If no `eval` batch is currently running AND an `eval` lane has waited `>= 20 min` (or `>= 2` fast batches have overtaken it), assemble the next batch from the **`eval` bucket** (grouping all waiting `eval` lanes up to `MAX_EVAL_BATCH = 4` so they share **one** 30m `eval` run).
     - Otherwise, assemble from the **`fast` bucket** first (opportunistic batch size `1..MAX_FAST_BATCH`, default `4–6`; `wait = 0` — never sleep waiting for more lanes!).
     - **Hard `eval` non-contagion rule**: Never stack a `fast` batch speculatively *on top of* an unlanded `eval` batch (otherwise `ci.yml:55` diffs `origin/main..HEAD` and forces the `fast` batch to run `eval` too!). Instead:
       - While a `fast` batch is running, up to `W - 1` more `fast` batches may stack speculatively on top of it (all stay `eval-needed == false`, all finish in ~6m!).
       - While an `eval` batch is running in slot 1, **hold** `fast` lanes in `ready/*` OR — even better — if `fast` lanes arrive while an `eval` batch is still <15m in, wait until the `eval` batch lands (at most 1 batch behind), OR limit active `eval` batches to `1` and allow `fast` batches to drain immediately before starting any `eval` batch `[Inferred]`. *(Notice why draining `fast` before starting `eval` works so well: at 10 lanes/hr, ~80% of lanes are non-`eval` and clear in 6m; draining them before launching the periodic coalesced `eval` batch keeps fast P50 latency at ~6–8m without ever cancelling an in-flight 30m `eval` run!)* `[Inferred]`.
   - **Atomic per-lane conflict isolation during assembly**:
     - In a scratch worktree initialized at the current `queue/main` tip (or `origin/main` if empty), iterate through selected `ready/<lane>` refs oldest-first:
       1. Verify every commit in `merge-base(origin/main, ready)..ready` carries an owner trailer (`Lane:` or `Amp-Thread-ID:`); if somehow missing, stamp `Lane: <lane-from-ref-name>` (preserving per-lane attribution, never `train-N`!).
       2. Verify `english-only-gate.mjs` passes on the lane's commits; if not, reject that lane immediately with a commit comment and delete `ready/<lane>`.
       3. Attempt `git rebase --onto <batchTip> <laneBase> <laneHead>` (or cherry-pick range atomically).
       4. If conflict: `git rebase --abort`, reset scratch HEAD back to `<batchTip>`, post a commit comment on the lane's tip SHA (`Skipped from train: rebase conflict against <batchTip>; rebase onto origin/main and re-run enqueue`), delete `ready/<lane>`, and continue assembling the next lane!
       5. If clean: advance `<batchTip>` to the rebased tip.
     - Push the assembled `<batchTip>` fast-forward to `refs/heads/queue/main` (`--force-with-lease` pinned to observed `queue/main`), triggering **one** `ci.yml` run for the whole batch `[Inferred]`.

5. **Step 5 — Cleanup**:
   - Delete any `ready/<lane>` whose commits are ancestors of `origin/main` (by commit SHA or `git patch-id` recorded in the commit trailer / state), and delete finished `queue/bisect/*` refs `[Inferred]`.

6. **Step 6 — Crash / Restart Idempotency**:
   - Every operation uses `--force-with-lease` or `git push --ff-only` (`pushToMain`) `[Measured/Inferred]`.
   - Because `train-main` concurrency serializes conductor runs (`cancel-in-progress: false`) and the conductor re-reads live Git refs + GitHub check runs on every start, a runner preemption or GitHub API blip leaves `main` untouched and the next wake (webhook or 5-min schedule) converges automatically `[Inferred]`.

### 5.2 Concrete file-by-file change list (for the follow-up implementation task — not edited here)

| File | Concrete change |
| --- | --- |
| `scripts/ops/classify-eval.mjs` *(new)* | Single source of truth for the `eval-needed` path regex currently inline at `.github/workflows/ci.yml:72`, imported by both `ci.yml` and `train-conductor.mjs`. |
| `scripts/ops/push-queue.mjs` | Replace the `--wait` rebase-and-repreflight loop with **inbox enqueue** (or add `scripts/ops/enqueue-lane.mjs` and deprecate `--wait` in the same change per Single Path rule): stamp `Lane: <host>/<worktree>` on unowned commits, run `english-only-gate.mjs`, verify rebase onto `origin/main`, push `HEAD:refs/heads/ready/<lane>` with `--force-with-lease`, and exit 0 (optional `--watch` polls `origin/main` ancestry + `ready/<lane>` status without rebasing or triggering CI). Keep `preflight.mjs` as an optional pre-submit confidence check (and direct-promote fast path when queue is idle). |
| `scripts/ops/promote-queue.mjs` | Keep `ownerOf`, `pushToMain` (GH013 retry), `closeLandedIssues`, `dropNotice`; extract reusable helpers (`groupByOwner`, `evaluateCommitChecks`, `acceptPreflightOrQueueRun`) consumed by `train-conductor.mjs`. |
| `scripts/ops/rebuild-queue.mjs` | Generalize scratch-worktree `rebase --onto` helper so `train-conductor.mjs` calls it for (a) batch assembly with atomic conflict skip, (b) suffix rebuild after eviction, and (c) bisection branch construction (`queue/bisect/*`). |
| `scripts/ops/guard-queue.mjs` & `.github/workflows/queue-guard.yml` | Simplify `queue/main` guard: **only `cairn-release[bot]` may push or delete `queue/main` and `queue/bisect/**`**; any direct human/agent push to `queue/main` is restored to `queue-state/main` with a notice directing the pusher to `push-queue.mjs` (inbox enqueue). Humans/agents push freely to their own `ready/<lane>` and `preflight/<lane>` refs. |
| `scripts/ops/train-conductor.mjs` *(new)* & `.github/workflows/train.yml` *(new, replaces `promote.yml`)* | Implements the 6-step stateless reconciler: promote/optimistic-skip, rerun-once, owner-grouped binary bisection, direct-promote of already-green singletons, `fast`/`eval` bucket assembly with anti-starvation and conflict skip, and `ready/*` cleanup. Runs under `cairn-release[bot]`, `concurrency: group: train-main, cancel-in-progress: false`, triggered on `push: ready/**`, `workflow_run: ci (queue/**, preflight/**)`, `workflow_dispatch`, and `schedule: '*/5 * * * *'`. |
| `.github/workflows/ci.yml` | (1) Gate `eval` with `needs: [changes, check-core]` (or fail-fast cancel on `check-core` failure) so broken lint/typecheck never burns 30m of Devin eval runs. (2) Source `eval-needed` from `scripts/ops/classify-eval.mjs`. (3) Keep `on: push: branches: [main, 'queue/**', 'preflight/**']` (explicitly excluding `ready/**`). |
| `AGENTS.md` & `docs/design/tested-sha-landing.md` | Update Ship steps 4–6 to the single enqueue flow and retire the serial 1-candidate pilot prose. |

### 5.3 Failure behavior matrix (every edge case)

| Failure mode | Detection | System response | Invariant preserved |
| --- | --- | --- | --- |
| **Conflict during batch assembly** | `git rebase --onto` exits non-zero in scratch worktree | Abort rebase, skip that lane atomically, delete `ready/<lane>`, comment on lane's commit naming the conflicting tip; assemble remaining lanes | Healthy lanes never wait on one conflicting lane |
| **Transient CI flake (batch in slot 1, no successor)** | `ci` run `attempt == 1` fails | `rerun-failed-jobs` once (`promote-queue.mjs:63-75`) | Avoids false eviction without wasting a full rebuild |
| **Transient CI flake (batch `B₁` in slot 1, `B₁+B₂` in slot 2 passes)** | `S₂` green while `S₁` red/retrying | Optimistic promotion (`pending_failure_depth = 1`): fast-forward `main` straight to `S₂` | Exact tested SHA (`S₂`) == landed SHA; 0 rebuilds |
| **Deterministic failure in 1-lane batch** | `attempt >= 2` red and `|groups| == 1` | Evict lane, post `dropNotice` comment, delete `ready/<lane>`, rebuild downstream slots onto `origin/main`, halve AIMD window | Culprit isolated; followers proceed automatically |
| **Deterministic failure in M-lane batch (`M ≥ 2`)** | `attempt >= 2` red and `|groups| ≥ 2` | Owner-grouped binary split onto `queue/bisect/<id>-L` & `-R` in parallel; promote any green half immediately; recurse only on red half (`O(log M)`) | Preserves per-lane `Lane:`/`Amp-Thread-ID:` boundaries; healthy half lands in 1 round |
| **Cross-lane semantic collision (`L` green, `R` green, `L+R` red)** | Both bisection halves pass individually | Fast-forward `main` to `L`, re-queue `R` onto new `main` (= `L`) where `R` fails deterministically against `L` and bisects | Guarantees linear tested-SHA history; never loops |
| **`main` moved externally (stale batch)** | `!isAncestor(origin/main, queue/main)` | Re-assemble remaining unlanded lane groups onto new `origin/main` without bisecting (Bors-NG rule) | Does not blame innocent lanes for an external push |
| **GitHub `GH013` check-lag refusal on promote** | `isCheckLagRefusal(stderr)` | Existing `pushToMain` 8-attempt exponential backoff (10s → 120s), re-checking `main` & `queue/main` before each retry (`promote-queue.mjs:276-328`) | Absorbs GitHub ruleset propagation lag |
| **Conductor runner crash / timeout / duplicate wake** | Next webhook or 5-min `schedule` wake | Stateless reconciler reads Git refs + Actions API; `--force-with-lease` & `--ff-only` reject stale mutations | No stuck locks; converges on next tick |
| **Direct manual push/delete to `queue/main`** | `queue-guard.yml` sees `actor !== 'cairn-release[bot]'` | Restores `queue-state/main`, cancels unauthorized CI run, comments instruction to enqueue via `ready/<lane>` | Single writer (`cairn-release[bot]`) owns `queue/main` |

---

## 6. How Agents Hand a Green Lane to the Train

Today's `AGENTS.md` Ship steps 4–5 force every agent to run `node scripts/ops/preflight.mjs --wait` and then sit in `node scripts/ops/push-queue.mjs --wait` for up to 120 minutes, burning context, wall-clock time, and 12× preflight CI runs `[Measured]`.

Under the recommended train, an agent's landing flow collapses to **one non-blocking handoff**:

1. Commit cleanly in the worktree (using the repo commit format) and run targeted local checks (at most one vitest file on the owner's Mac, or `mini-test` on the Mac mini when needed).
2. Rebase onto the latest `origin/main` and resolve any conflicts locally.
3. **Optional fast confidence check**: For risky or multi-package changes (or when the agent wants pre-handoff feedback before closing its session), run `node scripts/ops/preflight.mjs --wait` (pushing `refs/heads/preflight/<lane>`). If `queue/main` is idle when the lane then enqueues with that exact green SHA on `origin/main`, the conductor **direct-promotes** it with zero second CI run `[Inferred]`.
4. **Hand off to the train**: Run `node scripts/ops/push-queue.mjs` (repurposed to enqueue mode):
   - Stamps `Lane: <host>/<worktree>` onto every unowned commit in `origin/main..HEAD` *before* pushing (so trailers survive batch assembly!).
   - Runs `node scripts/english-only-gate.mjs` locally (~0.2s) and verifies `origin/main` is an ancestor of `HEAD`.
   - Force-with-lease pushes `HEAD` to `refs/heads/ready/<lane>` and **exits immediately (exit 0)** with a one-line status (`Enqueued <sha> on ready/<lane> (tier: fast|eval); conductor will batch and land it`).
5. **What happens next (no polling required)**:
   - On **landing**: the conductor fast-forwards `main`, closes `Closes #N` issues, and deletes `refs/heads/ready/<lane>`.
   - On **conflict or confirmed CI failure**: the conductor deletes `refs/heads/ready/<lane>` and posts a commit comment on the lane's tip SHA with the exact reason, failing run URL, and `Lane:`/`Amp-Thread-ID:` owner (plus `train.yml` job summary).
   - If an agent or orchestrator explicitly wants to wait for its lane's final verdict (e.g., to clean up its worktree right away or auto-fix an eviction), it passes `--watch`, which polls `git ls-remote origin refs/heads/ready/<lane>` and `origin/main` ancestry every 60s — **never rebasing and never firing new preflight CI runs** — and exits `0` when landed or `1` (printing the conductor's commit comment) if evicted `[Inferred]`.

---

## 7. Designated Sources Coverage (`SOURCES.md` + Prompt List)

| Source | Status | What was read first-hand |
| --- | --- | --- |
| **GitHub docs** (`SOURCES.md` — Actions, branch protection, rulesets, merge queue) | READ | Merge queue docs, rulesets OpenAPI schema (`repository-rule-merge-queue`), `merge_group` event, Actions `concurrency` (`queue: single/max`), status checks, GitHub Engineering blog |
| **Mergify docs** (`SOURCES.md`) | READ | `performance/`, `batches/`, `modes/`, `scopes/`, `merge-strategies/`, `two-step/`, `priority/`, `lifecycle/`, `file-format/` |
| **GitLab Merge Trains** | READ | `docs.gitlab.com/ci/pipelines/merge_trains/`, `merged_results_pipelines/`, `merge_requests/methods/` |
| **Bors-NG** | READ | `bors-ng/bors-ng@ca725797`: `lib/worker/batcher.ex`, `divider.ex`, `bors_toml.ex`, `lib/web/command.ex`, `README.md` |
| **Graphite MQ** | READ | `graphite.com/docs/graphite-merge-queue`, `merge-queue-optimizations` |
| **Trunk MQ** | READ | `docs.trunk.io/merge-queue` + `predictive-testing`, `optimistic-merging`, `batching`, `parallel-queues`, `pending-failure-depth`, `anti-flake-protection`, `advanced-settings`, `faq` |
| **Aviator MQ** | READ | `docs.aviator.co/mergequeue` + `parallel-mode`, `batching`, `fast-forwarding`, `setup-fast-forwarding`, `affected-targets`, `managing-flaky-tests-in-mergequeue`, `flaky-test-management`, `configuration-file` |
| **Zuul** | READ | `zuul-ci.org/docs/zuul/latest/`: `gating.html`, `config/pipeline.html`, `config/project.html`, `drivers/git.html`, `drivers/github.html` |
| **Chromium CQ (LUCI CV)** | READ | `docs/infra/cq.md`, `infra/config/generated/luci/commit-queue.cfg`, `docs/gardener.md`, `luci-go/cv/README.md`, `config.proto`, `bisection/README.md`, `sheriff-o-matic/README.md` |
| **Uber SubmitQueue** | READ (EuroSys '19 PDF **BLOCKED**) | Open-access ICSE '25 paper (`arXiv:2501.03440v2`), 2 Uber Engineering blogs, `uber/submitqueue@d477ef53` (RFCs, `platform/provider/git/README.md`, `mergestrategy.proto`); EuroSys '19 PDF `BLOCKED: HTTP 403 Cloudflare` |
| **Shopify MQ / Shipit v2** | READ | `shopify.engineering/successfully-merging-work-1000-developers`, `Shopify/shipit-engine@4fc0af34` (`merge_request.rb`, `process_merge_requests_job.rb`) |
| **Bazel / Google TAP** | READ (ICSE-SEIP '17 PDF **BLOCKED**) | *SWE Book* Ch. 23 + Aside 3, Bazel `rdeps`/`allrdeps` docs, official `research.google` abstract, Google Testing Blog (2011, 2016, 2017); ICSE-SEIP '17 PDF `BLOCKED: IEEE paywall / 404 / 429` |
| **Cairn repo & live Actions** | READ | `scripts/ops/{push-queue,promote-queue,guard-queue,rebuild-queue,preflight}.mjs`, `.github/workflows/{ci,promote,queue-guard}.yml`, `docs/design/{tested-sha-landing,preflight-ci-verification}.md`, `docs/research/2026-11-22-merge-train.md`, live `gh run list`/`gh api` (last 100 runs + `train-1`/`train-3`/`train-5` forensics) |

---

## 8. Primary Links

- **GitHub**:
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
  - https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group
  - https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs
  - https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks
  - https://github.blog/engineering/engineering-principles/how-github-uses-merge-queue-to-ship-hundreds-of-changes-every-day/
- **GitLab**:
  - https://docs.gitlab.com/ci/pipelines/merge_trains/
  - https://docs.gitlab.com/ci/pipelines/merged_results_pipelines/
  - https://docs.gitlab.com/user/project/merge_requests/methods/
- **Bors-NG**:
  - https://github.com/bors-ng/bors-ng/blob/ca725797e53a88e954998de0bbb14a8a5acb13ab/lib/worker/batcher.ex
  - https://github.com/bors-ng/bors-ng/blob/ca725797e53a88e954998de0bbb14a8a5acb13ab/lib/worker/batcher/divider.ex
  - https://github.com/bors-ng/bors-ng/blob/ca725797e53a88e954998de0bbb14a8a5acb13ab/lib/worker/batcher/bors_toml.ex
  - https://github.com/bors-ng/bors-ng/blob/ca725797e53a88e954998de0bbb14a8a5acb13ab/lib/web/command.ex
- **Mergify**:
  - https://docs.mergify.com/merge-queue/performance/
  - https://docs.mergify.com/merge-queue/batches/
  - https://docs.mergify.com/merge-queue/modes/
  - https://docs.mergify.com/merge-queue/scopes/
  - https://docs.mergify.com/merge-queue/merge-strategies/
  - https://docs.mergify.com/merge-queue/two-step/
  - https://docs.mergify.com/merge-queue/priority/
  - https://docs.mergify.com/merge-queue/lifecycle/
- **Graphite**:
  - https://graphite.com/docs/graphite-merge-queue
  - https://graphite.com/docs/merge-queue-optimizations
- **Trunk**:
  - https://docs.trunk.io/merge-queue
  - https://docs.trunk.io/merge-queue/optimizations/predictive-testing
  - https://docs.trunk.io/merge-queue/optimizations/optimistic-merging
  - https://docs.trunk.io/merge-queue/optimizations/batching
  - https://docs.trunk.io/merge-queue/optimizations/parallel-queues
  - https://docs.trunk.io/merge-queue/optimizations/pending-failure-depth
  - https://docs.trunk.io/merge-queue/optimizations/anti-flake-protection
  - https://docs.trunk.io/merge-queue/administration/advanced-settings
  - https://docs.trunk.io/merge-queue/faq
- **Aviator**:
  - https://docs.aviator.co/mergequeue/concepts/parallel-mode
  - https://docs.aviator.co/mergequeue/concepts/batching
  - https://docs.aviator.co/mergequeue/concepts/fast-forwarding
  - https://docs.aviator.co/mergequeue/how-to-guides/setup-fast-forwarding
  - https://docs.aviator.co/mergequeue/concepts/affected-targets
  - https://docs.aviator.co/mergequeue/concepts/managing-flaky-tests-in-mergequeue
  - https://docs.aviator.co/mergequeue/concepts/flaky-test-management
  - https://docs.aviator.co/mergequeue/reference/configuration-file
- **Zuul**:
  - https://zuul-ci.org/docs/zuul/latest/gating.html
  - https://zuul-ci.org/docs/zuul/latest/config/pipeline.html
  - https://zuul-ci.org/docs/zuul/latest/config/project.html
  - https://zuul-ci.org/docs/zuul/latest/drivers/git.html
  - https://zuul-ci.org/docs/zuul/latest/drivers/github.html
- **Chromium CQ / LUCI CV**:
  - https://chromium.googlesource.com/chromium/src/+/HEAD/docs/infra/cq.md
  - https://chromium.googlesource.com/chromium/src/+/HEAD/infra/config/generated/luci/commit-queue.cfg
  - https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gardener.md
  - https://chromium.googlesource.com/infra/luci/luci-go/+/HEAD/cv/README.md
  - https://chromium.googlesource.com/infra/luci/luci-go/+/HEAD/cv/api/config/v2/config.proto
  - https://chromium.googlesource.com/infra/luci/luci-go/+/HEAD/bisection/README.md
- **Uber SubmitQueue**:
  - https://arxiv.org/pdf/2501.03440.pdf (ICSE '25)
  - https://www.uber.com/blog/bypassing-large-diffs-in-submitqueue/
  - https://www.uber.com/blog/slashing-ci-costs-at-uber/
  - https://github.com/uber/submitqueue/blob/d477ef53af1572a2dd8eefc504ec7f2dc499bf06/docs/rfc/speculation.md
  - https://github.com/uber/submitqueue/blob/d477ef53af1572a2dd8eefc504ec7f2dc499bf06/docs/rfc/speculation-generator-best-first.md
  - https://github.com/uber/submitqueue/blob/d477ef53af1572a2dd8eefc504ec7f2dc499bf06/docs/rfc/workflow.md
  - https://github.com/uber/submitqueue/blob/d477ef53af1572a2dd8eefc504ec7f2dc499bf06/docs/rfc/tango-conflict-analyzer.md
  - https://github.com/uber/submitqueue/blob/d477ef53af1572a2dd8eefc504ec7f2dc499bf06/docs/rfc/outcome-scorer.md
  - https://github.com/uber/submitqueue/blob/d477ef53af1572a2dd8eefc504ec7f2dc499bf06/docs/rfc/change-uri.md
  - https://github.com/uber/submitqueue/blob/d477ef53af1572a2dd8eefc504ec7f2dc499bf06/platform/provider/git/README.md
  - https://github.com/uber/submitqueue/blob/d477ef53af1572a2dd8eefc504ec7f2dc499bf06/api/base/mergestrategy/mergestrategy.proto
  - https://github.com/uber/submitqueue/blob/d477ef53af1572a2dd8eefc504ec7f2dc499bf06/docs/rfc/runway/workflow.md
- **Shopify**:
  - https://shopify.engineering/successfully-merging-work-1000-developers
  - https://github.com/Shopify/shipit-engine/blob/4fc0af34f01b346d02dfb6ed4cc20980ae7a624e/app/models/shipit/merge_request.rb
  - https://github.com/Shopify/shipit-engine/blob/4fc0af34f01b346d02dfb6ed4cc20980ae7a624e/app/jobs/shipit/process_merge_requests_job.rb
- **Bazel / Google TAP**:
  - https://abseil.io/resources/swe-book/html/ch23.html
  - https://bazel.build/query/language#rdeps
  - https://research.google/pubs/taming-google-scale-continuous-testing/
  - https://testing.googleblog.com/2011/06/testing-at-speed-and-scale-of-google.html
  - https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
  - https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html
