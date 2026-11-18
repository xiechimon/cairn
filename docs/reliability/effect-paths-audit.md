# Effect paths: decision commit versus side effect (#2492)

Audit of every server path where a decision is committed to SQLite and a side effect follows outside that transaction. Crash windows are inferred from code order on 2026-11-04, not reproduced; the last column names the only tests that exist. "Lost" means the effect never happens after a kill and nothing re-derives it. "Dup" means it can happen twice on retry or restart.

There is no general outbox. Most effects are inline calls after separate autocommit statements. `chief-tools.ts`, `todos.ts`, `notifications.ts` and `machine-finish-step.ts` contain no `db.transaction`. The transactions that exist: `sendBuildSteer`, `chief.ts` composer send and answer, `local-merge.ts`, `autonomous-merge.ts`.

## Paths

| # | Path | Decision commit | Effect | One transaction? | Kill between decision and act | Kill between act and mark-done | Kill test |
|---|---|---|---|---|---|---|---|
| 1 | Coordinator `run_builds` (`startBuilds`) | `builds.ts` build insert, `enqueueStep`, `setTodoPhase`; `addChiefWatch` in `chief-tools.ts` | `machineHub.wake`, phase fan-out (row 4), chief watch | Yes (fixed) | Per-todo transaction covers build+step+phase+wake signal; a retried `run_builds` hits `assertPhaseTransition` (409, no dup build). `addChiefWatch` runs inside the `create_todo` transaction | n/a | `build-start` crash tests |
| 2 | Coordinator `confirm_builds` (`applyBuildConfirm`) | `setTodoPhase(building)` | `enqueueStep(build)` | Yes (fixed) | The whole confirm segment (phase, step, wake) runs in one transaction — no committed phase without its step | n/a | `build-confirm` crash tests |
| 3 | Step finish (`completeStep`) | step set to `done` | `setTodoPhase`, `maybeEnqueueVerifyStep`, `maybeEnqueueIndependentReview` | Yes (fixed) | `completeStep` settles step, phase, notifications and wakes in one transaction | n/a | `build-atomicity` tests |
| 4 | Phase fan-out (`notifyPhaseEntry`) | todo phase update | in-app notification, `triggerChiefWakes`, push | Yes (fixed) | `setTodoPhase` wraps the phase update and `notifyPhaseEntry` fan-out in one transaction; push is on the `web-push` ledger (row 14) | The notification upsert is idempotent | `todo-atomicity` tests |
| 5 | `set_wake` (`fireDueChiefWakes`) | wake removed from `chief.wakes` | `enqueueChiefStep` | Yes (fixed) | Wake delete and step enqueue commit in one transaction | n/a | `chief-wake-atomic.test.ts` |
| 6 | `notify_user` | `insertChiefMessageOnce` with a deterministic `notice-<hash>` id | `publishMessage`, `notifyChiefMessage` | Yes (fixed) | A retry hits the dedupe, reloads the stored card, republishes it and re-emits the notification — one card, repeated delivery | Report acknowledgements keep `reportNoticeId`; `imNotice` replay is deduped by the `im-send` effect key | `chief-quiet-1784.test.ts` |
| 7 | `ask_user` (`createOrGetQuestion`) | `writeQuestion` | `notifyChiefMessage`, push | Yes (fixed) | A retry reads the existing question and now re-runs `announceQuestion` (notify upsert + publish + deduped push) in both the tool path and the blocking relay path | notify upsert is idempotent; push deduped by the `web-push` effect key | `chief-quiet-1784.test.ts` |
| 8 | `message_todo` and user thread message (`sendBuildSteer`) | one transaction: message, `steerPending`, phase, step, ledger | `steerSignal`, `wake` (inside the transaction) | Yes | Safe for state; the signal is a hint. Inverse hazard: a rollback after `setTodoPhase` leaves already-sent push and hub publishes (phantom) | With `clientMessageId` the retry replays; the tool path passes no id, so a re-call re-steers (dup) | #2501 tests |
| 9 | Coordinator composer send | one transaction: ledger, message, `enqueueChiefStep` | `wake` inside; steer after commit | Yes | Safe; a lost wake is only latency (long-poll) | Ledger-guarded | #2501 tests |
| 10 | Chief steer while a turn runs | `steerPending` upsert plus hold | `steerSignal` | Yes (fixed) | `sentAt` hold plus fenced ack-delete; the daemon re-fetches on reconnect and a stale send re-derives the `steer_sent` batch (`docs/design/durable-steer-stop.md`) | At-least-once: a lost ack can re-inject a batch | `chief-queue-steer-stop.test.ts`, `machine-steer.test.ts` |
| 11 | Worker steer fetch (`fetchSteer`) | `steerPending` held until acked (`sentAt` marker) | daemon `live.steer` | Yes (fixed) | Row consumed before delivery: a daemon death in between loses the text — now held until `steerSentAt` ack; stale sends redeliver | At-least-once: merged content may repeat a delivered line after a lost ack | `steer.test.ts`, `machine-steer.test.ts` |
| 12 | Stop and cancel | `stopPending` held until the target step dies | `stopSignal` | Yes (fixed) | SSE only: the stop waits until the step ends — now the daemon re-fetches on reconnect and dedups repeat `discard` per step | None | `stop.test.ts`, `machine-steer.test.ts` |
| 13 | In-app notification | the upsert is the effect (keyed `userId:entityId`) | `publishNotification` (in memory) | Yes | The durable upsert is the effect itself; a lost in-memory publish re-derives on reload. Caller-side crash windows are the fixed rows 4/6/7 | Replay re-marks it unread | None |
| 14 | Plain web push (`pushToUserSafely`) | `external_effect` `web-push` row keyed by `userId:tag` | fenced `runEffectRow` send | Yes (fixed) | Lost on any kill — now durable intent; `drainEffects` recovers pending/stale-claimed rows | Deduped by tag; user-channel absence (`no-subscription`, `all-expired`) does not count as provider failure | `push-outcomes.test.ts` |
| 15 | Review push marker (`thread-push.ts`) | `pushDelivery` pending then claimed | push | Yes | Same pending-claim-send mechanism as row 16: the marker is durable and `sweepPendingPushAlerts` recovers stale `sending`/pending rows (the audit's `thread-push.ts` name is stale; the mechanism lives in `push-alerts.ts`/`push.ts`) | The claim precedes the send: at most once | `push-outcomes.test.ts` |
| 16 | Must-reach alert (`sendMustReachAlert`) | `pushDelivery` `alertStatus=pending` | web push then SMTP fallback | No | Durable; `sweepPendingPushAlerts` recovers every tick | Compare-and-swap claim; at-least-once email after the stale window | `push-outcomes.test.ts` |
| 17 | Daily report push | n/a | n/a | n/a | Daily report push was retired (`daily-report-retirement` migration; no sender remains in `apps/server/src`) | n/a | n/a |
| 18 | Push digest | `pushDigestItem` insert | daily batched push | No | Items deleted only after delivery: at least once; no producer found | Dup if delivered and killed before the delete | Mixed results |
| 19 | Feishu | none | none | n/a | The server holds binding CRUD only; no outbound sender found in `apps/` or `packages/` | n/a | n/a |
| 20 | GitHub merge (`mergeThroughGithub`) | `claimAutonomousMerge` write-ahead | `githubMergePull` with `sha` pin, settle, `finishTodoDone` | Claim atomic with its marker | Admission stays `pending`; `recoverAutonomousMerges` reads the PR (not lost) | The `sha` pin makes a double PUT harmless | `autonomous-merge.test.ts` |
| 21 | Self-issue create | `external_effect` `github-issue-create` row plus todo `sourceRef` | probe (`GET` issue by marker) then `githubCreateIssue`, then `sourceRef` update | Yes (fixed) | Durable intent with replay-safe probe: a crash after POST re-probes by the body marker before deciding | Marker match on body makes a re-created issue dedupe-safe | `external-effects.test.ts`, `github-writeback.test.ts` |
| 22 | Other issue create and close | `taskIssueClose` tombstone rows; intake re-derives from GitHub | GitHub PATCH or POST | Yes | Moved-todo close writes a durable `taskIssueClose` row the sync sweep consumes; intake close re-derives each sweep | Mismatch issue body carries a dedupe marker; `ci-corrections` checks first (safe) | `task-issue-sync` tests |
| 23 | PR creation and comments | n/a | n/a | n/a | Neither side creates PRs in orchestration code: the agent runs `gh` inside its own session, and daemon push/merge outcomes re-derive from git refs (the same replay-safe probe as rows 20 and 24) | n/a | n/a |
| 24 | Local merge | one transaction: claim, restore, enqueue | daemon git merge, then `applyLocalMergeReport` | Claim yes | Safe | The git merge precedes the server record: a kill loses the notice and wake; a re-report is a no-op | Title only |
| 25 | Schedule fire | `nextRunAt` advanced last | `startBuilds` or `sendBuildSteer` first | No (act, then mark) | n/a | Re-fires on restart; the active-step guard skips it while the first step is live | None |
| 26 | PR feedback delivery | one transaction: message, steer or enqueue, `dispatchedId` | signal inside | Yes | Safe | The marker makes a replay a no-op (the pattern to copy) | Not located |
| 27 | Abandoned and stale claim reclaim | step set to `pending` | `machineHub.wake` | No | A lost wake is latency only | A re-run chief turn re-invokes tools (rows 1, 6) | Sweep tests |

## Existing outbox-like structures

None is general: `pushDelivery` (must-reach alerts, drained every tick), `pushDigestItem`, `autonomousMergeAdmission` (write-ahead with reconciler), `queuedMessage`, `steerPending` and `stopPending` (durable rows, signal-only delivery), the `clientMessage` ledger from #2501 (user sends only), `chiefReport` (per-report retry), `schedule.retryNotBefore`.

## Per-kind failure counting

None for effects. Nearest: the in-memory `ProviderHealthTracker` (degraded after 3, open after 5; resets on restart), `step.holdCount`, `chiefReport.attempts`. Several effect failures are swallowed with no count: `dispatchSplitChildren` and `advanceSplitWaves` (`catch {}`), push errors, moved-todo close.

## Ranked by plausibility and user impact — resolution record

1. ~~Phase fan-out (rows 3, 4)~~ Done: `setTodoPhase` commits the phase and `notifyPhaseEntry` in one transaction; push rides the `web-push` ledger.
2. ~~Two-step state hops (rows 2, 3)~~ Done: `applyBuildConfirm` and `completeStep` each settle in one transaction.
3. ~~Deleted-before-enqueued wakes and one-shot notifications (rows 5, 7)~~ Done: wake delete + enqueue in one transaction; `ask_user` retries re-run `announceQuestion`.
4. ~~Duplicate Coordinator tool effects (rows 1, 6, 8)~~ Done: per-todo build transaction + `assertPhaseTransition` retry guard; `notify_user` deterministic `notice-<hash>` id; `clientMessageId` accepted on the MCP message paths.
5. ~~Signal-only steer and stop (rows 10 to 12)~~ Done: `docs/design/durable-steer-stop.md`.

## Not verified

Daemon behavior on repeated claim after a lost wake, and `ci-loop.ts` reconcile in full. Two earlier entries resolved: `apps/coordinator` does not exist (the coordinator runtime is `apps/server/src/coordinator/`, whose tool paths are rows 1, 2, 6, 7 and 8), and `queuePushDigest`'s only producer is `mail.ts` (row 18's at-least-once digest).

## Fix slices (one problem per PR)

1. ~~`effect` outbox table, after-commit executor, sweeper and per-kind failure counter~~ Done: `external_effect` ledger (`docs/design/external-effects-ledger.md`), `im-send`, `web-push` and `github-issue-create` wired; a kind is reported after three consecutive failures and `no-subscription`/`all-expired` do not count.
2. ~~Atomic hops~~ Done: rows 2, 3, 4, 5 and 7.
3. ~~Idempotency keys for Coordinator tool effects~~ Done: rows 1, 6 and 8 (MCP `clientMessageId`).
4. ~~Durable steer and stop re-fetch (rows 10 to 12)~~ Done: `docs/design/durable-steer-stop.md`.
