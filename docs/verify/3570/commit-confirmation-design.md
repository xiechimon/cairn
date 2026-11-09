# Commit-confirmed user-message publication

Coordinator authorization: one additional fix for PRRT_kwDOUSKs6c61U0n6 and #3696. Bug class: transaction/publication atomicity. The existing client cache remains an authoritative-confirmation cache, not an optimistic one. This is a pure bug repair using existing synchronous Drizzle transactions and the existing post-transaction publication pattern in task queue creation and Coordinator routes; no new-mechanism research is needed.

## Transition

Before commit, user transcript rows and queue mutations are provisional. On rollback, the stored message, submission ledger, continuation step and queue mutation roll back together; no user-message event may escape. After commit, publish the delivered row and its existing source queue identity, including forwarding to the source subscription on rollover. The post-transaction result is the confirmation; the client continues to upsert by message id and remove only the correlated capsule.

In `sendBuildSteer` and transactional restart branches, supply an explicit `afterCommit` effect list to transcript insertion, then flush it only after `db.transaction` returns successfully. Preserve the existing row, actor, queue identity and event order in each effect. Scheduled continuations still produce no user row. Replays return before publication and cannot duplicate events. Rollover and restart system rows inserted by the same transaction are deferred with the user row; assistant events and other system publishers are unchanged. This is the effect-list pattern already used by Coordinator reports, not a new transaction/replay library.

## Producer and reader sweep

| Path | Commit/failure behavior | Test |
| --- | --- | --- |
| Running steer and thread-message route | Steer-pending/signal failure rolls back the user row; no confirmation; retry with the same key succeeds once | Server post-insert rollback and retry |
| Idle continuation | Step-enqueue failure rolls back; no user confirmation | Server continuation rollback |
| Manual/automatic/stop queue delivery | Failed delivery keeps the source capsule and ledger; successful retry confirms once | Parameterized queue rollback; existing machine-done completion/stop tests |
| Replacement-build delivery | Source and target receive nothing on rollback; committed retry carries the same destination and source identity | Server rollover rollback; browser/live held-GET regression |
| Failed-build restart, reused/new build | User feedback event waits for the enclosing transaction; failed enqueue produces no user frame | Parameterized restart rollback |
| Review/plan revision | Existing transcript insertion autocommits; there is no enclosing transaction to roll back | Existing revision/idempotency tests; publication-time row visibility assertion |
| Coordinator composer, first thread and shortcut | Existing routes publish only after submitChiefMessage's transaction returns; POST cache callbacks run after response | Coordinator rollback/retry test and existing browser failure matrix |
| Queue creation | Existing publication follows its transaction; failure returns no capsule acknowledgement/event | Queue insertion rollback test |
| Duplicate/replay | No new event on replay; the committed id remains the only cache row | Existing submission-ledger and stream idempotency tests |
| GET delayed/failed | A rejected transaction produces no delivery frame to cache; draft and source capsule remain | Browser/live failure injection with held GET |

Writers: build steering and restart, transcript insertion, task queue creation and Coordinator submission/routes. Transport: ConversationStreamHub retains its existing correlation and rollover forwarding. Readers: startConversationStream/cacheUserMessage and mutation callbacks, unchanged. No daemon or persisted protocol change. Non-delivery invalidations and assistant/system events are not promoted into confirmed user rows.

## Failure limits

The publication itself is not durable replay. A disconnected subscriber reconciles through GET. A response lost after commit remains a committed send and uses the existing same-key replay. The post-commit publisher must not move inside a later transaction during refactoring; tests inspect database state from the publication boundary and inject failures after insertion. Existing unrelated side effects inside transactions are not redesigned here.
