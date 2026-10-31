#!/usr/bin/bash
set -euo pipefail
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:/usr/local/bin:/usr/bin:$PATH"
if [[ -z "${CAIRN_EVAL_RELAY_URL:-}" || -z "${CAIRN_EVAL_RELAY_KEY:-}" ]]; then
  set -a
  source "$HOME/.cairn/tools/eval-env.sh"
  set +a
fi
if [[ -z "${CAIRN_EVAL_RELAY_URL:-}" || -z "${CAIRN_EVAL_RELAY_KEY:-}" ]]; then
  echo "CAIRN_EVAL_RELAY_URL or CAIRN_EVAL_RELAY_KEY is unset" >&2
  exit 1
fi

REPO="$HOME/lanes/cairn"
STAMP=$(date -u +%Y%m%d)
WT="$HOME/lanes/cairn-memory-regression-$STAMP"
OUT="$HOME/.local/state/cairn-memory-regression/$STAMP"
mkdir -p "$OUT"
cleanup() {
  git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$REPO" fetch -q origin main
if [[ -e "$WT" ]]; then
  git -C "$REPO" worktree remove --force "$WT"
fi
git -C "$REPO" worktree add -q --detach "$WT" origin/main
cd "$WT"
pnpm install --frozen-lockfile

node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const src = JSON.parse(readFileSync('.claude/hillclimb/memory-regression/cases.json', 'utf8'));
const models = [...new Set(src.roster.map((row) => row.modelId))];
writeFileSync('/tmp/cairn-memory-regression-models.txt', `${models.join('\n')}\n`);
EOF

fail=0
n=0
while IFS= read -r model; do
  [[ -z "$model" ]] && continue
  n=$((n + 1))
  variant="v${n}"
  echo "START model=$model"
  set +e
  pnpm --filter @cairn/integration exec tsx eval/chief-dispatch/run-eval.mts \
    --flow .claude/hillclimb/memory-regression \
    --variant "$variant" \
    --model "$model" \
    --reps 1 \
    --concurrency 2 \
    --timeout-s 360 \
    --approve-harness
  status=$?
  set -e
  echo "END model=$model status=$status"
  if [[ "$status" -ne 0 ]]; then
    fail=1
  fi
  mkdir -p "$OUT/$model"
  for name in results.jsonl errors.jsonl; do
    src_file=".claude/hillclimb/memory-regression/$variant/$name"
    if [[ -f "$src_file" ]]; then
      cp -f "$src_file" "$OUT/$model/$name"
    fi
  done
done < /tmp/cairn-memory-regression-models.txt
rm -f /tmp/cairn-memory-regression-models.txt
echo "memory-regression weekly archive: $OUT"
exit "$fail"
