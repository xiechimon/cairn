#!/usr/bin/env bash
# backup-server-db.sh — hourly backup of the cairn server SQLite DB (#1151 / ADR 0016 ruling 7).
#
#   scripts/ops/backup-server-db.sh --db <path to server.db> --out <backup dir> [--remote <ssh target:dir>] [--keep N]
#
# Behavior: sqlite3 .backup (safe on a live DB, atomic) → integrity_check failure
# aborts → gzip lands at <out>/server-db-<UTC timestamp>.db.gz → optional scp push
# to a remote → both ends rotate away the oldest copies beyond --keep (default 48).
# Any failed step exits non-zero and prints where it failed — backups are the kind
# of thing nobody notices when broken; silent failure is worse than no backup.
set -euo pipefail

DB=""
OUT=""
REMOTE=""
KEEP=48

while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "$DB" ] && [ -n "$OUT" ] || { echo "usage: backup-server-db.sh --db <path> --out <dir> [--remote host:dir] [--keep N]" >&2; exit 2; }
[ -f "$DB" ] || { echo "db not found: $DB" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "sqlite3 not on PATH" >&2; exit 1; }

ts="$(date -u +%Y%m%dT%H%M%SZ)"
name="server-db-${ts}.db.gz"
mkdir -p "$OUT"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "[$ts] backup start: $DB"
sqlite3 "$DB" ".backup '$tmp/server.db'"
integrity="$(sqlite3 "$tmp/server.db" 'PRAGMA integrity_check;')"
[ "$integrity" = "ok" ] || { echo "[$ts] FAIL integrity_check: $integrity" >&2; exit 1; }

gzip -c "$tmp/server.db" > "$OUT/$name"
echo "[$ts] wrote $OUT/$name ($(stat -f%z "$OUT/$name" 2>/dev/null || stat -c%s "$OUT/$name") bytes)"

if [ -n "$REMOTE" ]; then
  host="${REMOTE%%:*}"
  rdir="${REMOTE#*:}"
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" "mkdir -p '$rdir'"
  scp -q -o BatchMode=yes -o ConnectTimeout=10 "$OUT/$name" "$REMOTE/"
  echo "[$ts] pushed to $REMOTE/"
  # Remote rotation: the file name carries the UTC timestamp; sort by name desc,
  # skip the newest KEEP entries, delete the rest. while-read instead of xargs -r:
  # BSD xargs has no -r, and empty input would run `rm -f` with no operand.
  ssh -o BatchMode=yes "$host" "cd '$rdir' && { ls -1 server-db-*.db.gz 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) | while IFS= read -r f; do rm -f -- \"\$f\"; done"
fi

# Local rotation (same rule).
cd "$OUT" && { ls -1 server-db-*.db.gz 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) | while IFS= read -r f; do rm -f -- "$f"; done

echo "[$ts] backup done"
