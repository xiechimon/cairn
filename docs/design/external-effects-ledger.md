# External effects ledger

Status: first slice built (`external_effect` + drainer + reconciler in `apps/server/src/services/external-effects.ts`, `im-send`, `away-push`, `mail-send` and `web-push` wired; the `github-issue-create` and `github-issue-title` kinds are retired and settle through a no-network retirement handler in `apps/server/src/services/retired-effects.ts`). Prior art already in this repo: `docs/reliability/effect-paths-audit.md` (#2492) inventories every decision-commit-versus-side-effect path, classifies each kill window as lost or dup, and names fix slice one "an `effect` outbox table, after-commit executor, sweeper and per-kind failure counter". This page is that slice's contract. Scope is assignment-tree work: a Coordinator chief tree that suspends on `ask_user` cards, fans out child todos through `todo.sourceTodo`, and wakes once when children finish (`settleSplitOnDone` in `apps/server/src/services/todos.ts`, `triggerChiefWakes` in `apps/server/src/services/chief.ts`).

## Problem

Nodes in the tree perform outward actions — web push, the SMTP must-reach fallback, IM replies, PR merges, outbound mail. Each rides on its own record with a different restart contract, and the audit's kill windows are real: a fire-and-forget send retries into a duplicate (dup), a plain `pushToUserSafely` is lost on any kill, a `createOrGetQuestion` retry skips notify and push forever (lost). A server crash between "provider accepted" and "local row updated" either resends (at-least-once runners cannot tell delivered from unsent) or silently drops (IM sends live in `origins`, `queueChains`, `seenInbound` maps in `apps/server/src/services/im/core.ts` — memory only, gone on restart). There is no single place that answers "did this effect reach the outside world".

## What the baseline does

| Existing mechanism | Restart contract | Where |
|---|---|---|
| `client_message` | durable dedupe: `claimClientMessage` inserts `onConflictDoNothing`; a conflict replays the stored response; `coalesceClientMessage` shares in-flight calls | `apps/server/src/services/client-message.ts` |
| `push_delivery` | durable row per notification; `alertStatus` `pending → sending → received / fallback-accepted / undelivered`; stale `sending` claims recover via `fallbackClaimedAt`; `sweepPendingPushAlerts` runs at startup and on sweep | `apps/server/src/db/schema.ts:733`, `apps/server/src/services/push-alerts.ts` |
| `due_event` + `createDueRunner` | reserve-before-async (`reserve` pushes `dueAt` forward while a detached handler runs), backoff, at-least-once | `apps/server/src/services/due-events.ts` |
| `computer_call` | `replaySafe` flag; a lost non-replay-safe call is marked `interrupted` when resubmitted | `apps/server/src/services/machine-computer.ts` (`forwardComputerCall`) |
| mail delivery | `deliverMailEvent` moves the event `received → delivered` and inserts the `push_delivery` row in one transaction; the send runs after commit — the queued row is the intent | `apps/server/src/services/mail.ts` |

The step-claim runtime is durable but is not an effects ledger: `claimStep` stamps `step.claimedAt` as the claim generation, the abandoned-step sweep (`build-abandoned-sweep.ts`, `BUILD_ABANDONED_STEP_MS = 120_000`) releases a dead claim to `pending` and fails it after `ABANDONED_CLAIM_QUARANTINE_LIMIT = 3`, and `finishStep` re-checks `(status, machineId, claimedAt)` before applying. Nothing on that path records whether an outward send inside the step already fired.

## Contract

One table `external_effect`, one drainer, one reconciler. An effect is recorded **at intent**, inside the same transaction as the motivating write (the `deliverMailEvent` pattern); the send runs after commit; the provider receipt marks the row `delivered`. Recording "at the moment of effect" is rejected: the moment of effect is exactly the window a crash can interrupt, so the durable record must exist before it.

Row: `id`, `teamId`, `scopeKind` (`todo | build | step | chiefThread | mailEvent | imConnection | team`), `scopeId`, `stepId` and `claimGeneration` (the claiming step's `claimedAt`, provenance only), `kind` (`web-push`, `away-push`, `mail-send`, `im-send`, …), `dedupeKey` (unique; hash of `scopeKind, scopeId, kind, content-digest` — deliberately excluding the claim generation), `payload` (json replay envelope), `state`, `dueAt`, `claimedAt`/`claimFence` (drainer claim, same shape as `step.claimedAt`), `attempts`, `lastError`, `receipt` (provider id/URL), `createdAt`/`updatedAt`.

States: `pending → sending → delivered | failed | interrupted`; `pending → cancelled` when the scope is cancelled or superseded (todo cancelled, build replaced by a newer `latestBuildId`, thread abandoned) — written in the same transaction as that cancellation. `sending → pending` on a retryable failure with backoff; `sending → interrupted` when the drainer claim is stale and the kind is not replay-safe. `interrupted` is terminal: the row is never resent automatically; it surfaces on the scope so a person or the next step sees "attempted, outcome unknown".

Each kind declares a reconcile policy: `probe` (re-read external state to settle delivered-vs-unsent — no shipped kind is a probe kind; [inferred] no uniform provider capability exists, mail/SMTP and IM sends have no post-hoc read), `replay-safe` (an idempotent resend is allowed — web push keyed by its tag), `unsafe` (neither provable nor idempotent — mark `interrupted`, never resend; IM sends and SMTP mail default here [inferred]).

Interaction with the step-claim runtime: the dedupe key is generation-independent, so a step re-claimed after the reaper that submits the identical effect hits the unique index, attaches to the existing row, and replays the stored receipt when it is `delivered` — the crash window cannot produce a second send of the same content for the same scope. `releaseClaimedStep` does not touch scope-level effects; only scope cancellation does. An effect raised inside `finishStep`'s transaction rolls back with it if the generation fence rejects.

In-flight dedupe: `INSERT … ON CONFLICT DO NOTHING`; on conflict, attach to the row — replay `receipt` if `delivered`, or coalesce on a per-key in-process map (the `coalesceClientMessage`/`fallbackInFlight` pattern) so concurrent drainers share one send.

Restart reconciliation: at startup (`index.ts`, beside the IM resume and computer-recovery sweeps) and on the scheduler: drain `pending`; for each stale `sending` apply the kind's policy — probe, requeue as `pending`, or mark `interrupted`; mark `pending` rows `cancelled` when their scope is gone. Daemon-side effects (agent browser and shell writes on machines) stay on the `computer_call` ledger and are out of scope here.

## Paths, failures, and the first test

| Path | Reads or writes | On failure | First test |
|---|---|---|---|
| Motivating transaction (`deliverMailEvent`, `sendMustReachAlert`, sends driven by `enqueueStep`/`enqueueChiefStep`, `autonomousMergeAdmission`) | inserts `external_effect` `pending` with dedupeKey | unique conflict → attach to existing row, replay receipt if `delivered` | two identical intents in one scope produce one row and one send |
| Post-commit drainer | `pending → sending` (claim + fence), calls the provider, writes `delivered` + receipt | provider error → `failed` or back to `pending` with backoff; process dies after claim → stale `sending` | kill after claim, before receipt: row is classified by policy, not resent blind |
| Startup/scheduler reconciler | reads stale `sending`, writes `interrupted`/`pending`/`delivered` (probe) | probe inconclusive → stays `interrupted`; [inferred] probe support varies by provider | stale `sending` mail-send becomes `interrupted`; a stale `sending` web-push is resent once because its tag is the delivery identity |
| `releaseClaimedStep` / quarantine | no write to effects | effects stay `pending` for the scope | a re-claimed step attaches to the pending effect rather than duplicating it |
| Scope cancellation (todo cancel, build supersede, thread abandon) | `pending → cancelled` in the cancelling transaction | `sending`/`delivered` rows are untouched (history) | cancelling a todo cancels its pending web-push effect, keeps the delivered one |
| `interrupted` surfacing | read on scope display / next step prompt | none — read-only | next step on the thread sees the uncertain effect instead of resending |
| `answer-delivery`-style replay reader | reads `delivered` rows by dedupeKey | missing row → normal first send | resubmission after delivered returns the stored receipt without a provider call |

## Second slice: remaining decision-versus-effect gaps

Audit of `db.transaction` and autocommit decision writes on main (2026-11-22). In-memory signals inside a transaction (`machineHub.wake`/`steerSignal`/`stopSignal`, `hub.publish*`, `convHub.publish*`) are hints: a phantom signal on rollback re-derives on the next poll, and transcript/deliverable publishes are deferred past commit by `afterCommit`/`deferSignals`. They are not listed as gaps.

Already durable and consistent, kept on their own ledger (single path, no migration): `push_delivery` (`sendMustReachAlert`, SMTP fallback claim), `pushDigestItem` (delete-after-deliver, tag-deduped digest), `autonomousMergeAdmission` + `sha` pin (`githubMergePull`), `client_message`, `steerPending`/`stopPending`/`queuedMessage` (held-until-ack), `deliverMailEvent`, `coordinatorInput`, `computer_call`, the pr-wakes `capRequest` ledger (write-ahead `pending`, `CAP_MARKER` comment probe before resend), `fireScheduleWebhook` (delivery dedupe in one transaction), `schedule.retryNotBefore`.

Gaps this slice closes:

| Path | Decision commit | Effect | Window |
|---|---|---|---|
| `fireSchedule` (steer path) | `sendBuildSteer` commits step + `step.scheduleId` + wake message in one tx | `schedule.lastRun*` + `nextRunAt` written after return | kill → schedule stays due → refires into a duplicate continuation once the step ends |
| `fireSchedule` (start path) | `startBuilds` commits build + step + phase | `step.scheduleId`, `schedule-wake` message, `lastRun*`, `nextRunAt` all post-commit | kill → refires into a duplicate build; the orphan step is never attributed (`lastRunStatus` never settles) |
| `executeMailSend` (cairn-mail connector) | approval/`journalRow` ledger | `sendSmtpMail` then `journalRow('run')` | kill after SMTP accept → journal shows nothing → an identical re-call sends a second copy |

Design per path:

- **Schedule fire is folded into the act's transaction, not given an `external_effect` row.** The effect (build + step + phase) is itself a set of DB writes; `startBuilds`/`sendBuildSteer` already wrap them in one transaction. `BuildSteerOptions.schedule` and a new `startBuilds` `schedule` option carry `{id, createdBy, at, expected, next, triggered}`; inside that transaction the code now (a) re-checks `schedule.enabled && nextRunAt = expected` (compare-and-swap on the due claim — a concurrent `runScheduleNow` or crash-orphaned mark rolls the whole act back instead of double-firing), (b) writes `step.scheduleId` (+`scheduledBy` on the steer path, matching today's asymmetry — `workerScheduleRunHistory` counts start-path runs via `build.triggerSource`, so `step.scheduledBy` must stay unset there or runs double-count), (c) inserts the `schedule-wake` message, (d) sets `lastRunAt/lastRunStatus/lastRunStepId/nextRunAt`. For `triggered` kinds (webhook/event, which queue one run per delivery) a moved `nextRunAt` is a *newer* claim, not a stolen one: the run still commits but only `lastRun*` is re-marked and the moved `nextRunAt` stands, so each queued delivery gets its run; for once/cron a failed CAS aborts the act. Kill anywhere → all-or-nothing; a due schedule with no fired step is the only post-crash state and refires once.
- **`mail-send` kind (`unsafe`)**: `executeMailSend` records the intent keyed by `(actionId, inputHash(gatedArgs))` once the outbound gate passes, then settles/claims/sends/marks; `journalRow('run')` is written on `delivered`. An identical re-call attaches to the row: `delivered` replays the receipt, stale `sending` settles to `interrupted` on reconcile (SMTP has no probe — never resent blind), and the caller sees a 409 that names the uncertainty instead of a second copy. `journalRow('error')` still accompanies thrown failures.

User-visible permanent failure: `failed`/`interrupted` rows surface through `interruptedEffectsNote` on todo/step scopes; `mail-send` is scoped `chiefThread` and surfaces as the tool-call error the Coordinator reports (`previous send outcome unknown`), plus the `action_journal` error row. Per-kind consecutive-failure stderr reporting already covers all registered kinds.

## Out of scope

Daemon-side effects, a UI for `interrupted` rows beyond the minimal surfacing, and any change to push/IM/mail provider clients beyond the receipt write-back. The `dispatchSplitChildren` per-child `catch` (a failed child stays `todo`; logged, not counted) and the `pushDigestItem` deliver-delete dup window remain on their own mechanisms.

## As built (first slice)

Wired kinds: `im-send` (`unsafe`; also the `PAIRING_REQUESTED`/`PAIRING_APPROVED` notices — dedupe keys `pairing:<sender>`/`paired:<sender>`), `away-push`, `mail-send` (`unsafe`) and `web-push` (`replay-safe` — dedupe `web-push:<userId>:<tag>`; the tag is already the delivery identity).

- `apps/server/src/services/external-effects.ts` owns the row lifecycle: `recordEffect` (intent + dedupe attach), `claimEffect`/`markEffectDelivered`/`markEffectAttempt` (fence-checked), `drainEffects` (per-db serialization), `reconcileEffects`/`settleEffectRow` (stale `sending` policy settle + `scopeGone` cancel), `effectDedupeKey`, and the `retryEffect`/`waitEffect`/`failEffect` outcome helpers. `waitEffect` returns a row to `pending` without burning an attempt — an offline IM session is an unexecuted wait, not a failed send, so queued replies survive overnight connectivity gaps.
- IM turn state that lived in process maps is durable: `im_turn_origin` (step → connection/chat/sender/thread), `im_seen_inbound` (`(connId, messageId)` dedupe, ~500-row retention per connection). A restarted `createImService` still answers the origin chat and still drops replayed inbound messages; `deleteConnection` cancels the connection's pending `im-send` effects in the same call.
- Startup (`index.ts`) and the scheduler tick run `reconcileEffects` then `drainEffects`, guarded by an `effectsSweeping` flag like the push-alert sweep. Rows whose kind is not yet registered are skipped, never `interrupted` — a lazily registered kind settles on the next tick.
- The `github-issue-create` and `github-issue-title` kinds are retired: `retireGithubIssueEffects` (`apps/server/src/services/retired-effects.ts`) registers both with a send that returns no receipt and settles every `pending`, `sending` or `interrupted` row of the two kinds as `delivered` with a `{ retired: 'github-issue-bridge' }` receipt. It runs once at startup, makes no network call, and keeps old rows from occupying `drainEffects` slots ahead of a live effect.
- Channels that already carry a durable ledger stay on it (single path, no double accounting): `push_delivery`/`sendMustReachAlert`, `client_message` dedupe, `deliverMailEvent`, `coordinatorInput`/outbox dedupe, `computer_call`, merge write-ahead admission. Migrating any of them onto `external_effect` is a later slice per kind.
- `runEffectRow` keeps a per-kind consecutive-failure counter (in-memory, like `drainsRunning`); at `EFFECT_KIND_FAILURE_REPORT_AFTER` (3) it writes one `EXTERNAL EFFECT KIND FAILING <kind>` line to stderr and re-arms after the next `delivered`. A `failEffect(msg, false)` settles the row as `failed` without counting toward that report — `web-push` uses it for `no-subscription`/`all-expired`, which describe the user's channel, not the provider.
- `pushToUserSafely` records a `web-push` effect (scope parsed from the href — todo, chief thread, else team) and attempts it immediately through `runEffectRow`'s fenced per-row claim, so the provider call still happens synchronously inside the caller; `drainEffects` follows for backlog. A delivered row makes a repeat call with the same tag a no-op.
- `ask_user` retries re-announce: both `executeChiefTool` (relay) and `machineAsk` (blocking ask) call `announceQuestion` when `createOrGetQuestion` reports `created:false`, replaying notify + publish + push for a question whose announce was lost between write and post-commit send.

## Channel × idempotency key

Every outward side-effect channel reachable from assignment-tree orchestration, and the durable key that dedupes it:

| Channel | Writer path | Idempotency / dedupe key | Ledger |
|---|---|---|---|
| IM reply / notice send | `sendToOrigin`, pairing notices in `im/core.ts` | `im-send` digest of `(connId, chatKey, stepId-or-pairing-scope, text, replyTo)` on `external_effect` | `external_effect` (`im-send`, `unsafe`) |
| Web push (ordinary) | `pushToUserSafely` in `push.ts` | `web-push:<userId>:<tag>` | `external_effect` (`web-push`, `replay-safe`) |
| Web push / must-reach alert | `sendMustReachAlert` in `push-alerts.ts` | `push_delivery` row id + fallback claim | `push_delivery` |
| Client request replay | `claimClientMessage` | `client_message` `(conversationId, clientMessageId)` | `client_message` |
| Steer / queued message | `sendBuildSteer`, `queueTaskMessage`; `clientMessageId` plumbed through `message_todo`, `mcp reply_thread` | `client_message` key when supplied, else `queuedMessage` row | `client_message` / `queuedMessage` |
| Mail event delivery | `deliverMailEvent` | mail event row + `watching` state machine | own ledger |
| Coordinator input | coordinator dispatch | `coordinatorInput` outbox dedupe | own ledger |
| Agent browser/shell writes | `computer_call` daemon protocol | `computer_call` replaySafe flag | `computer_call` |
| Merge admission | `autonomousMergeAdmission` | write-ahead admission row + reconciler | own ledger |
| Chief wake | `fireChiefWake` | wake id removed from `chief.wakes` + chief step enqueued in one transaction | `chief.wakes` JSON |
| IM inbound dedupe | `im_seen_inbound` insert | `(connId, messageId)` unique | `im_seen_inbound` |
| IM reply addressing | `im_turn_origin` | `(stepId, connId)` unique | `im_turn_origin` |
