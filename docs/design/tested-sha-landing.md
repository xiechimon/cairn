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
  the same three names the `green-main` ruleset requires on the pushed commit
  and `desktop-release` re-verifies before publishing. `desktop-release` is
  a level-triggered poller, not a push reaction: it runs on a 15-minute
  `schedule` and on `workflow_dispatch` to `main` only, so trusted `main`
  code still runs it. Runs serialize on one workflow-level concurrency
  group that never cancels the running release (`desktop-release`,
  `cancel-in-progress: false`); GitHub keeps only the newest pending run,
  so a later tick or dispatch replaces an earlier pending one and a run
  that finds the slot busy waits. Nothing retries a failed or replaced run
  as such: a later tick evaluates the `main` tip current at that time,
  and no re-dispatch job exists. Each run resolves the current
  `main` tip through the branches API and checks it out, then
  `scripts/ops/release-decide.mjs` judges it once: it plans the release
  from the `desktop-v*` tags and releases
  (`scripts/ops/release-plan.mjs`), reads the tip's push-to-`main` `ci`
  run (`scripts/ops/release-gate.mjs`) and diffs the shipped app sources
  against the highest-version published stable `desktop-v*` release.
  The run releases only when all three hold — the ci run's latest attempt
  ended `success` with green `check`/`pack-smoke`/`e2e-gate` jobs, shipped
  sources moved, and no published stable `desktop-v*` release's tag
  points at the tip — and exits successfully doing nothing otherwise:
  pending ci, red ci, unchanged sources and an already released tip are
  all skips, and a manual dispatch runs the identical check with no
  source-diff bypass. Nothing is staged or resumed: a releasing run
  always allocates a fresh version once, at decide time — the first
  `desktop-v*` name held by no tag and no release, published,
  prerelease or draft. Drafts reach the deciding token because the
  job's `contents` scope is `write`, the only scope GitHub answers
  with drafts; the checkout drops it (`persist-credentials: false`).
  A draft only ever occupies its own name — it never raises the base
  version, counts as a release, a baseline or the bar for `latest`. A
  prerelease still counts for the allocation base but for nothing
  else, and releases created by hand are outside the workflow
  entirely. `publish` runs with the release-app credential, which sees
  drafts too — and the workflow never deletes a release or a tag, so a
  leftover draft just occupies its version, which `decide` already
  skipped; an abandoned draft can never block a later poll, and an
  operator who wants the number back deletes the stale draft by hand.
  The source-diff
  and migration baselines are the highest-version published stable
  release, chosen by semver and never by list order, so a backfilled
  older release cannot lower them. `decide` picks the version once
  and passes it to both architectures and to `publish`; nothing renames
  or bumps it afterwards — the packaged app, the assets, the manifest
  and the tag all carry the decided version. Fifteen minutes is the polling cadence, not
  a bound on release latency — the price of removing the edge-triggered
  races: a tick that finds the slot busy queues behind the active build,
  and the tip can be superseded while it packages. `publish`
  re-reads the evidence: the run's latest attempt must have ended
  `success` with green jobs inside `runs/{id}/attempts/{attempt}/jobs`,
  and an attempt that started or moved between the jobs read and the run
  re-read blocks it, as does a newer still-running, failed or cancelled
  attempt. The publish step never creates or pushes a tag itself: it
  first refuses when `refs/tags/desktop-v$VERSION` already exists
  (`GET .../git/ref/tags/`), whatever it points at — an occupied tag is
  never adopted and the next poll allocates a fresh version above it.
  `POST /repos/{o}/{r}/releases` then stages a fresh draft owned by
  this run, never resumed from an existing one: `draft: true`,
  `tag_name` set to the decided tag and `target_commitish` pinned to
  the release SHA — a draft creates no tag, so nothing on the remote
  carries the version yet — and the response's numeric `id` is the
  only handle used from there on. Every asset is uploaded to
  `releases/{id}/assets`. With the upload done the evidence is re-read
  one last time — the `main` tip (`scripts/ops/release-tip.mjs`),
  stopping when `main` moved past the resolved tip so an out-of-order
  `ci` completion can never ship older code as the latest update,
  whether a published stable `desktop-v*` release's tag
  already covers the SHA (`scripts/ops/release-plan.mjs`), and the
  version still above the highest published stable release
  (`scripts/ops/release-version.mjs`) — the tag is probed once more and
  the ci attempt's green evidence is re-read last
  (`scripts/ops/release-gate.mjs`), so a rerun that started during the
  scans still blocks it; the draft itself is re-read by numeric id and the
  publish refuses unless it still is a draft holding the decided tag and
  the checked SHA, and only then does a single `PATCH /releases/{id}`
  send `draft: false` and `make_latest: true` and nothing else — a draft
  retargeted during the upload is abandoned, never renamed back, and
  GitHub creates the tag at the `target_commitish` the draft still holds. Any of those re-checks
  failing aborts the step and leaves the staged draft — no tag exists
  to clean: a `main` that moved, ci that turned, a stable release that
  appeared over the same commit, a higher version that landed during
  the upload or a tag that appeared in it each refuse the publish. A
  publish-only rerun of an old run can therefore never release the same
  SHA twice — the coverage read catches the stable release a later run
  already published. A failed or killed publish can leave its draft
  behind: the workflow deletes nothing, the draft only occupies its
  name — `decide` steps past it on the next poll — and an operator
  deletes it by hand if they want the number back. The window that remains is accepted, not
  defended by another read: between the final tag probe and the
  flip — seconds — a tag created in it is adopted by the publish, and
  a `main` push or a ci rerun that lands can still
  publish the checked state, and the next release then publishes the
  newer tip and moves `latest` to it. Closing the window entirely would
  need the release write coordinated with main promotion and ci reruns
  rather than separate API reads. A red tip therefore delays releases until
  `main` is green again; that stall is intended, not a bug. `publish`
  also waits on the `live-verify` job, which drives the new-task journey
  on an isolated stack and archives the evidence as an artifact.
- `S` still equals `queue/main` head (a lane may have stacked a newer candidate;
  promoting `S` then is still correct — `main` fast-forwards to `S` and the
  newer candidate waits for its own green run);
- `S` contains `origin/main` tip (else the push is non-fast-forward → the
  candidate is stale → report, do not promote).

On green the script runs `git push origin S:refs/heads/main`. The push uses the
caller's normal `gh` login, so it also triggers the ordinary main CI run that
any future green-checking watcher or ruleset would consume.

The `green-main` ruleset's view of check state lags the check-runs API the
script reads, so a green push is intermittently refused with `GH013 … required
status check … is expected`. The script retries that refusal up to 8 times with
exponential backoff (10s doubling, capped at 120s), re-verifying before each
retry that `queue/main` still points at `S` and `main` has not moved — a `main`
that already contains `S` counts as landed. Any other push failure, or a
refusal that survives all attempts, exits with git's real status code.

After the push lands, the same code path closes every issue named by a
`Closes #N`, `Fixes #N` or `Resolves #N` trailer in the commits the push moved
onto `main` (`main_before..main_after`), posting a comment that names the
commit(s) first. This exists because GitHub's closing-keyword processing only
runs on pushes made by a user credential — pushes made by the `cairn-release`
GitHub App token (the `promote` workflow) create `referenced` events but never
close. The step is idempotent (it skips issues already closed), never touches
`Part of` trailers, and warns instead of failing when a call fails — a failed
close never fails the landing. Both the workflow run and a local
`promote-queue.mjs --enforce` go through it.

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
- `push-queue.mjs --wait` automates the competitive entry path: while a
  candidate is live it rebases the lane's commits onto that candidate (the
  landed candidate becomes `main`, so a head that contains it fast-forwards
  over the ref when the window opens), pushes the head to the lane's
  `preflight/<lane>` ref so the evidence gate is already green, and polls
  until the candidate resolves. A landing means the lane's stack is exactly
  its own commits again; a drop moves the lane's commits back onto
  `origin/main` instead of resurrecting the dropped commits. A red preflight
  run stops the wait and names the failed contexts. `PUSH_QUEUE_WAIT_MINUTES`
  (default 120) bounds the wait; `PUSH_QUEUE_POLL_SECONDS` (default 15) the
  poll cadence.
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
4. Rollout day for the poller: cancel every `desktop-release` run started
   on the pre-poller workflow and never rerun one — GitHub reruns a
   workflow at its original revision, so a rerun of a pre-change run
   publishes without the gate. The schedule retries an eligible tip on
   its own; a tag or release left behind by a failed publish is skipped
   past by version — the next run allocates above it.

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
- `release-gate.test.mjs`: the release gate waits on a missing or running
  `ci` run, re-reads the run around the pinned jobs so a superseded attempt
  cannot publish, blocks a red or cancelled latest attempt, and releases
  only while the candidate is still the `main` tip (`release-tip.mjs`);
  `decideRelease` releases a green, changed, unreleased tip and skips a
  pending, red, unchanged or already released one, holding a manual
  dispatch to the same rule; `planRelease` picks the first `desktop-v*`
  version held by no tag and no release — a published stable release on
  the tip ends the run, drafts and prereleases each occupy their
  version, and a run of occupied names is skipped without a cap;
  `publish` refuses any existing
  `desktop-v*` tag, stages the release as a draft through the REST
  `POST` and keeps its numeric id, uploads the assets to that id,
  re-reads the tip, the stable-release coverage of the
  SHA and the `latest` decision (`release-version.mjs`), probes the tag
  once more, re-reads the draft by numeric id and refuses unless it still
  is a draft at the decided tag and SHA, re-reads the ci attempt as the
  last check, then flips the draft published sending only `draft: false`
  and `make_latest: true`, so a draft retargeted during the upload is
  abandoned rather than renamed back — a failed re-check aborts the step and leaves
  the draft for an operator to delete by hand, the step never deleting
  a release or a tag, and a
  rerun that finds the SHA
  already covered or the version occupied refuses; the workflow
  shape is `schedule` plus
  `main`-only dispatch on one concurrency group that never cancels the running release, with
  no re-dispatch path.
- Self-test: push the change itself as `queue/main`, watch its run, promote it
  with the script — the mechanism lands itself.
