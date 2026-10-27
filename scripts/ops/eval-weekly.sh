#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/.local/share/mise/shims:${HOME}/.local/bin:/usr/local/bin:/usr/bin:${PATH}"
export GIT_TERMINAL_PROMPT=0

if [[ -z "${CAIRN_EVAL_RELAY_KEY:-}" || -z "${CAIRN_EVAL_RELAY_URL:-}" ]]; then
  source "${HOME}/.cairn/tools/eval-env.sh"
fi
if [[ -z "${CAIRN_EVAL_RELAY_KEY:-}" || -z "${CAIRN_EVAL_RELAY_URL:-}" ]]; then
  echo "eval-weekly: relay environment is unset" >&2
  exit 1
fi

SUMMARIZER="${CAIRN_EVAL_SUMMARIZER:-${HOME}/.cairn/tools/weekly/baseline-record.mts}"
STATE="${CAIRN_EVAL_STATE_DIR:-${HOME}/.local/state/cairn-eval}"
TABLE="${STATE}/weekly.md"
MODEL="${CAIRN_EVAL_WEEKLY_MODEL:-glm-5.3}"
REPO="${CAIRN_EVAL_REPO:-${HOME}/lanes/cairn}"
mkdir -p "${STATE}"

record_dir() {
  local flow="$1"
  local dir="$2"
  local day="$3"
  node --experimental-strip-types "${SUMMARIZER}" record \
    --flow "${flow}" \
    --results "${dir}/baseline/results.jsonl" \
    --errors "${dir}/baseline/errors.jsonl" \
    --state "${dir}/_state.json" \
    --table "${TABLE}" \
    --model "${MODEL}" \
    --date "${day}"
}

if [[ "${1:-}" == "--record" ]]; then
  record_dir "$2" "$3" "${4:-$(date -u +%Y-%m-%d)}"
  exit 0
fi

STAMP="$(date -u +%Y%m%d)"
DAY="$(date -u +%Y-%m-%d)"
WT="${HOME}/lanes/cairn-eval-${STAMP}"
cleanup() {
  git -C "${REPO}" worktree remove --force "${WT}" >/dev/null 2>&1 || true
}

git -C "${REPO}" fetch -q origin main
if [[ -e "${WT}" ]]; then
  echo "eval-weekly: worktree already exists: ${WT}" >&2
  exit 2
fi
git -C "${REPO}" worktree add -q --detach "${WT}" origin/main
trap cleanup EXIT
head_sha="$(git -C "${WT}" rev-parse HEAD)"
main_sha="$(git -C "${WT}" rev-parse origin/main)"
if [[ "${head_sha}" != "${main_sha}" ]]; then
  echo "eval-weekly: refusing to record; checkout ${head_sha} is not origin/main ${main_sha}" >&2
  exit 2
fi
if [[ -n "$(git -C "${WT}" status --porcelain)" ]]; then
  echo "eval-weekly: refusing to record; origin/main worktree is dirty" >&2
  exit 2
fi

cd "${WT}"
pnpm install --frozen-lockfile --ignore-scripts

run_flow() {
  local flow="$1"
  local flow_dir="${WT}/.claude/hillclimb/${flow}"
  rm -f "${flow_dir}/baseline/results.jsonl" "${flow_dir}/baseline/errors.jsonl"
  echo "eval-weekly: ${flow} start"
  node --import ./integration/node_modules/tsx/dist/loader.mjs integration/eval/chief-dispatch/run-eval.mts \
    --flow ".claude/hillclimb/${flow}" \
    --variant baseline \
    --model "${MODEL}" \
    --reps 3 \
    --approve-harness
  mkdir -p "${STATE}/${STAMP}/${flow}/baseline"
  cp -f "${flow_dir}/_state.json" "${STATE}/${STAMP}/${flow}/_state.json"
  cp -f "${flow_dir}/baseline/results.jsonl" "${STATE}/${STAMP}/${flow}/baseline/results.jsonl"
  if [[ -f "${flow_dir}/baseline/errors.jsonl" ]]; then
    cp -f "${flow_dir}/baseline/errors.jsonl" "${STATE}/${STAMP}/${flow}/baseline/errors.jsonl"
  else
    : > "${STATE}/${STAMP}/${flow}/baseline/errors.jsonl"
  fi
  record_dir "${flow}" "${STATE}/${STAMP}/${flow}" "${DAY}"
  echo "eval-weekly: ${flow} recorded"
}

run_flow chief-dispatch
run_flow memory-regression
echo "eval-weekly: table ${TABLE}"
