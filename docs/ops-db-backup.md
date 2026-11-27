# Server backup and recovery (#1151, #2163)

The server's SQLite database is the source of truth for todos, threads and review records, the attachments directory holds the files those records point to, and `repos/` holds the only copy of every hosted project's git repository. Built-in daily backups on Mac hosts are managed by `apps/server/src/services/backup-service.ts`, while `scripts/ops/backup-server-db.sh` remains the supported standalone CLI for off-site copies (RPO 1 hour). This page is the runbook for that CLI script, the receiver on dmit, recovery, and the reference Linux systemd setup from the former `omarchy` host (torn down 2026-11-18).

What is not in the backup:

- `secretbox.key`. The DB stores secrets encrypted with this key, so a backup that holds both gives away every secret. ian keeps his own copy of the key. The script excludes any file named `secretbox.key` from every copy and push.
- `*.pem` files (private keys), for the same reason. The script excludes them everywhere.
- `trajectory-exports/` in the server data dir. Exports can be regenerated.

`repos/` is in the backup. It holds the bare repositories of hosted projects (`<team>/<name>.git`), which exist nowhere else; GitHub projects are cached under `workspaces/`, not here.

## The script

```sh
scripts/ops/backup-server-db.sh --db <server.db> --out <dir> [--keep N] \
  [--attachments <dir> --attachments-out <dir>] [--coordinator <dir> --coordinator-out <dir>] \
  [--skills <dir> --skills-out <dir>] [--repos <dir> --repos-out <dir>] [--remote <rsync destination>]
```

Each run does these steps in order:

1. `sqlite3 .backup` into a scratch dir inside `--out` (safe on a live DB), then `PRAGMA integrity_check`, which must print `ok`.
2. gzip, then a hard link to `<out>/server-db-<UTC timestamp>.db.gz`. The link is atomic and never replaces a file, so a crashed run never leaves a half-written copy under that name. If a copy with that name already exists (two runs in the same second), the run fails and the existing copy stays as it is. The receiver would keep the first copy under that name anyway.
3. Local rotation: keep the newest `--keep` copies (default 48, two days of hourly runs).
4. With `--attachments`: `rsync -a` from the attachments dir into `--attachments-out`, limited to files whose `attachment` row is `ready` in this run's DB copy and whose size on disk matches the row's `sizeBytes`. The server writes an upload in place and marks the row `ready` only after the write, and it never writes a file whose row is no longer `pending`. So an upload in progress, an interrupted upload or a retry waits for a later run, and a half-written file never reaches the receiver, which could not replace it. A ready file whose size differs is skipped with a `skipped <key>: ...` line on stderr; the run still succeeds. Step-session transcripts (`step-sessions/<step>.jsonl`) have no row and a machine may upload one again, so each distinct content is copied under its own name, `step-sessions/<step>.<mtime>-<first 16 hex of sha256>.jsonl`. Content already copied under any mtime is not copied again, and a copy whose hash differs from the source after reading is dropped and taken on the next run. Nothing is deleted, so the copy is cumulative and keeps files the server has since garbage-collected.
5. With `--repos`: each hosted repository `<repos>/<team>/<name>.git` becomes `<repos-out>/repos-<UTC timestamp>/<team>/<name>.bundle`, made with `git bundle create --all`, plus `<name>.head` holding the branch its `HEAD` points to. Before the run is kept, each bundle is cloned into scratch, checked with `git fsck`, and its branches and tags must equal the source's. A bundle is a consistent snapshot even while a push lands. A repository with no refs gets an empty `<name>.empty` instead of a bundle. The run fails, and older snapshots stay, when the repos directory is missing, a ref listing fails, a team or repo directory is a symlink or not a bare repository, or a name has characters other than letters, digits, `.`, `_` and `-`. The newest `--keep` runs are kept; the sources are only read. Requires `git` on `PATH`.
6. With `--remote`: rsync pushes into the destination root, `<out>/` into `db/` (only `server-db-*.db.gz` files), `<attachments-out>/` into `attachments/`, and each other store given into `coordinator/`, `skills/` and `repos/`. The pushes run plain `rsync --server` on the receiver: no remote shell, no `--delete`, and `--ignore-existing`, so a file already on the receiver is never overwritten. The receiver rotates its own copies.

ssh runs with `BatchMode=yes` and `ConnectTimeout=30` unless `RSYNC_RSH` is set, so a missing key fails the run instead of waiting for a password. The push uses `--timeout=300`.

A failed step exits non-zero and prints `[<timestamp>] FAIL <step>` to stderr, for example `FAIL integrity_check: ...` or `FAIL push db to dmit-backup:db/`. Bad arguments exit 2 before anything is written. Local copies are written before the push starts, so a failed push still leaves that hour's local copy.

Requirements on the host: `sqlite3`, `gzip`, and rsync 3.x when `--attachments` or `--remote` is used.

The self-test runs the script against a real rrsync receiver started through a fake ssh, and checks the copies byte for byte. It needs GNU rsync 3.x first on `PATH` and an rrsync that supports `-no-overwrite` (rsync 3.4 or later). CI runs it in the `gates` job. On macOS, install Homebrew's rsync and run:

```sh
PATH=/opt/homebrew/opt/rsync/bin:$PATH node --test scripts/ops/backup-server-db.test.mjs
```

## Reference Linux systemd setup (retired omarchy host)

Status: the `omarchy` host this setup ran on was torn down on 2026-11-18; Mac hosts use the server's built-in backup service instead. Kept as reference for Linux systemd deployments.

The server ran on omarchy as user `ian` with no `CAIRN_HOME`, so its data lived in `~/.cairn/server` (`server.db`, `attachments/`, `coordinator/`, `repos/`, `secretbox.key`) and its skills in `~/.cairn/skills`. The wrapper `~/.cairn/tools/backup/db-backup.sh` (mirrored in `scripts/ops/host/tools/backup/db-backup.sh`) derives both paths from `CAIRN_HOME` the way the server does. Local backups go to `~/backups/cairn-server/` (mode 700): `db/`, `attachments/`, `coordinator/`, `skills/` and `repos/`. After changing the mirrored wrapper, copy it to `~/.cairn/tools/backup/db-backup.sh`. The wrapper takes `CAIRN_BACKUP_REMOTE` as an SSH host and appends `:db/`, `:repos/` and the other paths itself, so the value is `dmit-backup` with no trailing colon; `dmit-backup:` turns each destination into `dmit-backup::db/`, which rsync reads as daemon mode on port 873 and fails with `getaddrinfo: dmit-backup 873`.

`~/.config/systemd/user/cairn-db-backup.service`:

```ini
[Unit]
Description=Cairn server DB and attachments backup
Documentation=https://github.com/xiechimon/cairn/blob/main/docs/ops-db-backup.md

[Service]
Type=oneshot
UMask=0077
Nice=10
StandardOutput=append:%h/.local/state/cairn-db-backup.log
StandardError=append:%h/.local/state/cairn-db-backup.log
Environment=CAIRN_BACKUP_REMOTE=dmit-backup
ExecStart=%h/.cairn/tools/backup/db-backup.sh
ExecStopPost=%h/.cairn/tools/backup/record-backup-status.sh --status %h/.cairn/server/backup-status.json
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

Enable with `systemctl --user daemon-reload && systemctl --user enable --now cairn-db-backup.timer`. `Persistent=true` runs a missed hour right after boot. Output goes to `~/.local/state/cairn-db-backup.log` instead of the journal on Linux hosts where the user journal stops recording.

### Path to dmit

When dmit does not answer direct TCP from an ISP, route the push through the host's local mixed proxy on 127.0.0.1:7890 (with `route_exclude_address` set on TUN so the proxy tunnel itself does not loop).

`~/.ssh/config` on the backup host (mode 600):

```
Host dmit-backup
    HostName <backup-host-address>
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

`/home/cairnbak/.ssh/authorized_keys` is owned by root (mode 644), so cairnbak cannot change it, and holds the push key:

```
restrict,command="/usr/bin/rrsync -wo -no-del -no-overwrite -munge /home/cairnbak/cairn-backups" ssh-ed25519 AAAA... cairn-backup
```

With that line the key can only add new files under `/home/cairnbak/cairn-backups/`. rrsync refuses a shell (`SSH_ORIGINAL_COMMAND does not run rsync`), a pull (`reading from write-only server is not allowed`), `--delete` (`option --delete has been disabled`), paths with `..`, and it never overwrites an existing file. It also allows one transfer at a time: a second push while one runs fails with `Another instance of rrsync is already accessing this directory`.

Rotation is cairnbak's crontab, which runs at minute 17 and keeps the newest 48 DB copies. A line that does this:

```
17 * * * * cd /home/cairnbak/cairn-backups/db && ls -1 server-db-*.db.gz 2>/dev/null | sort -r | tail -n +49 | while IFS= read -r f; do rm -f -- "$f"; done
```

Hosted repo snapshots need the same rotation, or full snapshots pile up every hour until dmit's disk is full and every push fails. A line that keeps the newest 48 runs:

```
19 * * * * cd /home/cairnbak/cairn-backups/repos 2>/dev/null && ls -1d repos-*/ 2>/dev/null | sort -r | tail -n +49 | while IFS= read -r d; do rm -rf -- "$d"; done
```

The receiver must keep at least as many DB copies and repo snapshots as `--keep`. A copy it deletes while the sender still holds it is sent again on the next push, every hour. Attachments are never rotated on either side.

Room, historical measurement on the retired `omarchy` host on 2026-10-29: a DB copy was about 34 MB, so 48 copies were about 1.7 GB on each side, plus attachments (159 MB off-site in total that day; about 25 GB a month over the proxy).

## Monitoring (#2162)

A stopped or failing backup shows up as a warning banner above the home page and the board. It sits in the banner slot rather than the daily brief because the brief only renders once the home chat has messages from an earlier day. Every run records its result, and the server reads that record:

- The backup unit runs `scripts/ops/record-backup-status.sh --status <server data dir>/backup-status.json` as `ExecStopPost=`. systemd runs it after every run, including failures and timeout kills, and passes the run's result in `SERVICE_RESULT` / `EXIT_STATUS`. The script atomically writes the host, the run time, the result and the last successful run time; a failed run keeps the previous success time.
- The status file sits next to `server.db`, in the data dir of the server it describes. A server that moves with its data dir brings a status that then goes stale, and a backup of a leftover DB copy writes its status next to that copy, not next to the live one.
- The server serves the record at `GET /api/server/backup`. The banner appears when the latest run failed (at once, naming the systemd result), when the last success is older than 2 hours (the timer stopped or the machine is down), or when the status file cannot be read. A data dir without a status file has never recorded a backup, and no banner appears there. The web reads the record on load and every 5 minutes.

Add the line to the backup service from the "Scheduling" section:

```ini
ExecStopPost=%h/cairn/scripts/ops/record-backup-status.sh --status %h/.cairn/server/backup-status.json
```

Check: after the next run, `cat <server data dir>/backup-status.json` shows `"lastRunResult":"success"`. When using the Linux systemd setup, install `record-backup-status.sh` beside `~/.cairn/tools/backup/db-backup.sh`.

## Recovery

The push key on the sender is write-only, so a restore never uses it. Take the newest local backup copy if it survived, otherwise from dmit as root (from the Mac: `scp dmit:/home/cairnbak/cairn-backups/db/<newest>.db.gz .`).

1. Stop writes: `systemctl --user stop cairn-server.service` and `systemctl --user stop cairn-db-backup.timer`.
2. `gunzip` the copy and check it: `sqlite3 server.db 'PRAGMA integrity_check;'` must print `ok`.
3. Rename the old `~/.cairn/server/server.db` (and its `-wal` / `-shm` files) aside as a record, then move the restored file into place.
4. Restore attachments: `rsync -a --exclude=step-sessions <backup>/attachments/ ~/.cairn/server/attachments/` from `~/backups/cairn-server/attachments/`, or as root from `/home/cairnbak/cairn-backups/attachments/` on dmit. For each step in `<backup>/attachments/step-sessions/`, copy its newest version (highest `<mtime>`; on a tie, the longer transcript) back to `step-sessions/<step>.jsonl`. Files without a version in the name come from before #2163 and are the oldest.
5. Restore skills: unpack the newest `skills/skills-<UTC timestamp>.tar.gz` into an empty `~/.cairn/skills` with `tar -xzf <archive> -C ~/.cairn/skills`.
6. Restore hosted repositories from the newest `repos/repos-<UTC timestamp>/`. For each `<team>/<name>.bundle`:

   ```sh
   dir=~/.cairn/server/repos/<team>/<name>.git
   git clone --mirror <run>/<team>/<name>.bundle "$dir"
   git -C "$dir" remote remove origin
   git -C "$dir" symbolic-ref HEAD "$(cat <run>/<team>/<name>.head)"
   git -C "$dir" config http.receivepack true
   git -C "$dir" config http.uploadpack true
   ```

   For a `<name>.empty`, run `git init --bare "$dir"` instead of the clone and skip `remote remove`; the other three lines are the same.
7. If `secretbox.key` is gone too, put back ian's own copy (mode 600). Without the matching key, stored secrets cannot be decrypted.
8. `systemctl --user start cairn-server.service`, open the web UI and check that recent todos are there, check that the daemons reconnect, then start the backup timer again.

## Drill discipline

Drills always run on a copy, never on the running server: fetch a backup, `gunzip`, run `integrity_check` and `PRAGMA foreign_key_check`, and compare row counts of key tables (`todo`, `build`, `chief_thread`) with the live DB. For attachments, compare sha256 lists of both sides; sort with `LC_ALL=C`, because a locale-aware sort orders the same names differently. Archive drill output under `docs/verify/<ticket>/` with the PR that asks for it.

## Troubleshooting

When a backup fails or does not run on time, look in this order:

1. `tail -n 30 ~/.local/state/cairn-db-backup.log`. A good run ends with `backup done`; a failed run prints `FAIL <step>`.
2. `systemctl --user status cairn-db-backup.service` for the last result and exit code, and `systemctl --user --failed` to see whether the unit is failed. If `journalctl --user -u` is empty on a Linux host, try `journalctl _SYSTEMD_USER_UNIT=cairn-db-backup.service`.
3. If nothing ran, `systemctl --user list-timers cairn-db-backup.timer` shows whether the timer is enabled and when it fires next.

For a failed push:

- `ssh dmit-backup true` checks the whole path; rrsync accepts `true` as a connectivity check. A timeout means the proxy path is down: check that something listens on 127.0.0.1:7890 (`ss -ltn | grep 7890`) and that sing-box is running.
- An rrsync message names the refused option or command. The script sends none of them, so such a message means the script or the forced command changed.
- `No space left on device` comes from dmit's disk: check that the rotation cron runs and that the receiver keeps no more than it should.

The receiver never overwrites, so a file that changed after it was pushed stays at its first version on dmit. To send it again, root deletes that file on dmit; the next push resends it.
