#!/usr/bin/env bash
# backup-server-db.sh — cairn server SQLite DB 的小时级备份（#1151 / ADR 0016 裁决 7）。
#
#   scripts/ops/backup-server-db.sh --db <server.db 路径> --out <备份目录> [--remote <ssh目标:目录>] [--keep N]
#
# 行为：sqlite3 .backup（活库安全、原子）→ integrity_check 不过即失败 →
# gzip 落 <out>/server-db-<UTC 时间戳>.db.gz → 可选 scp 推远端 → 两端各按
# --keep（默认 48）滚动删除最老份。任何一步失败都以非零退出并打印失败点——
# 备份是「坏了没人会知道」的那类东西，静默失败比没有备份更糟。
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
  # 远端滚动保留：文件名即 UTC 时间戳，按名倒序跳过最新 KEEP 份、删其余。
  # while-read 而非 xargs -r：BSD xargs 无 -r，空输入会跑出「rm -f 缺操作数」。
  ssh -o BatchMode=yes "$host" "cd '$rdir' && { ls -1 server-db-*.db.gz 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) | while IFS= read -r f; do rm -f -- \"\$f\"; done"
fi

# 本地滚动保留（同款口径）。
cd "$OUT" && { ls -1 server-db-*.db.gz 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) | while IFS= read -r f; do rm -f -- "$f"; done

echo "[$ts] backup done"
