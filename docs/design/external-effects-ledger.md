# External effects ledger

Status: first slice built (`external_effect` + drainer + reconciler in `apps/server/src/services/external-effects.ts`, `im-send` and `github-issue-create` wired). Prior art already in this repo: `docs/reliability/effect-paths-audit.md` (#2492) inventories every decision-commit-versus-side-effect path, classifies each kill window as lost or dup, and names fix slice one "an `effect` outbox table, after-commit executor, sweeper and per-kind failure counter". This page is that slice's contract. Scope is assignment-tree work: a Coordinator chief tree that suspends on `ask_user` cards, fans out child todos through `todo.sourceTodo`, and wakes once when children finish (`settleSplitOnDone` in `apps/server/src/services/todos.ts`, `triggerChiefWakes` in `apps/server/src/services/chief.ts`).

## Problem

Nodes in the tree perform outward actions — web push, the SMTP must-reach fallback, IM replies, GitHub issue create/close/sync and comments, PR merges, outbound mail. Each rides on its own record with a different restart contract, and the audit's kill windows are real: a fire-and-forget `githubCreateIssue` before the `sourceRef` update retries into a second issue (dup), a plain `pushToUserSafely` is lost on any kill, a `createOrGetQuestion` retry skips notify and push forever (lost). A server crash between "provider accepted" and "local row updated" either resends (at-least-once runners cannot tell delivered from unsent) or silently drops (IM sends live in `origins`, `queueChains`, `seenInbound` maps in `apps/server/src/services/im/core.ts` — memory only, gone on restart). There is no single place that answers "did this effect reach the outside world".

## What the baseline does

| Existing mechanism | Restart contract | Where |
|---|---|---|
| `client_message` | durable dedupe: `claimClientMessage` inserts `onConflictDoNothing`; a conflict replays the stored response; `coalesceClientMessage` shares in-flight calls | `apps/server/src/services/client-message.ts` |
| `push_delivery` | durable row per notification; `alertStatus` `pending → sending → received / fallback-accepted / undelivered`; stale `sending` claims recover via `fallbackClaimedAt`; `sweepPendingPushAlerts` runs at startup and on sweep | `apps/server/src/db/schema.ts:733`, `apps/server/src/services/push-alerts.ts` |
| `due_event` + `createDueRunner` | reserve-before-async (`reserve` pushes `dueAt` forward while a detached handler runs), backoff, at-least-once | `apps/server/src/services/due-events.ts` |
| `computer_call` | `replaySafe` flag; a lost non-replay-safe call is marked `interrupted` when resubmitted | `apps/server/src/services/machine-computer.ts` (`forwardComputerCall`) |
| `task-issue-sync` | desired-vs-recorded `issueState` reconciler; the sweep converges with bounded writes per pass | `apps/server/src/services/task-issue-sync.ts` |
| mail delivery | `deliverMailEvent` moves the event `received → delivered` and inserts the `push_delivery` row in one transaction; the send runs after commit — the queued row is the intent | `apps/server/src/services/mail.ts` |

The step-claim runtime is durable but is not an effects ledger: `claimStep` stamps `step.claimedAt` as the claim generation, the abandoned-step sweep (`build-abandoned-sweep.ts`, `BUILD_ABANDONED_STEP_MS = 120_000`) releases a dead claim to `pending` and fails it after `ABANDONED_CLAIM_QUARANTINE_LIMIT = 3`, and `finishStep` re-checks `(status, machineId, claimedAt)` before applying. Nothing on that path records whether an outward send inside the step already fired.

## Contract

One table `external_effect`, one drainer, one reconciler. An effect is recorded **at intent**, inside the same transaction as the motivating write (the `deliverMailEvent` pattern); the send runs after commit; the provider receipt marks the row `delivered`. Recording "at the moment of effect" is rejected: the moment of effect is exactly the window a crash can interrupt, so the durable record must exist before it.

Row: `id`, `teamId`, `scopeKind` (`todo | build | step | chiefThread | mailEvent | imConnection`), `scopeId`, `stepId` and `claimGeneration` (the claiming step's `claimedAt`, provenance only), `kind` (`web-push`, `mail-send`, `im-send`, `github-issue-sync`, `github-comment`, `pr-merge`, …), `dedupeKey` (unique; hash of `scopeKind, scopeId, kind, content-digest` — deliberately excluding the claim generation), `payload` (json replay envelope), `state`, `dueAt`, `claimedAt`/`claimFence` (drainer claim, same shape as `step.claimedAt`), `attempts`, `lastError`, `receipt` (provider id/URL), `createdAt`/`updatedAt`.

States: `pending → sending → delivered | failed | interrupted`; `pending → cancelled` when the scope is cancelled or superseded (todo cancelled, build replaced by a newer `latestBuildId`, thread abandoned) — written in the same transaction as that cancellation. `sending → pending` on a retryable failure with backoff; `sending → interrupted` when the drainer claim is stale and the kind is not replay-safe. `interrupted` is terminal: the row is never resent automatically; it surfaces on the scope so a person or the next step sees "attempted, outcome unknown".

Each kind declares a reconcile policy: `probe` (re-read external state to settle delivered-vs-unsent — GitHub issue state and comments are readable, so `github-*` kinds probe; [inferred] no uniform provider capability exists, mail/SMTP and IM sends have no post-hoc read), `replay-safe` (an idempotent resend is allowed — web push keyed by its tag, `github-issue-sync` which converges anyway), `unsafe` (neither provable nor idempotent — mark `interrupted`, never resend; IM sends and SMTP mail default here [inferred]).

Interaction with the step-claim runtime: the dedupe key is generation-independent, so a step re-claimed after the reaper that submits the identical effect hits the unique index, attaches to the existing row, and replays the stored receipt when it is `delivered` — the crash window cannot produce a second send of the same content for the same scope. `releaseClaimedStep` does not touch scope-level effects; only scope cancellation does. An effect raised inside `finishStep`'s transaction rolls back with it if the generation fence rejects.

In-flight dedupe: `INSERT … ON CONFLICT DO NOTHING`; on conflict, attach to the row — replay `receipt` if `delivered`, or coalesce on a per-key in-process map (the `coalesceClientMessage`/`fallbackInFlight` pattern) so concurrent drainers share one send.

Restart reconciliation: at startup (`index.ts`, beside the IM resume and computer-recovery sweeps) and on the scheduler: drain `pending`; for each stale `sending` apply the kind's policy — probe, requeue as `pending`, or mark `interrupted`; mark `pending` rows `cancelled` when their scope is gone. Daemon-side effects (agent browser and shell writes on machines) stay on the `computer_call` ledger and are out of scope here.

## Paths, failures, and the first test

| Path | Reads or writes | On failure | First test |
|---|---|---|---|
| Motivating transaction (`deliverMailEvent`, `sendMustReachAlert`, sends driven by `enqueueStep`/`enqueueChiefStep`, `task-issue-sync` write decision, `autonomousMergeAdmission`) | inserts `external_effect` `pending` with dedupeKey | unique conflict → attach to existing row, replay receipt if `delivered` | two identical intents in one scope produce one row and one send |
| Post-commit drainer | `pending → sending` (claim + fence), calls the provider, writes `delivered` + receipt | provider error → `failed` or back to `pending` with backoff; process dies after claim → stale `sending` | kill after claim, before receipt: row is classified by policy, not resent blind |
| Startup/scheduler reconciler | reads stale `sending`, writes `interrupted`/`pending`/`delivered` (probe) | probe inconclusive → stays `interrupted`; [inferred] probe support varies by provider | stale `sending` github-comment is probed to `delivered`; stale `sending` im-send becomes `interrupted` |
| `releaseClaimedStep` / quarantine | no write to effects | effects stay `pending` for the scope | a re-claimed step attaches to the pending effect rather than duplicating it |
| Scope cancellation (todo cancel, build supersede, thread abandon) | `pending → cancelled` in the cancelling transaction | `sending`/`delivered` rows are untouched (history) | cancelling a todo cancels its pending comment effect, keeps the delivered one |
| `interrupted` surfacing | read on scope display / next step prompt | none — read-only | next step on the thread sees the uncertain effect instead of resending |
| `answer-delivery`-style replay reader | reads `delivered` rows by dedupeKey | missing row → normal first send | resubmission after delivered returns the stored receipt without a provider call |

## Out of scope

Daemon-side effects, a UI for `interrupted` rows beyond the minimal surfacing, and any change to push/IM/GitHub provider clients beyond the receipt write-back.

## As built (first slice)

Wired kinds: `im-send` (`unsafe`; also the `PAIRING_REQUESTED`/`PAIRING_APPROVED` notices — dedupe keys `pairing:<sender>`/`paired:<sender>`) and `github-issue-create` (`probe` — created issue bodies carry a `<!-- cairn:todo <todoId> -->` marker so the probe can prove delivered-vs-unsent by listing repo issues).

- `apps/server/src/services/external-effects.ts` owns the row lifecycle: `recordEffect` (intent + dedupe attach), `claimEffect`/`markEffectDelivered`/`markEffectAttempt` (fence-checked), `drainEffects` (per-db serialization), `reconcileEffects`/`settleEffectRow` (stale `sending` policy settle + `scopeGone` cancel), `effectDedupeKey`, and the `retryEffect`/`waitEffect`/`failEffect` outcome helpers. `waitEffect` returns a row to `pending` without burning an attempt — an offline IM session is an unexecuted wait, not a failed send, so queued replies survive overnight connectivity gaps.
- IM turn state that lived in process maps is durable: `im_turn_origin` (step → connection/chat/sender/thread), `im_seen_inbound` (`(connId, messageId)` dedupe, ~500-row retention per connection). A restarted `createImService` still answers the origin chat and still drops replayed inbound messages; `deleteConnection` cancels the connection's pending `im-send` effects in the same call.
- `github-issue-create` dedupe is `(teamId, todoId, owner, repo)` — a repo move is a new intent; a repeated create attaches and replays the stored `number` receipt. `runSelfIssueCreate` settles an attached `interrupted`/stale `sending` row through the probe before sending, so a crash after GitHub accepted the issue yields `delivered` via the list-issues probe and zero second `POST /issues`; a confirmed miss re-sends exactly once.
- Startup (`index.ts`) and the scheduler tick run `reconcileEffects` then `drainEffects`, guarded by an `effectsSweeping` flag like the push-alert sweep. Rows whose kind is not yet registered are skipped, never `interrupted` — a lazily registered kind settles on the next tick.
- Channels that already carry a durable ledger stay on it (single path, no double accounting): `push_delivery`/`sendMustReachAlert`, `client_message` dedupe, `task_issue_close` tombstones + `issueState` convergence, `deliverMailEvent`, `coordinatorInput`/outbox dedupe, `computer_call`, merge write-ahead admission. Migrating any of them onto `external_effect` is a later slice per kind.
- `runEffectRow` keeps a per-kind consecutive-failure counter (in-memory, like `drainsRunning`); at `EFFECT_KIND_FAILURE_REPORT_AFTER` (3) it writes one `EXTERNAL EFFECT KIND FAILING <kind>` line to stderr and re-arms after the next `delivered`.

## Channel × idempotency key

Every outward side-effect channel reachable from assignment-tree orchestration, and the durable key that dedupes it:

| Channel | Writer path | Idempotency / dedupe key | Ledger |
|---|---|---|---|
| IM reply / notice send | `sendToOrigin`, pairing notices in `im/core.ts` | `im-send` digest of `(connId, chatKey, stepId-or-pairing-scope, text, replyTo)` on `external_effect` | `external_effect` (`im-send`, `unsafe`) |
| GitHub issue create (self) | `runSelfIssueCreate` in `todos.ts` | `github-issue-create:<teamId>:<todoId>:<owner>/<repo>` + `<!-- cairn:todo <id> -->` body marker for the probe | `external_effect` (`github-issue-create`, `probe`) |
| GitHub issue state sync | `settle` in `task-issue-sync.ts` | `task_issue_close` tombstone + `issueState` convergence re-read | own ledger |
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
