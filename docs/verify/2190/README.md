# Restore drill evidence (#2190)

## Review round 1 failure modes (before implementation)

The supplied independent review is BLOCK. GitHub overlap lookup is unavailable under the run's sandbox restriction; this continues #2190 in its assigned worktree. No other branch is touched.

| Failure mode | Regression or explicit limit |
| --- | --- |
| Corrupt todo title/spec accepted with equal v and old phaseAt | Undated todo content mutation rejection |
| Project, agent, tag or other undated content silently accepted | Strict comparison mutation matrix; only dated todo/tag versions or updatedAt permit differences |
| Ordinary deletes, inserts and in-place edits since an hourly backup cause false failures | Hourly mode checks restored relationships/files without comparing live content |
| Fresh backup omits ordinary writes already present at capture | Fresh mode invokes backup-server-db.sh then immediately snapshots; real SQLite fixture test |
| Writes or attachment GC during fresh capture window | Unverified timing race; conservative failure, retry with fresh scratch; no claim of an atomic DB/file snapshot |
| API helper creates or touches a live key | Direct API helper with absent sentinel key path; ephemeral box and no key environment/argument |
| Service depends on fixed checkout path or missing tools | Configurable launcher tests and missing-dependency rejection; Linux systemd execution unverified here |
| Successful drill retains full database scratch | Successful fresh/hourly/compare runs remove scratch; failures retain private scratch for diagnosis |
| Stale README contradicts committed host evidence and independent review | Rewrite current operation/evidence record; historical logs remain historical |
| Lesson includes process chatter or fabricated PR identity | Trim Notes, use issue #2190 for event identity, ledger validation |
| Host recovery, production entry point, provider behavior, installed timer | Unverified for this revision; API is a createApp GET /api/todos wrapper only, no provider exercised |

## Current operation

Requirements: Bash, Python 3.11+, sqlite3 CLI, gzip, rsync, Node supporting `--import`, and installed checkout server dependencies including tsx. No new package API or dependency is introduced. The API helper imports the local `createEphemeralSecretBox` API; its implementation was read before use.

```sh
scripts/ops/restore-drill.sh --mode fresh \
  --live-db /path/to/live/server.db \
  --attachments /path/to/backups/attachments \
  --live-attachments /path/to/live/attachments \
  --secretbox-key /path/to/live/secretbox.key \
  --scratch /path/to/new-drill-directory \
  --report /path/to/state/restore-drill.json
```

`fresh` is the default and the weekly service mode. It invokes `scripts/ops/backup-server-db.sh` into private scratch, including ready attachment copies, then immediately takes a read-only SQLite `.backup` snapshot of the live DB. It restores its new gzip backup and compares that restored DB with the snapshot. This shortens the interval during which ordinary writes can cause false failures; it does not create an atomic DB/file snapshot. Writes, undated edits, deletions or attachment GC during this interval can still produce a conservative failure. Retry with a new scratch path after investigating the failed item. Fresh mode does not read or rotate the hourly archive. Its `--attachments` argument is retained for the common CLI contract but ignored; fresh attachment copies are made in scratch.

`hourly` restores the newest `server-db-<UTC timestamp>.db.gz` in `--backup` (or the exact file supplied). Supply `--attachments` with the corresponding archived attachment directory. It checks integrity, declared foreign keys, ready attachment presence/size, restored relationships, one encrypted sample and the API wrapper. It never compares current live rows or files: ordinary deletions, todo creation without createdAt, message upserts, gate-round/secret edits, chief message timestamp changes, expired keys/subscriptions and attachment GC since the backup therefore cannot cause live-content false failures. The live-path arguments remain required for path safety but their files need not exist. Relationship checks in this mode use the restored DB as their reference; they cannot detect missing rows that leave an internally consistent archive. Without a separately trusted attachment digest, same-size corruption in the hourly archive is unverified.

`compare` is an explicit diagnostic mode for a supplied backup and live snapshot. It retains content-loss negative controls and should be used only with a deliberately paired snapshot or when strict drift diagnosis is wanted. It is unsuitable for routine hourly recovery checks. A differing row is accepted only with a dating signal: live updatedAt after the backup timestamp, live todo/tag v greater than restored v, or live todo phaseAt after the backup timestamp. Project, agent and other undated content stay strict, except the explicitly reported heartbeat columns documented in the follow-up below. All other machine columns remain strict. Dating signals establish that a row advanced, not that every individual cell is correct. Live-only rows require createdAt after the cutoff; missing rows otherwise fail. UTC filename cutoff precision is one second. The Drizzle migration ledger uses SQLite rowid because declared serial IDs are nullable.

All modes require a previously absent scratch path and refuse overlap with protected inputs or live directories, including resolved symlink aliases. Success removes scratch, which contains a full DB copy. Manual failures retain private scratch for diagnosis; remove it after inspection. The service RuntimeDirectory is also cleaned by systemd after service exit. Reports are published outside scratch. No live data is restored or updated.

The API check is a `createApp` wrapper serving only GET `/api/todos`, with no schedulers, daemon or provider; it is not the production server entry point. It seeds/migrates only the restored copy. HTTP uses an ephemeral loopback listener; fixture tests replace only that transport with in-process Hono requests. The API helper receives no live key argument or key environment variable and uses an ephemeral box. The separate decryption helper reads the existing key at its original path and never publishes plaintext. Subprocess environments are restricted to PATH/TMPDIR/SYSTEMROOT plus scratch HOME and isolated app paths. Node is resolved to an absolute executable before HOME isolation.

JSON and `<report>.status` are separately atomically replaced. Check timestamps for staleness; unsafe report-path refusals can leave old reports untouched. Reports use umask 0077 and may name row or attachment identifiers; host reports are private operational data. Abrupt termination, disk-full reporting, production scale, lock contention, key disappearance races and malformed helper protocols remain unverified.

## Weekly service

The service reads `%h/.config/cairn/restore-drill.env`:

```ini
CAIRN_CHECKOUT=/path/to/cairn
PATH=/path/to/node/bin:/usr/local/bin:/usr/bin:/bin
LIVE_DB=/path/to/live/server.db
BACKUP_ATTACHMENTS=/path/to/backups/attachments
LIVE_ATTACHMENTS=/path/to/live/attachments
SECRETBOX_KEY=/path/to/live/secretbox.key
```

The environment file controls the checkout path used by ExecStart and the launcher's working directory. The launcher checks node, python3 and sqlite3 on PATH and actually imports tsx from the configured server package before starting the drill. Shell version-manager initialization is not assumed. The weekly timer runs `fresh` to test backup creation and faithful recovery with a short comparison window. Run `hourly` separately to test recovery of the retained hourly archive without comparing it against a newer live database.

Scratch is `%t/cairn-restore-drill/run`; the service's RuntimeDirectory adds systemd cleanup, while the drill itself removes scratch on success for both manual and service runs. Reports persist at `%h/.local/state/cairn/restore-drill.json` and its status sibling. Installation, Linux unit parsing, dependency availability under the host user service and timer execution remain unverified for this revision.

Host acceptance still required: run both modes with the real paths and existing key, inspect JSON and status, confirm scratch cleanup on success, then install/reload and run the service once before enabling the weekly timer. Do not publish private DBs, key material or raw host identifiers.

## Review round 1 evidence limits

Tested base: `de588fa778ec44bc64e73f21efd93160a814979e` plus this working tree; `review-tested-files.sha256` identifies tested file bytes. No commit, push or PR is authorized. Current artifacts are local verification evidence pending a delivery commit, pinned remote links and CI. Earlier committed artifacts remain historical evidence for their own revisions.

All runtime tests use migrated synthetic scratch databases and real local encryption. Provider mode is **not exercised** throughout. No UI screenshots, real-provider claim or production-entry-point claim is made. Automated checks are separate from the supplied independent review, whose verdict was BLOCK. A new independent review of these fixes has not run. The PR evidence gate was not run and would not establish evidence sufficiency or real-provider behavior.

| Supported claim | Command | Surface / provider | Artifact | Result and remaining limit |
| --- | --- | --- | --- | --- |
| Undated corruption, mode separation, missing key/API isolation and unit contract regressions fail before fixes | `node --test --test-name-pattern='undated|todo differences|mode tolerates|API wrapper|weekly launcher' scripts/ops/restore-drill.test.mjs` | Synthetic SQLite / not exercised | red.log, appended review run | Expected assertion failures. The preceding broad run supplied an unsupported mode and is not acceptance evidence for content corruption |
| Hourly mode must not require current live files | `node --test --test-name-pattern='hourly recovery does not require' scripts/ops/restore-drill.test.mjs` | Synthetic SQLite / not exercised | red.log, final focused run | Expected missing-input failure before correction |
| Database/files/relationships/decryption, fresh backup script, hourly recovery and API isolation | `node --test --test-concurrency=1 scripts/ops/restore-drill.test.mjs scripts/ops/restore-drill-service.test.mjs` | Real scripts on synthetic SQLite; in-process route transport / not exercised | green.log, final run | Result recorded below; does not establish production recovery |
| Mandatory HTTP wrapper probe | Production-shell case in the same command | Synthetic restored DB, actual loopback attempt / not exercised | green.log | Accepts a real pass or explicit sandbox EPERM; no production-entry-point or host-success inference |
| Static checks and affected test selection | Commands and results below | Local static/collection / not exercised | review-*.log | No live-app/provider or independent-review inference |

Historical red/green log segments retain their own results; the last full run is the current acceptance run. Logs are normalized to remove local home/worktree prefixes. The regression's old API helper created a file named `--in-process-fixture`; that synthetic key artifact was removed and never included in evidence.

## omarchy runs on real backups (dispatcher, 2026-10-30)

Historical dispatcher runs on a separate host clone; these reports predate review round 1 and do not verify this revision.

| Run | Backup | Result | Report |
| --- | --- | --- | --- |
| 1, commit 22a07309 | server-db-20261030T050019Z | FAIL relationships: messages looked up by step id; the server keys them by build id (0 of 14752 messages carry a step id). Fixed in fccfecc0 | not kept |
| 2, commit fccfecc0 | server-db-20261030T060001Z | 40 tables, attachments and relationships pass; FAIL decrypt: the mise `node` shim exits under the scratch HOME, reported as a decryption failure. Fixed in b2fbb4fb | not kept |
| 3, commit b2fbb4fb | server-db-20261030T060001Z | PASS: integrity, foreign keys, 40 tables, 9 ready attachments, build with 2 steps and 139 messages, chief thread with 6 messages, decrypt ok, `/api/todos` 83 rows from a server on the restored copy | `omarchy/drill-20261030T063338Z.json` |
| Negative: one message edited in the backup | same | FAIL content: message `msg-rsHA8F_TBVuBt1PbSWZPd-40`: differing row | `omarchy/neg-edit-message.json` |
| Negative: one `todo_tag` row deleted from the backup | same | FAIL content: todo_tag ...: missing row | `omarchy/neg-drop-row.json` |
| Negative: first byte of one attachment changed in a copy of the attachment backup | same | FAIL attachments: ...png: missing, size or sha256 mismatch | `omarchy/neg-attachment-byte.json` |

The reports hold ids and counts only; they were checked for the key bytes and for token prefixes before commit. The weekly timer is not installed yet.


## Repository check results

All commands ran on the tested base plus the working tree identified above. Static/collection checks use no application surface and exercise no provider.

| Command | Result | Artifact / limit |
| --- | --- | --- |
| `pnpm lint` | Exit 0; existing useFlatMap information in feishu-config.test.ts | review-lint.log |
| `pnpm typecheck` | Exit 0 | review-typecheck.log |
| `pnpm exec vitest run --changed` | Exit 0, no tests selected | review-vitest.log; ops execution comes from node:test |
| `pnpm spec:parse` | Exit 0; 1391 web cases collected, 65 integration files parsed | review-spec-parse.log; no e2e execution |
| `node scripts/english-only-gate.mjs` | Exit 0 | review-english.log |
| `node scripts/comment-discipline-gate.mjs` | Exit 0; zero added comments | review-comments.log |
| `node scripts/lessons-ledger-gate.mjs` | Exit 0 after baseline correction | review-lessons.log retains the earlier rejected baseline state |
| `bash -n scripts/ops/restore-drill-service.sh scripts/ops/restore-drill.sh` | Exit 0 | review-shell.log |
| `node --test scripts/ops/backup-server-db.test.mjs` as part of the initial combined attempt | Blocked by required GNU rsync 3.x; sandbox has openrsync | green.log retains the dependency assertion; no claim that the separate backup suite passed |
| Node 24 launcher-only test | Exit 0, 5 passed | review-service.log; tool executables and final drill are stubs in this focused launcher test |

The first combined attempt also timed out in the hourly API fixture. A subsequent sequential run passed 64/64 tests on Node 26.8.1. An additional Node 24.14.0 run passed 58/59 drill cases but timed out in the same hourly API fixture. These are retained in green.log; resource contention is an inference, not a measured cause. Assertions and the 30-second helper timeout were not weakened. A final sequential Node 24 run with no concurrent repository checks is recorded at the end of green.log.

Retro used `.claude/skills/retro-cairn/SKILL.md`: strict dated comparison and separate recovery modes guard against the comparator flaw; the API signature removes live-key access; launcher regressions protect configurable checkout and dependency checks. The first broad red invocation's unsupported-mode harness error is excluded from content acceptance and recorded in the existing incomplete-failure-controls lesson. The fabricated PR event was removed, preserving the known recurrence in its baseline; Notes no longer contain ledger-command chatter.

No commit, push, PR, remote host action, full e2e suite, build or lockfile change was performed. Delivery evidence and CI remain unverified until the authorized owner commits and publishes these artifacts.

Final measured result: the sequential Node 24.14.0 run exited 0, with 64 passed and 0 failed in 124.96 seconds. No implementation or assertion changed between the timeout run and this rerun. The runtime result covers synthetic fixtures and the createApp wrapper only; successful host HTTP, production recovery, installed timer execution and provider behavior remain unverified for this revision.

Changed files for this round are listed in [review-files.txt](review-files.txt). Implementation, tests and unit byte identities are recorded in [review-tested-files.sha256](review-tested-files.sha256). The final whitespace and byte-identity check is [review-final.log](review-final.log).

## Heartbeat follow-up: failure modes recorded before implementation

Base: `60ab20d8b50dbce7a63d0bb392a760e205a5e5a2`, with uncommitted follow-up changes. GitHub overlap and host access are unavailable by the run contract; this extends the assigned #2190 branch only.

| Failure mode | Test or limit |
| --- | --- |
| Fresh capture rejects machine heartbeat drift between backup and snapshot | Snapshot-boundary SQLite CLI shim changes lastSeenAt and capabilities; fresh must pass |
| Compare rejects the same heartbeat drift | Compare heartbeat acceptance test |
| Hourly report omits heartbeat policy | Hourly report allowlist assertion; hourly still performs no live comparison |
| Heartbeat exception hides machine name or other machine corruption | Fresh name mutation negative control and comparator matrix over every other machine column |
| Timer evaluation timestamp causes false failure | autonomy_state lastEvaluatedAt acceptance test |
| Evaluation exception hides verdict, start, baseline or identity corruption | autonomy_state strict-field negative controls |
| Allowlist missing reasons, broadens to a whole row or absent on failure | Report assertions and strict-field negative controls |
| Other timer-driven business state races with capture | Source audit below; remains strict, concurrent business writes remain an unverified host timing limit |
| Real host fresh/hourly recovery, systemd timer, production HTTP and provider | Unverified here; rerun fresh and hourly on omarchy with existing real paths/key and inspect JSON/status and scratch cleanup |


## Heartbeat policy and timer audit

Measured source: `apps/server/src/services/machines.ts` heartbeat updates lastSeenAt and reported capabilities; `apps/server/src/services/autonomy-gates.ts` recordAutonomyVerdict writes lastEvaluatedAt on every evaluation, called by issue-intake and scheduling sweeps. The allowlist is column-specific and present in every mode's report, including failed content comparisons. Only rows whose non-allowlisted cells are identical count as allowedMutable. Missing rows and schema changes remain errors. Hourly mode reports the same policy but continues to skip live-content comparisons entirely.

| Table.column | Reason | Strict neighbors |
| --- | --- | --- |
| machine.lastSeenAt | Daemon heartbeat timestamp | Every other machine column except capabilities |
| machine.capabilities | Daemon heartbeat capability snapshot | Name, online, credentials, runtime settings, CLI/report/rate-limit fields and concurrency remain strict |
| autonomy_state.lastEvaluatedAt | Evaluation heartbeat timestamp when the verdict remains identical | lastBlockedReason, lastStartedAt, baselineSha, projectId and kind remain strict |

Measured audit commands: `rg -n 'setInterval|setTimeout' apps/server/src --glob '*.ts' --glob '!**/test/**'`, then scheduler sweep call sites and their database writers. The route timers emit SSE/WebSocket keepalive traffic; fs-pick and machine-wake timers manage timeouts. Scheduler sweeps update build/step/todo status, chief wakes/messages, notification readAt, schedules, push subscriptions/digest items, attachments/session retention, CI results and trajectory outcomes/curation. These represent business state, cleanup or derived results rather than pure heartbeats and receive no exemptions. Machine stale-offline changes online, which also stays strict as explicitly requested. Autonomy verdict reason/start/baseline changes affect gates and are not pure heartbeat metadata. Inference from this source audit: lastEvaluatedAt is the additional pure heartbeat column; this is not a live trace or proof of all possible timer races.

## Heartbeat follow-up evidence limits

All follow-up commands test base `60ab20d8b50dbce7a63d0bb392a760e205a5e5a2` plus the uncommitted files identified in heartbeat-tested-files.sha256. Surface is synthetic SQLite and scratch attachment files; provider mode is **not exercised**. The fresh boundary shim delegates to the real SQLite CLI and injects a deterministic write after the real backup script finishes but before the live snapshot. API transport in these tests is the existing in-process createApp fixture, except the separate production-shell listener probe. No screenshots or live-app claims apply.

| Claim | Command | Artifact | Result / limit |
| --- | --- | --- | --- |
| Existing comparator rejects heartbeat drift and lacks policy reporting | `node --test --test-name-pattern='heartbeat' scripts/ops/restore-drill.test.mjs` | red.log, final follow-up segment | 7 failed before implementation; strict-name cases already reject corruption but fail the new report assertion |
| Fresh and compare heartbeat-only drift passes; machine name drift still produces a failing drill | `node --test --test-concurrency=1 scripts/ops/restore-drill.test.mjs scripts/ops/restore-drill-service.test.mjs` | green.log, final follow-up segment; heartbeat-fresh-report.json, heartbeat-compare-report.json | Runtime SQLite evidence; final totals below |
| Every other machine field and autonomy identity/verdict/start/baseline remains strict | Same command, heartbeat comparator matrix | green.log | Python runtime comparator on minimal SQLite tables; does not exercise live scheduler writes |
| Hourly mode publishes reasons without introducing live comparison | Same command | heartbeat-hourly-report.json | Synthetic archive recovery only |

Automated regressions and static checks are separate from review. No independent review, PR evidence gate, CI or host command was run for this follow-up. No external package API was added or changed. No commit/push/PR is authorized, so these artifacts are local working-tree evidence, not delivered verification or SHA-pinned remote evidence. The PR evidence gate would not establish live origin, provider behavior or evidence sufficiency even if green.

Host acceptance remains unverified: rerun `scripts/ops/restore-drill.sh --mode fresh` and `--mode hourly` with the existing host paths/key and new scratch paths; inspect allowlist reasons, JSON/status, fresh allowedMutable counts and successful scratch cleanup. This sandbox cannot validate real heartbeat timing, production recovery, host HTTP transport, Linux units, installed timer execution, production load or providers. Concurrent non-heartbeat business writes can still conservatively fail fresh/compare.

Retro: applied `.claude/skills/retro-cairn/SKILL.md`. The user-corrected heartbeat classification is recorded in `docs/lessons/2190-heartbeat-restore-comparison.md`, protected by a failing-before-fix boundary test and strict-column negative controls.

### Follow-up command results

| Command | Measured result | Artifact / remaining limit |
| --- | --- | --- |
| Ops node:test suites listed above | Exit 0; 70 passed, 0 failed | green.log; synthetic scratch databases, no host/provider |
| `pnpm lint` | Exit 0; one pre-existing informational useFlatMap diagnostic | heartbeat-lint.log |
| `pnpm typecheck` | Exit 0 | heartbeat-typecheck.log |
| `pnpm exec vitest run --changed` | Exit 0; no tests selected | heartbeat-vitest.log; ops regressions use node:test |
| `pnpm spec:parse` | Exit 0; 1391 web cases collected and 65 integration files parsed | heartbeat-spec-parse.log; no e2e executed |
| `node scripts/lessons-ledger-gate.mjs` | Exit 0 | heartbeat-lessons.log |
| `node scripts/english-only-gate.mjs` | Exit 0 | heartbeat-english.log |
| `node scripts/comment-discipline-gate.mjs` | Exit 0; no added comment lines | heartbeat-comments.log |

The production shell probe returned the expected explicit `EPERM` listener refusal, recorded in heartbeat-http-report.json/status. This is not HTTP success. Follow-up fixture and HTTP reports are prefixed `heartbeat-`; older reports are preserved unchanged. Red and green logs append the follow-up after historical runs. The final focused rerun after formatting/test-title clarification is also in green.log. Repository check logs contain no application surface or provider execution. No workflow step was changed, so no additional changed-CI-step command applies.

Changed files are enumerated in heartbeat-files.txt. No commit, push, PR, lockfile change, other-worktree modification, full e2e suite or pnpm build was performed.
