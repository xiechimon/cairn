# Message-first sending

Status: proposal for the owner's review. Nothing here is built. Checked against `origin/main` at `f6411d379f9f5097f3ec2e0cb96ab568ccb07b92`. Prior art: `docs/research/message-first-sending-2026-11-11.md`.

The owner's rule: what the user sends shows at once; the network works behind it. Today the web awaits the request. `composer-wire.ts` clears the draft only after the promise resolves, and a rejection leaves the text in the composer. `useSendKey` keeps the idempotency id in memory until `settle()`, so a reload mints a new id.

## Recommendation

A client outbox, not a new server table. One drainer is the only retry path. The server ledger stays the retransmission record. Do not add tus, and do not allow video, while the cap is 10 MB. Do not change `apps/server/src/lib/attachments-token.ts`.

`packages/shared/src/attachment-types.ts` is not on main. The allowlist is inline in `apps/server/src/services/attachments.ts` and copied in `apps/web/src/api/attachments.ts`. PR #3924 adds that shared file and still has no video type. The implementation edits whichever copy is on main when it starts, and does not add a third.

## Ledger, as it is

`client_message` is keyed by `(scopeId, clientMessageId)` (`apps/server/src/db/schema.ts`). `findClientMessage` treats a null `response` as missing. `claimClientMessage` inserts null and throws `ClientMessageConflict` on a duplicate. `completeClientMessage` stores the response. `replayAfterConflict` returns the stored response only when it is non-null; a claimed row with a null response is rethrown. `coalesceClientMessage` joins an in-process retry. An omitted id skips the ledger.

A committed row from the three transactional writers has a non-null response, because claim and complete share one transaction. A retry of that same route and scope returns the stored response and does not insert again. `integration/test/client-message-idempotency.test.ts` covers the coordinator HTTP route. A retry on a different scope is a different request.

| # | Path | Scope | Reads | Writes | Retry after success | If the id is omitted |
|---|---|---|---|---|---|---|
| 1 | `POST /api/teams/:id/coordinator/messages` → `sendChiefMessageFromComposer` | chief thread id | `findClientMessage` | claim and complete in one transaction | returns the stored send | second message |
| 2 | `POST /api/teams/:id/chief/threads` | thread id | same | same | same | second message |
| 3 | `POST /api/conversations/:id/messages`, chief branch | thread id | same | same | same | second message |
| 4 | same route, steer → `sendBuildSteer` | conversation id | same | same | returns the stored steer | second steer |
| 5 | same route, `mode=queue` → `queueTaskMessage` | conversation id | same | same | returns the stored queue row | second queue row |
| 6 | same route, deliver / edit / cancel of a queued id | — | no | no | not a send retry | — |
| 7 | `POST /api/todos/:id/messages` → `messageThreadAsUser` | todo id | find, then `coalesceClientMessage` | claim after `deliver()`, response already set | returns the stored thread result if that claim committed | id is required |
| 8 | inner `sendBuildSteer` from row 7 | conversation id | find | claim and complete | a lost outer claim does not double-steer | id is passed through |
| 9 | `applyBuildStepAction` revision or restart, from row 7 or `POST /api/builds/:id/steps` | id is on the body and unused | no | no | a second call applies again | required on those actions, ignored |
| 10 | `stoppedBeforeFirstRun` → `startThreadBuild` | — | no | no | a second call can start another build | — |
| 11 | `messageTodo` (MCP face and `reply_thread` steer) | — | no | no | second post | always omitted |
| 12 | MCP `reply_thread` queue, coordinator reply, `start_thread` | — | no | no | second post | always omitted |
| 13 | `answerTaskQuestion`, `chief-router-tools` | minted id | inner path | inner path | not a client retry | a new id each call |
| 14 | `needs-you` restart, scheduler `sendBuildSteer` | minted or omitted | no on the restart; none on the wake | no | restart applies again; each wake is a new steer | restart id is ignored; wake omits it |
| 15 | iOS `SendBody` (`/api/todos/:id/messages`, `/api/conversations/:id/messages`, `/api/teams/:id/chief/threads`) | route it posts | depends | depends | a new struct is a new UUID | — |

Person HTTP routes 1–5 must require the id, matching row 7. Rows 9 and 10 must record the id before the side effect, on the scope the client retries, and a second apply must return. Agent paths that can run twice (11, 12, 14) mint an id and the receiver records it. iOS stores the id with the outbox item; a rebuilt body must not mint another.

## Outbox

State lives in IndexedDB, one row per send, per browser profile. It is not `composer_draft` and not `localStorage`. Fields: `clientMessageId`, `enqueueSeq`, route, scope id, content, attachment blobs, state, `dispatchedAt` (set in the IndexedDB transaction that starts `fetch`, never cleared, and not proof the server stored a row), server message id once known. `enqueueSeq` is a monotonic integer assigned at enqueue and never reused. `clientMessageId` is a UUID, so IndexedDB key order is not enqueue order. Rendering and draining both sort by `enqueueSeq`.

States: `uploading`, `pending`, `failed`, `cancelled`. Ack deletes a live row. A `cancelled` row is a tombstone. It keeps id, route, and scope, and it does not replay the send body. `findClientMessage` returns only a non-null `response`, and main has no public lookup route, so cancellation adds a person-session read-or-suppress call on the same scope and `clientMessageId`. It is not added to `isExempt`. A stored response is withdrawn or cancelled, then the tombstone is deleted. No row: the call inserts a suppression marker in one transaction and does not run the send handler. A later POST of that id hits `claimClientMessage`, gets the marker back, and does not insert a message or start a turn. A null `response` is in-flight; suppress retries the read and does not claim.

| From | To | When |
|---|---|---|
| composer send | `uploading` | any attachment blob is not ready |
| composer send | `pending` | text only, or every attachment is ready |
| `uploading` | `pending` | every upload reached `ready` |
| `uploading` or `pending` | `failed` | upload failed, or the send returned an error that is not a stored response |
| `pending` | deleted | a success response for that route: a server message id where the route returns one; on `POST /api/todos/:id/messages` the stored `ThreadMessageResult` itself is the ack, matched by `clientMessageId` |
| `failed` | `pending` or `uploading` | Retry, same id and same route |
| any, never dispatched | deleted | Delete before the first POST |
| any, `dispatchedAt` set or in flight | `cancelled` | Delete before ack. Abort the local `fetch`. Survives reload. Does not POST the body. An edit is not this row until suppression or withdraw has succeeded |
| `cancelled` | deleted | Lookup-or-suppress returns a stored response and withdraw or cancel succeeds, or it inserts a suppression marker because nothing was stored. Never a replay of the send |

The composer clears when the row is enqueued. `发送失败，请重试。` and `没发给 #{seq}，再试一次。` move onto the transcript row, with Retry, Edit, and Delete. Edit keeps the id only while `fetch` has not started. Once `fetch` has started, an edit aborts that fetch and runs lookup-or-suppress, but it does not enqueue a replacement yet. The replacement, with a new id and a later `enqueueSeq`, is enqueued only after that call confirms the original was suppressed or withdrawn. Aborting the local fetch does not undo a commit that already happened. `withdrawChiefMessage` returns 409 once the chief turn has started (`chief-turns.ts`). A committed steer, revision, restart, or todo message (rows 4, 7, 9, and 10) has no withdraw. In those cases the original stands, the edit is not applied, and the transcript says so. Reusing the id would replay the original content. Delete after ack uses `withdrawChiefMessage` or `cancelQueuedMessage`, and if the turn has started the message stands.

Ordering: `readConversationPage` walks `createdAt` then `rowid` (`apps/server/src/services/conversation-page.ts`). Pending rows render after that page, and the drainer sends them, both sorted by `enqueueSeq`. On ack, drop the local row and let the server position stand. Match the server message id from the stored response, not the text; the todo route has no message id, so its row is dropped on the stored result and the server page positions the message.

Two tabs share the database. One tab drains, holding the Web Locks API lock `cairn-outbox` (`navigator.locks.request` with exclusive mode). The browser releases the lock when the holding tab closes, crashes or is discarded, and the next waiting tab acquires it and drains; no lease timestamps are stored. A suspended holder keeps the lock, so a visible tab that waits longer than 30 seconds requests it with `steal: true`. Steal does not stop the old callback: released code keeps running, and `navigator.locks.query()` does not expose this document's client id, so an ownership check is not a fence. Persist `drainGeneration`. The stealer increments it in one IndexedDB transaction before any POST. Each callback captures the generation it acquired. Before every POST, one IndexedDB transaction re-reads `drainGeneration`, aborts unless it still matches, and only then sets `dispatchedAt` and `inflightGeneration` and starts `fetch`. A newer generation aborts the in-flight `fetch`. The new holder does not POST a row whose `inflightGeneration` is the generation it replaced until that flag is clear. A second POST of the same id is still safe only on routes that claim before the side effect; the generation check is what keeps the non-idempotent paths from running twice. Tests: closing the draining tab hands off to another; a steal stops the old callback before its next POST, including after it had already passed an earlier check; two tabs never POST one row at once.

## Attachment failure

`grantUpload` inserts `status=pending`. `uploadFile` requires the full body, an exact size match, and the grant mime, then sets `ready`. Nothing writes `failed`. The grant expires in five minutes (`ATTACHMENT_GRANT_TTL_MS`). A consumed grant answers 409. Size must be `1..ATTACHMENT_MAX_BYTES` (10 MB). `video/*` is not in the prefix list, and no video extension is in `ALLOWED_EXTS`. The web rejects the same size and mime before the grant (`附件上传失败`).

The picked file renders from a local blob immediately. The message waits in `uploading` and is not posted until every token exists. A failed upload marks that message `failed` and leaves the composer empty. Retry creates a new grant and uploads the same blob. If the row is already `ready`, skip the upload. Do not resume a consumed grant.

## Tests the implementation owes

One test per row above, plus: reload keeps a `pending` row and retries the same id; a retry after a committed coordinator send returns the stored message id; a retry of revision does not apply twice; a missing id on routes 1–5 is rejected; a failed send does not restore the composer; an upload failure marks the message and does not POST it; an acked row is not duplicated when the page arrives; a cancel whose POST never reached the server does not create the message; an edit whose lookup does not confirm suppression or withdraw does not enqueue a replacement; two offline sends render and drain in `enqueueSeq` order after reload.

## Risks

Two-way door for the outbox. The ledger change is two-way if the pending marker is additive and old clients that omit the id are rejected only on person routes. Blast radius is every composer send and every attachment. Not owner-routed unless the implementation edits `attachments-token.ts`, `routes-machine.ts`, or a `machine*.ts` service.

## Open decisions

- Video. Recommendation: no. 10 MB and a five-minute grant cannot carry it, and the allowlist on main has no video type.
- Chunked resume. Recommendation: no at this cap. Whole-file retry fits the grant.
- Edit after the server has accepted the message. Recommendation: no. Withdraw if that route has a withdraw and the turn has not started; otherwise the message stands and the replacement is not sent.

## Open for implementation

These notes are not settled here. Implementation must close them before the behavior ships. This page does not specify the procedure. Further notes on this page are the same deferral.

- Row 7 suppression. `messageThreadAsUser` claims after `deliver()` (`apps/server/src/services/thread-message.ts` on `origin/main`). An absent outer ledger row is not proof that no handler is running. Do not treat that as successful suppression.
- Abandoned `inflightGeneration`. A closed or suspended holder cannot clear the flag. Takeover must not wait forever for that callback.
- A ready attachment can sit in the outbox longer than the orphan grace. `sweepAttachmentBatches` deletes an unreferenced attachment after `ATTACHMENT_ORPHAN_GRACE_MS` (7 days, `apps/server/src/services/attachment-gc.ts`). Skipping the upload then posts a token for a deleted file. Re-upload when the server resource is gone is not specified here.
