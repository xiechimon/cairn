# Chief outbox persistence

Status: reviewed (read-only design review, go after changes; the changes are folded in below). Prior art: `docs/research/chief-outbox-persistence-2026-11-15.md`. This is the chief composer slice of `docs/design/message-first-sending.md`: text only, the two routes the chief composer posts to, no drainer generation fence, no tombstone.

## Problem

`apps/web/src/chief/outbox.ts` held every unsent Coordinator message in a module array. The composer clears when the message is enqueued. A renderer crash, a closed tab or a reload while the POST has not been accepted lost the bubble, the text and the client id. The isolated probe at `7d2b48d58` reproduced it with a renderer crash (`renderer-crash-outbox.json`). A send that fails while the page lives was not affected: its text goes back to the composer draft, which is persisted.

## Server contract this relies on (unchanged)

The chief composer posts to `POST /api/teams/:id/chief/threads` (no thread yet) and `POST /api/conversations/:chiefThread/messages` (`chiefSend` in `apps/web/src/api/hooks.ts`). Both run `submitChiefMessage`, which claims `(threadId, clientMessageId)` in `client_message` inside the transaction that inserts the message and enqueues the turn, with no `await` between the replay check and that transaction. A repeat of the id on the same scope returns the stored response, inserts nothing, starts no turn and publishes no stream event (`client-message-chief.test.ts`). For `threadId: null` the scope is the calling user's global Coordinator thread (no project, never archived); the first POST creates it and claims the id there, so a resend finds the same ledger row. A thread that was archived since still replays a stored message, because the replay lookup has no archive filter; the 409 only answers a message that was never stored. A repeat with different content returns the original message: that is the existing contract and stays. A resend always carries the stored text. The durable Thread routes, which answer 409 to a changed payload, are not on `main` and the chief composer does not call them.

## State

IndexedDB database `cairn-chief-outbox`, store `entries` keyed by `key`, through a thin wrapper over the IndexedDB API (no new dependency: four operations, one a conditional write in one transaction; a blocked open rejects). One row per client id: `{ key, scope, owner, threadId, projectId, text, state, createdAt }`. `scope` is `userId/teamId` (IndexedDB is per origin, not per user); `owner` is the page that holds the row, and each page holds the Web Lock `cairn-chief-outbox:<owner>` for its lifetime, which the browser releases when the page closes or crashes. `state` is `sending`, `failed` or `returned`. `sent` entries live only in memory. A row is never the proof that the server stored a message; only a 201 or the stream event is.

| # | Path | Memory | Store |
|---|---|---|---|
| 1 | composer send → `enqueue` | new `sending` entry, or the returned key reused for the same scope, project and text, in the same thread or (for a returned null-thread key) the global thread | put `sending`; delete the returned rows that enqueue retires |
| 2 | dispatch, before POST | — | waits for row 1's put, at most 1 s; a failed or stuck put still sends (memory only, as before) |
| 3 | POST 201 | `sent` with message id; null-thread followers of the same scope take the new thread id | delete the row; followers stay `null` in the store, which resends to the same global thread |
| 4 | stream `message` with this `clientMessageId` (`land`) | `sent`, only from `sending` | delete the row |
| 5 | POST error while still `sending` | `failed` only after the store write settles (at most 1 s) | put `failed` only if the row still exists |
| 5a | POST error after `land` | stays `sent` | nothing |
| 6 | composer effect `discard` of a failed entry | moved to returned, text to the composer | put `returned` only if the row still exists |
| 7 | `settle` | drops `sent` entries | nothing |
| 8 | live surface mounts with a scope (`resume`, queued first on the dispatch chain) | once per scope per page: rows of this scope, not already in memory, whose owner lock is not held; `returned` rows older than 10 minutes are deleted; the rest, by `createdAt`: `sending` appended and sent under their key before any later send, `failed` appended (row 6 returns them), `returned` join the returned list | put each taken row with this page as owner |
| 9 | reload from PR #4854 (background tab, new deploy), plain reload, closed tab, renderer crash | lost with the page | rows survive; row 8 on the next load |
| 9a | PR #4854 deploy check while an entry is `sending` | `busy()` is true, so it shows the `有新版本` prompt instead of reloading | — |
| 10 | render (`unlandedItems`) | a `null`-thread entry shows in the global thread's view | — |

## Failures

- Crash after the put, before or during the POST: row 8 resends under the same id. One message either way.
- Crash before the put commits: lost, as before. The window is the IndexedDB commit; dispatch waits for it.
- Delete fails after a 201: the next load resends; the ledger returns the stored message.
- IndexedDB unavailable, quota, or an open that blocks: every write is raced against 1 s and errors are swallowed, so sends behave as before.
- Two tabs: a row owned by a live page is left to it. If both still POST one id, the claim returns one stored message to both; a later failure cannot recreate a row the other tab deleted (rows 5 and 6 are conditional).
- Crash between the draft write and the `returned` put: the row comes back `failed` and its text is appended to the draft a second time. Text duplication only, never a second server message, because the key is kept.
- A returned key reused for the same text sends a retransmission that returns the earlier message. Limited to 10 minutes after a reload.
- A row of another user or team stays stored until that scope is opened in this browser.

## Tests

`apps/web/test/chief-outbox.test.ts` with an in-memory store: one test per table row, plus a stuck write, failed-after-stored, the other-page delete, land on a returned key, a live owner, re-ownership, expiry, ordering against a send made during the load. Playwright `apps/web/e2e/chief-send-retry.spec.ts`: renderer crash while the POST is held before the server stores it; crash after the server stored it and before the response; reload while sending. Live acceptance reruns the probe's crash window against a built stack and checks `chief_message` and `client_message`.

## Risk

Two-way door: an empty store is today's behavior. No server or protocol change. Blast radius: every Coordinator send.
