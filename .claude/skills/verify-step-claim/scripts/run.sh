#!/usr/bin/env bash
# Usage: run.sh [property ...]   (default: every line of expected.txt)
# Exit: 0 = every property matches expected.txt, 1 = a result changed, 2 = tool or setup error.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(git -C "$SKILL_DIR" rev-parse --show-toplevel)"
TLA_VERSION="1.7.4"
TLA_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
TLA_URL="https://github.com/tlaplus/tlaplus/releases/download/v${TLA_VERSION}/tla2tools.jar"
JAR="${PACMAN_TLA_JAR:-$HOME/.cache/pacman/tla2tools-${TLA_VERSION}.jar}"
JAVA="${JAVA:-java}"

if [ ! -f "$JAR" ]; then
  echo "tla2tools.jar not found at $JAR" >&2
  echo "fetch it (2,274,532 bytes) with:" >&2
  echo "  mkdir -p \"$(dirname "$JAR")\" && curl -fsSL -o \"$JAR\" $TLA_URL" >&2
  exit 2
fi
actual_sha="$(shasum -a 256 "$JAR" | cut -d' ' -f1)"
if [ "$actual_sha" != "$TLA_SHA256" ]; then
  echo "checksum mismatch for $JAR: got $actual_sha, want $TLA_SHA256" >&2
  exit 2
fi
if ! command -v "$JAVA" >/dev/null 2>&1; then
  echo "java not found (set JAVA=/path/to/java, Java 11+)" >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/verify-step-claim.XXXXXX")"
echo "work dir: $WORK"

if [ "$#" -gt 0 ]; then
  props="$*"
else
  props="$(awk '{print $1}' "$SKILL_DIR/expected.txt")"
fi

summarize_trace() {
  awk '
    function flush(   v) {
      if (n == 0) return
      printf "  %d. %s\n", n, act
      for (v in cur) {
        if (n == 1) {
          if (v ~ /^(st|sm|phase|home)$/) printf "       %s = %s\n", v, cur[v]
        } else if (!(v in prev) || prev[v] != cur[v]) {
          printf "       %s = %s\n", v, cur[v]
        }
        prev[v] = cur[v]
      }
      delete cur
    }
    /^State [0-9]+: / {
      flush()
      n = $2; sub(":", "", n); n += 0
      act = $3; sub("^<", "", act); sub(">$", "", act)
      var = ""
      next
    }
    /^\/\\ [a-zA-Z]+ = / {
      var = $2
      val = $0; sub("^/\\\\ [a-zA-Z]+ = ", "", val)
      if (var !~ /^(claims|partitions|crashes|rebinds|jout|presenceFresh|probeDue)$/) cur[var] = val
      next
    }
    /^[ \t]+[^ \t]/ && var != "" && (var in cur) {
      line = $0; gsub(/^[ \t]+/, " ", line); cur[var] = cur[var] line
      next
    }
    /^$/ { var = "" }
    END { flush() }
  ' "$1"
}

status=0
for prop in $props; do
  cfg="$SKILL_DIR/model/$prop.cfg"
  if [ ! -f "$cfg" ]; then
    echo "unknown property $prop (no $cfg)" >&2
    exit 2
  fi
  run="$WORK/$prop"
  mkdir -p "$run"
  cp "$SKILL_DIR/model/StepClaim.tla" "$cfg" "$run/"
  start=$(date +%s)
  (cd "$run" && "$JAVA" -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -deadlock -workers auto \
    -metadir "$run/states" -config "$prop.cfg" StepClaim.tla >"$run/tlc.log" 2>&1) || true
  secs=$(( $(date +%s) - start ))
  if grep -q "Model checking completed. No error has been found." "$run/tlc.log"; then
    got=PASS
  elif grep -qE "(Invariant|Action property|Temporal properties?) .*(is |were )?violated" "$run/tlc.log"; then
    got=FAIL
  else
    got=ERROR
  fi
  want="$(awk -v p="$prop" '$1 == p {print $2}' "$SKILL_DIR/expected.txt")"
  states="$(grep -E "distinct states found" "$run/tlc.log" | tail -1 | sed -E 's/.* ([0-9,]+) distinct states found.*/\1/' || true)"
  verdict="matches expected"
  if [ "$got" = ERROR ]; then
    verdict="TOOL ERROR"
    status=2
  elif [ "$got" != "$want" ]; then
    verdict="CHANGED (expected $want)"
    [ "$status" -eq 0 ] && status=1
  fi
  echo "$prop: $got in ${secs}s, ${states:-?} distinct states - $verdict"
  if [ "$got" = FAIL ]; then
    summarize_trace "$run/tlc.log"
  fi
  if [ "$got" = ERROR ]; then
    tail -20 "$run/tlc.log" | sed 's/^/  | /'
  fi
  echo "  full log: $run/tlc.log"
done

sync_commit="$(awk '/^sync-commit: /{print $2; exit}' "$SKILL_DIR/SKILL.md")"
covered="$(awk '/^```coverage$/{f=1; next} /^```$/{f=0} f && /^  [^ ]/{print $1}' "$SKILL_DIR/SKILL.md")"
if [ -n "$sync_commit" ] && [ -n "$covered" ]; then
  # shellcheck disable=SC2086
  drift="$(git -C "$REPO_ROOT" log --oneline "$sync_commit"..HEAD -- $covered)"
  # shellcheck disable=SC2086
  dirty="$(git -C "$REPO_ROOT" status --porcelain -- $covered)"
  if [ -n "$drift" ] || [ -n "$dirty" ]; then
    echo "covered code changed since sync-commit $sync_commit; re-read these against the model:"
    [ -n "$drift" ] && echo "$drift" | sed 's/^/  commit /'
    [ -n "$dirty" ] && echo "$dirty" | sed 's/^/  uncommitted /'
  else
    echo "covered code unchanged since sync-commit $sync_commit"
  fi
fi

exit "$status"
