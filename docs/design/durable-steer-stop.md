# Durable steer and stop delivery (audit rows 10–12)

Status: implemented. Closes the last `docs/reliability/effect-paths-audit.md` rows where a control
signal could be consumed before it was delivered.

## Problem

`steer_pending` and `stop_pending` are durable rows, but the fetch endpoints deleted them at read
time. The kill windows:

- Worker steer: `fetchSteer` deleted the row and returned the text. A daemon that died between the
  HTTP response and injecting the text into the live session lost the steer permanently — nothing
  re-derived it.
- Chief steer: same row delete, but the payload is recoverable — `takeChiefSteer` holds the owner
  messages as `steer_sent` step rows and the daemon only re-publishes them. The `steer_pending`
  flag row itself was still consumed early.
- Stop: `fetchStop` deleted the row on first read. A daemon that fetched a stop and died before the
  session exited never signalled again (worker steps; chief turns self-heal via the overlong sweep).

## Design

### `steer_pending` — hold until acked

New column `sentAt` (epoch ms, nullable). Lifecycle per row:

- Writer (`sendBuildSteer`, `steerChiefMessage`, `rebuildMachineSteer`, `pr-wakes`): insert/upsert
  resets `stepId`, `content`, `createdAt`, and `sentAt = null` — fresh content always reads as
  undelivered. All writers merge the new text into the prior row only while `sentAt = null`: an
  unsent row keeps every line, while a row already handed to a daemon is replaced, because
  re-delivering the sent text would inject it twice. (For workers the user text still lives in the
  transcript message row; the chief copy lives in `steer_sent` message rows.)
- `fetchSteer` for the matching claimed step:
  - `sentAt` null or older than `STEER_SENT_STALE_MS` → set `sentAt = now`, return the content plus
    `steerSentAt = now` in the wire response.
  - `sentAt` fresh → return `null` — a fetch is already in flight; wait for the ack or staleness.
  - `pending.stepId !== stepId` → the steer targets another step: keep the row while the target
    step is still claimed (that step's own daemon fetches it); delete only when the target is gone.
- `ackSteer` (any step kind): when `body.steerSentAt` is present, delete the row
  `where conversationId = buildId and stepId = <acking step> and sentAt = steerSentAt`. The fenced
  delete means a late ack for an older delivery cannot delete a newer pending steer: a writer that
  overwrote the row reset `sentAt`, so the stale ack's fence no longer matches. The `stepId` match
  keeps an ack scoped to the step the row was served to. When the ack carries no `steerSentAt` at
  all (a daemon built before this protocol), a bare `{}` ack deletes a served row for the acked
  step (`sentAt is not null`); acks carrying `answerIds`/`messageIds` never touch the steer row,
  because they can belong to a `content: null` fetch inside the fresh window. A replacement row
  (`sentAt = null`) is never deleted by an unsentAt'd ack, so an old daemon's late ack cannot drop
  a steer it never saw. Residual: an old daemon's steer+answers row is never deleted and re-serves
  every `STEER_SENT_STALE_MS` until the step ends — duplicates during a version-skew window, never
  a loss.
- Wire: `machineSteerResponseSchema` gains `steerSentAt?: number`;
  `machineSteerAckBodySchema` gains `steerSentAt?: number`. The daemon echoes the value it received.

Chief rows flow through the same hold. `takeChiefSteer` still flips `steered → steer_sent` for the
transcript/message mechanics and returns the batch ids. Redelivery is derived, not re-served: when
`sentAt` is stale, `fetchSteer` does not call `takeChiefSteer` (new `steered` messages must not be
folded into the unacked batch). Instead `chiefSteerSentBatch` reads the `steer_sent` rows and
rebuilds `{ ids, content }` via `steerContent` — correct even when a newer steer has already
rewritten the row's content. When the outstanding batch is empty the stale row is residue of a
settled delivery and is deleted. `ackSteer`'s fenced delete removes the flag row; `ackChiefSteer`
settles the held messages as before.

Daemon side:

- `steerAck` echoes `steerSentAt` (plus the existing `answerIds`/`messageIds`) after `live.steer`
  resolves.
- `deliveredSteerSends` maps `stepId → steerSentAt` of each injected send. A replayed fetch with the
  same `steerSentAt` re-acks without re-injecting — a duplicate text injection only happens when the
  daemon itself restarted, which is the desired recovery.
- On every push-channel reconnect the daemon re-fetches steer and stop for every live step; the
  SSE events stay latency hints and the durable rows close the gap while the channel was down.

Crash matrix (worker):

| Moment | Result |
|---|---|
| before `sentAt` write | row still `sentAt = null` → next fetch serves it |
| after `sentAt`, before daemon receives | `sentAt` goes stale → next fetch re-serves (at-least-once) |
| daemon received, died before `live.steer` | `sentAt` goes stale → re-served; the session reinjects |
| delivered, ack lost in flight | `sentAt` goes stale → re-served; a duplicate text injection, never a loss |
| ack lands | fenced delete — row gone |

### `stop_pending` — hold until the target dies

A stop has no ack endpoint, and none is needed: the target step leaving `claimed` is itself the
delivery receipt. `fetchStop` no longer deletes on read — it returns `{ discard }` whenever a
matching pending row exists, and deletes the row only when the target step is missing or no longer
active (the pre-existing auto-clean clause). The daemon keeps an in-memory `deliveredStops` set so a
repeated `{ discard }` does not re-`stop()` the same session every poll; a daemon restart clears the
set and re-stops, which is the desired recovery.

| Moment | Result |
|---|---|
| fetch, daemon died before `stop()` | row still there → next daemon's fetch returns `discard` again |
| `stop()` ran, step still exiting | row returns `discard`; the in-memory guard skips re-stop |
| step ended | auto-clean clause deletes the row on the next read |

### What is not changed

- `steerSignal`/`stopSignal` remain latency hints; durability lives in the rows.
- The answers channel (`undeliveredAnswers` → `markDelivered`) already had ack semantics and is
  untouched.
- `steerPending` rows targeting a dead step are cleaned by the same `!isActiveStepStatus` clause
  `fetchStop` already used, applied to steer as well.
- At-least-once is a deliberate trade: a worker steer delivered but never acked can be re-injected
  once when `sentAt` goes stale. A steer written over a sent-but-unacked row replaces it — the sent
  text is presumed delivered (and remains in the transcript regardless), so a fetch→inject crash
  followed by a new steer inside the same window is the one narrow loss this design accepts. A
  silently lost user steer is the worse failure mode.
