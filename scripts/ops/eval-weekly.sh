#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/.local/share/mise/shims:${HOME}/.local/bin:/usr/local/bin:/usr/bin:${PATH}"
export GIT_TERMINAL_PROMPT=0

utc_midnight_offset() {
  node --input-type=module -e '
    const day = process.argv[1];
    const offset = Number(process.argv[2]);
    const start = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(start.valueOf()) || !Number.isSafeInteger(offset)) process.exit(2);
    start.setUTCDate(start.getUTCDate() + offset);
    process.stdout.write(start.toISOString());
  ' "$1" "$2"
}

if [[ "${1:-}" == "--week-window" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "eval-weekly: usage: --week-window YYYY-MM-DD" >&2
    exit 2
  fi
  echo "since=$(utc_midnight_offset "$2" -7)"
  echo "until=$(utc_midnight_offset "$2" 1)"
  exit 0
fi

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

export_and_label_packs() {
  local packs_dir="$1"
  local day="$2"
  local model="$3"
  local packs_export="${packs_dir}/export.jsonl"
  local packs_labeled="${packs_dir}/labeled.jsonl"
  local week_since week_until
  mkdir -p "${packs_dir}"
  rm -f "${packs_export}" "${packs_labeled}"
  week_since="$(utc_midnight_offset "${day}" -7)"
  week_until="$(utc_midnight_offset "${day}" 1)"
  echo "eval-weekly: exporting packs ${week_since} .. ${week_until}" >&2
  pnpm traj:export --since "${week_since}" --until "${week_until}" --out "${packs_export}" >&2
  echo "eval-weekly: labeling packs with ${model}" >&2
  if ! pnpm traj:label --in "${packs_export}" --out "${packs_labeled}" --model "${model}" >&2; then
    rm -f "${packs_export}" "${packs_labeled}"
    echo "eval-weekly: labeling failed; cleared pack intermediates in ${packs_dir}" >&2
    return 1
  fi
  printf '%s\n' "${packs_labeled}"
}

if [[ "${1:-}" == "--record" ]]; then
  record_dir "$2" "$3" "${4:-$(date -u +%Y-%m-%d)}"
  exit 0
fi

if [[ "${1:-}" == "--packs" ]]; then
  if [[ -z "${CAIRN_LABELER_BASE_URL:-}" || -z "${CAIRN_LABELER_API_KEY:-}" || -z "${CAIRN_LABELER_MODEL:-}" ]]; then
    echo "eval-weekly: labeler environment is unset" >&2
    exit 1
  fi
  packs_dir="${2:-}"
  packs_week=""
  shift 2 || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --week)
        packs_week="${2:-}"
        shift 2
        ;;
      *)
        echo "eval-weekly: usage: --packs <dir> --week YYYY-MM-DD" >&2
        exit 2
        ;;
    esac
  done
  if [[ -z "${packs_dir}" || -z "${packs_week}" ]]; then
    echo "eval-weekly: usage: --packs <dir> --week YYYY-MM-DD" >&2
    exit 2
  fi
  export_and_label_packs "${packs_dir}" "${packs_week}" "${CAIRN_LABELER_MODEL}"
  exit 0
fi

STAMP="$(date -u +%Y%m%d)"
DAY="$(date -u +%Y-%m-%d)"
REVIEW_OUT="${STATE}/reviews/${DAY}"
if [[ -e "${REVIEW_OUT}" ]]; then
  echo "eval-weekly: review already exists for ${DAY}: ${REVIEW_OUT}" >&2
  exit 0
fi
if [[ -z "${CAIRN_LABELER_BASE_URL:-}" || -z "${CAIRN_LABELER_API_KEY:-}" || -z "${CAIRN_LABELER_MODEL:-}" ]]; then
  echo "eval-weekly: labeler environment is unset" >&2
  exit 1
fi

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
  if [[ -d "${flow_dir}/baseline/traces" ]]; then
    cp -R "${flow_dir}/baseline/traces" "${STATE}/${STAMP}/${flow}/baseline/"
  fi
  record_dir "${flow}" "${STATE}/${STAMP}/${flow}" "${DAY}"
  echo "eval-weekly: ${flow} recorded"
}

run_flow chief-dispatch
run_flow memory-regression
run_flow project-routing
echo "eval-weekly: table ${TABLE}"

PACKS_DIR="${STATE}/${STAMP}/packs"
PACKS_LABELED="${PACKS_DIR}/labeled.jsonl"
if [[ -n "${CAIRN_EVAL_REVIEW_PACKS:-}" ]]; then
  PACKS_LABELED="${CAIRN_EVAL_REVIEW_PACKS}"
else
  export_and_label_packs "${PACKS_DIR}" "${DAY}" "${CAIRN_LABELER_MODEL}" >/dev/null
  PACKS_LABELED="${PACKS_DIR}/labeled.jsonl"
fi

review_json="$(
  node "${WT}/scripts/eval-sample-failures.mjs" \
    --week "${DAY}" \
    --flows "${STATE}/${STAMP}" \
    --out "${REVIEW_OUT}" \
    --packs "${PACKS_LABELED}"
)"
echo "${review_json}"
packs_available="$(node -e 'const r=JSON.parse(process.argv[1]); process.stdout.write(String(r.available.packs))' "${review_json}")"
trace_hit="$(node -e 'const r=JSON.parse(process.argv[1]); process.stdout.write(String(r.traces.hit))' "${review_json}")"
trace_miss="$(node -e 'const r=JSON.parse(process.argv[1]); process.stdout.write(String(r.traces.miss))' "${review_json}")"
echo "eval-weekly: review packs=${packs_available} traces hit=${trace_hit} miss=${trace_miss}"
echo "eval-weekly: review ${REVIEW_OUT}/review.json"
