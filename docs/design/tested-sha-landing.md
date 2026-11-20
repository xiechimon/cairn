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
- inside that run, jobs `check`, `pack-smoke` and `e2e-gate` all succeeded.
  `desktop-release` publishes on app-source pushes without gating, so these
  three jobs are enforced nowhere else — the queue gate is the first place
  they must be green;
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
  ever reads the head. `scripts/ops/rebuild-queue.mjs <sha>` is the operator's surgical
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
remove it, by hand. The pilot also hit sessions that did not know the owner of
the red candidate deleting `queue/main` and pushing onto the empty ref, which
skipped the rerun and the one-candidate rule, and a `promote` run that picked
the `queue-guard` run for the head SHA and waited on `check` forever.

- `ci` no longer cancels queue runs: queue pushes use the per-SHA group like
  `main`, so a refused stacked push cannot cancel the running candidate.
- Only `push-queue.mjs` touches `queue/main`. It refuses while a candidate is
  live, names the commit, its `ci` state and its owner, and stamps
  `Lane: <host>/<worktree>` on commits that carry no `Amp-Thread-ID` or `Lane`
  trailer, so Claude Code sessions and Cairn tasks have an owner too.
- A candidate is live while it has not landed on `main` and has no
  `queue/main release:` comment. `queue-guard.yml` keeps the live candidate in
  `queue-state/main`, a branch that no workflow watches and that keeps the
  commit reachable after `queue/main` is deleted.
- Guard on `push` to `queue/main`: when a live candidate exists and the push
  is not the promoter's, the push is refused whether it stacks on the
  candidate, replaces it, or recreates the ref after a deletion. `queue/main`
  is put back to the live candidate, the refused commit gets a comment naming
  what it waits on, and its `ci` run is cancelled.
- Guard on `delete` of `queue/main`: a live candidate is recreated at once, the
  candidate gets a comment, and `promote` is dispatched when the candidate's
  `ci` run already finished (its own completion event may have come and gone).
  Deleting and pushing a few seconds later is therefore undone twice over:
  whichever event runs first restores, the other finds the ref already right.
- The promoter is the only actor allowed to remove a live candidate, because
  it acts as `cairn-release[bot]`. `state` follows the guard's last allowed
  change, with `before` of the push as a fallback so the first run after
  rollout still protects a candidate that was pushed before it existed.
- Operator hatch: a comment starting `queue/main release:` on the live commit
  makes the candidate not live. `rebuild-queue.mjs` posts it before it rewrites
  or deletes the ref. A plain deletion by hand gets restored.
- A deletion that nobody follows with a push is undone as well, so a lane
  cannot clear a red candidate it dislikes; the `promote` workflow reruns and
  drops it.
- `promote-queue.mjs --enforce` (used by `promote.yml`): the head's `ci` run
  (matched by workflow name, never another run on the same SHA) that ended
  `failure` with a failed or timed out job gets those jobs rerun once
  (`rerun-failed-jobs`); a run that ended `cancelled`, or `failure` with only
  cancelled jobs, is rerun whole once. After the rerun (`run_attempt` 2) the
  candidate is dropped when it is still not green. A candidate that does not
  contain `main` (a direct push moved it) is dropped at once. A missing queue
  is idle, not an error.
- Drop plan: the commits at the tip with the same owner (`Amp-Thread-ID` or
  `Lane`) go together; commits below them from other owners stay and the ref
  moves back to the last of those; commits without an owner drop together. The
  ref moves with `--force-with-lease` pinned to the failed head, so a lane that
  pushed in the meantime is not clobbered. A commit comment and the run
  summary name the reason, the failing run and the owners.
- Notification limit: Actions has no credential for Amp threads, Claude Code
  sessions or Cairn tasks. The owner learns from the push refusal text, the
  commit comment and the `promote` run summary.
- Metrics for the pilot: median queue-to-main time, cancelled `ci` runs,
  total red-stuck time, repairs and reverts after landing, measured over seven
  days before and after.

## Enforcement phase (separate flip, owner's call)

Repository ruleset on `main`: required status checks `check`, `pack-smoke`,
`e2e-gate`. Check runs bind to the SHA, so pushing an already-green `S` is
accepted while pushing an untested SHA is rejected by GitHub itself — the SHA
carries its own authorization, no bypass list or bot identity is needed. Verify
on flip day that GitHub evaluates the pushed head's existing checks this way;
if it only governs PR merges, fall back to "restrict pushes + owner on bypass"
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
   Remaining optional work: batching policy and prepush slimming.

## Tests

- `promote-queue.test.mjs`: predicate matrix — green run promotes; running,
  cancelled, failed or missing runs do not; stale base refuses; the three job
  names are required, not any aggregate conclusion.
- `workflow-concurrency.test.mjs`: queue, main and other refs use per-SHA
  groups that never cancel.
- `guard-queue.test.mjs`, `push-queue.test.mjs`: refuse a stacked, replacing or
  recreating push, restore a deleted live candidate, let only the promoter
  remove one, owner stamping and the wait message.
- `promote-queue.test.mjs` also covers rerun-once, drop, cancelled runs, a
  second workflow run on the same SHA, stale and missing queue, owner trailers
  and grouping, and the drop notice.
- `rebuild-queue.test.mjs`: mid-chain drop replays successors in order,
  head drop lands on the commit below, single-candidate drop deletes the
  ref, unknown sha refuses.
- Self-test: push the change itself as `queue/main`, watch its run, promote it
  with the script — the mechanism lands itself.
