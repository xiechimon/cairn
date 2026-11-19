# Ownership wake persistence is atomic

Status: proposed for #3669 (PR #3650 final-review follow-up, thread 4513632192).

The reconciler decides a task is Coordinator-owned, then must persist four facts together: the notification checkpoint, the wake step, the `coordinatorTurn` pointer and the handoff deadline event. Until now those were separate writes; a crash or failed pointer write left a task checkpointed as Coordinator-owned with no turn pointer. `coordinatorTurnState` treats a missing pointer as "turn running", so the task never woke a Coordinator and never handed off. `recoverGateWake` had the same split: the retry step was inserted before the pointer was moved to it, so a tear could leave a live retry while the pointer still named the failed attempt — the next reconcile then handed the task to the owner with a Coordinator turn still queued.

## State

Persisted per Coordinator-owned work:

- `todo.lastNotifiedOwner` / `todo.lastNotifiedWork`: the reconciler's checkpoint. The owner value (`coordinator`, `owner`, `none`) plus the work key that the last notification/wake was issued for.
- `todo.coordinatorTurn { stepId, workKey }`: the wake the checkpoint refers to.
- `step` row: the wake itself (`kind='chief'`, prompt carries `[wake:<trigger>] provenance=watch|report:<todoId>`).
- `dueEvent` row `ownership-handoff:<stepId>`: the deadline after which an unclaimed wake hands the work to the owner.

Invariant for Coordinator-owned work: all four exist and agree — checkpoint `(coordinator, workKey)`, pointer `{stepId, workKey}`, a live `step` (`pending`, `waiting_quota` or `claimed`), and a `dueEvent` for that `stepId`.

## Writers

- `reconcileRow` (`owner.ts`): the only writer of the checkpoint and pointer on the enqueue path. Now one `db.transaction`: the checkpoint CAS, the wake insert (or adoption of a live matching wake — see Transitions), the pointer update and the deadline insert commit or roll back together. Any abort — the CAS lost to a concurrent reconciler, or `enqueueOwnershipWake` returning null — persists nothing, so the next reconcile retries from scratch.
- `recoverGateWake` (`chief.ts`): the retry write set — retry step insert, pointer swap onto the retry, deadline reschedule — commits in one `db.transaction`. A retry step can no longer exist while the pointer still names the failed attempt.
- `cancelUnstartedWake` (`owner.ts`): unchanged — on handoff it stops the pointer's step; the pointer always names the live wake by construction.
- `finishCoordinatorTurn`, claims and sweeps end the step row; they never touch checkpoint or pointer.

## Readers

- `ownershipOf` / `coordinatorTurnState` (`owner.ts`): pointer missing or pointing at an ended step used to decide "handoff" (or "running" when null). Now, before declaring `ended` or `never-started`, it checks whether another live ownership wake exists for the todo (wake trigger `wake`/`gate`/`failed`, `provenance` `watch:<todoId>` or `report:<todoId>`). A live sibling means the Coordinator still owns the turn — `running` — and reconciliation repairs the pointer instead of handing off.
- `handoffUnclaimedOwnershipWake` (`owner.ts`, scheduler `ownership-handoff` events): fires a deadline for `stepId`; unchanged.
- `reconcileRow` intact check: a Coordinator-owned row whose checkpoint already matches skips work only when the whole invariant holds — matching pointer work key, live pointer step, deadline present. Anything less is treated as a torn write and repaired by re-running the atomic section.

## Transitions

- `none|owner → coordinator`: one transaction writes checkpoint, a fresh wake step, pointer and deadline.
- `coordinator → coordinator` (checkpoint already matches, invariant broken — a torn write): the same transaction adopts an existing live wake for the same reason (`wake` for question/blocked, `failed` for failed, `gate` for review) — or enqueues one when none exists — and restores the pointer and deadline. Adoption only applies to a matching checkpoint: a pending wake written for an older work key is never adopted into a new turn, so e.g. a second pending question still gets its own wake.
- `coordinator → owner` (handoff): unchanged decision (`ended` or `never-started`); `cancelUnstartedWake` stops the pointer step.
- wake ends without changing the work: `coordinatorTurnState` = `ended` → handoff, unchanged.
- gate wake attempt 0 fails: `recoverGateWake` atomically inserts the retry, moves the pointer to it and reschedules the deadline; attempt 1 failure posts the ask-a-person message, unchanged.
- torn legacy write (checkpoint set, pointer null or dead, wake step maybe present, deadline maybe missing): `ownershipOf` reports `running`, the reconcile intact check fails, and the atomic section adopts the live matching wake — or enqueues one when none exists — restoring the invariant without a second wake.

## Failure paths

- Checkpoint CAS lost inside the transaction: rollback; nothing persisted; the winning reconciler owns the wake.
- `enqueueOwnershipWake` returns null (todo gone, report origin gone): rollback; the checkpoint stays unclaimed so a later reconcile can succeed once the condition resolves — previously the checkpoint was already written and the task stuck forever.
- Crash anywhere inside a transaction: nothing persisted; restart reconciliation re-drives the whole write.
- Crash inside `recoverGateWake`'s transaction: retry, pointer move and reschedule are all lost; the pointer still names the failed step, the task hands off to the owner — a deliberate degrade over an untracked live retry.
- A wake step that ends between the intact check and the pointer write is adopted within the same transaction snapshot; `coordinatorTurnState` re-reads the step row on the next pass, so an ended adopted step resolves to `ended` on the following reconcile.
