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

## Public Results Branch

After the private state above is written, a terminal run attempts to publish one sanitized `latest.json` to the public `eval-results` branch of the canonical `xiechimon/cairn` repository. The file is a cache for the public homepage, not the measurement record: publication failure never changes the eval status or exit code.

- The publisher derives `remote.origin.url` from `$EVAL_DAILY_REPO` and refuses a non-canonical origin. Git runs non-interactively (`GIT_TERMINAL_PROMPT=0`) with per-command timeouts; there is no retry loop or destructive recovery.
- Only complete official runs publish: `evalExitCode` must be zero and the items must match the current suite's exact `(kind, caseId, repeat)` matrix. Partial `--only` runs, missing or duplicate trials, non-zero eval exits, and zero-item infrastructure failures are recorded as `publicResults.state = "skipped"` or `"failed"` in private state. Complete matrices may still contain measured incomplete trials; those are published as incomplete rather than rewritten to pass/fail.
- The public payload is constructed from a fixed allowlist and contains no diagnostics, stdout/stderr, local paths, trace ids or URLs, Langfuse metadata, quota/cost text, or secrets. Runtime/canary rows are labelled `Recorded replay` (localized on the site); lane rows are labelled `Devin CLI · <model>` using the model recorded from the isolated Devin CLI `sessions.db` (or `DEVIN_MODEL`).
- The branch contains only `latest.json`. A missing branch starts as an orphan branch; an existing branch has all other tracked files pruned from the commit tree. Identical content is `unchanged`; a newer/equal remote snapshot blocks an older local result as stale, except that a remote timestamp more than ten minutes in the future is treated as invalid rather than wedging publication forever. Push failure is recorded as `failed` with a scrubbed short reason.
- Rollback: stop or disable the timer before deleting or replacing `eval-results`; otherwise the next complete daily run recreates or advances the branch. Private runner state is independent and is never rolled back. GitHub, CDN and browser caches may retain an older public snapshot briefly, so rollback cannot erase copies already fetched.
