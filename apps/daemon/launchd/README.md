# cairn daemon launchd keepalive (macOS user domain)

Reboot-proof singleton supervision for the local executor daemon. The daemon
itself already survives crashes (supervisor) and server outages (claim
backoff, cap 30s) — what was missing is anything that restarts it after a
reboot. This job closes that gap.

## Install

```sh
apps/daemon/launchd/install.sh
```

Renders the plist into `~/Library/LaunchAgents/com.xiechimon.cairn-daemon.plist`,
copies the guarded wrapper to `~/.cairn/cairn-daemon-run.sh`, and bootstraps
`gui/$(id -u)`. Installed copies live outside the repo, so deleting checkouts
never orphans the job; re-run after pulling daemon updates. An already-rendered
plist is never migrated in place — re-running `install.sh` is the fix (it
re-renders in place; kickstart as printed to apply).

## Premise (read before rebooting)

- The job starts the equivalent of `pnpm dev:daemon`
  (`tsx src/cli.ts start -f`) from the main checkout, with fnm node 24
  pinned by absolute path. No login shell, no PATH guessing.
- The dev server on `:8787` is NOT managed here. If it is down, the daemon
  logs claim backoff and attaches once the server is up — start the server
  (`pnpm dev` in the main checkout) after a reboot; the daemon needs no kick.
- Enrollment is reused from `~/.cairn` (machine.json). First-ever enroll
  still goes through the browser flow, not this job.
- Exactly one daemon per checkout: if a manual `pnpm dev:daemon` (or a
  supervisor-mode `start`) is already on this checkout, the wrapper logs
  "already running" and exits 0 — launchd does NOT relaunch clean exits
  (`KeepAlive {SuccessfulExit: false}`), so the check costs one log line.
  Crash kills restart; restart storms are capped at one per 30s.

## Operate

```sh
launchctl list com.xiechimon.cairn-daemon   # state; second column is exit code
tail -f ~/.cairn/launchd-daemon.out.log    # wrapper + daemon stdout
tail -f ~/.cairn/daemon.log                # daemon structured log
launchctl kickstart -k gui/$(id -u)/com.xiechimon.cairn-daemon  # restart
apps/daemon/launchd/install.sh --uninstall  # bootout + remove plist
```

Never load this with sudo: a system-domain copy would need a reboot to take
effect and must not exist — `install.sh` refuses root.

## Test jobs (never disturb the real daemon)

```sh
apps/daemon/launchd/install.sh --label com.xiechimon.cairn-daemon.test \
  --repo <scratch-checkout> --home /tmp/cairn-launchd-test --server http://127.0.0.1:9
```

The guard keys on the job's own home/server/cwd, so a test job neither sees
nor touches the production daemon. Remove with
`install.sh --uninstall --label <same-label>`.
