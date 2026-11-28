# Tested-SHA landing queue

Problem: pushes landed on `main` before CI finished, so red commits arrived first
and were diagnosed later. Prior art is in
`docs/research/2026-11-18-green-main-landing.md`; this describes the mechanism
as it runs today.

Because `xiechimon/cairn` is a User-owned repository that lands without pull
requests, GitHub's native Merge Queue does not apply. A serial queue would make
every concurrent lane discard its pre-flight run and wait for another full CI run
whenever a different lane landed, so the queue tests stacked candidates in
parallel. `ci.yml` uses per-commit concurrency on pushes, so those runs never
cancel one another.

## What GitHub enforces

The `green-main` ruleset covers `refs/heads/main`: required status checks
`check`, `pack-smoke` and `e2e-gate`, no deletion, no non-fast-forward push, no
bypass actor. Check runs bind to a SHA, so pushing an already green commit is
accepted and pushing an untested one is rejected.

## Refs

- `refs/heads/enqueue/<13-digit-ts>-<sha9>`: one inbox ref per submission,
  written by `push-queue.mjs`. `ci.yml` does not match it, so enqueueing starts
  no CI run. Order is the timestamp. `repo-hygiene.mjs` preserves `enqueue/*`.
- `refs/heads/queue/try/<id>`: written only by the promoter. It holds entry `id`
  rebased onto `main` plus every active entry ahead of it, up to
  `MAX_SPECULATIVE_DEPTH = 4`. Pushing it starts `ci`, and a finished `ci` run
  on `queue/**` wakes `promote.yml`.

## Submitting (`scripts/ops/push-queue.mjs`)

- It stamps `Lane: <machine id>/<worktree>` on commits in `origin/main..HEAD` that have
  no `Amp-Thread-ID` or `Lane` trailer, runs the English-only gate, and requires
  green `check` + `pack-smoke` + `e2e-gate` on the exact SHA of `HEAD` (or a
  tested clean-rebase `preflight/<lane>` ancestor with identical patch-ids via
  `scripts/ops/rebase-equivalence.mjs`, in which case `queue/try/*` still tests
  the merged tree). `preflight.mjs` stamps before it pushes, so the SHA it tested
  is the one submitted; a later code edit or conflict resolution needs a new
  pre-flight run.
- It pushes `HEAD` to `enqueue/*` (reusing the ref when that SHA is already
  queued) and dispatches `promote.yml`. If the dispatch fails, the schedule
  backstop picks the entry up.
- With `--wait` it first pushes the pre-flight ref itself when the evidence is
  missing and stops on a red run. After enqueueing it polls every 15s
  (`PUSH_QUEUE_POLL_SECONDS`) until the change is on `origin/main` or the entry
  is gone with a removal comment. `PUSH_QUEUE_WAIT_MINUTES` (default 120) bounds
  the wait; transient network errors, and a fetch that lost a race with another worktree updating the shared `origin/main` ref, are retried.

## Promoting (`scripts/ops/speculative-queue.mjs --enforce`)

- **Prune and admit.** Entries already on `main`, or carrying a
  `queue/main release:` comment, are removed, as are `try` refs with no entry in
  the window. An entry is admitted if the three green checks pass on its exact
  SHA (`exactVerified`) OR on a tested `preflight/<lane>` SHA `S` where
  `isCleanRebaseOf` holds cleanly against `main` (`rebase-only` admission). Any
  unverified entry is ejected.
- **Window.** The first four entries are active. The first one, when it is
  `exactVerified`, contains the `main` tip, and has no `try` ref, is already
  tested and counts as green (a `rebase-only` entry with `exactVerified = false`
  must still run `queue/try/*` on its rebased tree). Later entries can count
  without a ref of their own too (*Verdict reuse*). Otherwise a `try` ref is
  kept, with its running CI, while it sits on the expected parent and carries
  the same commits; if not, it and everything after it are rebuilt in a
  temporary worktree.
- **Batch fast-forward.** The furthest position in the valid prefix that may be
  passed to is pushed to `main`, because its tree contains the earlier ones.
  Superseded runs are cancelled, `enqueue/*` and `try` refs are deleted, and the
  next window is planned at once. What may be passed depends on the runs ahead:

| Run ahead | Green queue run behind it | Entry behind it with only its pre-flight evidence |
|---|---|---|
| Green | lands both | lands both |
| First attempt pending or running | lands both | waits |
| Failed once and waiting for its retry, retry pending or running, or failed twice | waits | waits |

  A first attempt that is still running with a job already failed counts as
  running.
- **Carried commits.** The table only sees positions still in the window, so just
  before `main` is pushed the promoter reads the `queue/*` run of every commit in
  each landing entry's candidate and own history that is not on `main`. That
  covers a commit whose own entry has left the queue: ejected, released, or
  stacked on by another lane. The first commit with an unsettled failure decides
  one action:

| Its run | Action on the entry that brings the commit | What moves it next |
|---|---|---|
| First attempt failed | rerun it once and hold only the carrier | the retry finishes |
| Retry pending or running | hold only the carrier | the retry finishes |
| Attempt 2 was cancelled with no failed job | rerun it whole once (attempt 3) and hold only the carrier | that replacement rerun finishes |
| Attempt 2 was cancelled with a failed job, or attempt 3+ was cancelled | eject only the carrier, naming the commit | the same pass plans without it |
| Retry failed | eject only the carrier, naming the commit | the same pass plans without it |
| Transient rerun error (5xx, 401, 429, rate limit, network) | hold only the carrier | the next pass tries again |
| Permanent 4xx rerun refusal (after re-reading confirms no retry in flight or green completion) | eject only the carrier, naming the commit and HTTP status | the same pass plans without it |

  Holding is not waiting for the whole queue: the same pass lands the entries
  ahead of the held one and still builds, retries and ejects behind it. A first
  attempt that was only cancelled is not a failure: the queue cancels superseded
  runs itself. A commit that never had a queue run, such as the inner ones of a
  multi-commit submission, has nothing to read. The owner of an ejected entry
  drops the commit or squashes its fix into it.
- **One retry.** A first-attempt run that did not succeed has its failed jobs
  rerun; a run with only cancelled jobs is rerun whole.
- **Attribution.** Only the head entry is ever ejected for red CI, once a second
  attempt is red: an entry behind it may be red because of what is ahead of it.
  Obsolete downstream runs are cancelled and the rest are rebuilt on `main`; a
  follower run whose `try` ref stays valid on `main` is left running.
- **Conflict.** An entry that does not rebase cleanly is ejected with the
  conflicting paths, and the tail is rebuilt on the last good parent.

Every ejection is a comment on the entry's commit that names the reason, the run
or files, and the owner. Actions has no way to message an agent session, so the
owner learns from that comment and from `push-queue.mjs --wait`.

An operator who must remove a queued candidate first comments
`queue/main release: <reason>` on its commit. Nobody else removes a queue ref.

## Verdict reuse (2026-11-26)

Invariant: a tree reaches `main` only if a `ci` run on that exact tree ended green. `green-main` still reads check runs on the exact SHA; a new SHA always gets its own `ci` run, which is short when the tree is already verified.

- **Entry unchanged on its tested base**: at any window position, not only the head, when `entry_i` contains `expectedParent` its preflight-green SHA is the speculative candidate. No `queue/try` ref is pushed; a stale `try_i` ref is deleted and its run cancelled, so that cancelled attempt is never counted against a later one. This evidence predates the entries ahead, so it lands only once they are all green (*Batch fast-forward*).
- **Entry that adds nothing**: when every patch of `entry_i` is already in `try_{i-1}` (two submissions of one change), it shares that candidate and its verdict, including red: the first of the two is ejected, and the second is then evaluated again on its own base.
- **Rebuild that does not change the tree** (the entry ahead landed under another SHA): while `try_i`'s run is in flight and the rebuilt tree equals its tree, the ref and run stay. Later entries are built on, or kept on, the held `try_i`; a conflict against a held base that does not contain current `main` is not evidence against the entry, so it waits for the held run instead of being ejected. When the run ends, the next pass pushes the rebuilt SHA, which reuses the green run. Only runs whose entry gets another tree are cancelled.
- **Tree reuse in `ci`** (`scripts/ops/ci-reuse-verified.mjs`, the same mechanism `main` uses): a `queue/try/*` push reuses a completed green `ci` run from `preflight/*` or `queue/*` whose `head_commit.tree_id` equals its own tree, among the newest 300 successful push runs. `check` and `e2e-gate` pass without the test matrix; `pack-smoke` is skipped. `main` still requires the exact SHA.

| Situation | Behaviour |
|---|---|
| Red entry ejected mid-stack | Later entries get different trees; stale runs are cancelled and the new trees run the full matrix |
| Rebase conflict | Ejected with the conflicting files; no verdict is reused for it |
| Source run failed, cancelled or still running | Never a source |
| Held run fails or is cancelled | The next pass pushes the rebuilt SHA, which finds no green source and runs in full |
| Rebuild resolves to the entry's own SHA or its parent | No push; the position is covered by existing evidence |
| Tree carries the sidecar | No tree reuse; `main` must build the sidecar artifact itself |
| Two entries with the same tree | An entry that adds nothing shares the candidate ahead; unrelated concurrent runs of one tree both run |
| Eval required | The source run needs a green `eval` job |
| Lookup or jobs API error, missing tree | Fails closed to the full matrix |
| Source classified against an older `main` | Its diff covers the later one, because the identical tree already contains the newer `main` |

## Failure behaviour

- `ci` run pending or running: wait. A cancelled run is never green.
- `main` moved during a promotion: the push is not a fast-forward; the promoter
  reads the new tip and rebuilds the queue on it.
- The ruleset can lag the check-runs API and refuse a green push with
  `GH013 … required status check`. The push is retried up to 8 times with
  exponential backoff (10s doubling, capped at 120s), re-checking `main` before
  each retry. Any other push failure stops the pass with git's exit status.
- The promoter or `push-queue.mjs` dies: the state lives in git refs and GitHub
  runs, so the next pass continues from it.
- CI classification of a queue push diffs from the merge base with `origin/main`,
  so a docs-only commit on top of broken code cannot skip the code tiers.

After a landing, every issue named by `Closes #N`, `Fixes #N` or `Resolves #N`
in the landed commits is closed with a comment naming the commit. GitHub's own
closing keywords do not fire for pushes made with the GitHub App token that
`promote.yml` uses. Closed issues are skipped, `Part of` is ignored, and a failed
close only warns.

## Trust boundary

`promote.yml` runs from `main` (a `workflow_run` on `queue/**`, a push to `main`,
`workflow_dispatch`, and a 5-minute schedule backstop) with
`concurrency: promote-main` and `cancel-in-progress: false`. It pushes with the
`cairn-release` App token from the `desktop-release` environment, which only
`main` may use: a `GITHUB_TOKEN` push cannot carry workflow-file changes and
would not wake `desktop-release`.

## Desktop release

Each completed CI run on `main` wakes the level-triggered poller; the
fifteen-minute schedule and manual dispatch to `main` are backstops, not
a latency bound. The poller scans current `main` history newest first,
excluding ancestors of the highest-version published stable desktop
release. A candidate needs its own completed push-to-main CI attempt
with green `check`, `pack-smoke` and `e2e-gate`, and changed shipped
sources. Pending or red tip CI does not block an older eligible SHA.

The short `desktop-release-reserve` job group serializes selection and
allocation. The trusted workflow revision reserves the first version not
held by a tag or release in a new empty draft at the selected SHA. Drafts
occupy names but do not raise the version base. Prereleases are not
migration or publication baselines. A draft whose owner is still active
suppresses only an identical candidate; its owner is the recorded
workflow run and workflow revision. Finished owners and their drafts
do not prevent a new attempt at that SHA using a fresh version.

Versions are built in, never renamed. Distinct candidates package in
parallel. Signed ARM64 smoke, both journey modes and migration verify
the same run's update ZIP independently. Publication requires all
platform packages, those verifiers and the isolated `live-verify`
new-task journey, which archives its evidence.

The `desktop-release` group serializes finalization. Admission checks
exact-SHA CI and main ancestry and requires a newer version and a strict
descendant of the highest stable release. If the baseline moved since
migration passed, the finalizer replays that check against the new
baseline. Migration does not get the release App credentials. The
trusted workflow revision alone writes through the App token: it reads
the reserved draft by ID, confirms the owner, SHA and tag and that it is
empty, uploads assets to that numeric ID, then rechecks main ancestry,
existing stable coverage, stable version/ancestry and migration baseline,
the free tag, the draft and, last, exact-SHA CI. A single PATCH flips it
public and latest; the flip, not a separate tag write, creates the tag.
First-party finalizers cannot interleave; external API changes after the
last read can still race the flip.

Nothing deletes a release or a tag. An interrupted build or publish
can leave an occupied draft; a fresh trigger reserves a new draft,
never reusing partial assets. Operators can delete abandoned drafts
manually if needed. Use a fresh dispatch rather than a job rerun.
When changing the poller, cancel unfinished runs at older workflow
revisions and do not rerun one: GitHub reruns its original definition.

## Tests

- `speculative-queue.test.mjs`: FIFO order of `enqueue/*`, admission, batch and
  partial-prefix promotion, what each run state ahead lets through, mid-queue red without false blame, one retry then
  ejection and tail rebuild, conflict ejection, depth 4, external `main` advance,
  a real bare-git rebase and promote run, and `runQueuePass` against a bare
  remote with a stub `gh` for the verdict-reuse rules.
- `ci-reuse-verified.test.mjs`, `ci-tiers.test.mjs`,
  `merge-queue-invariants.test.mjs`: which runs may be a reuse source, and which
  refs the `check` and `e2e-gate` aggregates accept it on.
- `push-queue.test.mjs`, `merge-queue-invariants.test.mjs`: submission, owner
  stamping, waiting, and the invariants a scheduling change must keep.
- `workflow-concurrency.test.mjs`: queue, `main` and other refs use per-SHA
  groups that never cancel.
- `promote-queue.test.mjs`: the helpers the live queue imports from
  `promote-queue.mjs`: owner trailer, issue closing, and the push to `main` with
  its retry on ruleset check lag.
- `release-gate.test.mjs` and `release-plan.test.mjs`: exact-SHA CI and
  stable coverage, allocation around occupied names, same-SHA reservation
  deduplication, wake triggers, and the verification and finalization DAG.
- `desktop-release.test.mjs`: packaged inputs, stable ancestry and migration
  baseline, draft and asset identity, final guard ordering, and no tag or
  release deletion.
