# Push delivery verification (#2191)

## Context

The assigned branch starts at 54195adb0806fd11632109cb74e3af423b98c0b8. GitHub issue comments, linked PRs, open path overlaps and recently merged overlaps are unverified: this sandbox cannot reach GitHub. Proceed only on the assigned branch, without pushing or opening a PR.

## Failure modes before implementation

| Failure mode | Planned regression or unverified limit |
| --- | --- |
| Empty subscription set looks delivered | Outcome test: no-subscription |
| All subscriptions expire; stale rows survive | 404/410 outcome tests and database deletion |
| Provider accepts one or several devices | Delivered count and mixed-result tests |
| Network/provider error; mixed expiry and error | Failed outcome tests |
| Provider never settles or keeps a response active beyond socket inactivity timeout | Fake-timer never-settling provider regression and ten-second outcome watchdog |
| Disabled VAPID or unexpected send rejection | Must-reach fallback tests |
| Payload lacks a stable notification id | Payload/database correlation test |
| Receipt missing, malformed, foreign user/team, repeated or unauthenticated | Authenticated route tests and database assertions |
| Push handled without display or without receipt | Worker VM runtime tests; real browser unverified |
| Focused page suppresses an existing notification | Worker VM requires both ordinary and receipt-enabled foreground pushes to show |
| Worker cannot read bearer authentication | Worker cache credential tests; real device auth unverified |
| Declarative Safari bypasses handler | Payload retains web_push 8030, receipt-enabled payload adds mutable true; real Safari unverified |
| Receipt arrives early, late, or never | Fake timer boundary tests, fallback exactly once |
| Fallback missing, rejected or misconfigured | Persistent undelivered and loud log tests |
| SMTP credentials leak or message injects headers | SMTP configuration/encoding tests; actual SMTP provider unverified |
| Server restarts while waiting | Reopened SQLite recovery and scheduler startup/tick tests; real host restart unverified |
| CLI targets wrong owner, unauthorized instance, timeout or unreachable server | CLI fixture tests and route authorization tests |
| Digest caller interprets outcome object as truthy | Existing digest regression plus explicit outcome handling |
| New routes/table drift from shared catalogs; migration upgrade fixture starts at an impossible revision | Existing wire/schema gates and shared snapshots; real journal-prefix SQLite upgrade; red then green |
| SQLite write fails or disk fills | Unverified operational limit: errors propagate; no success returned |
| Phone offline, permission revoked, worker suspended, receipt POST fails | Unverified on host/phone; missing receipts trigger fallback in running process |

## Review round 1 failure modes (before fixes)

| Failure mode | Regression / limit |
| --- | --- |
| Receipts remove native Safari display and foreground pushes show nothing | Declarative payload and worker VM path tests |
| Long POST exceeds transport header timeout | Immediate id route plus CLI polling tests, including pending and deadline |
| Restart strands overdue alerts | Durable message and sweep tests, scheduler startup and periodic tick |
| Ordinary pushes create unlimited receipt rows | No ordinary rows and unknown receipt 404 regression |
| Ops regressions never execute in gates | Prepush/CI registration regression |
| Timed-out provider later accepts | Unknown outcome regression; fallback still sent, duplicate email acceptable |
| Receipt carries redundant identity | Strict id-only receipt test; authenticated ownership remains authoritative |
| Migration journal missing final newline | File-byte assertion |
| Brake integration absent | Explicit unverified scope: #1405 GitHub-side brakes wire the helper later |
| Crash while fallback send is in flight | At-least-once retry; duplicate fallback acceptable; host restart unverified |
| Real Safari mutable delivery, provider, SMTP, offline phone | Unverified host/device acceptance required |

## Current scope and behavior

Measured by runtime fixtures: every payload retains `web_push: 8030`; receipt-enabled payloads add `mutable: true`. The worker attempts display even with a focused PWA, then posts only `{ id }` to the authenticated receipt route. Unknown ids return 404 and insert nothing. Ordinary pushes allocate no delivery row. Real Safari declarative fallback when a worker fails, native click routing, permission handling and foreground notification display remain unverified.

The test POST returns 202 and a delivery id before waiting for provider settlement. The CLI sends one POST, polls the owner-scoped status endpoint, and exits zero only for `received`. It prints `fallback-accepted` or `undelivered` and exits nonzero for either. Polling has a twelve-minute total deadline and each request has at most thirty seconds. A fallback acceptance is SMTP transport acceptance, not an email receipt or a human read acknowledgement.

Required alerts persist their message before dispatch. The scheduler sweeps at startup and on every regular tick, with overlapping sweeps suppressed. Overdue pending alerts send fallback or become undelivered if fallback is missing or fails. A timely persisted receipt suppresses fallback; a late receipt does not. Recovery of an older row with no message sends a generic recovery alert. Database failures propagate or are logged, and can prevent recovery until the database becomes writable.

The ten-second provider watchdog and transport errors without an HTTP rejection return `unknown` for must-reach alerts and still invokes fallback. It cannot cancel an underlying provider promise; late push delivery and duplicate email are acceptable, a missing alert is not. A crash after SMTP acceptance but before the database update can resend fallback after restart. The process-local in-flight map suppresses overlap within one database handle; cross-process exactly-once delivery is not claimed. Required alert history has no retention policy in this ticket; ordinary sends no longer grow the table.

`sendMustReachAlert` is intentionally not wired to any brake. Those callers land with #1405's GitHub-side brakes. This task supplies delivery tracking, the test route, and recovery infrastructure only.

## Evidence provenance and limits

Tested base: `54195adb0806fd11632109cb74e3af423b98c0b8`, branch `B0/2191-push-delivery`, plus the uncommitted source revision recorded in `round1-source-manifest.json`. This is not a claim that the base commit contains the fixes. Round1 logs supersede the earlier implementation logs. `red.log` and `green.log` retain earlier evidence and append the review-round runs. A deliberately disabled scheduler sweep and false mutable flag produced the supplemental negative-control failures before restoring the fixes.

All delivery acceptance below uses in-process Hono, scratch SQLite, worker VM, CLI fetch responses or a scratch SMTP executable. Web-push, device display, worker storage, HTTP fetch and SMTP are stubbed at those boundaries. The reopened SQLite test exercises real on-disk persistence, not a process restart on omarchy. No live app, screenshot, real provider, real email or phone receipt was exercised. Automated gates are separate from independent review; passing them establishes neither real-provider provenance nor evidence sufficiency.

Artifacts remain local and uncommitted as requested. No delivered verification, CI result, PR review or anonymously reachable evidence URL is claimed. A future delivery must commit this archive and use SHA-pinned raw links to this branch's `docs/verify/2191/` artifacts; that publication and reachability are unverified. No GitHub or omarchy lookup ran; open and recently merged overlaps remain unverified, and work stayed on the assigned branch.

| Claim and command | Tested revision | App surface | Provider mode | Artifact | Result / remaining limits |
| --- | --- | --- | --- | --- | --- |
| Payload, receipts, outcomes, durable recovery, scheduler, SMTP and auth regressions: `pnpm exec vitest run apps/server/test/push-outcomes.test.ts apps/server/test/push-smtp.test.ts apps/server/test/schema.test.ts apps/server/test/wire.test.ts packages/shared/test/snapshot.test.ts packages/shared/test/vocabulary.test.ts apps/web/test/push-auth.test.ts --update` | Working revision; round1 source manifest | In-process Hono, scratch SQLite and auth fixture | Stub web-push and SMTP executable | round1-focused.log, red.log, green.log | 181 passed before the added library socket-timeout case; one expected REST snapshot updated; no live browser/provider claim |
| Worker display and id-only receipt, CLI POST/poll/deadline, gate registration: `node --test scripts/ops/push-test.test.mjs scripts/ops/push-worker.test.mjs` | Working revision; round1 source manifest | Worker VM and CLI fetch fixture | Stub display, CacheStorage and fetch | round1-node.log, green.log | 8 passed; not Safari or network acceptance |
| Actual payload and persisted row artifact: focused outcomes with `--silent=false --reporter verbose` | Working revision; round1 source manifest | In-process Hono and SQLite | Stub web-push | round1-runtime-final.log | 182 passed; runtime values at the stub boundary, not external push delivery |
| Required checks: `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse` | Working revision; round1 source manifest | Static checks and spec collection | Not exercised | round1-lint.log, round1-typecheck.log, round1-spec-parse.log | Lint and typecheck pass; spec parser collects 1391 web cases and parses 65 integration files; no e2e run |
| Required changed selection: `pnpm exec vitest run --changed` | Working revision | Mixed test surfaces | Mixed stub and fixture | round1-changed-final.log | Interrupted with exit 130 after roughly six minutes; trajectory and attachment failures/timeouts recorded, no final summary. This run preceded the last socket-timeout refinement; final-source acceptance is the focused 182-case rerun |
| Prepush self-tests: `pnpm prepush --self-test` with CI environment | Working revision | Node script fixtures | Not exercised | round1-self-test.log | 193 passed, 3 failed: port-binding fixtures report EPERM. Registration regressions pass separately (4 tests in round1-registration.log). CI environment bypasses the shared heavy-slot queue |
| Exact modified CI test line: `RRSYNC="$RUNNER_TEMP/rrsync" node --test scripts/ops/backup-server-db.test.mjs scripts/ops/push-test.test.mjs scripts/ops/push-worker.test.mjs` | Working revision | Backup scratch fixture and push VM/fetch fixtures | Stub push; backup setup not reached | round1-ops-ci-final.log | 8 push tests passed; backup prerequisite fails: this Mac has Apple openrsync, not GNU rsync 3.x. Existing local rrsync 3.4.1 file supplied; CI provisioning download was not exercised. Linux CI remains unverified |

## Host acceptance still required

On omarchy, migrate a scratch copy before updating the live instance. Configure its existing VAPID subscription and SMTP fallback using the usual secret handling; curl must support SMTP with TLS. Open the updated PWA to activate its worker and synchronize the existing bearer token. Then run:

```sh
node scripts/ops/push-test.mjs "$CAIRN_ORIGIN" "$CAIRN_TEAM_ID" "$CAIRN_USER_ID"
```

Set `CAIRN_TOKEN` for an authenticated instance. The script's request/response polling is covered by scratch fetch fixtures locally. On the host, verify locked/background and foreground Safari display, native click navigation, receipt persistence, offline timeout fallback and actual email arrival. Restart the server with an overdue pending alert and verify startup recovery in its database and logs; repeat across a periodic tick. Do not infer a real provider or device claim from the local fixtures. No brake invocation can be accepted until #1405 connects it.

## Review-round retro

Applied the repository retro-cairn workflow. Six reviewer-named mechanism classes now have explicit regression safeguards: declarative display, bounded HTTP polling, durable pending recovery, ordinary-send storage, ops test registration, and timeout certainty. The receipt body was already id-only in the starting worker source; its exact-body test remains. The journal now has a final newline. The first local check also caught a missing test JSON type, and the combined ops run exposed a load-sensitive wall-clock test; both have ledger entries and the deadline test uses controlled Date time. Intentional snapshot changes were limited to the added REST endpoint. No ADR, protected auth surface, package, lockfile, commit, push or PR was changed by this review round.

## Final round 1 results

- Measured: final focused rerun without snapshot update passes 182 tests across seven files (`round1-runtime-final.log`); worker/CLI tests pass 8/8 (`round1-node.log`); prepush registration tests pass 4/4 (`round1-registration.log`). The final runtime log includes actual payloads sent to the stub and persisted SQLite rows.
- Measured: `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse`, English, comment and lessons gates pass. Lint retains one pre-existing informational suggestion. `git diff --check` passes.
- Measured: the exact prepush self-test command completes with 193 passing and three failures from test TCP bind EPERM. The exact modified ops test command passes eight push cases and fails the backup file's GNU rsync prerequisite. The full Linux CI provisioning block, CI execution and GitHub evidence publication are unverified.
- Measured: the required changed selection was run twice. The earlier run stopped after detecting the REST snapshot drift (subsequently updated). The later run was interrupted with exit 130 after roughly six minutes, with trajectory and attachment failures/timeouts and no final summary. Neither is claimed green; their causes beyond the printed errors remain unverified.
- Measured: no commit, push, PR, full e2e command or direct `pnpm build` command was run in this review round. Host, real-browser, real-provider and live restart checks remain unverified. The broader changed run left one generated lifecycle fixture after interruption; its exact generated file was read and removed from this worktree.
- Eight new lessons capture six review failure classes and two local test mistakes. Existing prepush regressions caught the nested-path fixture assumptions while integrating the new ops files; that correction is recorded in the ops registration entry.

`round1-changed-files.txt` lists the complete uncommitted file set, including inherited changes. Round1 edits specifically cover push services/routes/schema/migration, scheduler recovery, worker display, REST catalog/snapshot, ops polling/tests, prepush/CI registration, evidence and the new ledger entries. The existing id-only receipt body needed no removal of a userId field; its exact-body test confirms the starting and final behavior.

All archived logs remove terminal control sequences and normalize this worktree's absolute path. Results and runtime fixture values are preserved. The earlier source-manifest.json describes the previous implementation; use round1-source-manifest.json for this review's final code.
