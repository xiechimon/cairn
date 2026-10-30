# Restore drill #2190: current verification

## Failure modes recorded before round 2 implementation

| Failure mode | Test or unverified limit |
| --- | --- |
| Weekly service skips kept recovery, loses one mode report, or installs the service directly | Launcher scratch executable test and unit assertions |
| Hourly newest archive is stale, future dated, malformed, corrupt gzip or corrupt SQLite | Hourly freshness and integrity negative controls |
| Status cannot distinguish modes | Exact fresh/hourly status assertions |
| API probe never reads a chief thread or misses a selected thread | Fixture route thread identity assertion and missing-thread negative control |
| Heartbeat exception hides business changes | Existing strict-column matrix; timer write sites audited below |
| Fresh wrongly requires kept attachments or lacks rsync/gzip | Launcher dependency and environment tests |
| Own backup fails without useful safe diagnostics | Injected backup failure test checks step text and secret redaction |
| Missing inputs, unsafe scratch/report paths, relational loss, attachment corruption, wrong key, helper failure, undated content corruption | Existing restore-drill node:test controls |
| Real host recovery, Linux unit loading, actual weekly execution, production HTTP and providers | Unverified for this revision; host commands required below |

GitHub overlap lookup is unavailable under the sandbox contract. This extends the assigned #2190 branch; open/recently merged overlaps and touching PRs are unverified.

## Current behavior and content limits

The weekly timer invokes one service run. The launcher runs fresh followed by hourly, retains failure exit status from either, and writes mode-specific `RESTORE_DRILL_REPORT-fresh` and `RESTORE_DRILL_REPORT-hourly` JSON/status files with separate scratch directories. The service has no install target; only the timer has `WantedBy=timers.target`. `CAIRN_CHECKOUT`, `LIVE_DB`, `LIVE_ATTACHMENTS`, `SECRETBOX_KEY`, `RESTORE_DRILL_SCRATCH` and `RESTORE_DRILL_REPORT` configure the launcher; hourly additionally requires `BACKUP_DB` (archive file or directory) and `BACKUP_ATTACHMENTS`. Direct fresh invocation does not require kept attachments.

Fresh takes its own backup and compares it with a subsequent live SQLite snapshot. It checks table identity and dated content, sampled relationships, ready attachment size/hash, decryption and isolated API reads. This proves agreement across that capture window subject to the explicit dated-write and heartbeat allowances. Capture is not atomic; concurrent business writes may conservatively fail it. Safe known backup failure step text and exit status survive, while arbitrary stderr is withheld to avoid exposing secrets.

Hourly selects the lexically newest timestamp-named kept archive, rejects ages outside zero to two hours, and checks gzip recovery, SQLite integrity, foreign keys, relationships, ready attachment files, decryption and isolated API reads. It does not compare content against the current live database. It proves that the kept archive is readable and internally consistent, not that its historical content matches current live content or that a logically altered, internally valid archive is authentic. Age uses the UTC filename and host wall clock; correctness of that clock and filename is an unverified operational assumption. It does not fall back from a corrupt newest archive to an older archive.

Both modes read todos and one chief thread's messages through the same isolated createApp helper. The helper has an ephemeral secret box; the existing key is used only by the separate decryption helper. API checks compare restored thread message identities; they do not invoke a provider.

## Heartbeat allowance: source audit

Measured source: `apps/server/src/services/scheduler.ts:357` periodically calls `issueIntake.sweep()` and `:364` calls `schedulingSweep.sweep()`. Their writes are `apps/server/src/services/issue-intake.ts:708` and `apps/server/src/services/scheduling/sweep.ts:114`, calling `recordAutonomyVerdict`; `apps/server/src/services/autonomy-gates.ts:181` writes `lastEvaluatedAt: now`. These timer paths justify retaining only `autonomy_state.lastEvaluatedAt` when every other cell is unchanged. This is source evidence of the timer write path, not a measured production timer trace. Machine lastSeenAt/capabilities remain the other column-specific allowances. Identity, verdict, start, baseline and every other machine field remain strict under the existing comparator matrix.

## Evidence scope and provenance

Tested base is `4634fe7367ee83d7f860212f708147111af34f40` plus the working-tree files in `round2-tested-files.sha256`. Each acceptance claim below uses synthetic scratch SQLite/attachment fixtures. Provider mode is **not exercised**. The launcher test stubs dependency executables and the final drill to observe argv and working directory. Drill tests run real SQLite, gzip, crypto and Hono routes, with in-process fixture transport except the separate production-shell listener probe. No screenshot or real-app UI claim is made.

| Claim | Command | Artifact | Result and limits |
| --- | --- | --- | --- |
| New failure controls reject the previous implementation | `node --test --test-name-pattern='round2\|weekly units\|configured service' scripts/ops/restore-drill.test.mjs scripts/ops/restore-drill-service.test.mjs` | red.log, round 2 tail | Assertion failures before implementation; earlier age harness rename failure is excluded |
| Recovery, status, thread route, age, dependency and diagnostic controls execute | `node --test --test-concurrency=1 scripts/ops/restore-drill.test.mjs scripts/ops/restore-drill-service.test.mjs` | green.log, round 2 tail | Scratch runtime evidence only; exact final totals recorded below |
| Service/timer shape | Same command, weekly unit assertion | green.log | Static unit assertions and executed launcher argv; Linux systemd execution unverified |
| Repository checks | Commands and results below | round2-*.log | Static/collection checks, no app surface or provider |

Automated tests are separate from review. This run does not establish an independent review verdict or CI result. The PR evidence gate cannot establish evidence sufficiency, live origin or provider behavior. These artifacts remain local working-tree evidence under the explicit no-commit instruction; they cannot support a delivered verification claim until published on the delivery branch with SHA-pinned raw links. Existing omarchy artifacts are historical and are not evidence for this revision. Host reports for HEAD 4634fe73 are dispatcher-owned and were not modified here.

## Required host acceptance

On omarchy, run the updated launcher using the configured existing paths and key, first with `fresh`, then `hourly` (or one default invocation running both). Inspect both JSON/status reports, mode names, archive age, integrity, API thread/message counts and successful scratch removal. Install/reload the supplied user service and timer, verify the loaded unit uses the configured checkout and both modes, and observe an actual timer-triggered execution. These steps, production HTTP success, real data recovery, installed timer operation, host load/timing and provider behavior remain unverified in this sandbox. No GitHub or omarchy request was attempted.

## Retro

Applied `.claude/skills/retro-cairn/SKILL.md`. The review-corrected comparison and scheduling gaps now have executable negative controls. Related comparison-policy lessons and fixture-fidelity lessons were consolidated; the unrelated #1686 entry was restored. The initial age-control fixture error was corrected before the authoritative red run and recorded in the existing failure-control lesson. Baselines were normalized with the ledger `write` command.

Additional limits: no API response fault-injection test targets the thread response comparator independently; missing-thread controls currently fail at the relationship layer. The launcher test executes both modes with kept attachment configuration; direct fresh without BACKUP_DB or BACKUP_ATTACHMENTS passed a separate scratch launcher probe recorded in round2-fresh-env.log; dependency executables and final drill were stubs. Age controls cover stale and future archives plus a fresh success, not an exact two-hour boundary or clock rollback. Malformed filename/gzip and newest-directory selection have existing controls, but their combination with hourly directory selection is not independently fault-injected. Safe backup diagnostics preserve recognized constant step messages; arbitrary third-party stderr and path-bearing failures remain withheld.

## Repository commands

| Command | Result | Artifact |
| --- | --- | --- |
| `pnpm lint` | Exit 0; existing informational useFlatMap diagnostic | round2-lint.log |
| `pnpm typecheck` | Exit 0 | round2-typecheck.log |
| `pnpm exec vitest run --changed` | Exit 0; no tests selected | round2-vitest.log |
| `pnpm spec:parse` | Exit 0; 1391 web cases collected, 65 integration files parsed; no e2e executed | round2-spec-parse.log |
| `bash -n scripts/ops/restore-drill.sh scripts/ops/restore-drill-service.sh` | Exit 0 | round2-shell.log |
| `node scripts/english-only-gate.mjs` | Exit 0 | round2-english.log |
| `node scripts/comment-discipline-gate.mjs` | Exit 0; no added comment lines | round2-comments.log |
| `node scripts/lessons-ledger-gate.mjs write` then validation | Exit 0 | round2-lessons.log; write also froze existing missing baselines |

No workflow step, lockfile or external package API changed. No commit, push, PR, other-worktree action, full e2e suite or build was performed.

Final measured scratch result: Node 24.14.0, 78 tests passed, zero failed, 91.55 seconds (green.log final segment). The previous full run's two failures and their fixes remain visible: JSON fixture encoding and a stale static launcher assertion. The six focused review controls also passed (round2-focused.log). After extending the safe dependency diagnostic vocabulary, the focused diagnostic/redaction test passed again (round2-diagnostics.log). Both logs are supplemental fixture evidence, not host acceptance.

The authoritative round 2 red run recorded 14 selected tests, 9 failures and 5 passes against the prior implementation. Historical logs and the discarded age-harness invocation are preserved; only the intended assertion failures support red-before-fix claims. Log trailing whitespace is normalized for repository hygiene.

Changed paths are listed in round2-files.txt. Tested implementation, tests and service unit bytes are identified in round2-tested-files.sha256. Static service checks do not establish a running Linux unit. No final independent review verdict is claimed.

## omarchy runs at d392ffae (current head, dispatcher, 2026-10-30)

| Run | Result | Report |
| --- | --- | --- |
| `--mode fresh` on the live instance | PASS restore-drill fresh ok | `omarchy-head/head-fresh.json` |
| `--mode hourly` on the newest kept backup | PASS restore-drill hourly ok | `omarchy-head/head-hourly.json` |
| `--mode compare`, clean control: a backup taken seconds before | PASS restore-drill compare ok | `omarchy-head/head-neg-clean-control.json` |
| `--mode compare`, one message edited in that backup | FAIL content message ...: differing row | `omarchy-head/head-neg-edit-message.json` |
| `--mode compare`, one `todo_tag` row deleted | FAIL content todo_tag ...: missing row | `omarchy-head/head-neg-drop-row.json` |
| `--mode compare`, first byte of one attachment changed | FAIL attachments ...png: missing, size or sha256 mismatch | `omarchy-head/head-neg-attachment-byte.json` |

The earlier `omarchy/` reports were taken at b2fbb4fb, before the modes existed; they record how the first real runs found the drill's own bugs.
