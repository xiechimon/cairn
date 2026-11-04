# Moving the control plane from the Mac to omarchy (D69)

The control plane is the server: database, secret-box key, push keys and attachments. It moves from the Mac (launchd agents, `127.0.0.1:8787` behind `tailscale serve`) to omarchy (systemd user units from `scripts/ops/systemd/`, the same loopback bind behind `tailscale serve`). Both machines keep running daemons as executors. The service is reachable only inside the tailnet, never through Funnel.

Host-specific names (tailnet hostnames, launchd labels, machine ids) live in the operator's host notes, not here. Below, `<mac>` and `<omarchy>` are the MagicDNS names, `$MAC_DATA` is `~/.cairn` on the Mac and `$OM` is `ssh -o BatchMode=yes -o ConnectTimeout=5 omarchy` and `$RS` is `rsync -a -e 'ssh -o BatchMode=yes -o ConnectTimeout=5'`.

## What moves

| Item | Path under `~/.cairn` | Note |
|---|---|---|
| Database | `server/server.db` | copy with `sqlite3 .backup` after the server stops, never the live file plus WAL |
| Secret-box key | `server/secretbox.key` | without it every stored credential is unreadable; mode 600 |
| Web push keys | `server/vapid.json` | keeps existing push subscriptions valid on the server side |
| Access token | `token` | if absent, the server runs with auth off; see the check in step 4 |
| Attachments, repos, exports | `server/{attachments,repos,trajectory-exports}/` | `rsync -a` |
| Server environment | the Mac server's launch script and env file | carry every `CAIRN_*` variable into `~/.config/cairn/server.env` on omarchy (600); set `CAIRN_WEB_ORIGIN` to `https://<omarchy>` |

Machine tokens live in the database, so daemons keep their identity; only their server URL changes.

## 1. Prepare omarchy (no downtime)

- `scripts/ops/systemd/*.service` installed into `~/.config/systemd/user/` and `daemon-reload`ed, not started.
- Remove host drop-ins that point at mounts or addresses that no longer exist (for example a `TMPDIR` on a removed disk). Keep the proxy drop-ins the daemons need for outbound traffic, and the server drop-in that sets `CAIRN_TAILSCALE_USERS`.
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
sqlite3 "$MAC_DATA/server/server.db" ".backup '$MAC_DATA/backups/server-cutover.db'"
sqlite3 "$MAC_DATA/backups/server-cutover.db" "pragma integrity_check"
$OM 'install -d -m 700 ~/.cairn ~/.cairn/server'
$RS "$MAC_DATA/backups/server-cutover.db" omarchy:.cairn/server/server.db
$RS "$MAC_DATA/server/"{secretbox.key,vapid.json} omarchy:.cairn/server/
$RS "$MAC_DATA/server/"{attachments,repos,trajectory-exports} omarchy:.cairn/server/
$RS "$MAC_DATA/token" omarchy:.cairn/token
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

Expect `200`, then `401`. A `200` from `/api/user/me` without a token means auth is off: stop the server and fix the token before going further. Then:

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

## 5. Repoint the daemons

- omarchy: the repo `cairn-daemon.service` already uses `--server http://127.0.0.1:8787`; the Orb daemon's drop-in gets the same URL. Set `serverUrl` in each daemon's `machine.json` to match, so a later start without the flag agrees with it. `--server` wins over `machine.json`; a mismatch only warns.
- Mac: start the daemon agent with `--server https://<omarchy>` and the same `serverUrl` in its `machine.json`.

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
2. Copy omarchy's `server.db` back to the Mac with `sqlite3 .backup` if it took writes worth keeping. Otherwise the Mac's own copy is the state at the freeze.
3. Restore the Mac launch agents and its `tailscale serve`, and start them.
4. Point both daemons back at `https://<mac>`.
