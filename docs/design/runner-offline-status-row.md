# Runner offline status row: one per machine

## Problem

`runner-offline` was keyed `runner-offline-<machineId>-<lastSeenAt>`, one row per
offline period. A Runner flapping offline and online mints a new primary key
each drop, so the Coordinator chat accumulates "… is back. N tasks started."
rows forever. The row is a status, not an event log: its only meaningful
content is the machine's current state.

Bug class: *event-keyed status row* — a row that shows the current state of one
entity was keyed by a per-incident value (`lastSeenAt`), so every new incident
appended a row instead of rewriting the one stable row in place. Sibling audit
of every `chief_message`/`message` writer: notices dedupe by a stable per-entity
id with upsert/`onConflict` (`notification` `${user}:${entity}`,
`retry-parked-${buildId}`, `chief-stop-${stepId}`, `skill-injection-${stepId}`,
question cards by `requestId`, PR-wake ledgers `pr-wakes:…`, `notify_user` by
`effectDedupeKey`, `report-notice`/`report-silent` by content hash), and the
rest are genuine event logs where each row is a distinct one-time event
(`thread-report`/`thread-message` per transition or send, `chief-err`/`chief-
fallback`/`local-merge` rows per step). No other writer carries the pattern.

## States

One `chief_message` row per machine, id `runner-offline-<machineId>`:

- **absent** — the machine has no current status worth showing.
- **open** (`recoveredAt: null`) — the machine is offline past the grace with
  waiting tasks, or it came back and the outcome has not settled. Content
  updates in place: waiting list, alternative offer, `backAt`, per-task states.
- **settled** (`recoveredAt: ts`) — the outcome is final: all listed tasks
  started, moved, or the 2-minute settle bound passed after `backAt`.

## Transitions

- absent → open: machine offline ≥ `RUNNER_OFFLINE_NOTICE_MS` with ≥1 waiting
  task. Insert with the current `lastSeenAt`, empty todos filled by
  `nextContent`, `createdAt = now`.
- open → open: every sweep recomputes `nextContent` and updates the row in
  place when the content changed. Position in the thread does not move.
- open → settled: `nextContent` sets `recoveredAt` once every task left
  `waiting`, or the settle bound passed. The machine row disappearing settles
  the row immediately.
- back → open: a machine that drops again *before* the return settles (the row
  still reads `backAt` with `recoveredAt: null`) reopens on the same row at the
  next sweep instead of keeping a stale "is back" line while it is offline
  again. Same rewrite as «settled → open».
- settled → open (the fix): a *new* offline period (machine offline ≥ grace
  with waiting tasks again) rewrites the same row instead of inserting: fresh
  `lastSeenAt`, `backAt`/`recoveredAt` back to null, todos rebuilt from the
  current waiting set, `alternative` recomputed, `createdAt = now` so the row
  surfaces at the bottom of the thread as the new event.
- any state → absent: never. The row is never deleted by the sweep itself.

## Readers and writers

- Writer: `sweepOfflineRunners` only, on the 15 s scheduler tick.
- Readers: the web mapper parses `runner_offline` content into a
  `runner-offline` stream item rendered by `RunnerOfflineRow`; every string
  goes through `t()` in the viewer's locale — the stored content carries no
  prose. The open-row scan (`recoveredAt":null` LIKE) and `publishNotice` are
  unchanged.

## Migration of existing duplicates

Rows written before this change use `runner-offline-<machineId>-<lastSeenAt>`.
Each sweep groups all `runner-offline-%` rows by the `machineId` inside their
content: an open row wins, otherwise the newest by `createdAt` survives; every
other row for that machine is deleted. A surviving legacy-id row keeps its id —
reply links and mirrored ids stay valid — and behaves exactly like a stable-id
row from then on. New rows use the stable id.

## Failure behavior

- Two sweeps racing: the insert is `onConflictDoNothing` on the stable id, so
  at most one row is ever created per machine.
- A row whose content does not parse as `runner_offline` is ignored by the
  merge (it is not deleted) and skipped by the update loop, as today.
- Deletion is limited to rows in the same machine's group; nothing else in the
  thread is touched.
