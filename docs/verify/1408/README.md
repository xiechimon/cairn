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

Requirements: Linux user systemd, Python 3, sqlite3, gzip, git, gh authenticated to this repository, pnpm and the node executable used by both units on PATH. The wrapper uses only Python standard-library APIs; no external package API was introduced. Installation uses `pnpm install --frozen-lockfile --ignore-scripts` to honor the repository's prohibition on unapproved lifecycle scripts. If native dependencies cannot load without an approved build, scratch startup refuses the deployment; this run does not authorize or claim a native dependency build.

Default layout: `~/.local/share/cairn-deploy/{releases/<full-sha>,current,last-good,backups,deploy.jsonl}`. Override with `CAIRN_DEPLOY_ROOT`, `CAIRN_DEPLOY_REPO`, `CAIRN_DEPLOY_DB`. Use absolute paths. Set `CAIRN_DEPLOY_TOKEN` to the existing server bearer token, `CAIRN_DEPLOY_MACHINE` to the daemon's exact machine row ID, and optionally `CAIRN_DEPLOY_URL` (default `http://127.0.0.1:8787`) and `CAIRN_DEPLOY_TIMEOUT` (seconds, default 120). Do not commit the token or host runtime logs. Keep the wrapper, Python helper and backup script together in a stable tools directory outside `current`.

Before the first deploy, create a detached release worktree for the currently running full SHA, install its dependencies, point `current` to it and write that SHA plus a newline to `last-good`. This bootstrap must be accepted on the host; the script deliberately refuses an uninitialized installation. Copy the provided files from `scripts/ops/systemd/cairn-{server,daemon}.service.d/deploy-self.conf` to matching directories under `~/.config/systemd/user/`, then run `systemctl --user daemon-reload`. These drop-ins retain the existing ExecStart and environment and change WorkingDirectory only. Inspect both `systemctl --user cat` outputs: ExecStart must use source paths relative to WorkingDirectory, or explicitly through `current`; an absolute source path into the old checkout must be replaced before use. The server's supplied measured ExecStart uses relative `src/index.ts`; the daemon's exact ExecStart was not supplied and remains unverified. Verify neither unit pins a source checkout elsewhere. The script refuses unless both effective WorkingDirectory values point through `current`.

Run `scripts/ops/deploy-self.sh <full-sha>` on the host. It fetches origin/main, checks ancestry, requires the newest GitHub Actions check run for each named check on the exact SHA, and requires one merged main PR whose merge commit equals the requested SHA and whose final head passed pr-evidence. Missing, pending and failing runs block. The release checkout is never reused after a failed attempt without operator inspection. Scratch startup uses the new release's actual entry point (which runs its migrations), followed by the previous release's actual entry point against the same scratch DB. Scratch has its own home, token and generated encryption key; no live key or attachments are copied. The two read probes cover startup and user/team reads, not all encrypted data or all prior-release queries. Scratch logs stay private under the deploy root. Port 18787 must be free; port isolation and external side effects from scratch scheduler startup remain host acceptance limits.

The claim barrier is necessary because source inspection of machine-claim.ts found no autonomyPaused check. The script transactionally saves pause values, pauses teams and installs SQLite triggers that ignore new transitions/inserts into claimed. It waits for existing claimed steps to finish without stopping either unit. Backup happens only after drain. The code symlink switches atomically, then server and daemon restart in order. Health requires both authenticated JSON reads plus the configured machine's lastSeenAt increasing after the pre-restart baseline. No dedicated health route exists in this checkout. Failed health swaps code back and restarts without copying any DB bytes back. No general forward-compatibility proof is claimed: only the scratch startup and read probes are enforced.

On the host, verify a genuinely green SHA, missing evidence rejection, migration failure, drain timeout with units still running, both actual scratch entry points, heartbeat advancement, authenticated reads and a deliberately failed health rollback retaining a post-backup row. Confirm the effective unit source paths and native modules. Live execution, live providers, GitHub status provenance and independent review are unverified here. No PR is opened and no CI result on a pushed head is claimed.

`deploy-self.sh restore <snapshot.db[.gz]>` prints current rows absent or different in the snapshot and refuses to modify anything. `--confirm-discard` explicitly authorizes stopping daemon/server/backup timer, recomputing the report after stop, replacing DB content through SQLite's backup API and restarting. The report includes changed current rows as well as new rows; schema mismatches conservatively print all current rows in that table. It can contain sensitive data: keep it private. Other external writers must be stopped separately; they are outside the supplied service inventory. Restore is not part of rollback. A failed restore leaves services stopped for inspection.

SIGTERM/SIGINT clean up a normal deploy drain. SIGKILL/power loss can retain the durable claim barrier and pause state. Inspect current, last-good, deploy.jsonl and unit state before running `deploy-self.sh resume` to restore saved pause values and remove the barrier. A fresh deploy refuses a preexisting drain table rather than clearing another run's state. Do not run resume until deciding which release should run. Rollback restart failure, crash recovery, disk-full behavior, concurrent deployment refusal, malformed arguments, missing/dirty release records and arbitrary external writers are not covered by the original acceptance fixture set unless explicitly named in green.log.

## Runtime evidence

- red.log: all ten original acceptance tests fail before the script exists.
- fixture-path-red.log: post-implementation assertions exposed noncanonical macOS paths; canonical fixture roots fix them.
- extended-red.log: expanded guard tests, including the missing unit-path preflight, before that preflight was added.
- restore-race-red.log: injected stop-time write omitted from the original restore report; fixed by stopping before the report.
- claim-barrier-red.log: negative control drops the real SQLite claim triggers and the claim-blocking assertion fails.
- green.log: final orchestration fixtures and real SQLite assertions, with stubbed external boundaries.

The tested revision is the recorded base plus these uncommitted files. The requested commit could not be created because git add cannot create the shared worktree index.lock (Operation not permitted). No screenshots or provider calls establish additional behavior. Check logs document automated results only; they are not a review verdict. After committing, a later PR must use SHA-pinned raw links to this branch's committed evidence; no public accessibility is claimed for this local-only delivery.


## Final verification commands

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
