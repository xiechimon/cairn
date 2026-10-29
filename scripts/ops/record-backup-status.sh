#!/usr/bin/env bash
# Usage, as ExecStopPost= of the backup unit (docs/ops-db-backup.md "Monitoring"):
#   record-backup-status.sh --status <server data dir>/backup-status.json
set -euo pipefail

STATUS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --status) STATUS="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "$STATUS" ] || { echo "usage: record-backup-status.sh --status <path>" >&2; exit 2; }
[ -n "${SERVICE_RESULT:-}" ] || {
  echo "SERVICE_RESULT is unset: run this as ExecStopPost= of the backup unit" >&2
  exit 2
}

json_string() {
  printf '"%s"' "$(printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

now_ms=$(( $(date +%s) * 1000 ))
last_success="null"
if [ "$SERVICE_RESULT" = "success" ]; then
  last_success="$now_ms"
elif [ -f "$STATUS" ]; then
  previous="$(sed -n 's/.*"lastSuccessAt": *\([0-9][0-9]*\).*/\1/p' "$STATUS" | head -n 1)"
  [ -z "$previous" ] || last_success="$previous"
fi

dir="$(dirname "$STATUS")"
tmp="$(mktemp "$dir/.backup-status.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
printf '{"host":%s,"lastRunAt":%s,"lastRunResult":%s,"lastRunExitStatus":%s,"lastSuccessAt":%s}\n' \
  "$(json_string "${BACKUP_STATUS_HOST:-$(uname -n)}")" \
  "$now_ms" \
  "$(json_string "$SERVICE_RESULT")" \
  "$(json_string "${EXIT_STATUS:-}")" \
  "$last_success" > "$tmp"
mv -f "$tmp" "$STATUS"
trap - EXIT
echo "[$(date -u +%Y%m%dT%H%M%SZ)] backup status recorded: $SERVICE_RESULT ${EXIT_STATUS:-}"
