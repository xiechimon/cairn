# Effect paths: decision commit versus side effect (#2492)

Audit of every server path where a decision is committed to SQLite and a side effect follows outside that transaction. Crash windows are inferred from code order on 2026-11-04, not reproduced; the last column names the only tests that exist. "Lost" means the effect never happens after a kill and nothing re-derives it. "Dup" means it can happen twice on retry or restart.

There is no general outbox. Most effects are inline calls after separate autocommit statements. `chief-tools.ts`, `todos.ts`, `notifications.ts` and `machine-finish-step.ts` contain no `db.transaction`. The transactions that exist: `sendBuildSteer`, `chief.ts` composer send and answer, `local-merge.ts`, `pr-feedback.ts`, `chief-report.ts`, `autonomous-merge.ts`.

## Paths

| # | Path | Decision commit | Effect | One transaction? | Kill between decision and act | Kill between act and mark-done | Kill test |
|---|---|---|---|---|---|---|---|
| 1 | Coordinator `run_builds` (`startBuilds`) | `builds.ts` build insert, `enqueueStep`, `setTodoPhase`; `addChiefWatch` in `chief-tools.ts` | `machineHub.wake`, phase fan-out (row 4), chief watch | No | Build row and pending step exist while the todo is still `todo`: a retried `run_builds` starts a second build (dup). Kill after `setTodoPhase` before `addChiefWatch`: the chief never gets the settle wake (lost) | No mark | None |
| 2 | Coordinator `confirm_builds` (`applyBuildConfirm`) | `setTodoPhase(building)` | `enqueueStep(build)` | No | Phase `building` with no step (lost). The retry cannot repair it: the 409 is swallowed as success in `chief-tools.ts`, and `sweepPlanAutoConfirm` only looks at `confirm` | n/a | None |
| 3 | Step finish (`completeStep`) | step set to `done` | `setTodoPhase`, `maybeEnqueueVerifyStep`, `maybeEnqueueIndependentReview` | No | Step `done`, todo still `planning` or `building`, no notification, no chief wake (lost); the daemon re-report is a no-op once the step is not `claimed` | n/a | None |
| 4 | Phase fan-out (`notifyPhaseEntry`) | todo phase update | in-app notification, `triggerChiefWakes`, push | No | All three lost, nothing re-derives them; a stalled chief wake stalls autonomous gating | A replay adds a second chief step and report row (dup); the notification upsert is idempotent | None |
| 5 | `set_wake` (`fireDueChiefWakes`) | wake removed from `chief.wakes` | `enqueueChiefStep` | No | The wake is deleted before the step is enqueued: "check back at 3pm" is lost | n/a | Happy path only |
| 6 | `notify_user` | `upsertChiefMessage` with a fresh id | `publishMessage`, `notifyChiefMessage` | No | Card row exists, notification lost | A re-run turn writes a second card (dup) | Provenance rejection only |
| 7 | `ask_user` (`createOrGetQuestion`) | `writeQuestion` | `notifyChiefMessage`, push | No | A retry reads the existing question, returns `created:false` and skips notify and push: lost permanently | n/a | None |
| 8 | `message_todo` and user thread message (`sendBuildSteer`) | one transaction: message, `steerPending`, phase, step, ledger | `steerSignal`, `wake` (inside the transaction) | Yes | Safe for state; the signal is a hint. Inverse hazard: a rollback after `setTodoPhase` leaves already-sent push and hub publishes (phantom) | With `clientMessageId` the retry replays; the tool path passes no id, so a re-call re-steers (dup) | #2501 tests |
| 9 | Coordinator composer send | one transaction: ledger, message, `enqueueChiefStep` | `wake` inside; steer after commit | Yes | Safe; a lost wake is only latency (long-poll) | Ledger-guarded | #2501 tests |
| 10 | Chief steer while a turn runs | `steerPending` upsert plus hold | `steerSignal` | No | Delivery is SSE-event only and nothing re-fetches on reconnect, so the message waits until the turn ends (delayed, not lost) | `steer_sent` hold plus ack makes it recoverable | None |
| 11 | Worker steer fetch (`fetchSteer`) | `steerPending` deleted at fetch | daemon `live.steer` | No | Row consumed before delivery: a daemon death in between loses the text (lost) | n/a | None |
| 12 | Stop and cancel | `stopPending` upsert | `stopSignal` | No | SSE only: the stop waits until the step ends; chief turns self-heal via the overlong sweep, worker steps never re-signal | n/a | None |
| 13 | In-app notification | the upsert is the effect (keyed `userId:entityId`) | `publishNotification` (in memory) | No | Lost if callers 4, 6, 7 die first; a lost publish shows on reload | Replay re-marks it unread | None |
| 14 | Plain web push (`pushToUserSafely`) | none | fire-and-forget send | No | Lost on any kill or send failure; failures only reach stderr | n/a | Send outcomes only |
| 15 | Review push marker (`thread-push.ts`) | `pushDelivery` `review-pending` then claimed `review-notified` | push | No | The pending marker is durable but depends on a later gate evaluation | The claim precedes the send: at most once | Not read |
| 16 | Must-reach alert (`sendMustReachAlert`) | `pushDelivery` `alertStatus=pending` | web push then SMTP fallback | No | Durable; `sweepPendingPushAlerts` recovers every tick | Compare-and-swap claim; at-least-once email after the stale window | `push-outcomes.test.ts` |
| 17 | Daily report push | `pushedAt` set inside the transaction | push closure after commit | Decision yes, effect after | Lost on a kill after commit (at most once) | n/a | `pushedAt` only |
| 18 | Push digest | `pushDigestItem` insert | daily batched push | No | Items deleted only after delivery: at least once; no producer found | Dup if delivered and killed before the delete | Mixed results |
| 19 | Feishu | none | none | n/a | The server holds binding CRUD only; no outbound sender found in `apps/` or `packages/` | n/a | n/a |
| 20 | GitHub merge (`mergeThroughGithub`) | `claimAutonomousMerge` write-ahead | `githubMergePull` with `sha` pin, settle, `finishTodoDone` | Claim atomic with its marker | Admission stays `pending`; `recoverAutonomousMerges` reads the PR (not lost) | The `sha` pin makes a double PUT harmless | `autonomous-merge.test.ts` |
| 21 | Self-issue create | todo with `sourceRef=null` | `githubCreateIssue`, then `sourceRef` update | No | Fire-and-forget: only the manual retry route recovers (lost until a click) | Issue created but `sourceRef` unsaved: a retry creates a second issue (dup) | None |
| 22 | Other issue create and close | moved-todo close; intake close; mismatch issue; `ci-corrections` | GitHub PATCH or POST | No | Intake close re-derives from GitHub each sweep; moved-todo close is one-shot (lost) | Mismatch issue precedes its marker (dup possible, body carries a dedupe marker); `ci-corrections` checks first (safe) | None |
| 23 | PR creation and comments | n/a | n/a | n/a | The server never creates PRs or comments; the daemon side was not audited | n/a | n/a |
| 24 | Local merge | one transaction: claim, restore, enqueue | daemon git merge, then `applyLocalMergeReport` | Claim yes | Safe | The git merge precedes the server record: a kill loses the notice and wake; a re-report is a no-op | Title only |
| 25 | Schedule fire | `nextRunAt` advanced last | `startBuilds` or `sendBuildSteer` first | No (act, then mark) | n/a | Re-fires on restart; the active-step guard skips it while the first step is live | None |
| 26 | PR feedback delivery | one transaction: message, steer or enqueue, `dispatchedId` | signal inside | Yes | Safe | The marker makes a replay a no-op (the pattern to copy) | Not located |
| 27 | Abandoned and stale claim reclaim | step set to `pending` | `machineHub.wake` | No | A lost wake is latency only | A re-run chief turn re-invokes tools (rows 1, 6) | Sweep tests |

## Existing outbox-like structures

None is general: `pushDelivery` (must-reach alerts, drained every tick), `pushDigestItem`, `autonomousMergeAdmission` (write-ahead with reconciler), `queuedMessage`, `steerPending` and `stopPending` (durable rows, signal-only delivery), the `clientMessage` ledger from #2501 (user sends only), `chiefReport` (per-report retry), `schedule.retryNotBefore`.

## Per-kind failure counting

None for effects. Nearest: the in-memory `ProviderHealthTracker` (degraded after 3, open after 5; resets on restart), `step.holdCount`, `chiefReport.attempts`. Several effect failures are swallowed with no count: `dispatchSplitChildren` and `advanceSplitWaves` (`catch {}`), push errors, moved-todo close.

## Ranked by plausibility and user impact

1. Phase fan-out (rows 3, 4): hot path, every phase change; a kill stalls the autonomous pipeline silently.
2. Two-step state hops with no transaction and no sweeper (rows 2, 3).
3. Deleted-before-enqueued wakes and one-shot notifications (rows 5, 7): silent permanent loss of something promised.
4. Duplicate Coordinator tool effects when an abandoned chief step is re-pended (rows 1, 6, 8 tool path): no idempotency key on mutating tools.
5. Signal-only steer and stop, worker steer consumed at fetch (rows 10 to 12).

## Not verified

Whether any sweeper repairs "step done but phase not advanced" or "building with no step" (none found); daemon behavior on repeated claim after a lost wake; `ci-loop.ts` reconcile in full; `apps/coordinator`; whether `queuePushDigest` has a producer outside `apps/server/src`.

## Fix slices (one problem per PR)

1. `effect` outbox table, after-commit executor, sweeper and per-kind failure counter (reports a kind only after three consecutive failures); first adopter: phase fan-out (rows 3, 4) with kill-between tests.
2. Atomic hops: rows 5 and 7 (`chief.ts`, `chief-questions.ts`), then rows 2 and 3 in `builds.ts` once the routing-rules build-flow work no longer owns that file.
3. Idempotency keys for Coordinator tool effects (rows 1, 6, 8) after the Coordinator tool changes land.
4. Durable steer and stop re-fetch (rows 10 to 12).
