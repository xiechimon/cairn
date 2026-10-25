# Server DB backup and recovery (#1151 / ADR 0016 ruling 7)

Once state leaves the machine, the server's SQLite database (the source of truth for todos / threads / review records) is the single point of failure. This page is the canonical text for its backup and recovery: the script lives in the repo (`scripts/ops/backup-server-db.sh`); the schedule and the target machine belong to the deployment side and are set up following the template on this page.

## Environment prerequisites

- **The machine running the script (the one holding `server.db`) must have `sqlite3` installed**: the script checks for it as its very first step and exits with an error if it is missing — this is deliberate design; a missing dependency must fail visibly rather than being silently worked around. On Debian/Ubuntu: `sudo apt-get install -y sqlite3`.
- **The remote backup target machine must be reachable over ssh**: the push uses `scp`, and the script passes `-o BatchMode=yes` on every remote command (no interactive password entry), so public-key login must be set up in advance. It is recommended to give the target a Host alias in `~/.ssh/config` — the `dmit:~/pacman-db-backups` in the examples on this page is exactly that usage.
- **Self-check**: run the "Backup" command below once by hand; if a new backup appears in both the local `--out` directory and the remote directory (`server-db-<UTC timestamp>.db.gz`), the environment is ready; on any failure the script exits non-zero and prints where it failed.

## Backup

```sh
scripts/ops/backup-server-db.sh --db ~/.pacman/server.db --out ~/backups/pacman \
  --remote dmit:~/pacman-db-backups --keep 48
```

Behavior: `sqlite3 .backup` (safe and atomic on a live database) → failure if `integrity_check` does not pass → gzip into the local `--out` → scp to the remote → rolling retention of the latest 48 copies on both ends. RPO = the schedule interval (one hour). **Every failure exits non-zero and prints where it failed** — backups are the kind of thing that "nobody knows when they break", so the schedule side must be able to see failures (timer failed state / cron mail); silent failure is forbidden.

## Scheduling (mea: systemd user timer)

`~/.config/systemd/user/pacman-db-backup.service`:

```ini
[Unit]
Description=pacman server DB backup

[Service]
Type=oneshot
ExecStart=/home/measure/pacman/scripts/ops/backup-server-db.sh --db %h/.pacman/server.db --out %h/backups/pacman --remote dmit:~/pacman-db-backups --keep 48
```

`~/.config/systemd/user/pacman-db-backup.timer`:

```ini
[Unit]
Description=hourly pacman server DB backup

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Enable: `systemctl --user daemon-reload && systemctl --user enable --now pacman-db-backup.timer`. `Persistent=true` = a downtime window is made up right after boot. Verify: `systemctl --user list-timers pacman-db-backup.timer` shows the next run; after triggering `systemctl --user start pacman-db-backup.service` once manually, both directories gain one new backup.

## Recovery

1. `systemctl --user stop pacman-dev-server` (stop writes).
2. Pull the latest backup from dmit: `scp dmit:~/pacman-db-backups/<latest>.db.gz /tmp/` → `gunzip`.
3. `sqlite3 /tmp/server.db 'PRAGMA integrity_check;'` must print `ok`.
4. Swap it in: `mv /tmp/server.db ~/.pacman/server.db` (rename the old database as a record, do not delete it).
5. `systemctl --user start pacman-dev-server`, open the web UI and spot-check that recent todos are there; the daemon reconnects by itself (`systemctl --user status pacman-daemon` shows no errors).

## Drill discipline

Recovery drills are always done on a **copy**: pull the backup → gunzip → integrity_check + reconcile row counts of key tables against the live database (todo / build / chief_thread). Never touch the running server. Drill output is archived into `docs/verify/1151/` with the PR that first lands this.

## Troubleshooting

When a backup fails or does not run on time, look in this order:

1. First `systemctl --user status pacman-db-backup.service`: the exit code and output of the most recent run — success ends with `backup done`, failure prints where it failed (missing sqlite3 / integrity_check failed / scp push failed).
2. Then `journalctl --user -u pacman-db-backup.service`: the complete historical output of each backup run, to locate "which run it broke from".

If it never fired at all (the status shows no recent run), check the timer schedule first: `systemctl --user list-timers pacman-db-backup.timer` (enablement and verification are in the "Scheduling" section). For environment gaps pointed to by the failure output, work through "Environment prerequisites" item by item.
