# Daily Real-Task Eval on Host Timer

The real-task eval suite (`eval/run.ts`) runs once per day on a dedicated macOS host via `launchd` (`com.xiechimon.cairn-eval-daily`), outside GitHub Actions and outside the CI merge gate.

## Relationship to CI (`EVAL_ENABLED`)

- Repository variable `EVAL_ENABLED` controls **only** the `eval` merge-gate job in `.github/workflows/ci.yml` (`false` keeps the merge gate off).
- Before setting `EVAL_ENABLED=true`, repository variable `LANGFUSE_BASE_URL` must also be configured in GitHub (`eval/run.ts --require-langfuse` fails with exit code `3` when `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, or `LANGFUSE_SECRET_KEY` is missing).
- Scheduled runs on GitHub Actions are retired; `scripts/ops/eval-daily.mjs` refuses to run inside `CI`.

## Host Setup

1. Keep a clean detached clone at `$EVAL_DAILY_REPO` (for example `$HOME/Code/cairn`) and a dedicated state directory at `$EVAL_DAILY_STATE` (for example `$HOME/.local/state/cairn-eval-daily`).
2. Store Langfuse credentials (`0600`) in `$EVAL_DAILY_LANGFUSE_ENV` (default `$HOME/langfuse/eval.env`) with explicit `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`.
3. Provision an isolated Devin CLI home at `$EVAL_DAILY_DEVIN_HOME` containing `.local/share/devin/credentials.toml` (`0600`), separate from `$HOME/.cairn/homes/devin`.
4. Write `$HOME/.config/cairn/eval-daily.env` (`0600`) setting `PATH`, `EVAL_DAILY_REPO`, `EVAL_DAILY_STATE`, `EVAL_DAILY_LANGFUSE_ENV`, `EVAL_DAILY_DEVIN_HOME`, and optional `EVAL_MAX_DEVIN_RUNS=40`.
5. Install the daily timer (default 05:00 local time; `RunAtLoad` false):

```sh
"$EVAL_DAILY_REPO/scripts/ops/install-eval-daily.sh" --env-file "$HOME/.config/cairn/eval-daily.env" --launchd
```

Manual run:

```sh
launchctl kickstart "gui/$(id -u)/com.xiechimon.cairn-eval-daily"
```

## Runtime & Persisted State

- `launchd` invokes `scripts/owned-process.mjs --max-runtime-sec 8100 -- node scripts/ops/eval-daily.mjs`.
- `eval-daily.mjs` acquires `$EVAL_DAILY_STATE/lock` (atomic `wx`, reclaimed safely via `$EVAL_DAILY_STATE/lock.reclaim` on dead, PID-reused, corrupt `>=5s`, or expired `>4h` locks), fetches and detaches `$EVAL_DAILY_REPO` to `origin/main` (refusing dirty trees), installs dependencies only when `pnpm-lock.yaml` changes, verifies Langfuse `/api/public/health` and synced `eval/harness/devin-env.mjs --check-auth`, and runs `eval/run.ts --require-langfuse --out "$EVAL_DAILY_STATE/tmp/<runId>.json"`.
- Outputs are written atomically to `$EVAL_DAILY_STATE/runs/<runId>.json`, `$EVAL_DAILY_STATE/latest.json`, `$EVAL_DAILY_STATE/history.json` (newest 60 runs), and `$EVAL_DAILY_STATE/index.html` (per-case pass/fail scores, scrubbed diagnostics, deltas, and Langfuse trace links).
- Statuses: `ok` (all trials passed, exit `0`), `degraded` (non-zero passes with some task failures, exit `0`), `incomplete` (auth/Langfuse/infra/timeout/signal interruption, exit `1`), `failed` (repo sync/install failure or 0 passes, exit `1`).
