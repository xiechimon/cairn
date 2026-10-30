#!/usr/bin/env bash
set -uo pipefail
umask 077
paths=()
pid=''
while [ $# -gt 0 ]; do
  case "$1" in
    --paths) shift; while [ $# -gt 0 ] && [[ "$1" != --* ]]; do paths+=("$1"); shift; done ;;
    --pid) [ $# -ge 2 ] && [[ "$2" =~ ^[1-9][0-9]*$ ]] || exit 2; pid="$2"; shift 2 ;;
    *) exit 2 ;;
  esac
done
[ ${#paths[@]} -gt 0 ] || [ -n "$pid" ] || exit 2
tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT
result=0
probe() {
  local channel="$1" path="$2" tool="$3"
  shift 3
  if ! command -v "$tool" >/dev/null; then
    printf 'SKIPPED %s %s\n' "$channel" "$path"
  elif "$@" > "$tmp/output" 2>/dev/null; then
    printf 'READ %s %s %s bytes\n' "$channel" "$path" "$(wc -c < "$tmp/output" | tr -d ' ')"
    result=1
  else
    printf 'BLOCKED %s %s\n' "$channel" "$path"
  fi
}
for path in "${paths[@]}"; do
  [[ "$path" = /* ]] || path="$PWD/$path"
  probe cat "$path" cat cat "$path"
  ln -s "$path" "$tmp/link" || exit 2
  probe symlink "$path" cat cat "$tmp/link"
  rm "$tmp/link"
  probe python "$path" python3 python3 -c 'import sys; sys.stdout.buffer.write(open(sys.argv[1],"rb").read())' "$path"
  probe node "$path" node node -e 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))' "$path"
  probe subprocess "$path" sh sh -c 'head -c1 "$1"' sh "$path"
  probe dd "$path" dd dd "if=$path" bs=1 count=1
  probe cp "$path" cp sh -c 'cp "$1" "$2" && cat "$2"' sh "$path" "$tmp/copy"
done
if [ -n "$pid" ]; then
  for channel in environ mem; do
    path="/proc/$pid/$channel"
    if [ "$(uname -s)" = Linux ]; then
      probe "$channel" "$path" dd dd "if=$path" bs=1 count=1
    else
      printf 'SKIPPED %s %s\n' "$channel" "$path"
    fi
  done
fi
exit "$result"
