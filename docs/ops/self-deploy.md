# Self-deploy on omarchy

`cairn-self-deploy.timer` runs `scripts/ops/deploy-watch.sh` every 5 minutes. The watcher finds the newest first-parent main commit after the deployed one whose required checks (`check`, `pack-smoke`, `e2e-gate`) are all green and runs `scripts/ops/deploy-self.sh <sha>` for it. Both scripts copy themselves into the state directory before running, because the deploy switches the checkout they live in.

`deploy-self.sh` refuses (exit 2) a SHA that is not on `origin/main`, lacks a green required check, arrives while an `autonomy-paused` issue is open, or adds a `true` entry under `allowBuilds` in `pnpm-workspace.yaml`. It waits (exit 75, retried on the next tick) while any step is `claimed` or `~/.local/state/cairn-deploy/hold` exists. A run of an orb trial, or anything else that must not see a restart, writes one line naming itself into that hold file and removes it when done.

A deploy rehearses the target's migrations on an online copy of the live DB in a scratch worktree, builds the daemon and web assets in the live checkout, stops daemon and server, snapshots the DB to `~/backups/cairn-server/predeploy/stopped-<time>-<previous sha>.db` (newest 10 kept), starts the server, waits for `/app` 200 and `/api/user/me` 200 or 401 three times in a row, starts the daemon and waits for its machine heartbeat. A failed health check moves the failed DB to `predeploy/failed-<time>-<sha>/`, restores the snapshot, rebuilds the previous commit and restarts it (exit 1). A failed rollback exits 3. A failed SHA is recorded in `~/.local/state/cairn-deploy/failed/<sha>` and never retried; the next green main commit is.

The result goes to `~/.local/state/cairn-deploy/deployed.json` and `~/.cairn/server/deploy.json`: `{sha, previous, result, failed, snapshot, at, host}` with `result` one of `deployed`, `rolled-back` or `rollback-unhealthy`.

When the oldest undeployed main commit landed more than 2 hours ago, the watcher opens the issue `deploy lag: omarchy is behind main` (or comments on it once per main head) with the reason, and closes it once the deployed SHA equals main.

Install from `scripts/ops/systemd/` into `~/.config/systemd/user/`, then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now cairn-self-deploy.timer
```

Deploy one SHA by hand with `scripts/ops/deploy-self.sh <sha>`; roll back by deploying the previous SHA, or by restoring a `stopped-*.db` snapshot with both units stopped.
