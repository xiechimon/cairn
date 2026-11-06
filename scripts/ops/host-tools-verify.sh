#!/usr/bin/env bash
set -uo pipefail

CHECKOUT="${CAIRN_CHECKOUT:-$HOME/Code/AgentProjects/cairn-exec}"
REF="${CAIRN_HOST_TOOLS_REF:-HEAD}"
TOOLS_ROOT="${CAIRN_HOST_TOOLS_ROOT:-$HOME/.cairn/tools}"
LANES_ROOT="${CAIRN_HOST_LANES_ROOT:-$HOME/lanes}"
BIN_ROOT="${CAIRN_HOST_BIN_ROOT:-$HOME/.local/bin}"
UNITS_ROOT="${CAIRN_HOST_UNITS_ROOT:-$HOME/.config/systemd/user}"

usage() {
  echo "usage: host-tools-verify.sh [--adopt <host path>...]" >&2
  echo "  Compares the host tools, lane helpers, bin scripts and user units with scripts/ops/host at \$CAIRN_HOST_TOOLS_REF [HEAD] of \$CAIRN_CHECKOUT." >&2
  echo "  Prints ok, DIFF, MISSING or EXTRA per file and exits 1 when any file is not ok." >&2
  echo "  --adopt moves each named DIFF host file to <file>.drift-<sha> and installs the repo version." >&2
  exit 2
}

dest_of() {
  case "$1" in
    scripts/ops/host/tools/*) echo "$TOOLS_ROOT/${1#scripts/ops/host/tools/}" ;;
    scripts/ops/host/lanes/*) echo "$LANES_ROOT/${1#scripts/ops/host/lanes/}" ;;
    scripts/ops/host/bin/*) echo "$BIN_ROOT/${1#scripts/ops/host/bin/}" ;;
    scripts/ops/host/units/*) echo "$UNITS_ROOT/${1#scripts/ops/host/units/}" ;;
  esac
}

adopt=()
if [ "${1:-}" = --adopt ]; then
  shift
  [ $# -gt 0 ] || usage
  adopt=("$@")
elif [ $# -gt 0 ]; then
  usage
fi

sha="$(git -C "$CHECKOUT" rev-parse --short "$REF")" || { echo "cannot resolve $REF in $CHECKOUT" >&2; exit 2; }
rels="$(git -C "$CHECKOUT" ls-tree -r --name-only "$REF" -- scripts/ops/host/tools scripts/ops/host/lanes scripts/ops/host/bin scripts/ops/host/units)"
bad=0
managed="$(mktemp)"
trap 'rm -f "$managed"' EXIT

adopt_file() {
  local rel="$1" dest="$2" mode=644
  case "$rel" in *.sh | */host/bin/*) mode=755 ;; esac
  [ ! -x "$dest" ] || mode=755
  mv "$dest" "$dest.drift-$sha" &&
    git -C "$CHECKOUT" show "$REF:$rel" >"$dest.tmp.$$" &&
    chmod "$mode" "$dest.tmp.$$" &&
    mv "$dest.tmp.$$" "$dest"
}

while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  dest="$(dest_of "$rel")"
  [ -n "$dest" ] || continue
  echo "$dest" >>"$managed"
  expected="$(git -C "$CHECKOUT" rev-parse "$REF:$rel")"
  if [ ! -f "$dest" ]; then
    echo "MISSING $dest"
    bad=1
  elif [ "$(git hash-object "$dest")" = "$expected" ]; then
    echo "ok      $dest"
  elif [[ " ${adopt[*]-} " == *" $dest "* ]] && adopt_file "$rel" "$dest"; then
    echo "adopted $dest (host copy kept as $dest.drift-$sha)"
  else
    echo "DIFF    $dest"
    bad=1
  fi
done <<<"$rels"

while IFS= read -r extra; do
  grep -qxF "$extra" "$managed" && continue
  echo "EXTRA   $extra"
  bad=1
done < <(find "$TOOLS_ROOT" -type f \
  -not -path '*/node_modules/*' -not -path "$TOOLS_ROOT/agent-desktop/*" -not -path "$TOOLS_ROOT/cairn/*" \
  -not -path "$TOOLS_ROOT/app-token/package*.json" -not -path "$TOOLS_ROOT/app-token/pnpm-lock.yaml" \
  -not -name '.installed-sha' -not -name '*.bak*' -not -name '*.log' -not -name '*.drift-*' -not -name '*.tmp.*' 2>/dev/null | sort)

exit "$bad"
