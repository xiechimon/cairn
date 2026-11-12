# Moving the control plane from the Mac to omarchy

The control plane is the server: database, secret-box key, push keys and attachments. It moves from the Mac (launchd agents, `127.0.0.1:8787` behind `tailscale serve`) to omarchy (systemd user units from `scripts/ops/systemd/`, the same loopback bind behind `tailscale serve`). Both machines keep running daemons as executors. The service is reachable only inside the tailnet, never through Funnel.

Host-specific names (tailnet hostnames, launchd labels, machine ids) live in the operator's host notes, not here. Below, `<mac>` and `<omarchy>` are the MagicDNS names, `$MAC_DATA` is `~/.cairn` on the Mac and `$OM` is `ssh -o BatchMode=yes -o ConnectTimeout=5 omarchy`. Copies use a shell function, so the quoted `-e` command reaches rsync as one argument:

```sh
rs() { rsync -a -e 'ssh -o BatchMode=yes -o ConnectTimeout=5' "$@"; }
```

## What moves

| Item | Path under `~/.cairn` | Note |
|---|---|---|
| Database | `server/server.db` | copy with `sqlite3 .backup` after the server stops, never the live file plus WAL |
| Secret-box key | `server/secretbox.key` | without it every stored credential is unreadable; mode 600 |
| Web push keys | `server/vapid.json` | keeps existing push subscriptions valid on the server side |
| Access token | `token` | if absent, the server runs with auth off; see the check in step 4 |
| Attachments, repos, exports | `server/{attachments,repos,trajectory-exports}/` | `rsync -a` |
| Server environment | `~/.config/cairn/server.env` on both hosts (600; the Mac launch script sources it, the omarchy unit reads it as `EnvironmentFile`) | carry every `CAIRN_*` variable into omarchy's file; set `CAIRN_WEB_ORIGIN` to `https://<omarchy>` |

Machine tokens live in the database, so daemons keep their identity; only their server URL changes.

## 1. Prepare omarchy (no downtime)

- `scripts/ops/systemd/*.service` from a main that includes #2732 installed into `~/.config/systemd/user/` and `daemon-reload`ed, not started. Those units, `cairn-daemon-orb.service` and the self-deploy `CAIRN_CHECKOUT` all use `~/Code/AgentProjects/cairn-exec`; units from an older main point at the lanes' checkout and must not be installed.
- Remove host drop-ins that point at mounts or addresses that no longer exist (for example a `TMPDIR` on a removed disk). Keep the proxy drop-ins the daemons need for outbound traffic, and the server drop-in. A `CAIRN_TAILSCALE_USERS` entry in it is ignored since #2057: sign in with the access token (`CAIRN_TOKEN`, or `$CAIRN_HOME/token`).
- `tailscale set --operator=$USER` done once with sudo, so `tailscale serve` runs without sudo.
- `~/Code/AgentProjects/cairn-exec` fetched. It is the only checkout the units and self-deploy use; lanes never work in it.

## 2. Freeze the Mac

1. Tell the lanes that run long jobs on either machine; claimed steps pause during the window.
2. Stop the Mac self-deploy (hold file or unload its agent) and wait until no step is `claimed`.
3. Record the SHA the Mac server runs (`git rev-parse HEAD` in its checkout). omarchy starts on the same SHA so the schema matches.
4. Stop the Mac web, server and daemon agents.

## 3. Copy

On the Mac:

```sh
mkdir -p "$MAC_DATA/backups"
sqlite3 "$MAC_DATA/server/server.db" ".backup '$MAC_DATA/backups/server-cutover.db'"
sqlite3 "$MAC_DATA/backups/server-cutover.db" "pragma integrity_check"
$OM 'install -d -m 700 ~/.cairn ~/.cairn/server'
rs "$MAC_DATA/backups/server-cutover.db" omarchy:.cairn/server/server.db
rs "$MAC_DATA/server/"{secretbox.key,vapid.json} omarchy:.cairn/server/
rs "$MAC_DATA/server/"{attachments,repos,trajectory-exports} omarchy:.cairn/server/
rs "$MAC_DATA/token" omarchy:.cairn/token
shasum -a 256 "$MAC_DATA/backups/server-cutover.db" "$MAC_DATA/server/secretbox.key"
$OM 'chmod 600 ~/.cairn/token ~/.cairn/server/{server.db,secretbox.key,vapid.json}; sha256sum ~/.cairn/server/{server.db,secretbox.key}'
```

The two hash lists must match. `integrity_check` must print `ok`.

## 4. Start omarchy

```sh
cd ~/Code/AgentProjects/cairn-exec && git checkout -q --detach <mac sha>
pnpm install --frozen-lockfile && pnpm -C apps/daemon build && pnpm -C apps/web build
systemctl --user enable --now cairn-server.service
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/app
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/user/me
```

Expect `200`, then `401`. A `200` from `/api/user/me` without a token means auth is off: stop the server and fix the token before going further. Run the environment check below; a missing key means the unit did not read the file, so fix it and restart before going further. Then:

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

### Environment check

A server started without its env file runs with issue intake and GitHub sign-in silently off. On whichever host is about to serve, the file must exist and the listening process must carry every key in it. This prints names only, never values; empty output after `missing:` is a pass.

```sh
env_file=~/.config/cairn/server.env
test -s "$env_file" && ls -l "$env_file"
pid=$(lsof -tiTCP:8787 -sTCP:LISTEN | head -n1)
file_keys() { sed -nE 's/^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$env_file" | sort -u; }
if [ -r "/proc/$pid/environ" ]; then
  proc_keys() { tr '\0' '\n' < "/proc/$pid/environ" | cut -d= -f1 | sort -u; }
else
  proc_keys() { ps eww -o command= -p "$pid" | tr ' ' '\n' | sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' | sort -u; }
fi
echo "missing:"; comm -23 <(file_keys) <(proc_keys)
```

## 5. Repoint the daemons

- omarchy: the repo `cairn-daemon.service` already uses `--server http://127.0.0.1:8787`; the Orb daemon's drop-in gets the same URL. Set `serverUrl` in each daemon's `machine.json` to match, so a later start without the flag agrees with it. `--server` wins over `machine.json`; a mismatch only warns.
- Mac: start the daemon agent with `--server https://<omarchy>` and the same `serverUrl` in its `machine.json`.
- Start both omarchy executors on the new units: `systemctl --user daemon-reload && systemctl --user enable cairn-daemon.service cairn-daemon-orb.service && systemctl --user restart cairn-daemon.service cairn-daemon-orb.service` (`restart` also starts a unit that is not running). Each logs `Online (machineId=...); polling http://127.0.0.1:8787`.

## 6. Verify

| Check | Pass |
|---|---|
| Coordinator turn | a message to the Coordinator gets an answer |
| Thread build | one build claimed by the Mac daemon and one by omarchy's, both finish |
| Push | a push notification arrives on the phone |
| Version | `~/.cairn/server/deploy.json` `sha` equals `origin/main` after the first self-deploy |
| Phone over the tailnet | `https://<omarchy>/app` opens without the token prompt; re-add it to the home screen and allow notifications (PWA and push subscriptions are bound to the origin) |
| GitHub sign-in | the OAuth App callback allows `https://<omarchy>/api/oauth/callback` |

Then `systemctl --user enable --now cairn-self-deploy.timer`.

## 7. Retire the Mac control plane

Rename the Mac server, web and deploy launch agents to `*.disabled-<date>` so a reboot does not start them, and remove its `tailscale serve` config. Keep the Mac database, key and copy for 7 days.

## Rollback (within 7 days)

1. On omarchy: `systemctl --user disable --now cairn-self-deploy.timer cairn-server.service`, `tailscale serve reset`.
2. If omarchy took writes worth keeping, copy its state back to the Mac as a set: `server.db` through `sqlite3 .backup`, plus `attachments/`, `repos/` and `trajectory-exports/` with `rs`. Attachment bytes live in files beside the database, so a database alone leaves rows whose files exist only on omarchy. Otherwise the Mac's own copy is the state at the freeze.
3. Restore the Mac launch agents and its `tailscale serve`, and start them. Run the environment check on the Mac before pointing anything at it.
4. Point both daemons back at `https://<mac>`.

## The Coordinator runs inside the server

The Coordinator is part of `cairn-server.service`. There is no sidecar unit, token or machine.

- Switch: `CAIRN_COORDINATOR_IN_SERVER` is on unless set to `0`, `false`, `no` or `off`. When it is off, or no keyed Coordinator route resolves, daemons claim chief turns as before.
- Route: the team's `coordinator` routing rule (provider `openai-codex`, model `gpt-6.1-sol`, thinking `low`, authenticated by the host's Codex login in `$CODEX_HOME/auth.json`) and the `compaction` summary route. Provider keys are read from the encrypted `provider` rows on each request; no key lives in `step`, `chief_message` or a store.
- State: one SQLite store per thread at `$CAIRN_HOME/server/coordinator/<threadId>.sqlite`, owned by one process through the `coordinator_lease` row. `chief_message` stays the truth; a store that disagrees with it is re-seeded and the old file is kept beside it as `*.stale-<ms>`.
- Boot migration: a set `CAIRN_COORDINATOR_MACHINE_ID` is logged and that machine's token is revoked. Stores under `$CAIRN_HOME/coordinator/threads/` are moved into the server store directory when no store of the same name exists.
- Backup: `backup-server-db.sh --coordinator <dir> --coordinator-out <dir>` copies each store after the server DB with `sqlite3 .backup` and `integrity_check`. A store newer than the DB copy is a reconcile case at the next boot.
- Restore: restore `server.db` and, optionally, the matching store files; a missing or divergent store is re-seeded from `chief_message`.
- Roll back: set `CAIRN_COORDINATOR_IN_SERVER=0` in `~/.config/cairn/server.env` and restart `cairn-server.service`.
