# Tested-SHA landing queue

Problem: pushes land on `main` before CI finishes, so red commits arrive first
and are diagnosed later. Prior art and mechanics are in
`docs/research/2026-11-18-green-main-landing.md`; this is the build design.

## Model

`refs/heads/queue/main` is the landing queue: a linear candidate chain ahead of
`main`. Lanes push `HEAD:queue/main` instead of `HEAD:main`. A non-fast-forward
push is rejected, so a second lane rebases onto the current queue head and its
candidate stacks behind the first — order is the ref itself.

Since 2026-11-19 (pilot, mon X) the queue holds one candidate at a time; see
"One candidate at a time" below. Where this document describes lanes stacking
behind each other, that behavior is retired.

A candidate moves QUEUED (pushed, no run) → TESTING (ci running on its SHA) →
GREEN → PROMOTED, or → REJECTED at any point (red run, stale base, replaced
head). Rejected candidates never move `main`; the lane rebases and re-queues.

## Promote predicate

`scripts/ops/promote-queue.mjs` promotes `queue/main` head SHA `S` when all hold:

- a `ci` workflow run for `S` exists with conclusion `success` (in-progress,
  queued and cancelled runs are not evidence);
- inside that run, jobs `check`, `pack-smoke` and `e2e-gate` all succeeded —
  the three names `deploy-watch.sh` used as its green predicate. The watcher
  was torn down on 2026-11-18 (`docs/ops/self-deploy.md`) and
  `desktop-release` publishes on app-source pushes without gating, so these
  three jobs are no longer enforced anywhere — the queue gate is the first
  place they must be green, not a second one;
- `S` still equals `queue/main` head (a lane may have stacked a newer candidate;
  promoting `S` then is still correct — `main` fast-forwards to `S` and the
  newer candidate waits for its own green run);
- `S` contains `origin/main` tip (else the push is non-fast-forward → the
  candidate is stale → report, do not promote).

On green the script runs `git push origin S:refs/heads/main`. The push uses the
caller's normal `gh` login, so it also triggers the ordinary main CI run that
any future green-checking watcher or ruleset would consume.

## Failure behavior

- candidate run red: `main` untouched; output names the failing jobs; lane
  fixes and re-queues. A stacked successor's run is independent and may still
  promote on its own merit.
- run cancelled or superseded before completion: wait — GitHub guarantees a
  fresh run for the head SHA; a cancelled run never counts as green.
- `main` advanced past `S`'s base before promotion (opt-in phase only, or a
  bypass push): non-ff check fails → report STALE, do not promote; lane rebases
  `queue/main` onto main and re-queues.
- promoter exits early (ctrl-C, machine sleep): state lives in git refs and
  GitHub runs, not in the process; rerunning re-evaluates the current head.
- queue ref deleted or rewound: next push recreates it; the predicate only
  ever reads the head. `scripts/ops/rebuild-queue.mjs <sha>` is the surgical
  tool for dropping a confirmed-broken candidate mid-chain — it replays the
  candidates above the dropped sha in a scratch worktree and force-pushes with
  `--force-with-lease` pinned to the old head, so a lane that pushed in the
  meantime is not clobbered.
- only one candidate runs: the queue guard refuses stacked pushes instead of
  cancelling the running candidate.
- classification evaluates the candidate's whole stacked diff: the classify
  step merge-bases `origin/main` for queue pushes rather than diffing the
  incremental push, so a docs-only push on top of broken code cannot skip
  the e2e/integration tiers and green-wash the stack.

## One candidate at a time (pilot, 2026-11-19)

Problem: stacked candidates cancelled each other's `ci` run, so only the chain
head was ever tested; a red head blocked every lane and only its owner could
remove it, by hand, once with the wrong commit dropped.

- `ci` no longer cancels queue runs: queue pushes use the per-SHA group like
  `main`, so a refused stacked push cannot cancel the running candidate.
- `queue-guard.yml` runs on every push to `queue/main`. When the previous head
  has not landed on `main` and the new head contains it, it resets the ref to
  the previous head, comments on the refused commit with what it waits on and
  who owns it, and cancels the refused commit's `ci` run.
  `scripts/ops/push-queue.mjs` gives the same answer before the push.
- `promote-queue.mjs --enforce` (used by `promote.yml`): when the head's run
  concluded `failure` and a job failed or timed out (cancelled jobs do not
  count), the failed jobs are rerun once (`rerun-failed-jobs`). If the
  rerun, `run_attempt` 2, still has a failed job, the candidate is dropped.
- Drop plan: the commits at the tip with the same `Amp-Thread-ID` go
  together; commits below them from other threads stay and the ref moves
  back to the last of those; with no thread marker the unmarked commits drop
  alone. The ref moves with `--force-with-lease` pinned to the failed head, so
  a lane that pushed in the meantime is not clobbered. A commit comment and
  the run summary name the failing run and the owner threads.
- Notification limit: the workflow has no Amp credential, so it cannot message
  a thread. The owner learns from the push refusal text, the commit comment
  and the `promote` run summary.
- Metrics for the pilot: median queue-to-main time, cancelled `ci` runs,
  total red-stuck time, repairs and reverts after landing, measured over seven
  days before and after.

## Enforcement phase (separate flip, owner's call)

Repository ruleset on `main`: required status checks `check`, `pack-smoke`,
`e2e-gate`. Check runs bind to the SHA, so pushing an already-green `S` is
accepted while pushing an untested SHA is rejected by GitHub itself — the SHA
carries its own authorization, no bypass list or bot identity is needed. Verify
on flip day that GitHub evaluates the pushed head's existing checks this way;
if it only governs PR merges, fall back to "restrict pushes + ian on bypass"
which keeps lanes honest via AGENTS.md but is toothless by itself.

## Rollout

1. Done: `ci.yml` triggers on `queue/**` pushes; the promote script and tests
   landed.
2. Done (2026-11-18): the `green-main` ruleset requires `check`, `pack-smoke`
   and `e2e-gate` green on the pushed commit — verified live: an untested
   `HEAD:main` push is rejected with "3 of 3 required status checks are
   expected". AGENTS.md ship steps switched to `queue/main` in the same change.
3. Done (2026-11-19): `.github/workflows/promote.yml` listens on
   `workflow_run` for completed `ci` runs on `queue/**` and runs the same
   promote predicate, so lanes do not need a local watcher. It pushes with
   the `cairn-release` app token — GITHUB_TOKEN pushes cannot carry commits
   that touch `.github/workflows` and would not re-trigger `desktop-release`.
   Verified live on the first two workflow_run events: both fired on queue
   completions and failed in setup because `actions/setup-node` auto-enables
   `package-manager-cache` for pnpm, which the job does not install — fixed
   by disabling the cache (`a9e6004c3`). The trigger wiring, the
   `desktop-release` environment secrets and the app-token checkout all
   worked on the first attempt.
   Remaining optional work: batching policy and prepush slimming.

## Tests

- `promote-queue.test.mjs`: predicate matrix — green run promotes; running,
  cancelled, failed or missing runs do not; stale base refuses; the three job
  names are required, not any aggregate conclusion.
- `workflow-concurrency.test.mjs`: queue, main and other refs use per-SHA
  groups that never cancel.
- `guard-queue.test.mjs`, `push-queue.test.mjs`: refuse a stacked push, allow
  creation, deletion, rewrite and a push after landing, and the wait message.
- `promote-queue.test.mjs` also covers rerun-once, drop, cancelled jobs, owner
  grouping and the drop notice.
- `rebuild-queue.test.mjs`: mid-chain drop replays successors in order,
  head drop lands on the commit below, single-candidate drop deletes the
  ref, unknown sha refuses.
- Self-test: push the change itself as `queue/main`, watch its run, promote it
  with the script — the mechanism lands itself.
