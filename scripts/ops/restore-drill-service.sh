#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${CAIRN_CHECKOUT:?CAIRN_CHECKOUT is required}"
cd "$CAIRN_CHECKOUT/apps/server"
for tool in node python3 sqlite3 rsync gzip; do
  command -v "$tool" >/dev/null || { echo "FAIL dependency unavailable: $tool" >&2; exit 1; }
done
node --import tsx --input-type=module -e '' || { echo 'FAIL dependency unavailable: tsx' >&2; exit 1; }
cd "$CAIRN_CHECKOUT"
mode="${1:-both}"
case "$mode" in fresh|hourly|both) ;; *) echo 'FAIL invalid drill mode' >&2; exit 1 ;; esac
result=0
for current in fresh hourly; do
  [ "$mode" = both ] || [ "$mode" = "$current" ] || continue
  args=(--mode "$current" --live-db "$LIVE_DB" --live-attachments "$LIVE_ATTACHMENTS" --secretbox-key "$SECRETBOX_KEY" --scratch "$RESTORE_DRILL_SCRATCH-$current" --report "$RESTORE_DRILL_REPORT-$current")
  if [ "$current" = hourly ]; then
    args+=(--backup "${BACKUP_DB:?BACKUP_DB is required for hourly}" --attachments "${BACKUP_ATTACHMENTS:?BACKUP_ATTACHMENTS is required for hourly}")
  else
    args+=(--attachments "$LIVE_ATTACHMENTS")
  fi
  bash "$CAIRN_CHECKOUT/scripts/ops/restore-drill.sh" "${args[@]}" || result=1
done
exit "$result"
