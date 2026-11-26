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

- It stamps `Lane: <host>/<worktree>` on commits in `origin/main..HEAD` that have
  no `Amp-Thread-ID` or `Lane` trailer, runs the English-only gate, and requires
  green `check` + `pack-smoke` + `e2e-gate` on the exact SHA of `HEAD`.
  `preflight.mjs` stamps before it pushes, so the SHA it tested is the one
  submitted; a later commit, rebase or amend needs a new pre-flight run.
- It pushes `HEAD` to `enqueue/*` (reusing the ref when that SHA is already
  queued) and dispatches `promote.yml`. If the dispatch fails, the schedule
  backstop picks the entry up.
- With `--wait` it first pushes the pre-flight ref itself when the evidence is
  missing and stops on a red run. After enqueueing it polls every 15s
  (`PUSH_QUEUE_POLL_SECONDS`) until the change is on `origin/main` or the entry
  is gone with a removal comment. `PUSH_QUEUE_WAIT_MINUTES` (default 120) bounds
  the wait; transient network errors are retried.

## Promoting (`scripts/ops/speculative-queue.mjs --enforce`)

- **Prune and admit.** Entries already on `main`, or carrying a
  `queue/main release:` comment, are removed, as are `try` refs with no entry in
  the window. An entry without the three green checks on its SHA is ejected.
- **Window.** The first four entries are active. The first one, when it contains
  the `main` tip and has no `try` ref, is already tested and counts as green.
  Otherwise a `try` ref is kept, with its running CI, while it sits on the
  expected parent and carries the same commits; if not, it and everything after
  it are rebuilt in a temporary worktree.
- **Batch fast-forward.** The furthest green position in the valid prefix is
  pushed to `main`, even while earlier positions are still running, because its
  tree contains theirs. Superseded runs are cancelled, `enqueue/*` and `try`
  refs are deleted, and the next window is planned at once.
- **One retry.** A first-attempt run that did not succeed has its failed jobs
  rerun; a run with only cancelled jobs is rerun whole.
- **Attribution.** Only the head entry is ever ejected for red CI, once a second
  attempt is red: an entry behind it may be red because of what is ahead of it.
  Obsolete downstream runs are cancelled and the rest are rebuilt on `main`.
- **Conflict.** An entry that does not rebase cleanly is ejected with the
  conflicting paths, and the tail is rebuilt on the last good parent.

Every ejection is a comment on the entry's commit that names the reason, the run
or files, and the owner. Actions has no way to message an agent session, so the
owner learns from that comment and from `push-queue.mjs --wait`.

An operator who must remove a queued candidate first comments
`queue/main release: <reason>` on its commit. Nobody else removes a queue ref.

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

`desktop-release` is
a level-triggered poller, not a push reaction: it is woken by a
`workflow_run` on every `ci` run completed on `main`, by a 15-minute
`schedule` backstop — GitHub's schedule trigger is best-effort and can
delay or drop ticks for hours — and by `workflow_dispatch` to `main`
only, so trusted `main` code still runs it. The wake is still
level-triggered: the run scans current `main` history rather than
trusting the event's SHA. Runs serialize on one workflow-level concurrency
group that never cancels the running release (`desktop-release`,
`cancel-in-progress: false`); GitHub keeps only the newest pending run,
so a later wake or dispatch replaces an earlier pending one and a run
that finds the slot busy waits. Nothing retries a failed or replaced run
as such: a later wake scans current `main` again, and no re-dispatch job
exists. Each run resolves main through the branches API and checks out its
full history. `scripts/ops/release-decide.mjs` scans newest first, excluding
ancestors of the highest-version published stable `desktop-v*` release.
It selects the newest unreleased commit whose own push-to-main CI's latest
attempt completed `success` with green `check`/`pack-smoke`/`e2e-gate`
(`scripts/ops/release-gate.mjs`) and whose shipped app sources moved since
that stable release. Pending or red CI on the tip does not block an older
eligible commit. No eligible candidate means a successful skip; manual
dispatch follows the identical rule without a source-diff bypass.
Both builds and live verification pin the selected SHA, while publish
control scripts come from the trusted workflow revision so selecting an
older candidate cannot restore an obsolete release gate. Nothing is staged or resumed: a releasing run
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
and the tag all carry the decided version. The ci-completion wake and the
fifteen-minute backstop are polling cadence, not
a bound on release latency — the price of removing the edge-triggered
races: a wake that finds the slot busy queues behind the active build,
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
one last time — the candidate must remain an ancestor of current `main`
(`scripts/ops/release-tip.mjs`); main advancing during packaging is allowed,
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
to clean: a candidate outside `main`, ci that turned, a stable release that
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
rather than separate API reads. A red or pending tip does not delay an
older eligible green ancestor. `publish`
also waits on the `live-verify` job, which drives the new-task journey
on an isolated stack and archives the evidence as an artifact.

On rollout of a change to the poller, cancel every `desktop-release` run started
on the previous workflow and never rerun one: GitHub reruns a workflow at its
original revision, so such a rerun publishes without the current gate.

## Tests

- `speculative-queue.test.mjs`: FIFO order of `enqueue/*`, admission, batch and
  partial-prefix promotion, mid-queue red without false blame, one retry then
  ejection and tail rebuild, conflict ejection, depth 4, external `main` advance,
  and a real bare-git rebase and promote run.
- `push-queue.test.mjs`, `merge-queue-invariants.test.mjs`: submission, owner
  stamping, waiting, and the invariants a scheduling change must keep.
- `workflow-concurrency.test.mjs`: queue, `main` and other refs use per-SHA
  groups that never cancel.
- `promote-queue.test.mjs`: the helpers the live queue imports from
  `promote-queue.mjs`: owner trailer, issue closing, and the push to `main` with
  its retry on ruleset check lag.
- `release-gate.test.mjs`: the release gate waits on a missing or running
  `ci` run, re-reads the run around the pinned jobs so a superseded attempt
  cannot publish, blocks a red or cancelled latest attempt, and releases
  only while the candidate is still on `main` (`release-tip.mjs`);
  the decide CLI scans past pending tip CI to select an older green ancestor;
  `decideRelease` releases a green, changed, unreleased candidate and skips a
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
  shape is a `ci`-on-`main` `workflow_run` wake plus `schedule` and
  `main`-only dispatch on one concurrency group that never cancels the running release, with
  no re-dispatch path.
