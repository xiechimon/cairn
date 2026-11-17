# External effects ledger

Status: proposal for the owner's review. Nothing here is built. Baseline `e541ed535` on `origin/main`. Prior art already in this repo: `docs/reliability/effect-paths-audit.md` (#2492) inventories every decision-commit-versus-side-effect path, classifies each kill window as lost or dup, and names fix slice one "an `effect` outbox table, after-commit executor, sweeper and per-kind failure counter". This page is that slice's contract. Scope is assignment-tree work: a Coordinator chief tree that suspends on `ask_user` cards, fans out child todos through `todo.sourceTodo`, and wakes once when children finish (`settleSplitOnDone` in `apps/server/src/services/todos.ts`, `triggerChiefWakes` in `apps/server/src/services/chief.ts`).

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
