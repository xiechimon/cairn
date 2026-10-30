# Server autonomy brakes (#1405), review round 1

## Context and scope

Measured base: `63aad9906`; branch: `B0/1405-brakes`. The tested source is an uncommitted worktree overlay, identified by `review-1-source-manifest.json`. This run intentionally makes no commit, push, PR, deployment, full e2e run, or build. GitHub overlap lookup, issue history and open PR paths are unverified because the assigned sandbox has no GitHub or host access. The assigned review is being fixed on this branch; no other worktree is used.

## Failure modes recorded before implementation

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

## Resulting behavior and mechanism evidence

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
