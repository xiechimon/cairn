#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<'EOF'
usage: backup-server-db.sh --db <server.db> --out <dir> [--keep N]
         [--attachments <dir> --attachments-out <dir>] [--coordinator <dir> --coordinator-out <dir>]
         [--skills <dir> --skills-out <dir>] [--repos <dir> --repos-out <dir>]
         [--remote <rsync destination>]

  --db               live server DB, copied with sqlite3 .backup and checked with integrity_check
  --out              local directory for server-db-<UTC timestamp>.db.gz, keeping the newest --keep (default 48)
  --attachments      server attachments directory; files whose attachment row is ready in this run's
                     DB copy, with the size it records, are copied into --attachments-out, and nothing
                     is ever deleted there; step-sessions/<step>.jsonl is copied as
                     step-sessions/<step>.<mtime>-<sha256 prefix>.jsonl, one file per content
  --coordinator      in-server Coordinator store directory; each <thread>.sqlite is copied after the server
                     DB with sqlite3 .backup, checked with integrity_check and written gzipped into
                     --coordinator-out/coordinator-<UTC timestamp>/, keeping the newest --keep runs. A store
                     newer than the DB copy is a reconcile case at the next boot, never a restore failure
  --skills           Cairn skills directory (<CAIRN_HOME>/skills); written as --skills-out/skills-<UTC timestamp>.tar.gz,
                     keeping the newest --keep; the source is only read
  --repos            existing hosted repositories directory (<server data dir>/repos, laid out as
                     <team>/<name>.git); each bare repo is written as a git bundle
                     --repos-out/repos-<UTC timestamp>/<team>/<name>.bundle, restored into scratch and checked
                     with fsck and its refs before the run is kept, with its HEAD branch in <name>.head;
                     keeps the newest --keep runs; symlinks and unsafe names fail the run; sources are only read
  --remote           existing rsync destination root (for example dmit-backup:); receives db/ and attachments/
                     and every other store given, with no remote shell, no deletes and no overwrites; the
                     receiver rotates its own copies

secretbox.key and *.pem are never copied or pushed. A copy name that already exists fails the run.
A failed step exits non-zero and names the step.
EOF
  exit 2
}

DB=""
OUT=""
ATTACHMENTS=""
ATTACHMENTS_OUT=""
COORDINATOR=""
COORDINATOR_OUT=""
SKILLS=""
SKILLS_OUT=""
REPOS=""
REPOS_OUT=""
REMOTE=""
KEEP=48

while [ $# -gt 0 ]; do
  case "$1" in
    --db | --out | --attachments | --attachments-out | --coordinator | --coordinator-out | --skills | --skills-out | --repos | --repos-out | --remote | --keep)
      [ $# -ge 2 ] && [[ "$2" != -* ]] || { echo "$1 requires a value" >&2; usage; }
      case "$1" in
        --db) DB="$2" ;;
        --out) OUT="$2" ;;
        --attachments) ATTACHMENTS="$2" ;;
        --attachments-out) ATTACHMENTS_OUT="$2" ;;
        --coordinator) COORDINATOR="$2" ;;
        --coordinator-out) COORDINATOR_OUT="$2" ;;
        --skills) SKILLS="$2" ;;
        --skills-out) SKILLS_OUT="$2" ;;
        --repos) REPOS="$2" ;;
        --repos-out) REPOS_OUT="$2" ;;
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

if [[ -n "$COORDINATOR" && -z "$COORDINATOR_OUT" || -z "$COORDINATOR" && -n "$COORDINATOR_OUT" ]]; then
  echo "--coordinator and --coordinator-out go together" >&2
  usage
fi

if [[ -n "$SKILLS" && -z "$SKILLS_OUT" || -z "$SKILLS" && -n "$SKILLS_OUT" ]]; then
  echo "--skills and --skills-out go together" >&2
  usage
fi

if [[ -n "$REPOS" && -z "$REPOS_OUT" || -z "$REPOS" && -n "$REPOS_OUT" ]]; then
  echo "--repos and --repos-out go together" >&2
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
if [ -n "$REPOS" ]; then
  command -v git >/dev/null || fail "git not on PATH"
fi

SECRETS=(--exclude=secretbox.key --exclude='*.pem')
if command -v sha256sum >/dev/null; then SHA256=(sha256sum); else SHA256=(shasum -a 256); fi
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
    while IFS= read -r f; do rm -f -- "$f" "$f.attachments.sha256" || exit 1; done
) || fail "rotate $OUT"

if [ -n "$COORDINATOR" ]; then
  [ -d "$COORDINATOR" ] || echo "[$ts] no coordinator stores yet: $COORDINATOR"
  mkdir -p "$COORDINATOR_OUT/coordinator-$ts" || fail "create $COORDINATOR_OUT/coordinator-$ts"
  stores=0
  for src in "$COORDINATOR"/*.sqlite; do
    [ -f "$src" ] || continue
    base="$(basename "$src")"
    sqlite3 "$src" ".backup $tmp/$base" || fail "sqlite3 .backup of coordinator store $base"
    store_check="$(sqlite3 "$tmp/$base" 'PRAGMA integrity_check;')" || fail "integrity_check of coordinator store $base"
    [ "$store_check" = "ok" ] || fail "integrity_check of coordinator store $base: $store_check"
    gzip -c "$tmp/$base" > "$COORDINATOR_OUT/coordinator-$ts/$base.gz" || fail "gzip coordinator store $base"
    rm -f "$tmp/$base"
    stores=$((stores + 1))
  done
  (
    cd "$COORDINATOR_OUT" &&
      { ls -1d coordinator-*/ 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) |
      while IFS= read -r d; do rm -rf -- "$d" || exit 1; done
  ) || fail "rotate $COORDINATOR_OUT"
  echo "[$ts] coordinator stores copied: $stores"
fi

if [ -n "$SKILLS" ]; then
  [ -d "$SKILLS" ] || fail "skills not found: $SKILLS"
  mkdir -p "$SKILLS_OUT" || fail "create $SKILLS_OUT"
  archive="$SKILLS_OUT/skills-$ts.tar.gz"
  [ ! -e "$archive" ] || fail "$archive already exists"
  tar -czf "$tmp/skills.tar.gz" -C "$SKILLS" --exclude=./.migrating --exclude=secretbox.key --exclude='*.pem' . ||
    fail "archive skills"
  mv "$tmp/skills.tar.gz" "$archive" || fail "write $archive"
  (
    cd "$SKILLS_OUT" &&
      { ls -1 skills-*.tar.gz 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) |
      while IFS= read -r f; do rm -f -- "$f" || exit 1; done
  ) || fail "rotate $SKILLS_OUT"
  echo "[$ts] skills archived: $archive"
fi

if [ -n "$REPOS" ]; then
  [ -d "$REPOS" ] || fail "hosted repos not found: $REPOS"
  run_dir="$REPOS_OUT/repos-$ts"
  [ ! -e "$run_dir" ] || fail "$run_dir already exists"
  mkdir -p "$tmp/repos" || fail "create a scratch dir for hosted repos"
  bundled=0
  for src in "$REPOS"/*/*.git; do
    [ -e "$src" ] || [ -L "$src" ] || continue
    team_dir="${src%/*}"
    team="${team_dir##*/}"
    repo="${src##*/}"
    repo="${repo%.git}"
    [[ "$team" =~ ^[A-Za-z0-9_-]+$ && "$repo" =~ ^[A-Za-z0-9._-]+$ ]] || fail "unsafe hosted repo path: $src"
    [ ! -L "$team_dir" ] && [ ! -L "$src" ] && [ -d "$src" ] || fail "hosted repo is not a plain directory: $team/$repo"
    [ "$(git -C "$src" rev-parse --is-bare-repository 2>/dev/null)" = "true" ] || fail "not a bare repository: $team/$repo"
    copy="$tmp/repos/$team/$repo"
    mkdir -p "$tmp/repos/$team" || fail "create $tmp/repos/$team"
    git -C "$src" symbolic-ref -q HEAD > "$copy.head" || fail "read HEAD of hosted repo $team/$repo"
    source_refs="$(git -C "$src" for-each-ref --format='%(objectname) %(refname)')" ||
      fail "list refs of hosted repo $team/$repo"
    if [ -z "$source_refs" ]; then
      : > "$copy.empty"
    else
      git -C "$src" bundle create "$copy.bundle" --all 2> "$tmp/bundle.err" ||
        fail "bundle hosted repo $team/$repo: $(cat "$tmp/bundle.err")"
      git clone -q --mirror "$copy.bundle" "$tmp/restore-check.git" 2> "$tmp/bundle.err" ||
        fail "restore check of hosted repo $team/$repo: $(cat "$tmp/bundle.err")"
      git -C "$tmp/restore-check.git" fsck --no-dangling --no-progress 2> "$tmp/bundle.err" > /dev/null ||
        fail "fsck of restored hosted repo $team/$repo: $(cat "$tmp/bundle.err")"
      restored_refs="$(git -C "$tmp/restore-check.git" for-each-ref --format='%(objectname) %(refname)' refs/heads refs/tags)" ||
        fail "list refs of restored hosted repo $team/$repo"
      expected_refs="$(git -C "$src" for-each-ref --format='%(objectname) %(refname)' refs/heads refs/tags)" ||
        fail "list refs of hosted repo $team/$repo"
      [ "$restored_refs" = "$expected_refs" ] || fail "restored refs differ for hosted repo $team/$repo"
      rm -rf "$tmp/restore-check.git"
    fi
    bundled=$((bundled + 1))
  done
  mkdir -p "$REPOS_OUT" || fail "create $REPOS_OUT"
  mv "$tmp/repos" "$run_dir" || fail "write $run_dir"
  (
    cd "$REPOS_OUT" &&
      { ls -1d repos-*/ 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) |
      while IFS= read -r d; do rm -rf -- "$d" || exit 1; done
  ) || fail "rotate $REPOS_OUT"
  echo "[$ts] hosted repos bundled: $bundled"
fi

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
      case "$key" in
        secretbox.key | */secretbox.key | *.pem) continue ;;
      esac
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
      partial="$ATTACHMENTS_OUT/step-sessions/.$(basename "$src").partial"
      cp "$src" "$partial" || fail "copy $src"
      digest="$("${SHA256[@]}" < "$partial" | cut -c1-16)" || fail "hash $partial"
      if [ "$("${SHA256[@]}" < "$src" | cut -c1-16)" != "$digest" ]; then
        rm -f "$partial"
        echo "[$ts] skipped $src: it changed during the copy" >&2
        continue
      fi
      mtime="$(stat -c '%Y' "$src" 2>/dev/null || stat -f '%m' "$src")" || fail "stat $src"
      dest="$ATTACHMENTS_OUT/step-sessions/$(basename "$src" .jsonl).$mtime-$digest.jsonl"
      if compgen -G "$ATTACHMENTS_OUT/step-sessions/$(basename "$src" .jsonl).*-$digest.jsonl" >/dev/null; then
        rm -f "$partial"
      else
        mv "$partial" "$dest" || fail "write $dest"
      fi
    done
  fi
  find "$ATTACHMENTS_OUT" -type f ! -name secretbox.key ! -name '*.pem' ! -name '*.partial' -print0 > "$tmp/copied" ||
    fail "list copied attachments"
  : > "$tmp/attachments.sha256"
  while IFS= read -r -d '' copied; do
    key="${copied#"$ATTACHMENTS_OUT/"}"
    digest="$("${SHA256[@]}" < "$copied" | cut -c1-64)" || fail "hash copied attachment $key"
    printf '%s\t%s\n' "$digest" "$key" >> "$tmp/attachments.sha256"
  done < "$tmp/copied"
  LC_ALL=C sort -k2 "$tmp/attachments.sha256" > "$tmp/attachments.sorted.sha256" || fail "sort attachment manifest"
  mv -f "$tmp/attachments.sorted.sha256" "$OUT/$name.attachments.sha256" || fail "write attachment manifest"
  echo "[$ts] attachments copied: $(find "$ATTACHMENTS_OUT" -type f | wc -l | tr -d ' ') files"
fi

if [ -n "$REMOTE" ]; then
  export RSYNC_RSH="${RSYNC_RSH:-ssh -o BatchMode=yes -o ConnectTimeout=30}"
  case "$REMOTE" in
    *: | */) dest="$REMOTE" ;;
    *) dest="$REMOTE/" ;;
  esac
  push=(rsync -a --timeout=300 --ignore-existing)
  "${push[@]}" --include='server-db-*.db.gz' --include='server-db-*.db.gz.attachments.sha256' --exclude='*' "$OUT/" "${dest}db/" || fail "push db to ${dest}db/"
  if [ -n "$ATTACHMENTS" ]; then
    "${push[@]}" "${SECRETS[@]}" --exclude='*.partial' "$ATTACHMENTS_OUT/" "${dest}attachments/" || fail "push attachments to ${dest}attachments/"
  fi
  if [ -n "$COORDINATOR" ]; then
    "${push[@]}" "$COORDINATOR_OUT/" "${dest}coordinator/" || fail "push coordinator stores to ${dest}coordinator/"
  fi
  if [ -n "$SKILLS" ]; then
    "${push[@]}" "$SKILLS_OUT/" "${dest}skills/" || fail "push skills to ${dest}skills/"
  fi
  if [ -n "$REPOS" ]; then
    "${push[@]}" "$REPOS_OUT/" "${dest}repos/" || fail "push hosted repos to ${dest}repos/"
  fi
  echo "[$ts] pushed to $dest"
fi

echo "[$ts] backup done"
