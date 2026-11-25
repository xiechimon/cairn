# Artifact self-deploy design

Status: owner-approved goal, 2026-11-25. Research: `docs/research/self-deploy-artifact-2026-11-25.md`. This is owner infrastructure, not a product settings surface: a self-hosted host operator installs one watcher on that host; Cairn users who never self-deploy never meet it. The operator must already have a running Cairn server, a dedicated build worktree, git, Node, rsync, sqlite3 and network access to GitHub. Hostnames, account names, service labels, tokens and absolute home paths stay in that host's environment file.

## One mechanism

`deploy-watch.sh` is the only scheduler entry. `deploy-self.sh` is the only deployer. `install-self-deploy.sh` only installs scheduler configuration for the same two scripts. When `CAIRN_DEPLOY_RUNNER_CHECKOUT` is configured in host env, `deploy-self.sh` also keeps that runner checkout on the exact deployed SHA and restarts the runner unit in lockstep with the server, waiting for both active in-server Coordinator turns and active claimed runner steps before swapping. When `CAIRN_DEPLOY_RUNNER_CHECKOUT` is unset, it operates in server-only mode (runner claims survive the server restart).

The running application path is a symlink to an immutable release containing `dist/`, `web/`, `drizzle/`, `node_modules/` and `DEPLOYED_SHA`. An unmanaged `tsnet-sidecar*` binary already present in the active release is carried forward unchanged; it is host runtime machinery, not source-built server output. The database, keys, attachments, repositories, Coordinator stores, logs, state and backups live outside every release. A release switch creates a temporary symlink to the new release and renames it over the application path.

## State and writers

| State | Shape | Writers | Readers / failure behavior |
|---|---|---|---|
| build worktree | dedicated detached git worktree | deployer fetches and checks out the target | never the running server; a failed build leaves services untouched |
| release directory | `<state>/releases/<time>-<sha12>/` | staged in a temporary sibling, renamed once complete | immutable after creation; retained for rollback |
| application path | symlink configured by host env | deployer copies a legacy real directory into a preserved legacy release, then atomically re-points it | the moved original legacy directory is retained outside the application path |
| `DEPLOYED_SHA` | full lowercase SHA inside the release | staging helper | watcher compares it with origin/main |
| deploy lock | directory under deploy state | deployer | concurrent or overlapping timers exit busy; stale lock recovery is bounded |
| hold file | operator-created file | operator only | any nonzero hold reason skips deployment before build or switch |
| lease row | existing server `deploy_lease` row | deployer through the owner-authenticated endpoint, with DB repair only for recovery | server pauses machine claims; Coordinator claim logic also refuses new in-server turns while draining |
| in-progress marker | `phase/target/previous/snapshot/release` key-values | deployer | the next invocation or `--recover` finishes a healthy target or rolls back before considering new work |
| database snapshot | SQLite online backup under backup root | deployer before stopping the server | rollback restores it only when no domain write happened after the snapshot; otherwise code rolls back and the newer DB is kept |
| result record | `deployed.json` in deploy state and beside `server.db` | deployer | `/api/server/deploy` already exposes the data-side record; records success, rollback and unhealthy rollback |
| failed marker | one file per SHA | deployer after migration, health or rollback failure | watcher skips that SHA rather than looping a broken release forever |
| GitHub evidence cache | successful exact-SHA evidence under deploy state | evidence helper | prevents unauthenticated public-repo polling from re-checking immutable green evidence |

## Transition

1. Watcher fetches `origin/main`, reads the deployed SHA, scans first-parent commits newest first and asks the evidence helper for exact binding: workflow run `head_sha`, branch `main`, event `push`, status `completed`, conclusion `success`, plus required check runs green. It invokes the deployer for the newest green commit not marked failed.
2. Deployer validates the SHA, fetch ancestry, hold, lock and prior recovery. It checks out the target in the dedicated build worktree, installs with the pinned package-manager version and scripts disabled, rehearses migrations against an online copy of the live database, builds server and web output, and stages an immutable release.
3. Deployer acquires the deployment lease. Machine claims pause immediately. On server versions that include this design, the in-server Coordinator also refuses new turns while the lease drains. The deployer waits up to the bounded coordinator timeout for `chief` steps claimed with no machine id and for open computer calls other than takeover requests. Timeout exits busy before any switch and releases the lease.
4. Deployer snapshots the live DB with SQLite online backup and verifies integrity. It stops only the server service, atomically points the application path at the new release, starts the server, and requires repeated `/app` plus authenticated-or-unauthenticated `/api/user/me` health responses.
5. Success writes both deploy records, releases the lease, prunes only surplus old releases/snapshots while keeping the previous release, and exits zero.
6. Health failure marks the target failed, stops the server, points the application path back to the previous release, restores the snapshot only when no domain write followed it, starts the previous release and health-checks it. A healthy rollback exits nonzero; an unhealthy rollback exits the distinct critical status.
7. Any pre-switch failure releases the lease and leaves the previous release running. Any interruption leaves the in-progress marker; recovery reacquires the deployer-owned lease where possible and resolves the recorded phase before new deployment.

## Service-manager adapters

- launchd: installer writes one LaunchAgent for the watcher with `StartInterval=120` and `RunAtLoad=true`. The deployer stops the server with `launchctl bootout` and starts it with `launchctl bootstrap` using the plist path supplied by host env; an absent service is treated as already stopped, while a present service is booted out. Forced proof can use `kickstart -k` for restart, but stop/start remains the deploy path because database restore requires a stopped process.
- systemd: installer writes one oneshot service and timer. The timer uses a two-minute interval with explicit accuracy; the deployer uses `systemctl --user stop` and `start` for the configured server unit.

Both adapters run the same shell functions and the same deployer. There is no separate cloud or Mac algorithm.

## Failure scenarios

| Scenario | Required outcome |
|---|---|
| malformed/non-main/non-green SHA | refusal before build or service mutation |
| hold file | busy/refusal before build or service mutation |
| install/build/migration rehearsal failure | target marked failed or left undeployed according to cause; previous service untouched |
| active in-server Coordinator turn | wait; timeout exits busy before snapshot or restart |
| runner claim active | restart remains allowed; the lease only prevents new claims during the short server outage |
| stop/swap/start failure | attempt rollback to previous release and preserve nonzero status |
| target unhealthy | automatic rollback as above |
| rollback unhealthy | distinct critical exit; snapshot and failed DB copies retained |
| domain write after snapshot | do not overwrite it; roll back code only and report that the DB was kept |
| deploy process killed | next tick recovers before deploying anything newer |
| API rate limit or network failure | no admission; next tick retries; successful evidence remains cached |

## Validation

Red-first operational tests cover exact-SHA CI binding, pagination, malformed and non-main refusal, artifact staging and external dependency copying, atomic symlink replacement, launchd and systemd adapter commands, busy waiting, health-check rollback, post-snapshot write preservation, interruption recovery, hold, failure markers and the two-minute scheduler configuration. A server test covers the Coordinator claim pause while the deployment lease drains. Live proof on the first host records `DEPLOYED_SHA` advancing without hand deployment and a forced unhealthy target rolling back.
