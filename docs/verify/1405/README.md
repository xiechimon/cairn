# Server autonomy brakes (#1405), review round 1

## Context and scope

Measured base: `63aad9906`; branch: `B0/1405-brakes`. The tested source is an uncommitted worktree overlay, identified by `review-1-source-manifest.json`. This run intentionally makes no commit, push, PR, deployment, full e2e run, or build. GitHub overlap lookup, issue history and open PR paths are unverified because the assigned sandbox has no GitHub or host access. The assigned review is being fixed on this branch; no other worktree is used.

## Review round 1 failure modes recorded before implementation

The original preimplementation list and review-round additions were written before the corresponding fixes. The following table consolidates their mappings; original logs are retained.

| Failure mode | Regression or unverified limit |
| --- | --- |
| Paused team passes GitHub or local evaluation | `merge-gate-product.test.ts`, `local-merge-landing.test.ts` |
| Pause or cap changes after evaluation, before issuance | `pr-merge-api.test.ts`, local enqueue and claim tests |
| Team projects disagree on daily cap | Team settings are persisted on `team`; project schema rejects the setting; admission tests share a team count |
| Concurrent builds spend the same final slot | API race regression and transactional SQLite admission assertions; cross-process contention is unverified |
| UTC rollover miscounts landed merges | Clock-controlled admission tests, including delayed legacy rows from a previous-day admission |
| Unknown GitHub reply permanently prevents retry | Stale open/closed recovery tests and user-request retry after normal reconcile reads an open PR |
| Unknown result actually landed, but reconcile exits before containment or branch acceptance | Independent stale-admission sweep records merged state even when task completion cannot be accepted |
| GitHub remains unreadable | Deterministic 503 regression retains the reservation; recovery retries on later ticks |
| Server crashes between admission and settlement | Missing/terminal local-step and stale GitHub recovery tests inspect SQLite state; real process restart remains unverified |
| Local authorization changes before claim | Authorization-failure regression releases the reservation |
| Local daemon failure or cancellation strands a reservation | Immediate terminal failure and stop regressions |
| Abandoned local command is requeued and holds capacity | Abandonment regression fails the command, releases capacity, and requires a fresh merge request |
| Paused/capped local candidate starves later work | Two-candidate regressions leave the merge queued and claim the next build |
| Human-policy merging is blocked or counted | Human bypass and legacy human-policy message regressions |
| Transcript and step history are scanned without bounds | A 2,000-message fixture asserts SQL query shape, UTC bounds and absence of a standalone build scan |
| Admission duplicates its legacy success record | Same-day and delayed-next-day deduplication regressions |
| PR timestamps disappear or break captured response shapes | Required nullable `GithubPull.mergedAt`, captured open and merged response expectations |
| Sparse project patches reset policy/checks | Existing sparse patch regressions; the cap now belongs to the team API |
| Invalid cap settings are accepted | Team API rejects negative/fractional values; schema rejects infinity |
| Transcript envelope changes unexpectedly | Existing JSON-string admission regression |
| Pause changes after a daemon already received a command | Unverified protocol boundary: this server change cannot revoke a disconnected daemon's in-flight ref update |

## Review round 1 behavior and mechanism evidence (superseded below)

The team owns `maxAutonomousMergesPerDay`, default ten, in the same SQLite row and PATCH API as `autonomyPaused`. Project merge-policy requests reject a cap field. Migration `0069_team_merge_admissions.sql` adds that setting and an indexed admission table. Its number must be checked against main at eventual merge time; it is not reserved by this lane.

Admissions are reserved inside an immediate transaction before a GitHub write; local enqueue shares its transaction with admission. The admission table is authoritative. Transcript rows retain their existing JSON string envelope. Settlement updates the admission and transcript in one transaction. Terminal local failure/stop releases capacity immediately. An abandoned local merge is failed rather than blindly replayed.

Before each CI sweep, admissions older than one 60-second tick are checked independently of the task's review phase and normal reconcile early returns. GitHub merged observations settle with the provider timestamp; open and closed-unmerged observations release the claim. Unreadable observations retain it. Local recovery checks the bound merge step; missing or terminal unsuccessful steps release it, and a completed step with a checkpoint records landing. Active/queued steps continue to reserve capacity after their state is rechecked. Normal reconcile also settles immediately after reading a PR, before task-containment checks. This separates capacity accounting from permission to mark a task complete.

Evaluation reads admission rows and UTC-day-bounded legacy rows through SQL joins. It does not materialize all team builds. Indexed date/state fields bound the history queries. Legacy rows are excluded when a durable admission exists, including admissions from a prior day. Legacy human-policy projects are excluded. Legacy records lack immutable policy-at-execution metadata: a later policy change can make historical attribution uncertain. These fixtures establish current-policy filtering, not reconstruction of missing historical facts.

Runtime evidence consists of server fixture requests, real SQLite queries/migrations, persisted rows and fake GitHub calls. The SQL-shape regression executes the actual evaluation against a large transcript fixture; it asserts predicates rather than wall-clock timing. The shared schema snapshot pins the team wire projection. These are runtime/schema artifacts, not acceptance by source inspection alone.

## Evidence provenance and commands

Every command below tests base `63aad9906` plus the uncommitted overlay at execution time. Final hashes are in `review-1-source-manifest.json`. Runtime surface: local in-process server and SQLite fixtures. Provider mode: GitHub HTTP and GitOps stubs; static checks do not exercise providers. There is no live UI, screenshot, real provider, host or CI claim.

| Command / supported claim | Artifact | Result / limits |
| --- | --- | --- |
| Primary negative controls: focused admission/reconcile run and local candidate run | `review-1-red.log`, `review-1-candidates-red.log`, also indexed in `red.log` | Expected failures before primary fixes; the first run reports 13 failing tests, the candidate run reports two failures plus the later authorization negative control |
| Abandonment and delayed-message negative controls | `review-1-abandoned-red.log`, `review-1-dedup-red.log` | Expected failures; abandonment implementation was removed before its red run and reapplied afterward |
| `pnpm exec vitest run apps/server/test/autonomous-merge.test.ts apps/server/test/local-merge-landing.test.ts apps/server/test/pr-reconcile.test.ts apps/server/test/pr-merge-api.test.ts apps/server/test/merge-gate-product.test.ts packages/shared/test/snapshot.test.ts --maxWorkers 1 --testTimeout 30000` | `review-1-acceptance-final.log`, indexed in `green.log` | Final result recorded below; server/SQLite fixtures and stubbed provider boundaries only |
| `pnpm exec vitest run --changed` | `review-1-changed.log` | Initial run interrupted, exit 130; not green evidence. Any final narrowed-worker run is recorded below |
| `pnpm lint` | `review-1-lint-final.log` | Static check; final result below |
| `pnpm typecheck` | `review-1-typecheck-final.log` | Static workspace check; final result below |
| `pnpm spec:parse` | `review-1-spec-parse.log` | PASS: 1,391 web cases collected and 65 integration files parsed; no e2e executed |
| `node apps/server/scripts/db-check.mjs` | `review-1-db-check.log` | PASS: linear snapshot chain, no parent collisions; existing missing 0008/0018 snapshot notes retained |
| Shared team snapshot update and rerun | `review-1-snapshot-update.log`, final focused run | Intentional team-field projection; initial snapshot red is preserved in the interrupted intermediate logs |
| English, comment, ledger and model checks | `review-1-discipline.log`, `review-1-step-model.log`, `review-1-merge-model.log` | Final results below; model tooling availability does not establish new cap behavior |

Interrupted focused attempts are `review-1-green.log` and `review-1-green-final.log`. They are not green evidence. `review-1-acceptance.log` completed with 465 passing tests and one expected-shape failure: the open PR fixture lacked the newly required null timestamp. The final run follows that correction. `review-1-focused.log` is a narrower 22-test admission result, not final-tree acceptance.

## Evidence limits checklist

Fixture tests support only the exercised server/SQLite layers. They do not establish live-app behavior. Stub HTTP responses support reconciliation and request sequencing, not real GitHub availability, permissions, eventual consistency or provider execution. No UI screenshot is offered as proof.

The artifacts remain local and uncommitted by explicit instruction; they cannot support a delivered-branch verification claim. A later authorized delivery must commit them and add SHA-pinned readable raw links to the PR. No PR evidence gate or CI result is claimed. Passing static gates is separate from independent review; this round fixes the supplied BLOCK findings and does not claim fresh reviewer approval.

No host operation was added. The SQL migration is exercised by the server fixture's normal database opener, not by a host shell script. On omarchy, still unverified: applying the migration to a backup/scratch copy of the actual database, restarting the server across an outstanding claim, running its scheduled recovery tick, exercising live GitHub outcomes and inspecting daemon terminal reports. No production data, host credentials or network provider was used here. The server's inability to revoke an already delivered daemon command remains a protocol limit.

## Retro and chronology

The lifecycle, scope, bounded-query and timestamp regressions provide safeguards for the supplied findings. The existing timestamp ledger entry now documents a required nullable field. Review round 1 also caught and fixed delayed legacy-message double counting. Supplemental invalid-input and API-retry assertions were added after their primary fixes; they are not presented as test-first negative controls. The premature abandonment implementation was removed before its failing regression was run, then reapplied. This chronology is recorded in the existing supplemental-test ledger entry.

A repeated zsh path-glob error was recorded through the ledger event command; subsequent commands explicitly select bash. Interrupted test runs are retained without claiming a cause or a passing result. No lockfile change, commit, push or PR is made. `review-1-changed-files.txt` lists this round's source/test/doc paths; inherited uncommitted changes remain present.


## Final focused and static results

Measured: `review-1-acceptance-final.log` reports six files and 466 passing tests, exit 0. `review-1-registry-green.log` reports three files and 125 passing tests, exit 0; it includes the 79 shared snapshot tests already present in the first total, so these counts must not be added as unique tests. `review-1-inflight-guard.log` reports one passing supplemental guard test. It was a falsification probe, not a negative control: the existing in-process `mergingBuilds` guard already prevents normal reconcile from reading a still-active PUT. No extra admission state was introduced.

The table-registry and historical-upgrade omissions introduced in this round were caught by `review-1-table-registry-red.log` (two failures) and `review-1-internal-registry-red.log` (one failure). The internal registry, table-name snapshot and genuine prior-journal upgrade fixtures are now aligned. These fixes are recorded in `1405-admission-table-registry.md`. Migration from both 0067 and 0068 preserves historical records and supplies ten to an existing team's new cap field.

Measured final static batch: `review-1-final-gates.log` exited 0 after lint, workspace typecheck, spec parse, database migration-chain check, English gate, comment gate and ledger gate. The later supplemental test was formatted, and `review-1-lint-last.log` also exited 0. There are zero new comment lines and zero English-gate violations. `git diff --check` passed. Both formal model commands exited 2 because the required TLC jar is missing; no model result is claimed.

Measured loopback limitation: `review-1-loopback.log` exits 1 with `listen EPERM` on `127.0.0.1` port zero. This establishes that listener-dependent tests cannot be accepted on this sandbox; it does not establish the cause of any particular changed-set delay or failure. The selection-only command `pnpm exec vitest list --changed --filesOnly` records 412 selected files in `review-1-changed-selection.log`.


Final broad-run result: `pnpm exec vitest run --changed --maxWorkers 1` was interrupted with exit 130 after producing no completed summary; `review-1-changed-complete.log` is not a passing result. Earlier broad attempts also exited 130. No baseline attribution is made. All changed-set integration, browser and listener-dependent acceptance beyond the focused runs remains unverified.

The source manifest records the final handoff tree, not historical snapshots for every intermediate log. The 466-test merge acceptance preceded the registry-only follow-up; that follow-up passed its 125-test schema/vocabulary/snapshot set, and the supplemental in-flight guard passed separately. There is no single successful broad run of all final-tree tests. The final static batch passed after the registry changes; the later formatted supplemental test also passed lint. No delivery commit or fresh independent approval is claimed.


## Review round 2: failure modes before implementation

| Failure mode | Test or limit |
| --- | --- |
| A normal open-PR poll releases the tenth slot during an in-flight or unknown merge | Cap-ten poll trace with nine landed records and a pending final admission |
| A landing after refused settlement disappears from accounting | Late merged settlement regression, including repeated settlement |
| Recovery releases a claim within the 15-second request timeout | Recovery minimum-window regression |
| An abandoned autonomous local command releases capacity or is issued again | Abandonment reservation regression and repeated recovery sweep |
| A late local landing on an unclaimed step is ignored | Late failed-step report regression |
| Human-policy abandoned local commands stop being requeued | Approved human-policy abandonment regression |
| A disconnected daemon never reports its repository state | Unverified: retain the pending admission; host reconciliation is still required |
| Autonomous UI-route merge is refused while paused or capped | Intended behavior retained: resume autonomy or raise the cap to proceed |

GitHub overlap checks and host execution are unavailable under the assigned sandbox constraints. Continue the assigned branch only; open and recently merged overlaps remain unverified.


## Review round 2 implementation and supported claims

This section supersedes round 1's admission-release and abandonment descriptions.
The tested base is `06b6d6acdb031802b56afbf28658a8a40740263d` with the
uncommitted source overlay recorded in `review-2-source-manifest.json`.
No commit, push, PR, independent approval or delivery verification is claimed.

The exact cap-ten regression starts with nine distinct landed builds. The poller
starts reading A while A is still open; that GET starts A's merge, then waits
until its PUT is held in flight before returning the open snapshot. B then asks
for the last slot. Runtime assertions require B's 409, exactly one PUT, and A's
successful landing after releasing the held response. The negative control
admitted B. A separate unknown-response regression preserves the admission
through an ordinary open poll.

Normal polling now settles only observed landings. GitHub recovery enforces a
minimum 60-second admission age even when its caller supplies a shorter window;
this exceeds the current 15-second request timeout. Only recovery releases a
stale GitHub admission after an open or closed-unmerged observation. Unreadable
or missing context remains reserved. Merged settlement upserts the admission and
its transcript if an earlier refusal removed them, and repeated settlement
cannot count the same build twice or replace its first landing time.

Abandoned autonomous local commands remain claimed and keep their admission.
Generic failure and stop paths also retain admissions for issued local commands;
those statuses alone cannot prove repository state. Recovery no longer treats a
missing, failed or stopped local step as proof of non-landing. A bound merged
report is counted before the unclaimed-step early return, without changing that
step's terminal status. A claimed non-landing report still releases its admission.
Human-policy abandoned commands return to pending with the previous behavior.

Under autonomous policy, the UI merge route is subject to the same team pause and
daily cap. Resume autonomy or raise the cap to proceed. This behavior is retained,
not changed into a manual override.

### Round 2 evidence provenance

All behavioral evidence is from in-process server/service and real SQLite fixtures.
GitHub HTTP responses, GitOps reads and daemon reports are stubs; no actual daemon,
LLM, GitHub merge or live UI is exercised. Static checks have no provider mode.
Runtime assertions on admission rows and recorded PUT calls establish the tested
mechanism, rather than source inspection. No screenshot or fixture result is used
to claim live-app behavior.

| Command / claim | Artifact | Result and limits |
| --- | --- | --- |
| `pnpm exec vitest run apps/server/test/autonomous-merge.test.ts apps/server/test/local-merge-landing.test.ts apps/server/test/pr-merge-api.test.ts` before implementation | [Red log](review-2-red.log), appended to [red.log](red.log) | Original resumed tests: 6 failures; expanded class regressions: 12 failures, including the exact cap-ten interleaving |
| Same focused command after implementation | [Green log](review-2-green.log), appended to [green.log](green.log) | PASS: 200 tests across 3 files; server/SQLite fixtures and stub boundaries only |
| `pnpm lint` | [Lint log](review-2-lint.log) | PASS, exit 0; one informational useFlatMap diagnostic in untouched feishu-config.test.ts |
| `pnpm typecheck` | [Typecheck log](review-2-typecheck.log) | PASS, exit 0 across workspace packages |
| `pnpm spec:parse` | [Parse log](review-2-spec-parse.log) | PASS, exit 0; 1,391 web cases collected, 65 integration files parsed; no e2e execution |
| `pnpm exec vitest run --changed` | [Changed-set log](review-2-changed.log) | Interrupted, exit 130 after failures outside the focused set; no complete summary or passing broad-run claim, and no baseline attribution |
| `node --test docs/verify/1405/evidence-history.test.mjs` | [History red](review-2-history-red.log), [history green](review-2-history-green.log) | Overwritten round-only files fail both assertions; restored historical prefixes pass both |

The initial round 2 red/green redirects replaced the aggregate evidence files.
Their committed bytes were recovered from HEAD and the new output appended; the
history regression checks both prefixes. Review round 1 files remain intact.
The admission-lifecycle lesson was escalated to structural constraints and its
recurrence recorded through the ledger script. The ledger marker's initial
full-timestamp form was rejected; its required date-only form is now used.

### Remaining limits and host acceptance

These uncommitted artifacts are reviewable locally but cannot support a delivered
verification claim. A future authorized delivery must commit them on this branch
and use commit-SHA-pinned readable raw links in the PR. No PR evidence gate was
run; static automation is separate from a fresh independent review and does not
judge live origin, real-provider execution or evidence sufficiency.

On omarchy, still unverified: migration against a scratch copy of its database,
restart with outstanding admissions, scheduled recovery, real GitHub open/closed/
late-merged responses, and authenticated late daemon reports after disconnection.
No host operation or shell script is introduced by this round. No full e2e suite
or build was run. GitHub overlap and CI remain unavailable.

An indefinitely silent daemon conservatively consumes capacity until repository
state is reported; no automatic host reconciliation is supplied here. A local
landing report without a provider timestamp is charged at server receipt time.
Cross-process contention, deleted project/build context, and historical policy
changes after a refused admission remain unverified. Reconstructing a deleted
admission uses the current project policy; these tests do not establish immutable
policy-at-issuance attribution after a policy change. A delayed remote landing
after the stale recovery window can still exceed a cap if recovery already
released capacity; the late landing is counted when observed, not revoked.


The expanded six-file acceptance command with `--maxWorkers 1 --testTimeout 30000`
was also interrupted with exit 130 after no completed summary; see
[its log](review-2-acceptance.log). It is not a passing result. The original
three-file focused run remains the completed behavioral acceptance for round 2.
The adjacent three-file run is recorded separately in `review-2-adjacent.log`.
A file inventory is in [review-2-changed-files.txt](review-2-changed-files.txt).


Final static checks: lint, evidence-history tests (2/2), lesson-ledger, English-only
and comment-discipline checks pass; artifacts are `review-2-lint-final.log`,
`review-2-history-final.log`, `review-2-ledger-final.log`,
`review-2-english-final.log` and `review-2-comments-final.log`.
`git diff --check` passes. The adjacent run was interrupted with exit 130 after
no completed summary, so adjacent-suite acceptance remains unverified.

The resumed worktree's pre-existing untracked `review-2-red.log` was replaced
when archiving the fresh red runs. Its original bytes are not recoverable from
HEAD; the current artifact contains the fresh 6-failure and expanded 12-failure
negative controls. Committed round 1 aggregate evidence is byte-preserved, but
no claim is made that the earlier untracked round 2 log was retained.

## Review round 3: accepted landing boundary (before implementation)

This round supersedes the earlier claim that raw merged observations may spend
capacity independently of reconcile acceptance. Base commit is
`06b6d6acdb031802b56afbf28658a8a40740263d` plus the existing uncommitted overlay.
GitHub overlap, issue history and open PR paths are unverified: network access is
unavailable by assignment. Work continues only on the assigned branch.

| Failure mode | Test or limit |
| --- | --- |
| Foreign or fork PR spends capacity | Existing pr-reconcile rejection cases and new pending-admission rejection matrix |
| Wrong or missing base/default metadata spends capacity | Existing pr-reconcile sparse/base cases and rejection matrix |
| Phase changes during the read spend capacity | Existing network-window cases and rejection matrix |
| Checkpoint is absent from the merged head | Existing compare cases and rejection matrix |
| Stale recovery bypasses reconcile acceptance | New stale raw-observation test for GitHub and local completed steps |
| Refused admission followed by accepted late landing is lost or duplicated | New reconcile late-landing test with SQLite row and timestamp assertions |
| API/local accepted landings regress | Full pr-merge-api and local-merge-landing suites |
| Poller releases an in-flight admission or changes claim behavior | Full autonomous-merge and machine-claim suites |
| Live provider, process restart, cross-process races, real host behavior | Unverified; no live or host access in this run |

New tests run red before implementation. Logs are add-only round-3 files and
are appended to red.log/green.log without replacing earlier evidence.

### Review round 3 evidence provenance

Every command in this section tests commit `06b6d6acdb031802b56afbf28658a8a40740263d`
plus the uncommitted overlay identified by [source hashes](review-3-source-manifest.json).
Surface: in-process server/SQLite fixtures and daemon harness, not a live app.
Provider mode: injected GitHub HTTP and GitOps/backend stubs, or not exercised
for static checks. Runtime assertions inspect persisted admissions, transcript
rows, phases and provider timestamps; source inspection alone is not acceptance.
No UI, screenshot, real provider, host, deployment or CI claim is made.

| Command | Artifact | Result and supported claim |
| --- | --- | --- |
| `pnpm exec vitest run --project @xiechimon/cairn test/autonomous-merge.test.ts test/pr-reconcile.test.ts --maxWorkers 1 --testTimeout 30000` before implementation | [Red](review-3-red.log), appended to [red.log](red.log) | Expected red: 27 failures (20 existing reconcile, seven new regressions), 193 passed |
| `pnpm exec vitest run --project @xiechimon/cairn test/autonomous-merge.test.ts test/pr-reconcile.test.ts --maxWorkers 1 --testTimeout 10000 --reporter verbose` | [Reconcile green](review-3-reconcile-verbose.log) | PASS: 220 tests; rejected observations do not settle, accepted late landing persists once with provider time |
| `pnpm exec vitest run --project @xiechimon/cairn test/local-merge-landing.test.ts test/pr-merge-api.test.ts --maxWorkers 1 --testTimeout 10000 --reporter verbose` | [API/local](review-3-api-local.log) | PASS: 175 tests; stub provider acceptance only |
| `pnpm exec vitest run --project @xiechimon/cairn-cli test/machine-claim.test.ts --maxWorkers 1 --testTimeout 10000` | [Machine claim](review-3-machine-claim.log) | PASS: 3 tests; daemon harness/backend stubs |
| `pnpm lint` | [Lint](review-3-lint.log) | PASS, exit 0; informational diagnostic in untouched feishu-config.test.ts |
| `pnpm typecheck` | [Typecheck](review-3-typecheck.log) | PASS, exit 0 across workspace |
| `pnpm spec:parse` | [Spec parse](review-3-spec-parse.log) | PASS: 1,391 web cases collected, 65 integration files parsed; no e2e execution |
| `pnpm exec vitest run --changed --maxWorkers 1 --testTimeout 10000` | [Changed set](review-3-changed-final.log) | Final result below; does not imply real-provider or live-app acceptance |
| `node --test docs/verify/1405/evidence-history.test.mjs` | [History](review-3-history.log) | PASS: both committed evidence prefixes preserved |
| `node scripts/lessons-ledger-gate.mjs`, `node scripts/english-only-gate.mjs`, `node scripts/comment-discipline-gate.mjs` | [Ledger](review-3-ledger.log), [English](review-3-english.log), [Comments](review-3-comments.log) | PASS; automated checks are separate from independent review |

Initial combined acceptance (`review-3-green.log`), initial changed-set
(`review-3-changed.log`), four-file server (`review-3-server.log`) and first
narrowed retry (`review-3-reconcile-green.log`) were interrupted with exit 130
before summaries. They are retained as incomplete attempts, not passing evidence.
The completed split runs are the behavioral acceptance evidence.

Eight tests were added before implementation: six rejected pending-admission
observations, accepted late landing after refusal, and raw completed local-step
recovery. Seven failed on the old implementation; the late-landing case already
passed and guards preservation of that guarantee.

### Review round 3 limits and retro

Raw merged observations now retain pending reservations until reconcile accepts
them, or an accepted API response/local landing report settles them. A task that
never returns to an acceptable reconcile state can retain capacity indefinitely;
this run does not establish a safe automatic release for that state. Existing
limits concerning policy changes after refusal, missing context, timestamps on
local reports and cross-process races still apply.

No host operation or shell script is introduced. On the host, still unverified:
real GitHub own/foreign/fork/wrong-base responses and delayed landing, restart
with pending admissions, and late authenticated daemon reports. These are future
host acceptance checks, not actions performed or host scripts verified here.

Artifacts remain local and uncommitted by explicit instruction. They support
local fixture claims only, not delivered-branch verification. A future delivery
must commit its evidence and use SHA-pinned readable raw links in its PR.
No PR evidence gate or independent other-vendor review was run. Passing static
gates do not judge evidence sufficiency, live origin or real-provider execution.
GitHub overlap and CI are unverified. No commit, push, PR, full e2e or build.

Retro: the prior raw-read settlement regression is recorded as a recurrence in
1405-pending-admission-lifecycle.md, with landing accounting moved behind acceptance
and negative-control regressions. A diagnostic search used the default zsh with
an unmatched path glob; the existing zsh-nomatch-search entry records the recurrence,
and subsequent shell tools explicitly select bash. No new wording-only rule was
added. The ledger reports that the lifecycle category already uses its strongest
rung and warrants independent review; this run makes no independent-review claim.

All five requested suites pass in the completed split runs: 398 tests total.
Their outputs are appended to green.log. No requested suite was port-blocked.

The unrestricted final changed-set attempt was interrupted with exit 130.
[Selection](review-3-changed-selection.log), obtained with
`pnpm exec vitest list --changed --filesOnly`, contains 202 files including
integration browser/e2e suites. To respect the no-full-e2e restriction, the
replacement command is `VITEST_PROJECT_SET=light pnpm exec vitest run --changed
--maxWorkers 2 --testTimeout 10000`, which excludes integration. Its output is
[light changed-set](review-3-changed-light.log). Neither the unrestricted attempt
nor the selection command establishes passing broad-test acceptance.

Final broad-check limit: the light changed-set run was interrupted with exit 130
after `git-hosting.test.ts` reported 11 skipped tests and a 10,004 ms setup
failure, with no overall summary. Its beforeAll waits for an HTTP listener.
A direct `node --input-type=module -e` probe importing `createServer` from
`node:net`, binding port 0 on `127.0.0.1`, and recording its error code returned
`EPERM`; see [loopback probe](review-3-loopback.log). The listener restriction is
measured; attributing the setup timeout to it is an inference. No claim is made
that every broader failure is caused by ports, or that the broad set passes.
The unrestricted and light changed-set commands must be rerun in an environment
that permits listeners, subject to the authorized e2e scope. No requested one
of the five acceptance suites was blocked: all 398 cases passed.

Files edited in this round and new evidence artifacts are listed in
[round-3 inventory](review-3-changed-files.txt). Pre-existing modifications to
builds.ts, local-merge.ts, local-merge-landing.test.ts and pr-merge-api.test.ts
were preserved, not edited in this round. No lockfile change was introduced.

At interruption the light run also reported seven failures in push.test.ts and
one 30-second timeout in attachment-gc.test.ts. These are unresolved broad-check
failures, not baseline-attributed or proven to be caused by the listener denial.
There is no complete broad-run summary. The five focused-suite acceptance claim
is deliberately narrower than the changed-set check.
