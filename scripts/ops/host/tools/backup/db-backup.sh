#!/usr/bin/env bash
set -euo pipefail

cairn_home="${CAIRN_HOME:-$HOME/.cairn}"
server_home="$cairn_home/server"
skills_dir="${CAIRN_SKILLS_DIR:-$cairn_home/skills}"
backup_root="$HOME/backups/cairn-server"
repo="${CAIRN_REPO:-$HOME/Code/AgentProjects/cairn}"
remote="${CAIRN_BACKUP_REMOTE:?set CAIRN_BACKUP_REMOTE to the rsync destination}"

install -d -m 700 "$backup_root"
"$repo/scripts/ops/backup-server-db.sh" --db "$server_home/server.db" --out "$backup_root/db" --keep 48 \
  --coordinator "$server_home/coordinator" --coordinator-out "$backup_root/coordinator" \
  --skills "$skills_dir" --skills-out "$backup_root/skills" \
  --repos "$server_home/repos" --repos-out "$backup_root/repos"
rsync -a "$server_home/attachments/" "$backup_root/attachments/"
echo "[$(date -u +%Y%m%dT%H%M%SZ)] attachments synced: $(find "$backup_root/attachments" -type f | wc -l) files"
rsync -a --timeout=300 "$backup_root/db/" "$remote:db/"
rsync -a --timeout=300 "$backup_root/attachments/" "$remote:attachments/"
rsync -a --timeout=300 "$backup_root/coordinator/" "$remote:coordinator/"
rsync -a --timeout=300 "$backup_root/skills/" "$remote:skills/"
rsync -a --timeout=300 "$backup_root/repos/" "$remote:repos/"
echo "[$(date -u +%Y%m%dT%H%M%SZ)] pushed db, attachments, coordinator, skills and hosted repo stores to $remote"
