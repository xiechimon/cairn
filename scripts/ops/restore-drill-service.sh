#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${CAIRN_CHECKOUT:?CAIRN_CHECKOUT is required}"
cd "$CAIRN_CHECKOUT/apps/server"
for tool in node python3 sqlite3; do
  command -v "$tool" >/dev/null || { echo "FAIL dependency unavailable: $tool" >&2; exit 1; }
done
node --import tsx --input-type=module -e '' || { echo 'FAIL dependency unavailable: tsx' >&2; exit 1; }
cd "$CAIRN_CHECKOUT"
exec bash "$CAIRN_CHECKOUT/scripts/ops/restore-drill.sh" --mode fresh --live-db "$LIVE_DB" --attachments "$BACKUP_ATTACHMENTS" --live-attachments "$LIVE_ATTACHMENTS" --secretbox-key "$SECRETBOX_KEY" --scratch "$RESTORE_DRILL_SCRATCH" --report "$RESTORE_DRILL_REPORT"
