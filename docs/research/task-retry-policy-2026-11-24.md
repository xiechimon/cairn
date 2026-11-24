# Task Retry Policy: Prior-Art Research and Design (2026-11-24)

> **Evidence tags**: `[measured]` = read directly in primary documentation or source code; `[inferred]` = arithmetic or logical derivation from `[measured]` facts; `[guessed]` = none used.

## 1. Prior-Art Comparison

Cairn's current task-level retry (`apps/server/src/services/retry-parking.ts`) applies a single policy to almost every failure: `AUTOMATIC_RETRY_LIMIT = 3`, base `60s`, exponential delay `60s * 2^n` (1m / 2m / 4m, 7m total) with no jitter, then parks as `Task parked: automatic retries exhausted (3)` `[measured]`. Only `model_unavailable`, `runtime_outdated`, provider auth, missing credentials, and gate rejections bypass automatic retry; environment/setup hook exits (such as `.agents/setup` failing on `corepack: command not found`) currently retry three times before parking `[measured]`.

### Comparison Table

| Source | Max Attempts | Backoff Formula & Cap | Jitter | Total Retry Window | 429 / `Retry-After` / Quota Reset | Auth / Config / Non-Retryable | Trade-offs & Primary Link |
|---|---|---|---|---|---|---|---|
| **Anthropic TS SDK** (`@anthropic-ai/sdk` `@a58021f8` / local `0.129.0`) | Default `2` (`3` tries); forced `0` for stream bodies `[measured]` | `min(0.5s * 2^n, 8.0s)` (`n=0,1,...`) `[measured]` | Downward uniform `× (1 - rand * 0.25)` (`-25%..0%`) on default backoff only `[measured]` | `1.125s–1.5s` without `Retry-After` `[inferred]` | Retries `429`; honors `retry-after-ms`, then `retry-after` (sec or HTTP-date) in `(0, 2^31-1]` ms (~24.85d) ignoring `8s` cap; obeys `x-should-retry` `[measured]` | Retries `408, 409, 429, >=500`, connection/timeout; single `401` bearer token-cache refresh; fails fast on `400, 401 (apiKey), 402, 403, 404, 413` `[measured]` | Fast, predictable HTTP retries; short window unsuitable for multi-hour outages. [client.ts](https://github.com/anthropics/anthropic-sdk-typescript/blob/a58021f8a441529d6c6b418687442b359b9afc72/src/client.ts), [API Errors](https://platform.claude.com/docs/en/api/errors), [Rate Limits](https://platform.claude.com/docs/en/api/rate-limits) |
| **Claude Code CLI** | Default `10` (`CLAUDE_CODE_MAX_RETRIES`, cap `15`); watchdog mode: `∞` for `429/529`, `300` for other transient errors; `/goal` task loop: `3` transient retries `[measured]` | Exponential; `529` base `500ms` (tunable `0.5s–32s`), cap `32s` (tunable `32s–300s`); watchdog cap `5m` `[measured]` | Not specified in primary docs `[measured]` | Watchdog: `~3h` across 300 transient retries; `429/529` unbounded or `MAX_WAIT_MS`; interactive quota wait up to `24h` reset (`3` auto-continues) `[measured]` | Retries temporary `429` throttles; fails fast on spend-limit `429` (`x-should-retry: false`) and exhausted credits; interactive & watchdog wait for plan quota reset (watchdog recheck `60s–3h`) `[measured]` | Fails fast on TLS cert errors, inference-hook denials, partial output after text/tool start, Bedrock bad content-type; refreshes `apiKeyHelper` on `401/403` and GCP/AWS creds `2x`; `/goal` pauses on rate/usage limit or hook end `[measured]` | Separates short interactive turns from long unattended watchdog waits; honors `x-should-retry` so spend caps never spin. [errors.md](https://code.claude.com/docs/en/errors.md), [env-vars.md](https://code.claude.com/docs/en/env-vars.md), [interactive-mode.md](https://code.claude.com/docs/en/interactive-mode.md), [goal.md](https://code.claude.com/docs/en/goal.md) |
| **OpenAI Codex CLI** (`openai/codex` `@f64f003d`) | HTTP: `4` (cap `100`); Stream/turn: `5` (cap `100`, reset to `0` on WS→HTTPS fallback); `UnboundedConnectionRetries`: `∞` for `ConnectionFailed` `[measured]` | HTTP & stream: `200ms * 2^(attempt-1)`, no cap; `UnboundedConnectionRetries`: `5s` doubling, cap `60s` `[measured]` | Uniform `±10%` (`× [0.9, 1.1]`); none on `Retry-After` or `UnboundedConnectionRetries` `[measured]` | HTTP: `2.7s–3.3s`; Stream: `5.58s–6.82s` without `Retry-After` `[inferred]` | HTTP disables 429 retry (`retry_429: false`) so structured classifier handles it; captures `Retry-After` (sec/HTTP-date) once as monotonic `Instant` deadline (and SSE `"try again in Xs/ms"`); `ServerOverloaded`/`RetryLimit` retry only if server sent `Retry-After` (`ServerDirected`); `UsageLimitReached`/`QuotaExceeded`/`APISpendLimitExceeded` = `Never` `[measured]` | Single-attempt `401` token refresh in `client.rs`; exhaustive `RetryPolicy::Never` for auth denials, `InvalidRequest` (`400`), `ContextWindowExceeded`, `EnvVar`, `Sandbox`, `ModelNotFound`, policy violations, spend/quota `[measured]` | Monotonic `Retry-After` deadline prevents timer resets across layers; strict `Never` vs `ServerDirected` vs `Backoff` split stops futile retries. [retry.rs](https://github.com/openai/codex/blob/f64f003d985ae59e82b4c63b37fe8c494d203ce9/codex-rs/codex-client/src/retry.rs), [responses_retry.rs](https://github.com/openai/codex/blob/f64f003d985ae59e82b4c63b37fe8c494d203ce9/codex-rs/core/src/responses_retry.rs), [error.rs](https://github.com/openai/codex/blob/f64f003d985ae59e82b4c63b37fe8c494d203ce9/codex-rs/protocol/src/error.rs), [retry_after.rs](https://github.com/openai/codex/blob/f64f003d985ae59e82b4c63b37fe8c494d203ce9/codex-rs/http-client/src/retry_after.rs) |
| **Buildkite Pipelines** | Default `limit: 2` (`3` runs) when `automatic: true`; max `10` per rule; `limit: 0` disables; counts tracked independently per rule `[measured]` | None on job `retry.automatic` (re-enqueued immediately); agent git checkout uses `6` attempts, `1s * 2^n` `[measured]` | None on job retry `[measured]` | N/A (immediate re-queue; bounded by step timeout) `[inferred]` | N/A for command steps (API client docs advise bounded exponential backoff + jitter + `Retry-After` on `429`/`5xx`, never other `4xx`) `[measured]` | Ordered rules match `exit_status` (`-1` agent lost, `255` agent stop, `1..255`), `signal`, `signal_reason`; unmatched exit codes never retry; canceled jobs/builds never auto-retry `[measured]` | Opt-in error-matched rules avoid blind retries of deterministic build/setup failures; preserves immutable attempt history. [Buildkite Retry](https://buildkite.com/docs/pipelines/configure/retry), [Command Step](https://buildkite.com/docs/pipelines/configure/step-types/command-step), [Agent Lifecycle](https://buildkite.com/docs/agent/lifecycle) |
| **GitHub Actions** (Workflows & `actions/runner` `@1060fd3a`) | Jobs: **`0` automatic retries** (manual/API re-run max `50` in `30d`). Runner→Service HTTP: `5` retries (`50` low-priority) `[measured]` | Runner HTTP: `min(10s + (2^a - 1) * rand(0.8s..1.2s), 10m)` `[measured]` | Runner HTTP: `±20%` on `1s` delta coeff `[measured]` | Runner HTTP: `95.6s–118.4s` (5 retries) `[inferred]` | Runner HTTP retries `429, 502, 503, 504` (not `500`), honors `Retry-After` clamped to `[minBackoff, maxBackoff]` + `rand(0..30s)` if clamped `[measured]` | No workflow `retry` key; `continue-on-error` suppresses failure without retrying; Runner HTTP skips `4xx` (other than `429`), `TimeoutException`, and `VssHostOfflineError` `[measured]` | Zero surprise job loops; explicit manual rerun preserves upstream artifacts, while transport layer absorbs short service blips. [Workflow Syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [Re-running Workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs), [VssHttpRetryOptions.cs](https://github.com/actions/runner/blob/1060fd3acfef295496f6843c2ec134fd74a70dc5/src/Sdk/Common/Common/VssHttpRetryOptions.cs), [BackoffTimerHelper.cs](https://github.com/actions/runner/blob/1060fd3acfef295496f6843c2ec134fd74a70dc5/src/Sdk/Common/Common/Utility/BackoffTimerHelper.cs) |
| **Local `@earendil-works/*`** (`v1.5.0`, installed in `node_modules`) | `pi-ai` HTTP: `0` default (SDKs forced `maxRetries: 0`); `pi-coding-agent` & `pi-durable` turn retry: `3` (`pi-durable` restart cap `5`) `[measured]` | Turn layer: `min(2s * 2^(a-1), 60s)` → `2s, 4s, 8s` `[measured]` | `pi-ai` `provider-retry`: `-25%..0%`; turn layer (`retry.js`): **none** `[measured]` | Turn layer: `14s` total wait before surfacing error to Cairn `[inferred]` | `pi-ai` throws immediately if `Retry-After > 60s`; turn layer does **not** parse headers, uses regex allow/deny lists (blocks `insufficient_quota`, billing, subscription limits) `[measured]` | `pi-agent-core` does no retries; turn layer skips `aborted`, context overflow (compacted), `400/401/403/404`, and unrecognized errors `[measured]` | Absorbs sub-14s glitches inside a turn; any >14s outage, `Retry-After > 60s`, or workspace/runner failure escapes to Cairn's task layer. `node_modules/.pnpm/@earendil-works+pi-ai@1.5.0/.../dist/utils/retry.js`, `provider-retry.js` |

### Pattern That Fits Cairn — and Why

1. **Two distinct timescales**: `@earendil-works/pi-*` already absorbs sub-14-second provider blips inside an active step `[measured]`/`[inferred]`. Cairn's server-level retry policy only sees failures that survive 14s or occur outside the model call (setup hooks, runner disconnect, quota exhaustion, provider outages).
2. **Error classification before scheduling** (Codex `RetryPolicy`, Buildkite exit-status matching, Claude Code spend-limit vs throttle split): deterministic local/config/environment failures (`permanent`) must never burn retry attempts; rate-limit/quota waits (`rate_limit`) must follow server-supplied timing without burning attempt budgets; real infrastructure outages (`transient`) need hours of resilient backoff rather than giving up in 7 minutes; uncategorized errors (`unknown`) keep a short safety-net window.
3. **Concrete persisted deadline** (Codex `RetryAfter` monotonic deadline, `pi-durable` durable sleep checkpoint): computing jittered `retryNextAt` once when the failure lands and persisting it guarantees the UI countdown and the server sweeper agree to the second and survive server restarts without resetting timers.

---

## 2. One-Page Design: Classified Automatic Task Retries

### Newcomer Perspective

Someone who installed Cairn today and has never heard of builds, steps, or sweepers meets this change in three places:

- **Tasks panel (`任务`)**: active tasks that failed transiently or hit a provider limit show when Cairn will continue (e.g., `17:05 自动重试（第 2 次）` or `额度 14:30 恢复后自动继续`). Tasks that stopped on a permanent problem (missing tool, broken setup script, expired key, unavailable model) appear under attention with the plain-language reason they stopped.
- **Task thread panel**: the header status line and the existing failure marker (`Marker`) explain what happened, whether Cairn will retry (with exact clock time and count, using non-red waiting treatment) or why it stopped (red only when parked), and offer a `立即重试` action whenever retrying is possible.
- **PR status / mail connectors**: transient load or connection errors name their real retry schedule instead of a vague `稍后会自动重试`, with an immediate retry button where applicable.
- **Prerequisites / accounts / payments / keys**: none added. Uses the user's existing providers, Runner, and local SQLite database (`~/.cairn/server/server.db`).
- **Where they get stuck / failure UX**: if a repository's `.agents/setup` hook fails because `corepack` is missing on the Runner, Cairn stops immediately instead of spinning for 7 minutes, tells the user the setup hook failed, lets them inspect the raw output, and lets them click `立即重试` once fixed.

### Why (User Problem & Data)

On `origin/main`, `apps/server/src/services/retry-parking.ts` uses one fixed policy (`3` retries at `1m / 2m / 4m = 7m`, no jitter) `[measured]`:
- A deterministic setup failure (`.agents/setup` exiting 1 on `corepack: command not found`) wastes 3 full re-runs over 7 minutes before parking `[measured]`.
- A 20-minute upstream 503 outage or Runner disconnect exhausts all 3 tries in 7 minutes and permanently parks a task that would have succeeded on its own `[measured]`.
- `quota-wait.ts` clamps `Retry-After` to `30 min` and doubles it on repeated hits, and `applyStepFailure` counts `429` errors against the 3-try budget `[measured]`.
- Five UI surfaces (`thread-pr-panel.tsx`, `tasks-sections.ts`, `takeover-card.tsx`, `api/activity.ts`, `mail-connectors.tsx`) plus `thread-copy.ts` and `side-chat.tsx` either hide the retry time/count behind vague copy (`稍后会自动重试`, `失败了，等自动重试`) or offer no direct immediate-retry action `[measured]`.

### Scenario Table

| User Scenario | What the User Sees | What Cairn Does | Wait & Cost |
|---|---|---|---|
| `.agents/setup` exits 1 (`corepack: command not found`) or auth/config/model fails | Parked at once; row and thread show plain stop reason (e.g., `工作区初始化脚本失败，已停止自动重试`), raw output behind `查看原始错误`, plus `立即重试` | Classifies `permanent`; parks on 1st failure (`retryNextAt = null`), notifies Coordinator once, blocks auto-retry/sweeps | `0s` wasted wait; `0` extra runs |
| Upstream `502/503`, timeout, stream drop, or Runner disconnect | Row & thread show exact clock time and attempt (`17:05 自动重试（第 2 次）`) with waiting treatment, plus `立即重试` | Classifies `transient`; schedules `retryNextAt = now + jitter(min(60s * 2^attempt, 30m))` across a `6h` window (`-20%..0%` jitter, capped at `30m`), parks only when `6h` elapses (or 20 tries) | Up to `6h` resilient window; ~15 retries max |
| Provider `429`/`529`/quota with `Retry-After` or reset time (e.g. `14:30`) | Row, thread, and quota banner show `额度 14:30 恢复后自动继续` (or `限流 14:30 恢复后自动继续`) plus `立即重试` | Classifies `rate_limit`; waits until provider `Retry-After` / reset time (up to `24h` cap; fallback `1m→30m` doubling if none given); **does not increment `retryAttempt`** | Waits for reset; `0` retry budget consumed |
| Unrecognized error (e.g. `TypeError: boom`) | Shows `17:01 自动重试（第 1 次）`, up to 3 retries within `15m`, then parks saying retries exhausted | Classifies `unknown`; short window (`3` retries, `15m` total window, `60s * 2^n` cap `4m` with `-20%..0%` jitter), then parks | `~7–15m` max; at most `3` automatic retries |
| User clicks `立即重试` while waiting to retry, parked, or in quota wait | Task moves back to `排队中` / `运行中` immediately | Calls `POST /api/builds/:id/retry-now`: restarts failed build as `origin: 'person'` (fresh episode, `retryAttempt = 0`) or releases `waiting_quota`/`holdReason='quota'` step immediately to `pending` and wakes Runner | Immediate (`<1s`); resets episode budget |

### Final Policy Constants

| Class | Base | Cap | Jitter | Total Window | Attempt Cap | Counts Against `retryAttempt` |
|---|---|---|---|---|---|---|
| `permanent` | — | — | — | `0` | `0` | N/A (parks immediately) |
| `transient` | `60s` | `30m` (`1_800_000ms`) | `-20%..0%` (`[0.8, 1.0]`, never exceeds cap) | `6h` (`21_600_000ms`) | `20` (safety ceiling) | Yes |
| `rate_limit` | Provider `Retry-After` / reset; fallback `60s` | `24h` for provider time; `30m` for fallback | None on provider time; `-10%..0%` (`[0.9, 1.0]`) on fallback | `24h` (`86_400_000ms`) | Unbounded within `24h` | **No** |
| `unknown` | `60s` | `4m` (`240_000ms`) | `-20%..0%` (`[0.8, 1.0]`, never exceeds cap) | `15m` (`900_000ms`) | `3` | Yes |

### Persisted State & Schema

New nullable columns on `build` (`apps/server/src/db/schema.ts`, migration `0250_retry_policy.sql`):
- `retryClass`: `'permanent' | 'transient' | 'rate_limit' | 'unknown' | null`
- `retryNextAt`: `integer | null` (epoch ms when the next automatic retry is due)
- `retryWindowStartedAt`: `integer | null` (epoch ms of the first failure in the current retry episode; carried across automatic retry builds, cleared on person restart or resume from parked)
- `retryParkReason`: `text | null` (closed reason code: `setup_hook | missing_tool | auth | config | model_unavailable | runtime_outdated | gate_rejection | branch_divergence | window_exhausted | retries_exhausted | rate_limit_exhausted | breaker | parked`)

Wire projection on `TodoRecord` (`packages/shared/src/records/todo.ts`):
- Optional `retry?: TodoRetryState | null`:
  - `{ state: 'scheduled', failureClass: 'transient' | 'rate_limit' | 'unknown', reasonCode, attempt, maxAttempts, nextRetryAt, windowEndsAt }`
  - `{ state: 'parked', failureClass, reasonCode, attemptsMade, detail }`
- On `MailAccountRecord` (`packages/shared/src/mail.ts`): optional `nextRetryAt?: number | null`, `retryAttempt?: number`.

### State Machine & Transitions

```text
[running (queued/planning/building)]
  |-- step fails with quotaBlock / waiting_quota (machine-finish-step.ts) --> [waiting_quota]
  |      |-- now >= quotaBlock.probeAt (sweepQuotaWaitSteps) --> [pending] (retryAttempt unchanged)
  |      |-- POST /api/builds/:id/retry-now ------------------> [pending] (quotaBlock cleared, machineHub.wake)
  |      +-- POST /api/builds/:id/stop -----------------------> [stopped]
  |
  |-- step fails (applyStepFailure / sweepStalledRunningTodos) --> classifyRetryFailure(error, now)
         |-- permanent ---------------------------------------> [failed: parked]
         |      (retryClass='permanent', retryNextAt=null, retryParkReason=code,
         |       errorMessage='Task parked: ...', Coordinator notified once, owner='coordinator')
         |
         |-- rate_limit & elapsed < 24h ----------------------> [failed: scheduled (rate_limit)]
         |      (retryClass='rate_limit', retryNextAt=resetAt ?? now+delay, retryWindowStartedAt kept, owner=null)
         |-- rate_limit & elapsed >= 24h ---------------------> [failed: parked (rate_limit_exhausted)]
         |
         |-- transient & elapsed < 6h & attempt < 20 ---------> [failed: scheduled (transient)]
         |      (retryClass='transient', retryNextAt=now+jitteredBackoff, retryWindowStartedAt kept, owner=null)
         |-- transient & (elapsed >= 6h || attempt >= 20) ----> [failed: parked (window_exhausted)]
         |
         |-- unknown & attempt < 3 & elapsed < 15m -----------> [failed: scheduled (unknown)]
         |      (retryClass='unknown', retryNextAt=now+jitteredBackoff, retryWindowStartedAt kept, owner=null)
         +-- unknown & (attempt >= 3 || elapsed >= 15m) ------> [failed: parked (retries_exhausted)]

[failed: scheduled]
  |-- now >= retryNextAt (sweepFailedRetries) ----------------> [queued]
  |      (new/reused build; retryAttempt = class==='rate_limit' ? prev : prev+1; retryWindowStartedAt carried)
  |-- POST /api/builds/:id/retry-now (person) ----------------> [queued] (retryAttempt=0, retryWindowStartedAt=null)
  |-- non-retry rolling-hour breaker (>3 non-retry fails/1h) -> [failed: parked (breaker)]

[failed: parked]
  |-- automatic retry / chief start / steer (human=false) ----> 409 Conflict (blocked)
  |-- person restart / retry-now / Coordinator resume --------> [queued] (retryAttempt=0, retryWindowStartedAt=null)
  +-- runtime-holds.ts (satisfying runtime version reported) -> [queued] (retryAttempt=0, retryWindowStartedAt=null)
```

### Every Reader and Writer of Retry State

| Module | Role | Exact Fields Read / Written |
|---|---|---|
| `packages/shared/src/task-failure.ts` | Classifier | Pure `classifyRetryFailure(error, now)`, `parseRetryDelayMs(error, now)`, `parseQuotaResetAt(error, now)`; closed `RetryFailureClass` & `RetryReasonCode` enums |
| `apps/server/src/services/retry-parking.ts` | Core policy | Reads `build.{errorMessage, retryAttempt, retryClass, retryNextAt, retryWindowStartedAt, retryParkReason}`, `todo.{phase, phaseAt, latestBuildId}`; writes retry schedule (`scheduleOrParkFailedBuild`) and parked fields (`parkFailedBuild`); exposes `todoRetryStateOf`, `automaticRetryOwed`, `automaticRetryDueAt`, `assertAutomaticRetryAllowed`, `retryIsParked`, `failureNeedsHuman` |
| `apps/server/src/services/build-step-failure.ts` | Failure writer | Calls `scheduleOrParkFailedBuild(deps, buildRow.id)` after recording `errorMessage` and failing step; `settleParkedStep` preserves parked state against late sibling completions |
| `apps/server/src/services/build-stalled-sweep.ts` | Stalled-run writer | Sets `errorMessage = STALLED_RUN_MESSAGE`, calls `scheduleOrParkFailedBuild`, transitions to `failed` |
| `apps/server/src/services/needs-you.ts` | Sweeper & ownership gate | `sweepFailedRetries` reads `automaticRetryOwed` & `automaticRetryDueAt` (honoring persisted `retryNextAt`), restarts due builds with `origin: 'retry'`; `failureAwaitsAutomaticRetry` delegates to `automaticRetryOwed` |
| `apps/server/src/services/build-restart.ts` | Restart writer | Preserves `retryWindowStartedAt`, skips incrementing `retryAttempt` on `rate_limit`, resets both on `origin === 'person'` or resume from parked; clears `retryClass`/`retryNextAt`/`retryParkReason` on reuse |
| `apps/server/src/services/build-start.ts` | Launch writer | On non-user restart of failed todo, carries `retryWindowStartedAt` and increments `retryAttempt` (unless `rate_limit`); enforces `assertAutomaticRetryAllowed` |
| `apps/server/src/services/build-steer.ts` | Continuation writer | On `human: false` continuation of failed todo, carries `retryWindowStartedAt`, increments `retryAttempt` (unless `rate_limit`), clears retry schedule fields |
| `apps/server/src/services/quota-wait.ts` & `machine-finish-step.ts` | Quota/429 step hold | Honors explicit `retryAfterMs` / parsed `resetAt` up to `24h` without clamping to `30m` or doubling; exposes `retryQuotaWaitNow` for immediate manual retry |
| `apps/server/src/services/builds.ts` & `routes-builds.ts` | API surface | Exposes `POST /api/builds/:id/retry-now` (immediate person retry for failed, parked, or quota-waiting builds) and `enqueueStep` parked guard |
| `apps/server/src/services/todos.ts` & `owner.ts` | Read projection | Projects `TodoRecord.retry` via `todoRetryStateOf` and computes `owner`/`section` from `failureAwaitsAutomaticRetry` |
| `apps/server/src/services/pr-wakes.ts`, `runtime-holds.ts`, `build-step-state.ts` | Consumers | Check `retryIsParked` to keep parked builds idle and allow runtime-update auto-resume |
| `apps/server/src/services/mail-connector.ts` & `mail-accounts.ts` & `routes-mail.ts` | Mail reconnect | Tracks `nextRetryAt` & `retryAttempt` on degraded IMAP runners; exposes immediate reconnect route |
| `apps/web/src/board/*`, `detail/transcript.tsx`, `api/mappers.ts`, `api/activity.ts`, `chief/takeover-card.tsx`, `resources/mail-connectors.tsx` | UI readers | Render exact countdown/clock time + attempt count + stop reason + `立即重试` button across Tasks panel, SideChat header, Failure `Marker`, Quota banner, PR panel, and Mail dialog |

### Failure Behavior & Edge Cases

1. **DB rollback during parking**: `parkFailedBuild` writes `build` retry/park columns, stops unstarted sibling steps, and inserts both task and Coordinator notices inside one SQLite transaction; any failure rolls back all writes so the next call retries cleanly.
2. **Concurrent automatic retry vs person `立即重试`**: `restartFailedBuild` checks current `todo.phase === 'failed'` and `latestBuildId === row.id` inside a SQLite transaction with `claimClientMessage`; the loser gets `409 Conflict` and creates no duplicate step or build.
3. **Server restart mid-backoff**: `retryNextAt` and `retryWindowStartedAt` are persisted on `build`; on restart, `sweepFailedRetries` reads them directly without recomputing jitter or extending the window.
4. **Legacy pre-migration rows**: failed builds with `retryClass = null, retryNextAt = null` fall back to classifying `errorMessage` on read and computing deterministic `phaseAt + delay` so no task stalls after upgrade.
5. **Non-retry vs retry rolling-hour breaker**: the `FAILED_BUILDS_PER_HOUR_LIMIT = 3` breaker counts only non-`retry` failed builds (`triggerSource !== 'retry'`), so a 6-hour transient retry episode is never prematurely parked at minute 7 while runaway schedules or Coordinator loops remain bounded.
6. **Late step completion on a parked build**: `settleParkedStep` continues to preserve the parked `errorMessage` and `retryParkReason` and keeps the task `failed`.

### Code Areas Touched

- Shared: `packages/shared/src/task-failure.ts`, `packages/shared/src/records/todo.ts`, `packages/shared/src/mail.ts`, `packages/shared/test/task-failure.test.ts`, `packages/shared/test/__snapshots__/snapshot.test.ts.snap`
- Server: `apps/server/src/db/schema.ts`, `apps/server/drizzle/0250_retry_policy.sql`, `apps/server/src/services/{retry-parking,build-step-failure,build-restart,build-start,build-steer,build-stalled-sweep,needs-you,quota-wait,machine-finish-step,dispatch-timeouts,todos,builds,mail-connector,mail-accounts}.ts`, `apps/server/src/{routes-builds,routes-mail}.ts`, `apps/server/test/{retry-backoff,needs-you,quota-wait,quota-hold}.test.ts`
- Web: `apps/web/src/board/{tasks-sections,thread-copy,side-chat,tasks-panel,task-row-menu,thread-actions,thread-pr-panel,quota-banner,retry-copy}.ts(x)`, `apps/web/src/components/thread/task-row.tsx`, `apps/web/src/api/{activity,mappers,hooks}.ts`, `apps/web/src/chief/takeover-card.tsx`, `apps/web/src/resources/mail-connectors.tsx`, `apps/web/src/detail/transcript.tsx`, `apps/web/src/i18n/en.ts`, `apps/web/test/`
