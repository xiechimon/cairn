# Chief outbox persistence

The same outbox (`createOutbox`) holds Coordinator messages and task replies.

Status: reviewed (read-only design review, go after changes; the changes are folded in below). Prior art: `docs/research/chief-outbox-persistence-2026-11-15.md`. This is the chief composer slice of `docs/design/message-first-sending.md`: text only, the two routes the chief composer posts to, no drainer generation fence, no tombstone.

## Problem

`apps/web/src/chief/outbox.ts` held every unsent Coordinator message in a module array. The composer clears when the message is enqueued. A renderer crash, a closed tab or a reload while the POST has not been accepted lost the bubble, the text and the client id. The isolated probe at `7d2b48d58` reproduced it with a renderer crash (`renderer-crash-outbox.json`). A send that fails while the page lives was not affected: its text goes back to the composer draft, which is persisted.

## Server contract this relies on (unchanged)

The chief composer posts to `POST /api/teams/:id/chief/threads` (no thread yet) and `POST /api/conversations/:chiefThread/messages` (`chiefSend` in `apps/web/src/api/hooks.ts`). Both run `submitChiefMessage`, which claims `(threadId, clientMessageId)` in `client_message` inside the transaction that inserts the message and enqueues the turn, with no `await` between the replay check and that transaction. A repeat of the id on the same scope returns the stored response, inserts nothing, starts no turn and publishes no stream event (`client-message-chief.test.ts`). For `threadId: null` the scope is the calling user's global Coordinator thread (no project, never archived); the first POST creates it and claims the id there, so a resend finds the same ledger row. A thread that was archived since still replays a stored message, because the replay lookup has no archive filter; the 409 only answers a message that was never stored. A repeat with different content returns the original message: that is the existing contract and stays. A resend always carries the stored text. The durable Thread routes, which answer 409 to a changed payload, are not on `main` and the chief composer does not call them.

## State

IndexedDB databases `cairn-chief-outbox` (Coordinator) and `cairn-task-outbox` (task replies), store `entries` keyed by `key`, through a thin wrapper over the IndexedDB API (no new dependency: four operations, one a conditional write in one transaction; a blocked open rejects). One row per client id: `{ key, scope, owner, threadId, projectId, text, task?, failure?, state, createdAt }`. `task` is `{ todoId, mode }` with `mode` one of `reply`, `queue` and `stop-and-send`; `failure` is `error`, `timeout`, `stale` or `cancelled` (the server refused the send because the queued message was removed). `scope` is `userId/teamId` (IndexedDB is per origin, not per user); `owner` is the page that holds the row, and each page holds the Web Lock `cairn-chief-outbox:<owner>` for its lifetime, which the browser releases when the page closes or crashes. `state` is `sending`, `failed` or `returned`. `sent` entries live only in memory. A row is never the proof that the server stored a message; only a 201 or the stream event is.

| # | Path | Memory | Store |
|---|---|---|---|
| 1 | composer send → `enqueue` | new `sending` entry, or the returned key reused for the same conversation, project and text, handed back at most 10 minutes ago. A task's conversation is the task itself (its replies can move it to a new build; the server keeps their keys per task). A Coordinator conversation is the scope and thread or (for a returned null-thread key) the global thread | put `sending`; delete the returned rows that enqueue retires |
| 2 | dispatch, before POST: one chain per conversation, the same identity as row 1 (a new Coordinator conversation by scope and project, and the thread id it creates joins that chain) | — | waits for row 1's put, at most 1 s; a failed or stuck put still sends (memory only, as before) |
| 2a | no response 30 s after the request starts | the request is aborted; `failed` with `timeout` (delivery unknown); the next message of that conversation goes out | as row 5 |
| 3 | POST 201 | `sent` with message id; null-thread followers of the same scope take the new thread id | delete the row; followers stay `null` in the store, which resends to the same global thread |
| 4 | stream `message` with this `clientMessageId` (`land`) | `sent`, from `sending` or `failed`. For a returned key, a mounted composer of that conversation removes the text if it is unchanged and retires the key | delete the row; a returned row only when such a composer saw the arrival, otherwise an unchanged resend still reuses the key until it expires |
| 5 | POST error while still `sending` | `failed` only after the store write settles (at most 1 s) | put `failed` only if the row still exists |
| 5a | POST error after `land` | stays `sent` | nothing |
| 6 | composer effect `discard` of a failed entry (an archived or closed task has no composer that takes text, so its entry stays `failed` and its text shows under the error) | moved to returned, text to the composer | put `returned`, with `createdAt` set to now, only if the row still exists |
| 6a | a task send fails while that task is not open | as row 5, plus one toast that opens the task | as row 5 |
| 7 | `settle` | drops `sent` entries | nothing |
| 8 | the app shell mounts with a scope (`resume`; no conversation has to be open) | once per scope per page: rows of this scope, not already in memory, whose owner lock is not held; `returned` rows older than 10 minutes are deleted; the rest, by `createdAt`: `sending` rows at most 10 minutes old are sent under their key before any later send in their conversation, older ones become `failed` with `stale` and are not sent, `failed` appended (row 6 returns them), `returned` join the returned list. Each failure found or hit here raises a toast that opens the conversation; a row already stored as `failed` was reported by the page that failed it, so it raises none. Sends made during the load wait for it, at most 5 s | put each taken row with this page as owner |
| 9 | reload from PR #4854 (background tab, new deploy), plain reload, closed tab, renderer crash | lost with the page | rows survive; row 8 on the next load |
| 9a | PR #4854 deploy check | `busy()` is true while an entry is `sending`, while a task reply is `failed` until it is handed back or lands (its notice must not be reloaded away), or while a Coordinator entry is `failed` without a scope or with a failed store write; it then shows the `有新版本` prompt instead of reloading | — |
| 10 | render (`unlandedItems`) | a `null`-thread entry shows in the global thread's view | — |

## Failures

- Crash after the put, before or during the POST: row 8 resends under the same id. One message either way.
- Crash before the put commits: lost, as before. The window is the IndexedDB commit; dispatch waits for it.
- Delete fails after a 201: the next load resends; the ledger returns the stored message.
- Task replies post to `POST /api/conversations/:id/messages` (`mode: queue`) or `POST /api/todos/:id/messages`, and an unchanged resend can take the other route because the task's state changed. Both routes share one in-flight run per task and key and answer from the state the first send is in now (next section).
- A send older than 10 minutes may have been accepted before the page closed. Resending the returned text before the next reload reuses the key.
- IndexedDB unavailable, quota, or an open that blocks: every write is raced against 1 s and errors are swallowed, so sends behave as before. A failed entry whose write did not land holds back the app-update reload, because only this page has its text.
- Two tabs: a row owned by a live page is left to it. If both still POST one id, the claim returns one stored message to both; a later failure cannot recreate a row the other tab deleted (rows 5 and 6 are conditional).
- Crash between the draft write and the `returned` put: the row comes back `failed` and its text is appended to the draft a second time. Text duplication only, never a second server message, because the key is kept.
- A send refused as removed from the queue hands its text back without its key, so sending that text again is a new message.
- A returned key reused for the same text sends a retransmission that returns the earlier message. Limited to 10 minutes after the text was handed back, with or without a reload; after that the same words are a new message.
- Two or more handed-back messages joined in one draft and sent as one text are a new message, as are the same words sent after another message or after the 10 minutes. The timeout copy therefore promises nothing about duplicates and asks the user to check the conversation. When one of them turns out to have arrived, it is removed from the draft wherever it stands.
- A row of another user or team stays stored until that scope is opened in this browser.

## A task message resent under its key

A queued message has no receipt copy of its own. The queue route marks its ledger row, and each resend reads the queued row that receipt points to (`apps/server/src/services/queued-send.ts`).

| State of the first send | Resend |
|---|---|
| Handed to the agent, by either route | success, nothing inserted, also after the task closes |
| Queued behind an active step of the task's latest build, no delivery error | success, nothing inserted; stop-and-send marks it to run after the stop |
| Held by a Stop: the latest run's last step is stopped, no delivery error, task open | success, nothing inserted and nothing started; the row stays queued with its send now and remove controls. A stop-and-send resend takes the next row instead, so it is delivered |
| Queued where no active step will drain it: failed turn, older build, delivery error, archived or closed task | one run removes the queued row and its receipt and sends the resend as a new message through the requested route; a refused or failed send puts both back and returns the error, except a row the user cancelled meanwhile |
| The same, but the queued row was edited since | only the receipt is replaced; the edited row stays queued beside the resent text |
| Cancelled by the user | the cancel marks the receipt cancelled in the same transaction; every resend under that key, in any send mode, is refused with 409 `queued-message-cancelled` and nothing is inserted. A cancel that arrives while an earlier resend is still in flight wins: that resend is refused at its commit, whether it was about to succeed or fail |
| Never received | normal send. A queue send addressed to an earlier run of the task goes to the task's latest run |

A crash between the removal and the new send leaves neither row; the browser still holds the text and its resend is a new message.

## Waiting messages follow the task's run

Waiting rows follow the task onto the next run in two transactions, both through `moveQueuedMessages`: a message `sendBuildSteer` delivers to another run, and every restart of a failed run (Retry, a Coordinator restart, an automatic retry; a new run or a reopened PR run). Creation time and insert order are unchanged, so they are handed over one per turn in the order typed. No run begun through `startBuilds` moves them (the Start action, a reply to a stopped task that begins a new run, and its other callers); those rows stay on the old run.

| Case | Result |
|---|---|
| Restart on the same run, or a quota wait resumed | rows stay where they are |
| Restart refused: task changed or archived, a step still active, PR unreadable | rows stay on the failed run |
| Retry pressed twice under one key | the second press changes nothing |
| A row with a delivery error | moves with its error, stays visible, is not sent by itself |
| A row marked to run after a stop | keeps the mark |
| The new run fails too | rows wait on it; a later restart that continues on another run moves them again |
| Remove pressed on a page still showing the old run | the row is matched among the task's runs, removed and its receipt released |
| Edit or send now pressed on such a page | refused as already delivered, until the page shows the new run |
| A carried message resent under its key while its row will still run | success, answered with the run the row is on now |
| The same resend when the row will not run (it has an error, or the new run failed or stopped) | the failed-turn or held-by-a-Stop row of the previous section applies, whichever run the resend is addressed to |

## Tests

`apps/server/test/composer-queue-stop.test.ts` covers one key across both task routes, and `apps/server/test/composer-resend-fate.test.ts` covers each state above through both routes, and concurrent resends through both routes while a send is slow. `apps/server/test/retry-carries-queue.test.ts` covers the move on restart. `apps/web/test/outbox-send-tails.test.ts` covers the update hold, the key of handed-back text, the refusal copy and the single timeout notice. `apps/web/test/outbox-persist-lanes.test.ts` covers per-conversation chains, the 30 s timeout, the 10 minute window, task rows and late arrival. `apps/web/test/chief-outbox.test.ts` with an in-memory store: one test per table row, plus a stuck write, failed-after-stored, the other-page delete, land on a returned key, a live owner, re-ownership, expiry, ordering against a send made during the load. Playwright `apps/web/e2e/chief-send-retry.spec.ts`: renderer crash while the POST is held before the server stores it; crash after the server stored it and before the response; reload while sending. Live acceptance reruns the probe's crash window against a built stack and checks `chief_message` and `client_message`.

## Risk

Two-way door: an empty store is today's behavior. The ledger rows written by the task queue route gain a `via` mark; no schema or wire change. Blast radius: every Coordinator send and task reply.
