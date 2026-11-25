# Merge-queue total efficiency and CI capacity: prior art and empirical analysis

Why: after shipping the speculative + batching merge queue (`48ba97997`), live runs on `xiechimon/cairn` cut queue landing latency from ~10–15 minutes per commit to ~2.2 minutes per commit across 8 landings in 18 minutes (verified). However, high-concurrency agent bursts still hit two bottlenecks: redundant 3-pass CI execution (`preflight/*` → `queue/try/*` → `push: main`) against the GitHub Free 20-job concurrency ceiling, and shared host REST API rate exhaustion (`5,000 req/hr`) across polling agents.

## Telemetry (verified 2026-11-25 on `xiechimon/cairn`)

- **Three-pass CI duplication (verified)**: Every concurrent code change runs full CI three times for the exact same code: once on `refs/heads/preflight/<lane>`, a second time on `refs/heads/queue/try/<id>`, and a third time on `push` to `refs/heads/main` (because `.github/workflows/ci.yml` treats `push` to `main` identically to unverified pushes).
  - Real `queue/try/*` runs [`45561757811`](https://github.com/xiechimon/cairn/actions/runs/45561757811), [`45562308085`](https://github.com/xiechimon/cairn/actions/runs/45562308085), and [`45562466006`](https://github.com/xiechimon/cairn/actions/runs/45562466006) each ran 15 non-skipped jobs (`changes`, `check-core`, `gates`, `pack-smoke`, 4x `vitest-light`, 3x `vitest-integration`, 2x `e2e-affected`, `e2e-gate`, `check`).
  - Redundant `push: main` runs (`45562753965`, `45563082466`, `45563362906`) sat `queued` for 8+ minutes and competed directly with `queue/try/*` for the same 20 concurrent runner slots.
- **Shard critical path vs slot waste (verified)**: Inside [`45562466006`](https://github.com/xiechimon/cairn/actions/runs/45562466006), `vitest-light (1..4)` is the critical path (`06:42:26Z`–`06:48:12Z`, up to ~5m04s per shard), while `vitest-integration` (3 shards) finishes ~2m earlier (`~2m56s`). Reducing `vitest-integration` from 3 to 2 shards trades ~1.5m of slack inside an existing 5m wall-clock budget for 1 fewer concurrent runner slot per CI run (inferred: ~4.4m vs ~5.1m `vitest-light`).
- **Host GitHub REST quota contention (verified)**: `gh api user` confirmed account plan is `null` (GitHub Free). During heavy parallel agent runs at `07:07:47 UTC`, shared user REST quota (`5,000 req/hr` across all local `preflight` + `push-queue` processes) hit `0/5000` (`HTTP 403`), and transient macOS `LibreSSL SSL_connect: SSL_ERROR_SYSCALL` errors aborted an active `push-queue.mjs --wait` poller even though the commit landed cleanly.

## Prior art comparison

| Source | How it solves duplicate CI & runner limits | Trade-offs for cairn | Link |
| --- | --- | --- | --- |
| **GitHub Actions Runner & Rate Limits** | Public repos get unlimited *minutes*, capped at **20 concurrent jobs** on GitHub Free (Pro: 40, Team: 60, Enterprise: 500; self-hosted: unlimited concurrency). `GITHUB_TOKEN` has `1,000 req/hr/repo` separate from user `5,000 req/hr` | Zero-dollar optimization must reduce concurrent job *count* per merge (eliminating `push: main` full re-runs & over-sharding) rather than assuming unlimited free parallelism (verified) | [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits) |
| **GitHub Merge Queue (`merge_group`)** | Tests predicted merge state in `merge_group`, separates `pull_request` vs `merge_group` triggers to avoid identical double runs; caps concurrent merge groups | PR-only (incompatible with Cairn's no-PR workflow rule established in [green-main landing](2026-11-18-green-main-landing.md)) (verified) | [Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) |
| **Mergify Two-Step CI + Speculative Batching** | Describes the RCV theorem (Reliability / Cost / Velocity): runs fast checks on open changes and heavy E2E/integration only in the queue, plus dynamic `batch_size: { min, max }` when queue backs up | **Skipping heavy preflight checks** lowers runner usage ~50%, at the cost of admitting broken changes into speculative batches (invalidating downstream specs and adding bisection latency) (verified) | [Mergify Performance](https://docs.mergify.com/merge-queue/performance/), [Mergify Batches](https://docs.mergify.com/merge-queue/batches), [Mergify Two-Step CI](https://docs.mergify.com/merge-queue/two-step) |
| **bors / homu** | Runs full suite on staging branch (`auto`), fast-forwards `main` to the exact tested SHA; `main` push does not require a second full test suite to produce release trust when promoted SHA is already verified | Matches `cairn` except `desktop-release` ([release-gate.mjs](../../scripts/ops/release-gate.mjs)) currently requires a completed `push` CI run on `head_branch=main` — solved cleanly if `main` fast-checks and reuses the exact-SHA `queue/*` / `preflight/*` verdict (verified) | [Green-main landing](2026-11-18-green-main-landing.md) |

## Pattern that fits Cairn

Combine **Zero-Trust Verified-SHA Reuse on `main`** with **Non-Critical-Path Shard Trimming**, preserving full preflight quality gates AND `release-gate.mjs` contracts:

1. **Eliminate Pass 3 (`push` on `main`) at zero safety cost**:
   - When `push` arrives on `refs/heads/main`, [ci-reuse-verified.mjs](../../scripts/ops/ci-reuse-verified.mjs) checks via `GITHUB_TOKEN` whether the exact `HEAD` SHA already has a completed `success` `ci` workflow run on `queue/*` or `preflight/*` (same repository) whose `check` (`success`), `e2e-gate` (`success`), `pack-smoke` (`success|skipped`), and `eval` (if `eval-needed && EVAL_ENABLED`) all passed, and `has-sidecar=false` (so sidecar release artifacts still build when sidecar source moves).
   - If every predicate passes, `ci.yml` keeps `check` (`success`), `e2e-gate` (`success`), and `pack-smoke` (`skipped`) satisfied in ~25 seconds using 1 runner instead of 15 — automatically freeing ~12–15 concurrent runner slots for active `preflight/*` and `queue/try/*` work and keeping `desktop-release` ([release-gate.mjs](../../scripts/ops/release-gate.mjs)) green without relaxing any rule.
   - Fails closed on any API error, non-`main` ref, mismatched SHA, or sidecar change.
2. **Trim non-critical `vitest-integration` sharding (3 → 2)**:
   - Saves 1 concurrent runner slot on every code `preflight/*` and `queue/try/*` run while staying under `vitest-light`'s 4–5m critical path.
3. **Optional next levers (owner trade-off decisions, not unilaterally flipped)**:
   - **Option A — Two-Step CI (`preflight` runs `check-core` + `vitest-light`, `queue/try/*` adds `vitest-integration` + `e2e`)**: halves `preflight` runner footprint (~5 vs 15 jobs), at the trade-off of letting integration/E2E failures enter `enqueue/*` and triggering speculative invalidation + bisection when one fails.
   - **Option B — Dynamic queue batching (`batch_wait_seconds` ~20s / `batch_size = 2`)**: halves `queue/try/*` runner footprint under heavy bursts (~1–2x vs `N`x), at the trade-off of holding solitary commits briefly and needing bisection if a 2-commit batch fails.
   - **Option C — GitHub Pro ($4/mo) or Self-Hosted ephemeral runner**: doubles hosted runner ceiling (`20 → 40` jobs) or removes concurrency caps entirely.

## Concrete recommendations (implemented cleanly and locked by invariants)

- `scripts/ops/ci-reuse-verified.mjs` + `.github/workflows/ci.yml`: fail-closed exact-SHA verification reuse on `refs/heads/main` pushes + `vitest-integration` `[1, 2]`.
- `scripts/ops/push-queue.mjs`: transient TLS/network error retry inside `--wait` poll loop.
- `scripts/ops/guard-queue.mjs`: cleanly retire `queue/main` with rebase guidance for stale worktrees.
- `scripts/ops/merge-queue-invariants.test.mjs` + `AGENTS.md`: automated safety & efficiency invariants preventing accidental weakening of `green-main`, reuse boundaries, depth bounds, or polling speed.
