# Coordinator queue, steer state and withdraw

> Superseded in part by `docs/design/coordinator-interrupt.md`: explicit Coordinator `Cmd+Enter` queuing (`mode: 'queue'`) and queued-message editing (`PATCH .../messages/:mid`) were removed when instant mid-generation barge-in replaced queuing as the single path. Outage `held` tabs, tool-round steer withdrawal, and claim-time folding remain.

Owner decision (2026-11-17): while the Coordinator is busy, Enter steers the running turn and ⌘/Ctrl+Enter queues the message for the turn after it. Queued messages show in a tab bar above the composer (prototype direction 1), can be edited in the composer, deleted, or steered now. A steered message the model has not read yet can be withdrawn. Messages queued during one turn are sent together and answered once.

## State

A Coordinator user message is a `chief_message` row plus a waiting chief `step` whose id is the message id (`ownerMessageIds` lists the messages a step carries). No new table.

| Waiting step | Meaning | `pending.state` on the wire |
|---|---|---|
| `holdReason` null or `queued`, a turn is claimed or the step is not first | waits for the next turn | `queued` |
| `holdReason` `editing`, `holdUntil` in the future | queued, being edited; claim skips it | `queued` |
| `holdReason` `steer`, `steer_sent` or `steer_withdraw` | steered into the running turn, not read yet | `steering` (was `queued`) |
| parked on quota | Coordinator unavailable | `held` |

`chief_message.delivery` (new nullable column) records how a message entered a turn: `steer`, `queue`, or `steer_missed` (steered, but the turn ended before the model read it, so it opens the next turn). The server uses it to restore the queue hold after an edit. The page does not label messages by it: an unread steer shows only as a hollow outlined bubble, and read, missed and queued messages look like any other message.

## Transitions and the paths that write them

- **Send** (`POST /api/conversations/:id/messages`, `mode: 'queue'`): with a claimed turn, the waiting step gets `holdReason 'queued'`, the message `delivery 'queue'`, and no steer. Without one it is an ordinary send. Without `mode` a busy send steers as before and sets `delivery 'steer'`.
- **Steer now** (existing `POST .../messages/:mid/steer`): works on a queued step; sets `delivery 'steer'`.
- **Edit** (`PATCH /api/teams/:id/chief/threads/:tid/messages/:mid`): `{ editing: true }` sets `holdReason 'editing'` and `holdUntil = now + 2 min` (the page renews it every minute); `{ content }` rewrites the message and the step prompt and clears the hold; `{ editing: false }` clears it. A step already claimed, steered or carrying other messages answers 409.
- **Delete a queued message** (existing `DELETE .../messages/:mid`): unchanged.
- **Withdraw a steered, unread message** (same `DELETE`):
  - Daemon path, `holdReason 'steer'` (not fetched yet): delete the step and the message and rebuild `steer_pending` from the remaining `steer` steps; drop the row when none remain. `steer_sent` (fetched) answers 409.
  - Native path, batch not yet pulled: delete the batch, step and message in one transaction.
  - Native path, batch pulled: mark the step `steer_withdraw`, then ask the running turn to abort that durable submission (an in-process registry keyed by step). The turn first joins its in-flight steer drain, so a pulled batch is always submitted before it is aborted. `aborted` or a missing submission settles it as withdrawn; the input observer's `release` sees `steer_withdraw` and deletes the step and message instead of creating a successor. `already_placed` or `settled` restores `steer` and answers 409 (the model has read it). No running turn answers 409.
- **Turn end** (`releaseUnconsumedSteer` on both paths and native `releaseCoordinatorInput`): unread steers become ordinary waiting work as before and their messages get `delivery 'steer_missed'`.
- **Claim** (`claimPendingChiefStep`, shared by the server runtime and machine claims): after the head is claimed, later waiting user steps of the same thread and project scope that are not steered, parked, locked for editing or native-pending fold into it: their prompts append in order, their owners join `ownerMessageIds`, and their steps are deleted, all in one transaction. The function returns the claimed row so the machine claim builds its payload from the folded prompt.

## Failures

- Server restart: everything is in SQLite. An editing lock expires on its own. A `steer_withdraw` mark left by a crash is still a steer hold: the turn's end releases it as `steer_missed`, or recovery's release deletes it if the submission was aborted.
- Lost response or retry: send keeps `clientMessageId` deduplication; a repeated edit or withdraw answers the same state or 409.
- Withdraw races the read: exactly one of `aborted` and `already_placed` wins inside the durable store, and the consumption receipt or the release follows from it.
- Edit races the claim: the claim's update requires `holdUntil` to have passed, and an edit of a claimed step answers 409; the page keeps the draft and says it was already sent.

## Tests (one per path)

Server: queue send while busy and while idle; pending states for steering, queued and held; edit lock blocks claim and expires; edit content and 409 after claim; fold at claim (same scope folds, other scope and locked do not, machine claim payload carries the folded prompt); withdraw daemon `steer` rebuilds the buffer and `steer_sent` refuses; native withdraw unbound, aborted and already placed; turn end marks `steer_missed`.
