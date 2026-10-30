# Restore drill evidence (#2190)

## Scope and failure modes (recorded before implementation)

Base commit: 54195adb0806fd11632109cb74e3af423b98c0b8. Changes stay on this branch. GitHub overlap lookup, issue comments and open/recently merged PR paths are unverified: this sandbox cannot reach GitHub. Proceeding with the assigned ticket and new ops paths only.

| Failure mode | Acceptance test or limit |
| --- | --- |
| Clean backup is rejected, counts or relationships are wrong | Clean fixture using migrated checkout schema and real server API |
| Changed attachment, missing file, wrong size, unsafe storage key | Attachment corruption and path tests |
| Message bytes differ or a pre-backup row is missing on either side | Content edit and deletion tests |
| Post-backup inserts or timestamped updates cause false alarms | Timestamp and insertion tests |
| Mutable columns without updatedAt change | Explicit reported column allowlist; unrelated columns remain strict |
| Corrupt gzip, invalid SQLite, integrity or foreign key failure | Corruption and foreign key tests |
| Scratch aliases live data through parent paths or symlinks | Refusal tests before creating scratch |
| Existing scratch or report overwrites input data | Refusal tests; exclusive run directory |
| Missing or incorrect key, missing encrypted sample, leaked key/plaintext | Decryption failure and report secrecy tests |
| Missing todo/build/step/message or chief messages | Relationship sample failure tests |
| API startup/read/count failure, inherited live configuration | Real checkout entry point, clean environment, ephemeral loopback port; sandbox binding availability is a limit |
| Concurrent live writes | sqlite3 .backup snapshot used for all comparisons; production contention and scale unverified |
| Backup timestamp ambiguity | UTC filename timestamp, second precision; writes in the capture window cannot be ordered exactly |
| Legitimate deletions or untracked mutations | Strict failure unless explicitly allowlisted; no inference that a missing row is harmless |
| Host dependencies, weekly schedule, production data | Unverified on omarchy; unit files are supplied, never installed here |
| Crash, disk full, termination before report publication | Nonzero failure; a stale status must be judged by its timestamp; forced-kill reporting unverified |

## Evidence limits

All fixture runs use synthetic data and no LLM provider. They establish local drill behavior only, not production recovery, real-provider behavior, or installed timer execution. No UI screenshots are used. Runtime artifacts are the test logs and generated JSON assertions. Automated checks are not independent review. Follow-up artifacts remain uncommitted as requested; no push or PR is authorized, so SHA-pinned remote evidence links and CI verification remain unavailable.

Host acceptance still required: run the supplied service command with the production backup, live DB, attachment directories and existing key; inspect JSON and its `.status` sibling; verify the weekly timer with systemd after installation by the host operator. Production key recovery, filesystem permissions, data volume, backup freshness and off-site retrieval are unverified.

## Operation

Requirements: Bash, Python 3.11+ (standard-library SQLite and SHA256), sqlite3 CLI, Node supporting `--import`, and this checkout's installed server dependencies including tsx 4.23.15. No new packages or lockfile changes. The server bootstrap imports the checkout's real app, DB migrations, seed and secret-box implementation; it serves only GET `/api/todos` on an OS-assigned loopback port and starts no schedulers, daemon or provider. The supplied key is read at its original path, never copied or linked into scratch. HTTP and decryption subprocesses inherit only PATH/TMPDIR/SYSTEMROOT and a scratch HOME, preventing live auth, provider, proxy or home configuration from leaking in.

```sh
scripts/ops/restore-drill.sh \
  --backup /path/to/backups/db \
  --live-db /path/to/live/server.db \
  --attachments /path/to/backups/attachments \
  --live-attachments /path/to/live/attachments \
  --secretbox-key /path/to/live/secretbox.key \
  --scratch /path/to/new-empty-drill-directory \
  --report /path/to/state/restore-drill.json
```

`--backup` accepts a file or directory; default is the current directory. Directory selection uses the newest UTC timestamp filename. Scratch must not exist. Each successful or failed run leaves scratch for inspection; use a fresh path on the next manual run. No live files are restored, removed or updated. SQLite's read-only CLI `.backup` writes `live-snapshot.db` before decompression. Comparison reads this snapshot exclusively. Database counts refer to the restored DB before its isolated API bootstrap migrates it.

Per-table counts partition identical, changedAfterBackup, missing, differing, allowedMutable and addedAfterBackup. Missing rows on either side fail, except live-only rows with a createdAt later than the filename timestamp. Live-only rows without createdAt cannot be dated and fail conservatively. Tables without usable primary keys fail; the Drizzle migration ledger explicitly uses rowid because its declared serial IDs are null. SQLite values are compared with storage type retained, UTF-8 text bytes, blob bytes and packed floating-point bytes. File layout/page identity is not claimed.

The allowlist records each column and reason in the report. These mutations cannot be dated and have their own allowedMutable count rather than being described as proven post-backup changes. Unknown non-allowlisted mutations fail conservatively. The relationship follow-up selects the newest build in the live snapshot with at least one step at or before the backup cutoff, ordered by build.createdAt and build.id. It requires the same todo/build in the restore and identical nonempty step and build-scoped message ID lists at the cutoff. The newest eligible chief thread and its pre-backup message IDs are compared the same way. Relationship checks precede general content and foreign-key checks so sample loss names its build or thread. This samples relationship paths, while foreign_key_check checks declared foreign keys; it does not establish every undeclared logical relationship.

The report is JSON and `<report>.status` is a timestamped one-line PASS/FAIL record. Each file is atomically replaced, separately; readers should use JSON as the authoritative result and check timestamps for staleness. Input/unsafe-report argument refusals may deliberately leave an older report untouched. Files use umask 0077. Error reports include table/primary-key or attachment-key identifiers, never cell contents, plaintext secrets or key bytes. Treat host reports as private operational data, not public evidence.

## Weekly units (not installed)

`scripts/ops/systemd/cairn-restore-drill.service` reads a private `%h/.config/cairn/restore-drill.env` containing paths only:

```ini
BACKUP_DIR=/path/to/backups/db
LIVE_DB=/path/to/live/server.db
BACKUP_ATTACHMENTS=/path/to/backups/attachments
LIVE_ATTACHMENTS=/path/to/live/attachments
SECRETBOX_KEY=/path/to/live/secretbox.key
```

The service assumes the checkout at `%h/Code/AgentProjects/cairn`; adjust WorkingDirectory and ExecStart on the host if needed. Its systemd RuntimeDirectory contains the fresh per-run scratch and is cleaned by systemd after each service run. The persistent report is `%h/.local/state/cairn/restore-drill.json` and its `.status` sibling. Ensure the user service PATH includes node, python3 and sqlite3 (fnm shell initialization is not run by systemd). After host review, install both unit files in the user unit directory, reload systemd, run the service once and inspect both report files before enabling the weekly timer. Installation, unit parsing by systemd, timing, production snapshot contention and real HTTP startup remain unverified here.

## Sandbox transport boundary

A direct isolated server launch returned `listen EPERM: operation not permitted 127.0.0.1`. The production drill keeps this check mandatory and exits nonzero on that condition. Fixture tests use `restore-drill-test-driver.py` to replace only the HTTP transport probe with the same real Hono `/api/todos` handler in process, without a socket. The generated JSON is marked fixtureOnly and names its in-process surface. This driver is test-only; neither the shell script nor the systemd service invokes it. Green fixture tests establish database, attachment, relationship, decryption and in-process route behavior; they do not establish a successful production drill or HTTP bind/read. The production-shell test accepts only a real pass or the explicitly named EPERM refusal, never a generic startup failure.

## Acceptance record

| Claim | Command | Tested revision and surface | Provider | Artifact | Result and limit |
| --- | --- | --- | --- | --- | --- |
| Core regressions detect the absent drill | `node --test scripts/ops/restore-drill.test.mjs` before implementation | Base commit above, first 17 fixture cases | Not exercised | `red.log` | Expected nonzero; original missing-script failures retained |
| Migration identity correction | Same command during implementation | Working tree on the base above; migrated schema fixture | Not exercised | `implementation-red.log` | Clean DB rejected before rowid correction; migration mutation is a regression |
| Database, files, decryption, relationships, in-process route | Same command after implementation | Working tree, synthetic migrated DB; test-only in-process transport | Not exercised | `green.log` | See final summary in log; does not establish host HTTP success |
| Production refusal | Production-shell case in same command | Real shell/bootstrap, scratch DB and ephemeral loopback listener | Not exercised | `green.log` | Expected EPERM is safe failure; production HTTP success unverified |
| Static checks | `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse` | Working tree code, no live stack | Not exercised | `lint.log`, `typecheck.log`, `spec-parse.log` | Exit results recorded in final verification log |
| Affected Vitest selection | `pnpm exec vitest run --changed` | Working tree; ops cases use node:test instead | Not exercised | `vitest.log` | Exit 0 with no selected tests; not evidence of executing these ops tests |

No frontend, daemon, provider, GitHub, CI, production systemd or production-data claim is made. Tests use the real encryption implementation with synthetic keys and never copy a production key. The initial 17 tests were written and run red before implementation. Supplemental edge assertions were added afterward; their passing results are additional coverage, not evidence of having followed test-first ordering for those supplemental assertions. The lessons entry records that limitation and its regression coverage. Full e2e and `pnpm build` were not run, as instructed.

Runtime JSON and one-line records are archived as `fixture-report.json` / `fixture-report.status` (in-process fixture PASS) and `http-report.json` / `http-report.status` (mandatory HTTP probe FAIL with EPERM). Reproduce them with:

```sh
CAIRN_RESTORE_DRILL_EVIDENCE="$PWD/docs/verify/2190" node --test \
  --test-name-pattern='clean backup|production shell' scripts/ops/restore-drill.test.mjs
```

`artifact-run.log` records that focused run. `tested-files.sha256` identifies the exact implementation/test/unit contents used for delivery; the tests ran on this worktree before its delivery commit, based on the base SHA above. `verification.log` records command exits. Earlier red artifacts retain their original failures with local home/worktree paths redacted. They are historical observations, not failures of the final tree. No independent reviewer has evaluated this branch, and no PR or CI run exists for this delivery.

## Delivery restriction observed

The sandbox refused both explicit `git add` commands with `Unable to create .../.git/worktrees/b0-2190-restore-drill/index.lock: Operation not permitted`. No files were staged and no commit was created. The implementation, reports and logs remain in this worktree, uncommitted. They therefore do not yet meet the committed-delivery-evidence requirement, and no remote evidence availability is claimed. Intended commit subject: `ops(2190): restore drill compares content, attachments, relationships and decryption` (no closing line).

`pnpm exec husky` was run during preparation and the subsequent read showed `.husky/_` as core.hooksPath. There is no captured pre-run value, so unchanged hook configuration is not claimed. No hook bypass or explicit git configuration override was used.

## Relationship follow-up failure modes (before implementation)

| Failure mode | Test or limit |
| --- | --- |
| Production build-scoped messages rejected | Clean migrated fixture with build-scoped messages |
| Todo activity selects an older build; newest build has no steps | Newest eligible build regression with conflicting phaseAt and step-less decoy |
| Restored sample differs from live selection or lacks todo/build/steps/messages | Missing selected relationship rows regressions; errors name build id |
| Partial child loss or extra pre-backup children | Child count and identity regressions |
| Post-backup builds, steps or messages affect sample | Backup cutoff regression, including timestamp boundary |
| Chief thread or messages missing or counts differ | Chief relationship regressions |
| Fixture repeats an invented relationship | Migrated schema plus typed ORM inserts and server message insert helpers; source audit below |
| Host backup still fails | Unverified: rerun on host with newest backup and fresh scratch |

## Relationship follow-up evidence and source audit

Tested base commit: `22a073092b44af1b7aa1c5ab3e6728680c3da622` plus the uncommitted working-tree changes identified in `relationships-tested-files.sha256`. These checks do not test the unchanged commit alone.

Measured source audit against `apps/server/src/db/schema.ts` and server write paths:

| Relationship | Server write path | Fixture construction |
| --- | --- | --- |
| todo -> build | `services/builds.ts` start inserts build.todoId from todoId | Migrated schema, typed build insert with todo parent |
| build -> step | `services/builds.ts` enqueue inserts step.buildId from buildId | Typed step insert using returned build.id |
| build -> message | `services/builds.ts` inserts conversationId=stepRow.buildId; `services/machine-finish-step.ts` passes stepRow.buildId to upsertMessage; `services/merge-gate-run.ts` reads conversationId=buildId | Actual `services/machine-deps.ts` upsertMessage helper with returned build.id |
| chief_thread -> chief_message | `services/chief.ts` send inserts threadId=threadRow.id | Typed chiefMessage insert with returned chiefThread.id |

The fixture executes the checkout migrations through openDbWithHandle. Full service creation would require unrelated dispatch, notification and stream dependencies; typed ORM inserts keep this fixture focused. Types enforce columns, while the runtime regressions protect the string ownership relationship that types cannot express. No new dependency was used; the installed Drizzle 0.45.2 insert declarations were read before adding ORM calls.

`relationships-red.log` is the original implementation run with production-shaped message data: the clean fixture fails the old step lookup. `relationships-green.log` is the full local node:test rerun. Missing-build-message and partial-child tests require errors naming build b; missing chief rows name ct. The newer-build regression includes an older active todo and a newer build without steps. The cutoff test excludes post-backup builds and children and requires rows exactly at the cutoff. Inclusive cutoff matches the existing content comparator; second-resolution backup filenames still cannot order writes within the capture window.

`relationships-boundary-fixture-error.log` is a discarded test error, not acceptance evidence: a manually calculated timestamp was a day late. The corrected boundary uses Date.parse with an explicit UTC date. Retro applied using `.claude/skills/retro-cairn/SKILL.md`: production fixture drift is protected by migrated typed inserts, the server insert helper and regressions; the boundary mistake is recorded separately under docs/lessons.

All relationship acceptance commands use a scratch SQLite fixture, no UI, and provider mode **not exercised**. Runtime assertions inspect the actual drill exit, JSON report, selected IDs and mismatch diagnostics. No fixture screenshot or stub run establishes live application or provider behavior. Automated checks are not independent review. No independent vendor review, GitHub overlap lookup, PR evidence gate, CI, committed artifact or SHA-pinned remote evidence is available in this run. Earlier fixture-report/http-report artifacts predate this follow-up and do not verify these changes. The requested no-commit restriction supersedes the earlier intended delivery commit.

Host acceptance remains unverified: execute the Operation command above on omarchy with `--backup /path/to/server-db-20261030T050019Z.db.gz` (or the then-newest backup), real attachment paths and the existing key, using a fresh scratch directory. Inspect the selected build, steps, messages, chief thread/messages and cutoff in JSON plus its status. This sandbox does not establish recovery of that production backup, host HTTP binding, timer installation/execution, provider behavior or production contention/scale.

| Acceptance claim | Command | Surface / provider | Artifact | Result and limits |
| --- | --- | --- | --- | --- |
| Original step lookup rejects production-shaped messages | `node --test scripts/ops/restore-drill.test.mjs` before implementation | Scratch fixture / not exercised | relationships-red.log | Expected nonzero; clean backup fails relationships |
| Build selection, missing and partial relationship diagnostics, cutoff | `node --test scripts/ops/restore-drill.test.mjs` after implementation | Scratch fixture / not exercised | relationships-green.log | Exit 0, 38/38 tests passed; host acceptance remains unverified |
| Repository lint | `pnpm lint` | Static / not exercised | relationships-lint.log | Exit 0, one existing informational diagnostic in feishu-config.test.ts |
| Repository types | `pnpm typecheck` | Static / not exercised | relationships-typecheck.log | Exit 0 |
| Changed Vitest tests | `pnpm exec vitest run --changed` | Local / not exercised | relationships-vitest.log | Exit 0, no test files selected; no behavioral coverage claimed |
| Spec collection | `pnpm spec:parse` | Collection only / not exercised | relationships-spec-parse.log | Exit 0, 1391 web cases collected and 65 integration test files parsed; no e2e executed |
| Lessons format | `node scripts/lessons-ledger-gate.mjs` | Static / not exercised | relationships-lessons.log | Exit 0 |
| Diff whitespace | `git diff --check` | Static / not exercised | This acceptance record | Exit 0 |

`relationships-concurrent-check-timeout.log` preserves the failed verification attempt: three seed subprocesses returned null status at their 30-second timeout while repository checks were running. Resource contention is an inference, not an established cause. No timeout was increased and no assertion was weakened; the node:test suite was rerun alone. Equal-count ID substitution, extra restored children, absent live build/step samples, and absent live chief samples have implementation checks but no dedicated new regression in this follow-up; those specific variants remain unverified beyond the existing missing-message regression. No full e2e, build, commit, push, PR or host action was performed.

Final measured node:test result: 38 passed, 0 failed. The original regression run had 38 cases, 20 passed and 18 failed; it includes expected original-code failures and is not a final acceptance run. Logs redact the local home/worktree prefix. No code changes were made between the timeout attempt and the successful isolated rerun.

Additional measured static checks: `node scripts/english-only-gate.mjs`, `node scripts/comment-discipline-gate.mjs`, and the final `node scripts/lessons-ledger-gate.mjs` each exited 0; artifacts are relationships-english.log, relationships-comments.log and relationships-lessons.log. These are static checks, not independent review.
