# Deploy self verification (#1408)

## Scope and evidence boundaries

Review round 2 continues the assigned branch at `93dd87ee6acd2be063b006da542e3179f143f2f1` plus this working diff. GitHub and omarchy access are unavailable by instruction, so open and recently merged overlaps are unverified. No commit, push, PR, full e2e or build is authorized. Earlier evidence files are historical; the current round's commands and limits below take precedence.

The node suite runs scratch Git repositories and real SQLite files. gh, pnpm, node/server, curl and systemctl are stubbed. No live application, daemon, provider or host systemd is exercised. Filesystem, digest, trigger and signal assertions are runtime fixture evidence. No screenshots are used. Automated checks are separate from review; this round does not claim an independent review verdict or CI result. Evidence cannot establish delivered verification until a later authorized delivery commits it and supplies SHA-pinned raw links from its PR. Logs and Markdown should be linked as readable artifacts, not image embeds.

## Review round 2 failure modes (before implementation)

| Failure mode | Test or limit |
| --- | --- |
| Drill units retain the live DB, timer or URL during restore/resume/deploy | Custom-unit unsafe-default rejection tests |
| DB lies outside effective server CAIRN_HOME, including sibling prefixes and symlinks; environment absent or unreadable | Instance home containment tests; systemctl failures fail closed |
| SIGHUP bypasses rollback and drain cleanup | Actual SIGHUP during drain fixture |
| Reinstalled barriers retain an expired deadline after slow health | Slow health and barrier renewal fixture using an advanced clock |
| Heartbeat changes preview digest while services run | Preview stops writers and stable confirmation fixture |
| Real unit EnvironmentFiles, host ExecStart, native modules, external writers, clock jumps, SIGKILL and power loss | Unverified host acceptance; no claim from stubs |


## Retained failure modes from earlier rounds

These were recorded before the original implementation; their existing tests remain in the 60-case suite.

| Failure mode | Test or unverified limit |
| --- | --- |
| SHA off main; checks missing, pending, wrong SHA, superseded or red; evidence missing | Gate refusal fixtures |
| Malformed SHA, API failure, ambiguous PR, unexpected PR base or merge SHA | Unverified API variants; fails closed |
| Fetch omitted before checkout | Fetch-before-worktree fixture |
| Dependency installation or native SQLite probe fails | Install/native refusal fixtures |
| New migrations fail or previous server cannot open migrated scratch | Migration and compatibility fixtures |
| Read-only check creates DB/root, changes WAL/SHM or depends on bootstrap | Missing DB/root and open-writer WAL fixtures |
| Current/last-good missing, dirty release, concurrent deploy, lock refusal | Unverified operational preconditions |
| In-flight steps lost, new claims inserted or transitioned during drain, drain timeout | In-flight, claim barrier and timeout fixtures |
| Partial pause transaction, changed pause values or failed trigger cleanup | Transactional drain and conditional resume fixtures |
| Backup failure | Backup refusal fixture |
| Invalid units or wrong WorkingDirectory | Unit inventory and path fixtures |
| Restart returns before migration completes or migrations remove triggers | Asynchronous readiness and rebuilt-step fixtures |
| Health reads fail, heartbeat is stale, or pre-restart heartbeat is reused | Health and heartbeat rollback fixtures |
| Code rollback loses a post-backup row or selects the wrong release | Real SQLite row, symlink and git SHA assertions |
| Rollback restart itself fails, URL targets the wrong app or arbitrary external writer races | Unverified host limits |
| Restore hides changed/new rows, confirms a stale digest, keeps snapshot barriers or skips service recovery after failure | Preview, stop-time write, restored-drain and recovery fixtures |
| Invalid snapshot, schema mismatch, corruption, partial restore, start failure during preview, disk exhaustion | Unverified host failure variants; inspect stopped units before recovery |
| Persisted drain state silently cleared, missing triggers or unclean exit | Leftover-state, expiry, missing-trigger and explicit resume fixtures |
| External tool tampering, wall-clock jumps, SIGKILL or power loss | Unverified; deadline and explicit recovery do not guarantee crash safety |

## Recovery and deadline behavior

Custom units require a nondefault DB, backup timer and URL for deploy, restore and resume. Before any of those commands mutates state, `systemctl --user show -p Environment <server-unit>` must expose an absolute CAIRN_HOME containing the resolved DB path. Missing CAIRN_HOME fails closed. Set it directly with Environment in the unit; EnvironmentFile values are not resolved by this guard. Symlinks are resolved before containment checks. Operators must also verify that ExecStart does not override CAIRN_HOME and that the URL addresses this instance; that host relationship cannot be proven by these fixtures.

`restore <snapshot.db[.gz]>` stops daemon, server and backup timer before computing DISCARD_DIGEST. This preview causes downtime and leaves those writers stopped so heartbeat writes cannot invalidate confirmation. Confirm with `restore <same-snapshot> --confirm-discard <digest>`. Confirmation stops the same inventory again, recomputes the discard set, refuses changes, restores through SQLite backup and attempts to start every configured service and timer even on failure. If abandoning preview, explicitly start the three configured units. Reports can contain sensitive rows; keep them private. Arbitrary external writers remain outside this inventory, and can still invalidate the digest. Restore is never an automatic rollback operation.

SIGINT, SIGTERM and SIGHUP unwind deployment cleanup, including pause restoration and code rollback after cutover. SIGKILL and power loss cannot run cleanup. Barriers receive a fresh max(600, 4 * TIMEOUT) second deadline whenever installed or reinstalled after server readiness, including rollback. A clock jump or a single phase exceeding that renewed allowance can still expire claims early. Expiry permits claims but leaves saved pause state for explicit `resume`. Inspect current, last-good, deploy.jsonl and unit state before resuming. A fresh deploy refuses leftover pause state.

## Copy-paste bootstrap on omarchy (not executed here)

Run in a private Bash shell on the host. First inspect the actual running commands and source checkout. The checked-in `scripts/ops/systemd/` contains only WorkingDirectory drop-ins for server and daemon, not their base service ExecStart. `apps/daemon/package.json` defines source `dev` as `tsx src/cli.ts start -f`, while the installed `cairn` binary is `dist/cli.mjs`. Therefore the supplied daemon drop-in alone does not establish source execution relative to WorkingDirectory. A packaged or absolute old-checkout ExecStart will not follow the release source. Inspect and, if necessary, configure source execution before bootstrap; the host's effective invocation remains unverified.

```sh
systemctl --user cat cairn-server.service cairn-daemon.service
systemctl --user show -p ExecStart -p WorkingDirectory -p Environment cairn-server.service cairn-daemon.service
export CAIRN_DEPLOY_REPO="$HOME/Code/AgentProjects/cairn"
export CAIRN_DEPLOY_ROOT="$HOME/.local/share/cairn-deploy"
export CAIRN_DEPLOY_DB="/mnt/fast/cairn/server/server.db"
export CAIRN_DEPLOY_UNITS="cairn-server.service cairn-daemon.service"
export CAIRN_DEPLOY_BACKUP_TIMER="cairn-db-backup.timer"
export CAIRN_DEPLOY_URL="http://127.0.0.1:8787"
export CAIRN_DEPLOY_SCRATCH_PORT="18787"
export CAIRN_DEPLOY_BACKUP_OUT="$CAIRN_DEPLOY_ROOT/backups"
export CAIRN_DEPLOY_TIMEOUT="120"
read -r -p 'Verified currently running full source SHA: ' CAIRN_RUNNING_SHA
export CAIRN_RUNNING_SHA
read -r -p 'Exact daemon machine row ID: ' CAIRN_DEPLOY_MACHINE
export CAIRN_DEPLOY_MACHINE
read -r -s -p 'Existing server bearer token: ' CAIRN_DEPLOY_TOKEN
export CAIRN_DEPLOY_TOKEN
printf '\n'
test "${#CAIRN_RUNNING_SHA}" -eq 40
test "$(git -C "$CAIRN_DEPLOY_REPO" rev-parse "$CAIRN_RUNNING_SHA^{commit}")" = "$CAIRN_RUNNING_SHA"
command -v node pnpm python3 sqlite3 git gh curl gzip
export CAIRN_DEPLOY_PATH="$PATH"
umask 077
mkdir -p "$CAIRN_DEPLOY_ROOT/releases" "$CAIRN_DEPLOY_ROOT/backups" "$HOME/.cairn/tools/deploy-self"
git -C "$CAIRN_DEPLOY_REPO" worktree add --detach "$CAIRN_DEPLOY_ROOT/releases/$CAIRN_RUNNING_SHA" "$CAIRN_RUNNING_SHA"
(cd "$CAIRN_DEPLOY_ROOT/releases/$CAIRN_RUNNING_SHA" && pnpm install --frozen-lockfile)
(cd "$CAIRN_DEPLOY_ROOT/releases/$CAIRN_RUNNING_SHA/apps/server" && node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();")
ln -s "$CAIRN_DEPLOY_ROOT/releases/$CAIRN_RUNNING_SHA" "$CAIRN_DEPLOY_ROOT/current"
printf '%s\n' "$CAIRN_RUNNING_SHA" > "$CAIRN_DEPLOY_ROOT/last-good"
for app in server daemon; do
  mkdir -p "$HOME/.config/systemd/user/cairn-$app.service.d"
  install -m 600 "$CAIRN_DEPLOY_REPO/scripts/ops/systemd/cairn-$app.service.d/deploy-self.conf" "$HOME/.config/systemd/user/cairn-$app.service.d/deploy-self.conf"
done
install -m 700 "$CAIRN_DEPLOY_REPO/scripts/ops/deploy-self.sh" "$CAIRN_DEPLOY_REPO/scripts/ops/deploy-self.py" "$CAIRN_DEPLOY_REPO/scripts/ops/backup-server-db.sh" "$HOME/.cairn/tools/deploy-self/"
systemctl --user daemon-reload
systemctl --user show -p ExecStart -p WorkingDirectory -p Environment cairn-server.service cairn-daemon.service
```

Use the verified running SHA, not an assumed repository HEAD. Bootstrap deliberately refuses existing current/releases rather than overwriting them. The supplied drop-ins assume the default deploy root; custom drill roots need matching WorkingDirectory overrides. Both units must retain their existing credentials, token and connection configuration. Set server Environment=CAIRN_HOME=/mnt/fast/cairn (or the drill home), then daemon-reload before running the guard. Set the units' PATH to an absolute path that includes their node/pnpm executables. A user manager does not load interactive fnm initialization. The deployment process also needs that PATH, including Python, sqlite3, git, authenticated gh and curl. Python helper and shell wrapper must remain together outside current.

When the base daemon unit needs a source command, the corresponding override uses an empty ExecStart followed by `ExecStart=/absolute/path/to/node --import tsx src/cli.ts start -f` with WorkingDirectory pointing through current/apps/daemon. The server equivalent is `ExecStart=/absolute/path/to/node --import tsx src/index.ts`. Preserve the measured host options and environment; these example entry points do not prove host credentials or registration. Do not use the packaged `cairn` binary as evidence that current selects source.

Run deployments under a transient user service so terminal/session loss does not kill the deploy. After setting the exports above, this exact command prompts for the target SHA and passes configuration without putting the token in arguments:

```sh
read -r -p 'Green main full SHA to deploy: ' CAIRN_TARGET_SHA
systemd-run --user --unit="cairn-deploy-$(date +%s)" --collect --wait --pipe \
  --setenv="PATH=$CAIRN_DEPLOY_PATH" \
  --setenv=CAIRN_DEPLOY_REPO --setenv=CAIRN_DEPLOY_ROOT --setenv=CAIRN_DEPLOY_DB \
  --setenv=CAIRN_DEPLOY_UNITS --setenv=CAIRN_DEPLOY_BACKUP_TIMER \
  --setenv=CAIRN_DEPLOY_URL --setenv=CAIRN_DEPLOY_SCRATCH_PORT \
  --setenv=CAIRN_DEPLOY_BACKUP_OUT --setenv=CAIRN_DEPLOY_TIMEOUT \
  --setenv=CAIRN_DEPLOY_MACHINE --setenv=CAIRN_DEPLOY_TOKEN \
  "$HOME/.cairn/tools/deploy-self/deploy-self.sh" "$CAIRN_TARGET_SHA"
```

## Host acceptance still required

Use an isolated copied SQLite database under a separate CAIRN_HOME, scratch units and timer, separate URL/ports and backup destination. Bootstrap current/last-good at its actual old SHA. Verify effective Environment, source-relative ExecStart and WorkingDirectory, native load, real GitHub positive/negative checks, new and old scratch server migrations, drain of a real in-flight step, authenticated reads, actual daemon heartbeat, slow readiness, SIGHUP cleanup, rollback retaining a post-backup row, and stopped-writer restore preview/confirmation. Do not reuse live credentials, provider keys, attachments or dispatch targets in the drill. Validate missing Environment and each accidental live-default configuration refuses before stopping any service. Host commands, real providers, external scheduler isolation, API provenance, native compatibility, disk exhaustion, arbitrary writers, URL misrouting, concurrent configuration changes and kill/power-loss recovery remain unverified.

## Review round 2 commands

All commands test the base SHA above plus this diff. Provider mode is stub for the node suite and not exercised for static checks. Artifact paths are relative to this directory. Measured results: the node suite passed 60/60 (ten new tests and an updated preview assertion). The immutable baseline focused run failed all 11 selected review cases. Lint, typecheck, changed Vitest, spec collection, shell/Python syntax, language/comment gates and ledger validation exited 0. Vitest selected no tests; spec collection parsed 1391 web cases and 65 integration files without executing e2e. Final focused containment, slow-readiness and stopped-writer tests are recorded separately after strengthening quoted-path and symlink cases. Red controls ran before implementation; slow-health-red.log uses immutable HEAD script copies with explicit CAIRN_TEST_DEPLOY_SCRIPT and CAIRN_TEST_DEPLOY_PYTHON paths.

| Command | Artifact | Claim and limits |
| --- | --- | --- |
| `node --test scripts/ops/deploy-self.test.mjs` | green.log | Fixture orchestration, real SQLite and Git, actual signal handling; external service/API boundaries stubbed |
| `CAIRN_TEST_DEPLOY_SCRIPT=/tmp/1408-round2-baseline/deploy-self.sh CAIRN_TEST_DEPLOY_PYTHON=/tmp/1408-round2-baseline/deploy-self.py node --test --test-name-pattern='live default\|home containment\|slow health\|SIGHUP\|stable digest\|restore previews' scripts/ops/deploy-self.test.mjs` | red.log, slow-health-red.log, home-containment-red.log | Review regressions reject the prior script; no live behavior |
| `pnpm lint` | lint.log | Formatting and lint only |
| `pnpm typecheck` | typecheck.log | TypeScript only; no Python/shell runtime coverage |
| `pnpm exec vitest run --changed` | vitest.log | Selected coverage only; no tests selected means no additional coverage |
| `pnpm spec:parse` | spec-parse.log | Collection only; no e2e execution |
| `node --test --test-name-pattern='home containment\|slow health\|stable digest' scripts/ops/deploy-self.test.mjs` | focused-green.log | Passed 3/3 final focused regressions; same fixture boundaries |
| `node scripts/lessons-ledger-gate.mjs`; `node scripts/english-only-gate.mjs`; `node scripts/comment-discipline-gate.mjs` | ledger.log, english.log, comment.log | Passed; automated source checks, not review |
| `bash -n scripts/ops/deploy-self.sh`; Python `ast.parse`; `git diff --check` | This record | Passed local syntax and whitespace checks only |

## Changed files

The paths below are this round's changes. Historical file lists and fingerprints are superseded.

- `docs/lessons/1408-duplicate-fixture-property.md`
- `docs/lessons/1408-fixture-runtime-model.md`
- `docs/verify/1408/fixture-clock-red.log`
- `docs/verify/1408/fixture-distinct-rows-red.log`
- `docs/verify/1408/focused-green.log`
- `docs/verify/1408/home-containment-red.log`
- `docs/verify/1408/lint-round2-red.log`
- `docs/verify/1408/slow-health-red.log`
- `docs/lessons/1408-drain-lifecycle.md`
- `docs/lessons/1408-evidence-source-snapshot.md`
- `docs/lessons/1408-instance-isolation.md`
- `docs/lessons/1408-restore-preview-race.md`
- `docs/lessons/1773-evidence-log-whitespace.md`
- `docs/lessons/baselines.json`
- `docs/lessons/events.jsonl`
- `docs/verify/1408/README.md`
- `docs/verify/1408/green.log`
- `docs/verify/1408/lint.log`
- `docs/verify/1408/red.log`
- `docs/verify/1408/spec-parse.log`
- `scripts/ops/deploy-self.py`
- `scripts/ops/deploy-self.test.mjs`

## Retro and source provenance

The repository retro-cairn workflow was applied. Review defects update the instance-isolation, drain-lifecycle and restore-preview lessons. This run also corrected an overlapping mixed-revision red run, an incomplete clock stub, duplicate stop-time row identities and a duplicate fixture object key. The harness now snapshots sources at startup; immutable baseline controls replace the excluded mixed run. Biome rejected the duplicate key before delivery. Ledger recurrence counters were generated by the ledger command, not edited by hand. Raw subprocess whitespace was caught by git diff --check and normalized before final archiving; output assertions and exit outcomes are unchanged. No external package API was added.

The first follow-up green run failed only the older identical-row fixture (fixture-distinct-rows-red.log). The incomplete clock stub is preserved in fixture-clock-red.log and excluded from deadline acceptance; slow-health-red.log fails on the actual deadline assertion. lint-round2-red.log captures the duplicate key rejection. The ten new review regressions and updated preview assertion were red against HEAD before implementation. Final home-path cases also have an immutable baseline rejection and a focused green rerun.

Logs strip terminal escape sequences, trailing whitespace, final empty lines and private absolute path prefixes. Artifact results establish fixture behavior only. Real host commands and publicly accessible evidence links remain unverified by the sandbox and delivery restrictions.


Final source SHA-256 fingerprints (working diff):

- `scripts/ops/deploy-self.py`: `238dcc28894cd76590ea79f8c5ac51abf286394206fb7f9a429117605251495c`
- `scripts/ops/deploy-self.test.mjs`: `e8a578b5fdedb5238571d3ea0854f5d048f4b256cdb31ec1f9d7fa02e570ae87`
