# Server backup and recovery (ADR 0016 ruling 5, #1151, #2163)

The server's SQLite database is the source of truth for todos, threads and review records, and the attachments directory holds the files those records point to. ADR 0016 ruling 5 requires an hourly off-site copy of both (RPO 1 hour). This page is the runbook for that backup: the script `scripts/ops/backup-server-db.sh`, the live setup on omarchy, the receiver on dmit, and recovery.

What is not in the backup:

- `secretbox.key`. The DB stores secrets encrypted with this key, so a backup that holds both gives away every secret. ian keeps his own copy of the key. The script excludes any file named `secretbox.key` from every copy and push.
- `*.pem` files (private keys), for the same reason. The script excludes them everywhere.
- `repos/` and `trajectory-exports/` in the server data dir. Repos are clones of GitHub; exports can be regenerated.

## The script

```sh
scripts/ops/backup-server-db.sh --db <server.db> --out <dir> [--keep N] \
  [--attachments <dir> --attachments-out <dir>] [--remote <rsync destination>]
```

Each run does these steps in order:

1. `sqlite3 .backup` into a scratch dir inside `--out` (safe on a live DB), then `PRAGMA integrity_check`, which must print `ok`.
2. gzip, then a hard link to `<out>/server-db-<UTC timestamp>.db.gz`. The link is atomic and never replaces a file, so a crashed run never leaves a half-written copy under that name. If a copy with that name already exists (two runs in the same second), the run fails and the existing copy stays as it is. The receiver would keep the first copy under that name anyway.
3. Local rotation: keep the newest `--keep` copies (default 48, two days of hourly runs).
4. With `--attachments`: `rsync -a` from the attachments dir into `--attachments-out`, limited to files unchanged for more than a minute. The server writes an upload in place, so a file still being written waits for the next run, and a half-written file never reaches the receiver, which could not replace it later. Nothing is deleted, so the copy is cumulative and keeps files the server has since garbage-collected.
5. With `--remote`: two rsync pushes into the destination root, `<out>/` into `db/` (only `server-db-*.db.gz` files) and `<attachments-out>/` into `attachments/`. The pushes run plain `rsync --server` on the receiver: no remote shell, no `--delete`, and `--ignore-existing`, so a file already on the receiver is never overwritten. The receiver rotates its own copies.

ssh runs with `BatchMode=yes` and `ConnectTimeout=30` unless `RSYNC_RSH` is set, so a missing key fails the run instead of waiting for a password. The push uses `--timeout=300`.

A failed step exits non-zero and prints `[<timestamp>] FAIL <step>` to stderr, for example `FAIL integrity_check: ...` or `FAIL push db to dmit-backup:db/`. Bad arguments exit 2 before anything is written. Local copies are written before the push starts, so a failed push still leaves that hour's local copy.

Requirements on the host: `sqlite3`, `gzip`, and rsync 3.x when `--attachments` or `--remote` is used.

The self-test runs the script against a real rrsync receiver started through a fake ssh, and checks the copies byte for byte. It needs GNU rsync 3.x first on `PATH` and an rrsync that supports `-no-overwrite` (rsync 3.4 or later). CI runs it in the `ops-backup-test` job. On macOS, install Homebrew's rsync and run:

```sh
PATH=/opt/homebrew/opt/rsync/bin:$PATH node --test scripts/ops/backup-server-db.test.mjs
```

## Live setup on omarchy

The server runs on omarchy as user `ian`, with data in `/mnt/fast/cairn/server` (`server.db`, `attachments/`, `secretbox.key`). Local backups go to the HDD under `~/backups/cairn-server/` (mode 700): `db/` and `attachments/`.

`~/.config/systemd/user/cairn-db-backup.service`:

```ini
[Unit]
Description=Cairn server DB and attachments backup (ADR 0016 ruling 5)
Documentation=https://github.com/xiechimon/cairn/blob/main/docs/ops-db-backup.md

[Service]
Type=oneshot
UMask=0077
Nice=10
StandardOutput=append:%h/.local/state/cairn-db-backup.log
StandardError=append:%h/.local/state/cairn-db-backup.log
ExecStart=%h/Code/AgentProjects/cairn/scripts/ops/backup-server-db.sh --db /mnt/fast/cairn/server/server.db --out %h/backups/cairn-server/db --attachments /mnt/fast/cairn/server/attachments --attachments-out %h/backups/cairn-server/attachments --remote dmit-backup: --keep 48
TimeoutStartSec=30min
```

`~/.config/systemd/user/cairn-db-backup.timer`:

```ini
[Unit]
Description=Hourly cairn server DB and attachments backup

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Enable with `systemctl --user daemon-reload && systemctl --user enable --now cairn-db-backup.timer`. `Persistent=true` runs a missed hour right after boot. Output goes to `~/.local/state/cairn-db-backup.log` instead of the journal, because the user journal on omarchy has recorded nothing since 2026-10-25.

### Path to dmit

dmit (179.255.103.75) does not answer direct TCP from either of ian's ISPs; the drop is on the network path, not in dmit's firewall. omarchy's sing-box TUN routes everything except exactly that address (`route_exclude_address`, so sing-box's own tunnel to dmit does not loop), so plain ssh from omarchy goes out directly and times out. The push therefore goes through sing-box's local mixed proxy on 127.0.0.1:7890, the same tunnel the Mac uses.

`~/.ssh/config` on omarchy (mode 600):

```
Host dmit-backup
    HostName 179.255.103.75
    User cairnbak
    IdentityFile ~/.ssh/cairn_backup_ed25519
    IdentitiesOnly yes
    ProxyCommand socat - PROXY:127.0.0.1:%h:%p,proxyport=7890
    BatchMode yes
    ConnectTimeout 30
    ServerAliveInterval 15
    ServerAliveCountMax 4
```

`~/.ssh/cairn_backup_ed25519` (mode 600) is used only for this push. dmit's ed25519 host key is pinned in `~/.ssh/known_hosts`. If sing-box is down, every push fails; the local copies are still written.

## Receiver on dmit

The receiver is the user `cairnbak`: password locked, shell `/bin/sh`, home mode 750. It needs rsync 3.4 or later, which ships `/usr/bin/rrsync` with `-no-overwrite`.

`/home/cairnbak/.ssh/authorized_keys` is owned by root (mode 644), so cairnbak cannot change it, and holds one line with the omarchy push key:

```
restrict,command="/usr/bin/rrsync -wo -no-del -no-overwrite -munge /home/cairnbak/cairn-backups" ssh-ed25519 AAAA... cairn-backup@omarchy
```

With that line the key can only add new files under `/home/cairnbak/cairn-backups/`. rrsync refuses a shell (`SSH_ORIGINAL_COMMAND does not run rsync`), a pull (`reading from write-only server is not allowed`), `--delete` (`option --delete has been disabled`), paths with `..`, and it never overwrites an existing file. It also allows one transfer at a time: a second push while one runs fails with `Another instance of rrsync is already accessing this directory`.

Rotation is cairnbak's crontab, which runs at minute 17 and keeps the newest 48 DB copies. A line that does this:

```
17 * * * * cd /home/cairnbak/cairn-backups/db && ls -1 server-db-*.db.gz 2>/dev/null | sort -r | tail -n +49 | while IFS= read -r f; do rm -f -- "$f"; done
```

The receiver must keep at least as many DB copies as `--keep`. A copy it deletes while omarchy still holds it is sent again on the next push, every hour. Attachments are never rotated on either side.

Room, measured on 2026-10-29: a DB copy is about 34 MB, so 48 copies are about 1.7 GB on each side, plus attachments (159 MB off-site in total that day). dmit has 7.8 GB free on a 20 GB disk; omarchy's HDD has 1.7 TB free. The hourly push sends about 34 MB through the proxy, about 25 GB a month.

## Recovery

The omarchy push key is write-only, so a restore never uses it. Take the newest copy from the omarchy HDD if it survived, otherwise from dmit as root (from the Mac: `scp dmit:/home/cairnbak/cairn-backups/db/<newest>.db.gz .`).

1. Stop writes: `systemctl --user stop cairn-server.service` and `systemctl --user stop cairn-db-backup.timer`.
2. `gunzip` the copy and check it: `sqlite3 server.db 'PRAGMA integrity_check;'` must print `ok`.
3. Rename the old `/mnt/fast/cairn/server/server.db` (and its `-wal` / `-shm` files) aside as a record, then move the restored file into place.
4. Restore attachments: `rsync -a <backup>/attachments/ /mnt/fast/cairn/server/attachments/` from `~/backups/cairn-server/attachments/`, or as root from `/home/cairnbak/cairn-backups/attachments/` on dmit.
5. If `secretbox.key` is gone too, put back ian's own copy (mode 600). Without the matching key, stored secrets cannot be decrypted.
6. `systemctl --user start cairn-server.service`, open the web UI and check that recent todos are there, check that the daemons reconnect, then start the backup timer again.

## Drill discipline

Drills always run on a copy, never on the running server: fetch a backup, `gunzip`, run `integrity_check` and `PRAGMA foreign_key_check`, and compare row counts of key tables (`todo`, `build`, `chief_thread`) with the live DB. For attachments, compare sha256 lists of both sides; sort with `LC_ALL=C`, because a locale-aware sort orders the same names differently. Archive drill output under `docs/verify/<ticket>/` with the PR that asks for it.

## Troubleshooting

When a backup fails or does not run on time, look in this order:

1. `tail -n 30 ~/.local/state/cairn-db-backup.log`. A good run ends with `backup done`; a failed run prints `FAIL <step>`.
2. `systemctl --user status cairn-db-backup.service` for the last result and exit code, and `systemctl --user --failed` to see whether the unit is failed. `journalctl --user -u` is empty on omarchy; `journalctl _SYSTEMD_USER_UNIT=cairn-db-backup.service` still works.
3. If nothing ran, `systemctl --user list-timers cairn-db-backup.timer` shows whether the timer is enabled and when it fires next.

For a failed push:

- `ssh dmit-backup true` checks the whole path; rrsync accepts `true` as a connectivity check. A timeout means the proxy path is down: check that something listens on 127.0.0.1:7890 (`ss -ltn | grep 7890`) and that sing-box is running.
- An rrsync message names the refused option or command. The script sends none of them, so such a message means the script or the forced command changed.
- `No space left on device` comes from dmit's disk: check that the rotation cron runs and that the receiver keeps no more than it should.

The receiver never overwrites, so a file that changed after it was pushed stays at its first version on dmit. To send it again, root deletes that file on dmit; the next push resends it.
