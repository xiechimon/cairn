#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<'EOF'
usage: backup-server-db.sh --db <server.db> --out <dir> [--keep N]
         [--attachments <dir> --attachments-out <dir>] [--remote <rsync destination>]

  --db               live server DB, copied with sqlite3 .backup and checked with integrity_check
  --out              local directory for server-db-<UTC timestamp>.db.gz, keeping the newest --keep (default 48)
  --attachments      server attachments directory; files whose attachment row is ready in this run's
                     DB copy, with the size it records, are copied into --attachments-out, and nothing
                     is ever deleted there; step-sessions/<step>.jsonl is copied as
                     step-sessions/<step>.<mtime>-<size>.jsonl, one file per version
  --remote           existing rsync destination root (for example dmit-backup:); receives db/ and attachments/
                     with no remote shell, no deletes and no overwrites; the receiver rotates its own copies

secretbox.key and *.pem are never copied or pushed. A copy name that already exists fails the run.
A failed step exits non-zero and names the step.
EOF
  exit 2
}

DB=""
OUT=""
ATTACHMENTS=""
ATTACHMENTS_OUT=""
REMOTE=""
KEEP=48

while [ $# -gt 0 ]; do
  case "$1" in
    --db | --out | --attachments | --attachments-out | --remote | --keep)
      [ $# -ge 2 ] && [[ "$2" != -* ]] || { echo "$1 requires a value" >&2; usage; }
      case "$1" in
        --db) DB="$2" ;;
        --out) OUT="$2" ;;
        --attachments) ATTACHMENTS="$2" ;;
        --attachments-out) ATTACHMENTS_OUT="$2" ;;
        --remote) REMOTE="$2" ;;
        --keep) KEEP="$2" ;;
      esac
      shift 2
      ;;
    -h | --help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done

[ -n "$DB" ] && [ -n "$OUT" ] || usage
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "--keep must be a positive integer: $KEEP" >&2; usage; }
if [[ -n "$ATTACHMENTS" && -z "$ATTACHMENTS_OUT" || -z "$ATTACHMENTS" && -n "$ATTACHMENTS_OUT" ]]; then
  echo "--attachments and --attachments-out go together" >&2
  usage
fi

ts="$(date -u +%Y%m%dT%H%M%SZ)"

fail() {
  echo "[$ts] FAIL $1" >&2
  exit 1
}

[ -f "$DB" ] || fail "db not found: $DB"
DB="$(cd "$(dirname "$DB")" && pwd)/$(basename "$DB")"
command -v sqlite3 >/dev/null || fail "sqlite3 not on PATH"
command -v gzip >/dev/null || fail "gzip not on PATH"
if [ -n "$ATTACHMENTS$REMOTE" ]; then
  command -v rsync >/dev/null || fail "rsync not on PATH"
fi
[ -z "$ATTACHMENTS" ] || [ -d "$ATTACHMENTS" ] || fail "attachments not found: $ATTACHMENTS"

SECRETS=(--exclude=secretbox.key --exclude='*.pem')
name="server-db-${ts}.db.gz"

echo "[$ts] backup start: $DB"
[ ! -e "$OUT/$name" ] || fail "$OUT/$name already exists"
mkdir -p "$OUT" || fail "create $OUT"
find "$OUT" -maxdepth 1 -type d -name '.backup.*' -mmin +60 -exec rm -rf {} + || fail "remove stale scratch dirs in $OUT"
tmp="$(mktemp -d "$OUT/.backup.XXXXXX")" || fail "create a scratch dir in $OUT"
trap 'rm -rf "$tmp"' EXIT

(cd "$tmp" && sqlite3 "$DB" ".backup server.db") || fail "sqlite3 .backup"
integrity="$(sqlite3 "$tmp/server.db" 'PRAGMA integrity_check;')" || fail "integrity_check"
[ "$integrity" = "ok" ] || fail "integrity_check: $integrity"
gzip -c "$tmp/server.db" > "$tmp/$name" || fail "gzip"
ln "$tmp/$name" "$OUT/$name" || fail "write $OUT/$name: it already exists or the link failed"
echo "[$ts] wrote $OUT/$name ($(wc -c < "$OUT/$name" | tr -d ' ') bytes)"

(
  cd "$OUT" &&
    { ls -1 server-db-*.db.gz 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) |
    while IFS= read -r f; do rm -f -- "$f" || exit 1; done
) || fail "rotate $OUT"

if [ -n "$ATTACHMENTS" ]; then
  mkdir -p "$ATTACHMENTS_OUT" || fail "create $ATTACHMENTS_OUT"
  sqlite3 -separator $'\t' "$tmp/server.db" "select storageKey, sizeBytes from attachment where status = 'ready';" > "$tmp/ready" ||
    fail "list ready attachments in the db copy"
  : > "$tmp/settled"
  while IFS=$'\t' read -r key size; do
    case "/$key/" in
      */../* | //*) fail "unsafe attachment storageKey: $key" ;;
    esac
    actual="$( [ -f "$ATTACHMENTS/$key" ] && wc -c < "$ATTACHMENTS/$key" | tr -d ' ' || echo missing)"
    if [ "$actual" = "$size" ]; then
      printf '%s\0' "$key" >> "$tmp/settled"
    else
      echo "[$ts] skipped $key: $actual bytes on disk, $size in the db" >&2
    fi
  done < "$tmp/ready"
  rsync -a --from0 --files-from="$tmp/settled" "${SECRETS[@]}" "$ATTACHMENTS/" "$ATTACHMENTS_OUT/" ||
    fail "copy attachments"
  if [ -d "$ATTACHMENTS/step-sessions" ]; then
    mkdir -p "$ATTACHMENTS_OUT/step-sessions" || fail "create $ATTACHMENTS_OUT/step-sessions"
    for src in "$ATTACHMENTS"/step-sessions/*.jsonl; do
      [ -f "$src" ] || continue
      version="$(stat -c '%Y-%s' "$src" 2>/dev/null || stat -f '%m-%z' "$src")" || fail "stat $src"
      dest="$ATTACHMENTS_OUT/step-sessions/$(basename "$src" .jsonl).$version.jsonl"
      [ ! -e "$dest" ] || continue
      cp "$src" "$dest.partial" || fail "copy $src"
      if [ "$(stat -c '%Y-%s' "$src" 2>/dev/null || stat -f '%m-%z' "$src")" = "$version" ]; then
        mv "$dest.partial" "$dest" || fail "write $dest"
      else
        rm -f "$dest.partial"
        echo "[$ts] skipped $src: it changed during the copy" >&2
      fi
    done
  fi
  echo "[$ts] attachments copied: $(find "$ATTACHMENTS_OUT" -type f | wc -l | tr -d ' ') files"
fi

if [ -n "$REMOTE" ]; then
  export RSYNC_RSH="${RSYNC_RSH:-ssh -o BatchMode=yes -o ConnectTimeout=30}"
  case "$REMOTE" in
    *: | */) dest="$REMOTE" ;;
    *) dest="$REMOTE/" ;;
  esac
  push=(rsync -a --timeout=300 --ignore-existing)
  "${push[@]}" --include='server-db-*.db.gz' --exclude='*' "$OUT/" "${dest}db/" || fail "push db to ${dest}db/"
  if [ -n "$ATTACHMENTS" ]; then
    "${push[@]}" "${SECRETS[@]}" --exclude='*.partial' "$ATTACHMENTS_OUT/" "${dest}attachments/" || fail "push attachments to ${dest}attachments/"
  fi
  echo "[$ts] pushed to $dest"
fi

echo "[$ts] backup done"
