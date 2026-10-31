#!/usr/bin/env bash
set -euo pipefail

server_home=/mnt/fast/cairn/server
backup_root="$HOME/backups/cairn-server"
repo="${CAIRN_REPO:-$HOME/Code/AgentProjects/cairn}"
remote="${CAIRN_BACKUP_REMOTE:?set CAIRN_BACKUP_REMOTE to the rsync destination}"

install -d -m 700 "$backup_root"
"$repo/scripts/ops/backup-server-db.sh" --db "$server_home/server.db" --out "$backup_root/db" --keep 48
rsync -a "$server_home/attachments/" "$backup_root/attachments/"
echo "[$(date -u +%Y%m%dT%H%M%SZ)] attachments synced: $(find "$backup_root/attachments" -type f | wc -l) files"
rsync -a --timeout=300 "$backup_root/db/" "$remote:db/"
rsync -a --timeout=300 "$backup_root/attachments/" "$remote:attachments/"
echo "[$(date -u +%Y%m%dT%H%M%SZ)] pushed db and attachments to $remote"
