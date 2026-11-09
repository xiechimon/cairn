# Thread owner field

Status: accepted with the coordinator's change of 2026-11-08 (computed on read, wakes from a reconciler). Replaces the per-view ownership rules that #3471 grew. #3488 (the inbox UI) reads this field once it lands.

## Problem

Whether a thread waits on the person, the Coordinator or a machine was computed separately in the server inbox, the Coordinator's `needs_you` tool, each wake trigger, the web home, the sidebar, the project home, the tasks panel, the row copy and the push notifications. Each review in #3471 found two of them disagreeing: a failure out of the owner inbox but with no Coordinator wake, a question escalated to the owner still in the Coordinator queue, the sidebar still listing what the home page had moved.

## Invariants

1. Every task has one owner: `owner` | `coordinator` | `machine-update` | `null` (nobody waits: running, idle, done). It is computed in one server function, `ownerOf(task)`, from the task's phase, pending questions, escalations, parking and the running machine's capability.
2. `ownerOf` is computed on read and never stored. The server puts it on every `TodoRecord` it returns (`owner`), so every view reads the same value. No view computes ownership itself.
3. Wakes come from one reconciler, `reconcileOwners()`. It recomputes `ownerOf` for the affected tasks after write events (a task, step, question or machine write) and for all open tasks in a periodic sweep, and diffs against a stored `lastNotifiedOwner` per task. A change to `coordinator` enqueues one Coordinator wake with the reason; a change to `owner` sends the owner notification and push; then `lastNotifiedOwner` is updated. A write path that forgets to trigger the reconciler is late by one sweep, never lost. No other code enqueues ownership wakes or notifications.
4. Every view reads `owner` only: the server inbox (`/api/needs-you`, the daily report), the Coordinator `needs_you` tool, and on the web the home, sidebar, project home, tasks panel, row copy and tray. The copy names the actor from `owner`, never from the phase.
5. `ownerOf` rules:
   - `confirm`, and `review` of a code task under the human merge policy: `owner`.
   - A pending question escalated in an owner class (design, payment, credential, intended-behavior) on any phase: `owner`.
   - A pending question not escalated, a failure (including a parked failure), an info report in `review`: `coordinator`.
   - A claimed step whose machine lacks `answersAck` while answers or questions are pending: `machine-update` (takes precedence).

## Entry points

File and function names refer to the #3467 and #3471 branches (`server/stall-needs-input`, `server/stall-escalation`); main does not have them yet.

| # | Entry point (current code) | Today | Failure seen in #3471 | Under the field |
|---|---|---|---|---|
| 1 | `waitingOnOf` (`todos.ts`) | owner/coordinator/machine-update next to machine/quota | — | `waitingOn` keeps only machine and quota; `owner` comes from `ownerOf` |
| 2 | `listNeedsYou(audience)` (`needs-you.ts`), `/api/needs-you`, daily report | phase rules per audience | review of info reports, escalated failed threads | `ownerOf = owner` |
| 3 | Coordinator `needs_you` tool (`chief-router-tools.ts`) | own filter of escalated questions | escalated question still offered | `ownerOf = coordinator` |
| 4 | `triggerChiefWakes` question wake, failed wake, info-review gate wake (`chief.ts`) | per-phase rules plus watch state | parked failures got no wake; info reports needed their own wake | replaced by the reconciler's change to `coordinator` |
| 5 | `parkFailedBuild` (`retry-parking.ts`) removes watches before the failure lands | — | suppressed the only wake | parking only stops retries; the reconciler still wakes |
| 6 | `sweepQuestionDeadlines` remind and escalate (`question-deadlines.ts`) | its own notify and push | — | writes the escalation; the reconciler notifies |
| 7 | `escalate_question`, `answer_question` owner proof (`ownerAnswerTime`) | — | — | unchanged; their writes trigger the reconciler |
| 8 | Web `needsYouThreads`, `inProgressThreads` (`board/needs-you.ts`) | phase plus `waitingOn` | failed escalated threads hidden | `owner === 'owner'`, everything else by run state |
| 9 | Web `groupThreads` (`board/sidebar-threads.ts`) | `threadStatus` | sidebar still listed Coordinator-owned rows | reads `owner` |
| 10 | Web `threadCopy`, `threadTone`, `threadStatus` (`board/thread-copy.ts`) | phase | rows said "asked you" for Coordinator-owned questions | copy per `owner` |
| 11 | Web home, project home, tasks panel, tray, `replyDeliveryOf`, `threadTargetsOf` | the selectors above | — | read `owner` through the selectors |
| 12 | `notifyTodoPhase` and push on phase change (`todos.ts`, `notifications.ts`) | phase-driven | owner pinged for Coordinator-owned phases | only the reconciler's change to `owner` notifies |

## Migration

- Add `lastNotifiedOwner` (nullable text) to the todo row; on first boot set it to the current `ownerOf` for every open task, so the change does not fire a burst of wakes for existing tasks.
- Add `owner` to `TodoRecord` as a computed field.
- `waitingOn` drops `owner`, `coordinator` and `machine-update` in the same PR.
- `NEEDS_YOU_REASONS` keeps `question`, `confirm`, `review`; `failed` leaves the owner inbox.
- #3488 switches its inbox to `owner` after this lands (its own agent).

## Tests

1. `ownerOf` table test over every phase × question × escalation × parking × capability combination.
2. The reconciler fires once per change: a change to `coordinator` enqueues exactly one wake, also for a parked failure with no watch; a change to `owner` sends one notification; a Coordinator-owned phase sends none; an unchanged owner sends nothing.
3. A missed call site is caught: change a task's inputs without triggering the reconciler, run the sweep, and the wake or notification fires.
4. First boot after migration sends no wakes for existing tasks.
5. Server inbox, `needs_you` tool, home, sidebar, project home, tasks panel and tray all list the same tasks for the same fixtures (one parity test over the shared fixture set).
6. Row copy names the right actor for each `owner` value.
7. A grep test: no web or server file outside `ownerOf` derives ownership from phase.
