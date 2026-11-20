# Automatic retry: backoff and a total attempt cap

Status: step 5 of the task state machine rebuild (`todo-state-machine.md`, steps 1–3 landed as `fa9b55cbc`, `ae6e595fc`, `8d401472e`). Prior art: Orca's dispatch circuit breaker stops after 3 failed starts per retry chain and only the user reopens (`docs/research/orca-execution-model-2026-11-09.md`); Temporal retries unboundedly with exponential backoff, which is what the 2026-11-18 backup showed Cairn doing — task #111 accumulated 1,890 builds on the same model-404 before `retry-parking.ts` existed.

## Who meets it

You run a task and the run dies on something transient — a dropped connection, a provider 500, a crashed session. Today the scheduler's next tick (seconds later) quietly starts a new run; if that also fails, the task sits failed until you or the Coordinator does something. There is no wait between tries and no total ceiling on the software-initiated ones.

After this change the failed task retries on a schedule instead of instantly: about a minute for the first retry, then longer each time, up to 3 automatic retries per failure episode. The task card stays in its failed column while a retry is pending — no notification yet, since the system still owns it. If the last retry fails too, the task shows **Task parked: automatic retries exhausted (3)** with the original error, a system message lands in the task thread, the Coordinator is notified once, and the task enters Needs You. Pressing Rerun yourself always works and gives the task a fresh retry budget.

Failures that already name a human fix (missing credentials, gate rejections, a model that does not exist, `Task parked`) are never retried, exactly as today — `model_unavailable` still parks on the first failure.

## The rule

- `AUTOMATIC_RETRY_LIMIT = 3` — at most three automatic retries in one failure episode.
- `AUTOMATIC_RETRY_BASE_MS = 60_000` — retry *k+1* is due `60s · 2^k` after the task entered `failed`: +1 min, +2 min, +4 min. An episode's worst case is ~7 minutes from first failure to parked.
- A **failure episode** is the chain of runs launched while the task sits in `failed`. A run launched by a person (`origin`/`triggerSource`/`human`) or from any other phase starts a new episode at depth 0. A run launched by software (`sweepFailedRetries`, a Coordinator restart or dispatch, a schedule or synthetic steer) on a `failed` task continues the episode at depth +1.

## State

One persisted field, derived deadline:

| Field | Where | Meaning |
|---|---|---|
| `build.retryAttempt` | `build` column, `integer not null default 0` | Episode depth of this run: 0 = first run of an episode, *k* = the *k*-th automatic retry |
| retry deadline | derived, never stored | `todo.phaseAt + retryDelay(build.retryAttempt)`; `phaseAt` is already the moment the task last entered `failed` (written by `setTodoPhase`), so every failure-landing path arms the clock uniformly |

The deadline is derived rather than stored so that every write path that lands a failure — `applyStepFailure`, the stalled-run settle (`build-stalled-sweep.ts`), `settlePrWakeNotices`, `failWithMessage` — is covered by the one thing they already do: `setTodoPhase(failed)`. A stored `retryNotBefore` a path forgot to arm would leave the task failed forever owned by nobody.

Existing rows migrate to `retryAttempt = 0` — one full budget each.

## Reads and writes

**Writers of `retryAttempt`** (every place a run is launched):

- `startBuilds` — `0`, or `failedBuild.retryAttempt + 1` when `triggerSource !== 'user'` and the task is `failed`.
- `restartFailedBuild` — new build: `origin === 'person' ? 0 : row.retryAttempt + 1`; reused build: same assignment on the reused row.
- `sendBuildSteer` — same formula keyed on the resolved `human` flag, both for the same-build new-turn and for the rare new-build continuation.

**Readers:**

- `sweepFailedRetries` (needs-you.ts, every scheduler tick) — retries a `failed` task's latest build only when `automaticRetryOwed` and `now >= dueAt`. `owed` = error does not need a human, no worker question is pending on the build, the build's last step was not schedule-created, and `retryAttempt < LIMIT`.
- `assertAutomaticRetryAllowed` (retry-parking.ts) — the existing non-person gate on `startBuilds`, `applyBuildStepAction`, `sendBuildSteer`, `restartFailedBuild`, unchanged apart from parking: it still throws 409 only for parked failures. Coordinator and schedule launches on a `failed` task stay immediate — they are deliberate one-shot actions that consume the same episode budget (`retryAttempt + 1`), not a loop; delaying them would refuse real journeys like a Coordinator message landing on a failed thread (caught by `board-trio-e2e`). Only the sweep, the actual retry loop, is held to the deadline.
- `parkFailedBuild` — additionally parks when `retryAttempt >= AUTOMATIC_RETRY_LIMIT`, with reason `Task parked: automatic retries exhausted (3). Last error: …`. The existing triggers are unchanged: `model_unavailable` parks at once; more than 3 failed builds in a rolling hour parks — that bound covers velocity across episodes (e.g. a person re-running by hand), which the per-episode cap cannot see.
- `failureAwaitsAutomaticRetry` (owner.ts via needs-you.ts) — a task awaiting retry, due or not yet due, is still the system's: the Coordinator is not woken and the task does not enter Needs You. At the cap the park lands it there instead.
- `owedAutomaticRetry`'s `prevPhase !== 'failed'` clause is deleted — `retryAttempt` replaces it as the episode counter (this is what allows retries 2 and 3).

## Behavior on each failure

| Failure lands | Effect |
|---|---|
| Retryable error, `retryAttempt < 3` | Deadline armed; sweep launches retry *k+1* once due; task stays `failed`, owner-less until then |
| `retryAttempt = 3` fails | `parkFailedBuild` rewrites the error to the parked reason, stops unstarted steps, posts the task thread message and the single Coordinator notice |
| Needs-human error, scheduled-continuation failure | No retry owed (unchanged); the Coordinator still owns the failure |
| Software launch while a retry is pending-not-due | Allowed — it is the episode continuing; `retryAttempt + 1` is consumed, and the cap still bounds the chain |
| Person rerun/steer at any time | Allowed (parked tasks too, once active steps settle); new run at `retryAttempt = 0` |
| Retry launches | A system row `Automatic retry k/3` lands in the build thread so the transcript shows the gap |
| Build reused for the retry | `retryAttempt` increments on that row; a new build carries `parent.retryAttempt + 1` |

Out of scope, already bounded elsewhere: in-step retries (daemon `step-pass-retry.ts` network delays, `planModelFallback`'s tried-list, the single zero-usage requeue, `CI_FIX_ROUNDS_MAX`), quota/capacity `waiting_quota` holds (step 4), `schedule.retryNotBefore` (schedule firing).

## Tests — one per path

`apps/server/test/retry-backoff.test.ts` fails on the pre-change code:

1. A transient failure is **not** retried on the next tick; it becomes queued only after `phaseAt` ages past 60 s.
2. The wait doubles: after the first retry fails, the second waits ~120 s.
3. After the third retry fails, the next sweep parks with `automatic retries exhausted` + Coordinator notice + `owner = coordinator`.
4. Failures spaced more than an hour apart still park at the cap — the #111 hole the rolling-hour rule misses.
5. `startBuilds` (`chief`), coordinator `applyBuildStepAction`, and non-human `sendBuildSteer` stay immediate during the window and each consume one unit of the episode budget, ending parked at the cap.
6. The counter: sweep retry produces `retryAttempt 1`; a person restart produces `0`.
7. The stalled-run settle (`build-stalled-sweep.ts`) arms the same clock — it no longer retries on the spot.

Existing tests re-baselined to the policy: the immediate-retry expectations in `needs-you.test.ts` (`a transient failure is retried once`, `the scheduler tick retries a transient failure`, `a second failure after the automatic retry stays failed`) and `thread-schedule-tool.test.ts` age `phaseAt` before sweeping; `a second failure…` now asserts the second failure schedules retry 2 rather than ending the episode.
