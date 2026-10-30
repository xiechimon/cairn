# Deploy self verification (#1408)

## Context

Assigned worktree only. GitHub overlap lookup (terms: deploy-self, release, 1408; paths: scripts/ops/deploy-self*, scripts/ops/systemd/) is unavailable under the run's explicit network restriction. Open and recently merged overlaps are unverified. Proceed on the assigned branch with new files only.

## Failure modes recorded before implementation

| Failure mode | Test or limit |
| --- | --- |
| SHA absent from main | off-main fixture |
| Malformed SHA or fetch failure | Unverified operational rejection paths |
| Push checks red, missing, pending, wrong SHA, or superseded | Check gate fixtures |
| Final-head evidence missing | evidence fixture |
| No matching merged PR or red final-head evidence | Unverified API variants; implementation fails closed |
| Dependency installation fails | Install refusal fixture |
| New migrations fail on scratch | Migration refusal fixture |
| Previous server cannot open migrated scratch | Compatibility refusal fixture |
| Claims arrive during drain; existing claims never finish | Claim barrier and timeout fixtures |
| Existing pause values lost | Pause preservation fixture |
| Backup fails | Backup refusal fixture |
| Missing current/last-good, dirty release, concurrent deploy | Unverified operational preconditions |
| Restart, authenticated read, or heartbeat fails | Code rollback fixture |
| Row written after backup lost on rollback | Real SQLite row preservation fixture |
| Successful deployment selects wrong checkout | Symlink and git SHA fixture |
| Restore silently discards writes | Restore preview and confirmation fixture |
| Rollback restart itself fails | Unverified host failure; script must report failure |
| Power loss, SIGKILL, disk exhaustion, malicious local tools | Unverified; durable drain state requires explicit recovery |
| Actual GitHub checks, systemd units, native dependencies, server migrations and daemon | Unverified host acceptance |
| Forward compatibility beyond startup and authenticated team/user reads | Unverified; no universal migration compatibility proof |

## Evidence boundaries

Command: `node --test scripts/ops/deploy-self.test.mjs`. Tested base: `54195adb0806fd11632109cb74e3af423b98c0b8` plus the delivery diff. Surface: scratch git repositories and real SQLite files; provider mode: stubbed gh, pnpm, node/server, curl and systemctl; no LLM provider exercised. Artifacts: red.log, green.log. Tests establish deployment orchestration and filesystem/DB effects only. They do not establish live application behavior, real-provider behavior or host readiness. Automated checks are separate from review. No screenshots are used. Artifacts are local only: the sandbox rejected creation of the shared Git index.lock, so staging and the requested commit are blocked. No delivery/PR URL is claimed; pushing is prohibited.

## Host installation and acceptance still required

Requirements: Linux user systemd, Python 3, sqlite3, gzip, git, gh authenticated to this repository, pnpm and the node executable used by both units on PATH. The wrapper uses only Python standard-library APIs; no external package API was introduced. Installation uses `pnpm install --frozen-lockfile`; the repository allowBuilds policy controls approved lifecycle builds. Immediately afterward, a node command in apps/server requires better-sqlite3 and opens and closes an in-memory database. A failed native load stops before scratch startup, backup, drain or restart. Installation and native execution remain unverified on the host.

Default layout: `~/.local/share/cairn-deploy/{releases/<full-sha>,current,last-good,backups,deploy.jsonl}`. Override with `CAIRN_DEPLOY_ROOT`, `CAIRN_DEPLOY_REPO`, `CAIRN_DEPLOY_DB`. Use absolute paths. Set `CAIRN_DEPLOY_TOKEN` to the existing server bearer token, `CAIRN_DEPLOY_MACHINE` to the daemon's exact machine row ID, and optionally `CAIRN_DEPLOY_URL` (default `http://127.0.0.1:8787`) and `CAIRN_DEPLOY_TIMEOUT` (seconds, default 120). Do not commit the token or host runtime logs. Keep the wrapper, Python helper and backup script together in a stable tools directory outside `current`.

Before the first deploy, create a detached release worktree for the currently running full SHA, install its dependencies, point `current` to it and write that SHA plus a newline to `last-good`. This bootstrap must be accepted on the host; the script deliberately refuses an uninitialized installation. Copy the provided files from `scripts/ops/systemd/cairn-{server,daemon}.service.d/deploy-self.conf` to matching directories under `~/.config/systemd/user/`, then run `systemctl --user daemon-reload`. These drop-ins retain the existing ExecStart and environment and change WorkingDirectory only. Inspect both `systemctl --user cat` outputs: ExecStart must use source paths relative to WorkingDirectory, or explicitly through `current`; an absolute source path into the old checkout must be replaced before use. The server's supplied measured ExecStart uses relative `src/index.ts`; the daemon's exact ExecStart was not supplied and remains unverified. Verify neither unit pins a source checkout elsewhere. The script refuses unless both effective WorkingDirectory values point through `current`.

Run `scripts/ops/deploy-self.sh <full-sha>` on the host. It checks main ancestry through GitHub's compare API, requires the newest GitHub Actions check run for each named check on the exact SHA, and requires one merged main PR whose merge commit equals the requested SHA and whose final head passed pr-evidence. Missing, pending and failing runs block. The release checkout is never reused after a failed attempt without operator inspection. Scratch startup uses the new release's actual entry point (which runs its migrations), followed by the previous release's actual entry point against the same scratch DB. Scratch has its own home, token and generated encryption key; no live key or attachments are copied. The two read probes cover startup and user/team reads, not all encrypted data or all prior-release queries. Scratch logs stay private under the deploy root. Port 18787 must be free; port isolation and external side effects from scratch scheduler startup remain host acceptance limits.

The claim barrier is necessary because source inspection of machine-claim.ts found no autonomyPaused check. The script transactionally saves pause values, pauses teams and installs SQLite triggers that ignore new transitions/inserts into claimed. It waits for existing claimed steps to finish without stopping either unit. Backup happens only after drain. The code symlink switches atomically, then server and daemon restart in order. Health requires both authenticated JSON reads plus the configured machine's lastSeenAt increasing after the pre-restart baseline. No dedicated health route exists in this checkout. Failed health swaps code back and restarts without copying any DB bytes back. No general forward-compatibility proof is claimed: only the scratch startup and read probes are enforced.

On the host, verify a genuinely green SHA, missing evidence rejection, migration failure, drain timeout with units still running, both actual scratch entry points, heartbeat advancement, authenticated reads and a deliberately failed health rollback retaining a post-backup row. Confirm the effective unit source paths and native modules. Live execution, live providers, GitHub status provenance and independent review are unverified here. No PR is opened and no CI result on a pushed head is claimed.

`deploy-self.sh restore <snapshot.db[.gz]>` prints current rows absent or different in the snapshot and refuses to modify anything. `--confirm-discard` explicitly authorizes stopping daemon/server/backup timer, recomputing the report after stop, replacing DB content through SQLite's backup API and restarting. The report includes changed current rows as well as new rows; schema mismatches conservatively print all current rows in that table. It can contain sensitive data: keep it private. Other external writers must be stopped separately; they are outside the supplied service inventory. Restore is not part of rollback. A failed restore leaves services stopped for inspection.

SIGTERM/SIGINT clean up a normal deploy drain. SIGKILL/power loss can retain the durable claim barrier and pause state. Inspect current, last-good, deploy.jsonl and unit state before running `deploy-self.sh resume` to restore saved pause values and remove the barrier. A fresh deploy refuses a preexisting drain table rather than clearing another run's state. Do not run resume until deciding which release should run. Rollback restart failure, crash recovery, disk-full behavior, concurrent deployment refusal, malformed arguments, missing/dirty release records and arbitrary external writers are not covered by the original acceptance fixture set unless explicitly named in green.log.

## Original runtime evidence

- Original red.log (preserved in the parent commit): all ten original acceptance tests fail before the script exists.
- fixture-path-red.log: post-implementation assertions exposed noncanonical macOS paths; canonical fixture roots fix them.
- extended-red.log: expanded guard tests, including the missing unit-path preflight, before that preflight was added.
- restore-race-red.log: injected stop-time write omitted from the original restore report; fixed by stopping before the report.
- claim-barrier-red.log: negative control drops the real SQLite claim triggers and the claim-blocking assertion fails.
- Original green.log (preserved in the parent commit): final orchestration fixtures and real SQLite assertions, with stubbed external boundaries.

The tested revision is the recorded base plus these uncommitted files. The requested commit could not be created because git add cannot create the shared worktree index.lock (Operation not permitted). No screenshots or provider calls establish additional behavior. Check logs document automated results only; they are not a review verdict. After committing, a later PR must use SHA-pinned raw links to this branch's committed evidence; no public accessibility is claimed for this local-only delivery.


## Original verification commands

All runs use base `54195adb0806fd11632109cb74e3af423b98c0b8` plus the local diff. Surface and provider boundaries are those specified above.

| Command | Artifact | Result and limit |
| --- | --- | --- |
| `node --test scripts/ops/deploy-self.test.mjs` | green.log | Passed: 21 tests; no live host or real provider |
| `pnpm lint` | lint.log | Repository formatting/lint check; no runtime claim |
| `pnpm typecheck` | typecheck.log | Passed; Python and shell are outside TypeScript coverage |
| `pnpm spec:parse` | spec-parse.log | Passed: 1391 web tests collected and 65 integration test files parsed; no e2e tests executed |
| `pnpm exec vitest run --changed` | vitest.log | Initial runs interrupted after producing no results; no passing changed-Vitest claim |
| `GIT_OPTIONAL_LOCKS=0 pnpm exec vitest run --changed --maxWorkers=1 --no-file-parallelism --passWithNoTests` | vitest-final.log | Exited 0 with no test files selected; no additional coverage |
| `bash -n scripts/ops/deploy-self.sh` | This record | Passed syntax check only |
| `node scripts/lessons-ledger-gate.mjs` | ledger.log | Passed |

No pnpm build, full e2e, push, PR or host command was run. No lockfile was changed. Review is an in-context source inspection only; no independent review verdict is claimed. The repo's retro-cairn skill was applied: four fixed process defects have dedicated lessons and failing regression evidence (fixture path normalization, restore reporting order, SQLite DDL transaction boundary, restored drain state).

Log copies redact absolute worktree and temporary fixture paths and remove terminal color sequences. Command results and assertions are preserved. Shared-Git write access prevented staging, so diff-based language/comment gates cannot inspect these untracked additions; that coverage remains unverified.


## Follow-up failure modes (recorded before implementation)

Revision: e60b5cac2b2fa9182604e0e7dbc49950cad882b3 plus this follow-up diff. GitHub overlap lookup remains unavailable; this explicitly assigned continuation stays on the existing branch.

| Failure mode | Test or unverified limit |
| --- | --- |
| Install disables approved native builds | Native install command fixture |
| Native binding cannot open a database | Native failure fixture, before scratch or drain |
| Check depends on bootstrap, token, units or creates files | Read-only check fixture with absent deploy root and DB |
| Check fetch changes refs | Check command trace rejects git and systemctl |
| SHA not on main, checks missing/pending/red/wrong SHA/superseded, evidence missing | Check refusal fixtures |
| Malformed SHA or API failure, ambiguous PR, wrong PR base or merge SHA | Unverified API variants, fail closed |
| Read-only SQLite changes WAL sidecars | Uncheckpointed drain fixture compares DB, WAL and SHM bytes |
| Leftover drain state is silently retained | Deploy/check/restore leftover-state fixtures and resume report |
| Custom units, URL, DB, scratch port or backup destination leak into defaults | Isolated configuration deploy/rollback/restore fixtures |
| Empty or wrong unit inventory | Configuration rejection fixture |
| SIGKILL during recovery, concurrent check/deploy, arbitrary writers, disk exhaustion | Unverified host limits; read-only check is advisory, deploy rechecks under lock |
| Missing local release objects after removing fetch from the gate | Fetch-before-checkout fixture |
| Real native install, real GitHub, real systemd, migrations and rollback | Host drill required; stubs cannot establish host readiness |


## Follow-up configuration and host drill

| Environment | Default | Meaning |
| --- | --- | --- |
| CAIRN_DEPLOY_UNITS | cairn-server.service cairn-daemon.service | Exactly two distinct service names, server first |
| CAIRN_DEPLOY_URL | http://127.0.0.1:8787 | Authenticated health read base URL |
| CAIRN_DEPLOY_DB | /mnt/fast/cairn/server/server.db | Target instance DB |
| CAIRN_DEPLOY_SCRATCH_PORT | 18787 | Temporary migration/compatibility server port |
| CAIRN_DEPLOY_BACKUP_OUT | $CAIRN_DEPLOY_ROOT/backups | Backup output directory |
| CAIRN_DEPLOY_BACKUP_TIMER | cairn-db-backup.timer | Timer stopped and restarted by confirmed restore |

The defaults preserve the production layout. ROOT, REPO, TOKEN, MACHINE and TIMEOUT retain their previous environment settings. Unit names are ordered: restart server then daemon; restore stops daemon then server then the configured backup timer.

Run `deploy-self.sh check <full-sha>` before bootstrap or cutover. It needs only authenticated gh and optional read access to the configured DB for the mandatory leftover-drain guard. It does not fetch Git refs, create the deployment root or lock, install dependencies, start services or mutate DB data. If the DB does not exist, the drain guard skips it without creating it. Each passed SHA check prints one PASS line with its checked SHA; final-head pr-evidence prints the head SHA rather than the merge SHA. Failure exits nonzero, prints the failing reason, and stops the remaining checks. Real GitHub provenance and concurrent host WAL activity still require host acceptance.

Deploy, check and restore refuse a persisted deploy_pause_state before performing deployment work and name `deploy-self.sh resume`. Deploy and restore repeat that guard while holding the deployment lock. Inspect current, last-good and units first, then run resume with the same instance environment. Resume prints restored team IDs and pause values only after the transaction commits, then confirms removal of the two claim barriers. A concurrent check is advisory; a later deploy repeats every gate.

Host drill (not run here):

1. In a private host shell, set a new CAIRN_DEPLOY_ROOT and a copied DB under a separate CAIRN_HOME. Use sqlite3's backup API to copy the DB consistently; never copy an active DB with cp. Set CAIRN_DEPLOY_DB to that copy and CAIRN_DEPLOY_BACKUP_OUT to a private drill directory.
2. Set CAIRN_DEPLOY_UNITS to two scratch service names, CAIRN_DEPLOY_BACKUP_TIMER to a scratch timer name, CAIRN_DEPLOY_URL to an unused loopback server port, and CAIRN_DEPLOY_SCRATCH_PORT to a different unused port. Confirm both ports are free. Keep live unit names out of the drill environment.
3. Create the old release and bootstrap current/last-good inside the drill root. Install with the frozen lockfile and run the native probe from apps/server. Capture the actual native probe output and exit code privately.
4. Start two transient user services with the configured scratch names. Set WorkingDirectory to the drill current/apps/server and current/apps/daemon paths. Use source entry points relative to those directories. Give both a scratch HOME/CAIRN_HOME, scratch token and scratch server URL; register a scratch daemon and set CAIRN_DEPLOY_MACHINE to its DB row ID. Inspect effective environment, ExecStart and WorkingDirectory before continuing. Do not reuse live daemon credentials, provider keys, attachments or external dispatch targets. Isolate external scheduler/dispatch activity as well as ports.
5. Run check against a genuinely green main SHA and a SHA missing a required check or evidence. Retain every PASS/failure line and compare filesystem/DB sidecars before and after. No cutover bootstrap or service changes should occur. This is the required real GitHub negative control.
6. Run a full deployment against the scratch instance, recording actual native load, both migration server startups, backup, current/last-good, authenticated reads and scratch daemon heartbeat advancement. Verify only scratch units restarted and only the scratch backup directory received output.
7. Use a second fresh drill root bootstrapped to the old SHA, with its own DB/ports/units. Set CAIRN_DEPLOY_URL to an unused port to force post-cutover health failure while preserving the migration scratch port. During the health wait, insert a uniquely identified row through the scratch application's API. After rollback, verify current and last-good point to the old release and that row still exists; no DB restore should occur.
8. On an expendable drill instance, kill only the drill deployment after drain. Verify deploy/check/restore all refuse with the resume instruction. Inspect its state, run resume, and verify reported team pause values, removed barriers and resumed claims. Retain private host evidence; redact secrets and private data before adding evidence to this repository.

Transient unit setup, exact daemon invocation/registration and safe external isolation depend on the host's measured configuration. These steps remain host acceptance work, not a claim that transient systemd services or real migrations have passed locally.

## Follow-up evidence record

All follow-up runs test commit e60b5cac2b2fa9182604e0e7dbc49950cad882b3 plus the uncommitted current diff. Artifacts are local files only, as explicitly requested; no committed delivery, accessible raw link, PR, CI verdict or independent review is claimed. Original evidence remains available in the parent commit; red.log and green.log now describe the follow-up.

| Claim | Command | Surface / provider mode | Artifact | Result / limit |
| --- | --- | --- | --- | --- |
| Approved-build install invocation, immediate native failure stop, isolated settings, stale drain refusal and recovery | node --test scripts/ops/deploy-self.test.mjs | Fixture orchestration, real Git/SQLite; gh, pnpm, node server, curl and systemctl stubbed; no LLM | red.log, green.log | Red before implementation; final suite passed 41/41 (20 added tests) |
| WAL schema guard preserves sidecars | node --test scripts/ops/deploy-self.test.mjs | Real SQLite WAL with an open writer connection, stub external tools | wal-red.log, green.log | Red under plain mode=ro; final suite compares DB/WAL/SHM unchanged |
| Compare-response fixture must not receive check-run mutations | Same node test command | Stub GitHub response boundary | fixture-shape-red.log, green.log | Initial three unintended gh failures; endpoint-specific fixture fix |
| Deployment still fetches release objects | node --test --test-name-pattern='deploy fetches' scripts/ops/deploy-self.test.mjs | Fixture fetch boundary | fetch-red.log, green.log | Red without deployment fetch, then exercised in final suite |
| Native database can open locally | node -e in apps/server, same require/open/close expression as deploy | Local real native binding, existing install; no provider | native-local.log, native-version.log | Passed locally; does not prove a clean install or host ABI/build |
| Static checks | pnpm lint; pnpm typecheck; pnpm spec:parse | Repository source, no provider | lint.log, typecheck.log, spec-parse.log | Lint and typecheck passed; 1391 web cases collected and 65 integration files parsed; no e2e executed |
| Changed test selection | pnpm exec vitest run --changed | Repository selector, no provider | vitest.log | Exit 0, no tests selected; node suite supplies deployment coverage |
| Shell syntax | bash -n scripts/ops/deploy-self.sh | Local parser, no provider | This record | Exit 0; wrapper unchanged |
| Lessons format | node scripts/lessons-ledger-gate.mjs | Local ledger, no provider | ledger.log | Passed |

No screenshot or fixture HTTP response establishes real application or provider behavior. Runtime fixture assertions inspect symlink targets, real SQLite rows/schema and subprocess traces; reading source alone is not used to accept those effects. The tests establish that check creates no deploy root, lock or absent DB and leaves existing fixture DB bytes unchanged. The uncheckpointed WAL regression also compares DB, WAL and SHM bytes unchanged while observing the persisted drain. The guard uses SQLite's Unix no-lock VFS with exclusive read-only locking mode to keep its WAL index in private memory. It never uses immutable mode, which would miss uncheckpointed WAL state. This short schema read has no cross-process lock; concurrent external schema changes, power loss and host filesystem semantics remain host acceptance limits. Deploy and restore repeat it under the deployment lock. It is the only local DB access in check.

In-context source inspection found and fixed the missing deployment fetch. This is separate from automated verification and is not an independent review verdict. The retro-cairn workflow was applied: the four dispatcher findings and the fixture response-shape, fetch-boundary and WAL-sidecar errors have regression tests and dedicated lessons. The existing formatting lesson records lint catching fixture formatting. These are automated safeguards, not review approval.

A drill shell can pin the target inventory before the steps above (replace the two SHA placeholders with full measured SHAs, and supply the scratch token and machine ID privately):

```sh
export CAIRN_DEPLOY_ROOT=/tmp/cairn-deploy-drill
export CAIRN_HOME="$CAIRN_DEPLOY_ROOT/home"
export CAIRN_DEPLOY_DB="$CAIRN_HOME/server/server.db"
export CAIRN_DEPLOY_UNITS="cairn-drill-server.service cairn-drill-daemon.service"
export CAIRN_DEPLOY_URL=http://127.0.0.1:28887
export CAIRN_DEPLOY_SCRATCH_PORT=28888
export CAIRN_DEPLOY_BACKUP_OUT="$CAIRN_DEPLOY_ROOT/backups"
export CAIRN_DEPLOY_BACKUP_TIMER=cairn-drill-backup.timer
scripts/ops/deploy-self.sh check <green-full-sha>
scripts/ops/deploy-self.sh check <negative-control-full-sha>
scripts/ops/deploy-self.sh <green-full-sha>
```

For rollback, use the second bootstrapped drill instance, change its health URL to an unused port, and invoke the same deploy command. Do not reuse a failed release directory or retarget a currently running drill root.


Final follow-up result (measured): 41 node tests passed, including 20 added tests. red.log contains the 39-test pre-implementation run; fetch-red.log and wal-red.log preserve the two later failure modes before their fixes. Final lint, typecheck, changed Vitest, spec parsing, lessons, English-only and comment-discipline gates exited 0. Vitest selected no tests. The local native probe exited 0; npm ls identified better-sqlite3 13.0.3 but exited 1 because installed Drizzle packages declare incompatible dependency ranges. No dependencies or lockfile were changed to address that pre-existing environment limitation.

Final logs remove terminal colors, trim trailing whitespace and redact absolute workspace/cache paths. Assertions and command results are preserved. No commit, push, PR, full e2e, pnpm build, omarchy or real GitHub command was performed. No installed lifecycle build was run locally. The host drill, clean native install, real checks and service behavior remain unverified.
