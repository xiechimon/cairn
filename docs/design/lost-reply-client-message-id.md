# Lost reply clientMessageId retirement and opensAtTop anchor fix — plan, 2026-11-27

## User scenario

Imagine someone who installed Cairn today and is replying to a task or to Coordinator. Before clicking Send completes—perhaps the tab closes, reloads, switches away, or hits a brief network drop right after the server commits the message—their browser still holds a saved copy in IndexedDB with no record of the server-assigned row id. When they reopen that thread, the server already has the message, yet without a shared key the browser cannot tell its saved copy apart from the server row, leaving a stale duplicate, an errant resend, or a sticky failure banner. Separately, when they reopen a finished task whose agent already produced long output before their first follow-up reply, the transcript opens jumped ~2070 px back to the top instead of anchored at their follow-up message.

- **Prior knowledge needed**: None beyond typing in the Cairn reply composer.
- **Accounts, payments, keys**: None beyond the user's existing Cairn session; no external keys or billing changes.
- **Storage**: Additive nullable `clientMessageId` columns in existing server SQLite tables (`message`, `queued_message`, `chief_message`), paired with retiring matching entries in the browser's existing IndexedDB outbox (`cairn-task-outbox` / `cairn-chief-outbox`) upon message-list load.
- **Failure visibility**: If a reply truly never reached the server, the failed entry remains visible and recoverable in the composer; if the server already stored or queued it, loading the thread immediately retires the browser copy, clears any false error banner, and shows the single server copy.

| Scenario | What the user sees | What the system does | Wait & cost |
|---|---|---|---|
| Reply committed on server while HTTP response drops | On reopen or reload, only the single server message renders with no duplicate bubble or false resend | Server returns `clientMessageId` on `messages`; web outbox matches `clientMessageId`, retires saved entry, preserves stable React key | Immediate on initial page fetch; 0 extra requests |
| Queued / `stop-and-send` reply reloaded while queued or after drain | Single queued capsule while waiting; single user bubble once drained, no ghost outbox bubble | `queued_message.clientMessageId` returns in `queuedMessages` and copies into `message` via `sseClientMessageId` on drain | Immediate; 0 extra requests |
| Previously failed or returned-to-draft entry actually landed on server | False send error disappears and returned draft text strips cleanly when opening the thread | `landKnown` reconciles `'failed'` and `'returned'` entries (including after delayed IndexedDB `resume()`) | Immediate on load/resume; 0 cost |
| Reopening finished task with >2000 px agent work before user's first follow-up | Opens anchored at the user's follow-up bubble instead of jumping to `scrollTop = 0` | `opensAtTopOf` checks that nothing precedes the single user bubble except optional `run` header | Instant; 0 cost |
| Reopening finished task whose only user message is at the start (`DEMO.cartMerge`) | Opens cleanly at `scrollTop = 0` | `opensAtTopOf` returns `true` when `!hasEarlier` and single user bubble has only `run` rows before it | Instant; 0 cost |
| Last released daemon (`desktop-v0.1.787`) paired with updated server | Enrolls, claims steps, steers, and finishes turns normally | Nullable columns + optional schema fields keep daemon/step wire payloads unchanged | Zero downtime or daemon upgrade required |

## Scope

1. **Additive SQLite schema & migration (`apps/server/src/db/schema.ts`, `apps/server/drizzle/`)**:
   - Add nullable `clientMessageId: text('clientMessageId')` via one additive Drizzle migration (`0263_*.sql`) to `message`, `queued_message`, and `chief_message`.
   - Update synthetic rows constructed in `chiefMessagesWithTurnBoundaries` (`apps/server/src/services/message-page.ts`) with `clientMessageId: null` to match `chiefMessage.$inferSelect`.
2. **Shared wire schema (`packages/shared/src/records/message.ts`)**:
   - Add `clientMessageId: z.string().nullish()` to `transcriptRowSchema` and to each element of `conversationMessagesResponseSchema.shape.queuedMessages`.
3. **Persist `clientMessageId` across every server user-message writer**:
   - `insertMessageRow` (`apps/server/src/services/transcript.ts`): persist `clientMessageId: clientMessageId ?? null` on `message` insert and emit `clientMessageId` via `publishMessage` when non-null.
   - `sendBuildSteer` (`apps/server/src/services/build-steer.ts`), `applyBuildStepAction` (`apps/server/src/services/build-step-action.ts`), and `restartFailedBuild` (`apps/server/src/services/build-restart.ts`): compute external key via helper (`sseClientMessageId` if present, else `body.clientMessageId` when not starting with `'nested:'`) and pass it to `insertMessageRow`, ensuring internal `nested:<todoId>:<clientMessageId>` ledger keys never leak onto `message.clientMessageId`.
   - `queueTaskMessage` (`apps/server/src/services/task-message-queue.ts`): persist `clientMessageId: clientMessageId ?? null` when inserting into `queued_message`.
   - `deliverQueuedMessage` (`apps/server/src/services/task-message-queue.ts`): pass `{ afterTurn: true, ...(row.clientMessageId != null ? { sseClientMessageId: row.clientMessageId } : {}) }` into `sendBuildSteer` (NOT `body.clientMessageId`, avoiding any collision with `client_message` ledger rows).
   - `submitChiefMessage` (`apps/server/src/services/chief.ts`): persist `clientMessageId: body.clientMessageId ?? null` on `chief_message` insert and include `clientMessageId` on the returned/published message object (`sendDesignComments` inherits this via `sendChiefMessageFromComposer` -> `submitChiefMessage`).
   - `moveQueuedMessages` and `replacingStrandedSend` (`apps/server/src/services/queued-send.ts`): preserve `queued_message.clientMessageId` automatically on in-place `conversationId` updates; stranded replacement deletes the old row and inserts with the caller's `clientMessageId`.
4. **Expose `clientMessageId` on `GET /api/conversations/:id/messages` (`apps/server/src/routes-builds.ts`)**:
   - Include `clientMessageId` on returned `messages` (both `chiefMessage` and task `message` paths) and on `queuedMessages` elements when non-null (omit property when `null` to keep existing non-keyed payloads and strict-equality checks untouched).
5. **Retire browser outbox entries on server load (`apps/web/src/chief/outbox.ts`, `apps/web/src/board/task-outbox.ts`, `apps/web/src/board/use-thread-chat.ts`, `apps/web/src/chief/use-chief-surface.ts`, `apps/web/src/api/mappers.ts`)**:
   - Add `landKnown(loaded: ReadonlyMap<string, string>)` on `Outbox` (`apps/web/src/chief/outbox.ts`) to remove matching `'sending'`, `'sent'`, `'failed'`, or `'returned'` entries from `list` and `returned` (updating `sentKeys`, invoking `lateListeners` for `'returned'`, clearing `pendingRefetchKeys`, deleting from IndexedDB, notifying listeners). When `land` or `landKnown` matches a `'returned'` entry before its composer registers `subscribeLateArrival`, retain `(key -> entry)` in `pendingLateArrivals` and replay it as soon as `subscribeLateArrival` subscribes so React `useEffect` ordering never skips draft cleanup.
   - In `resume()` (`apps/web/src/chief/outbox.ts`), notify listeners even when only `'returned'` rows are restored so mounted surfaces reconcile even if IndexedDB finished loading after the server query settled.
   - In `useThreadChat` (`apps/web/src/board/use-thread-chat.ts`) and `useChiefSurface` (`apps/web/src/chief/use-chief-surface.ts`): build `knownClientIds` (`Map<clientMessageId, rowId>`) from loaded `messages` and `newest?.queuedMessages`; pass `knownClientIds` into `unlandedTaskBubbles` / `unlandedItems` so duplicate optimistic bubbles never appear even on the first frame; call `landKnown(knownClientIds)` inside the settlement effect before `settle(buildId, knownWithQueued, ...)`; clear `taskOutboxErrors` for `todoId` when its last failed entry is retired by server confirmation.
   - In `mapTranscript` and `mapChief` (`apps/web/src/api/mappers.ts`), compute `outboxKey` from `m.clientMessageId ?? sentKey?.(m.id)` so React keeps stable keys when an optimistic bubble is replaced by the confirmed server row.
6. **Fix `opensAtTop` separately (`apps/web/src/detail/scroll-anchor.ts`, `apps/web/src/detail/transcript-column.tsx`)**:
   - Add `opensAtTopOf(transcript, hasEarlier)` returning `true` only when `!hasEarlier`, there is exactly one `kind === 'user'` item in `transcript`, and every preceding item in `transcript` has `kind === 'run'`.
   - Replace `const opensAtTop = bubbles?.length === 1 && !hasEarlier;` in `TranscriptColumnInner` with `const opensAtTop = opensAtTopOf(transcript, hasEarlier);`.
   - Keep `anchoredKey.current === threadKey` single-anchor behavior unchanged (no provisional re-anchoring loop, no scroll hijacking during pending sends or earlier-page loads, `DEMO.cartMerge` continues opening at `scrollTop = 0`).

## States, readers, writers and failure paths

- **Outbox entry states**: `sending` -> `sent` (on HTTP response or SSE `message`) -> removed on `settle`; `sending` -> `failed` (on timeout/error) -> `returned` (on `discard`). With this change, any state (`sending`, `sent`, `failed`, `returned`) transitions directly to **retired** whenever `knownClientIds` from `GET /api/conversations/:id/messages` (or `queuedMessages`) matches `entry.key`.
- **Database writers**: `insertMessageRow` (`transcript.ts`), `sendBuildSteer` (`build-steer.ts`), `applyBuildStepAction` (`build-step-action.ts`), `restartFailedBuild` (`build-restart.ts`), `queueTaskMessage` / `deliverQueuedMessage` (`task-message-queue.ts`), `submitChiefMessage` (`chief.ts`), `sendDesignComments` (via `submitChiefMessage`), `moveQueuedMessages` / `replacingStrandedSend` (`queued-send.ts`).
- **Database & API readers**: `newestMessagePage` (`message-page.ts`), `readQueuedMessages` (`task-message-queue.ts`), `GET /api/conversations/:id/messages` (`routes-builds.ts`), `mapTranscript` / `mapChief` (`mappers.ts`), `useThreadChat` (`use-thread-chat.ts`), `useChiefSurface` (`use-chief-surface.ts`).
- **Failure paths**: Transaction rollbacks leave zero inserted message/ledger rows; legacy rows with `clientMessageId = null` are skipped cleanly without breaking schema parsing; messages older than page 1 remain idempotently deduplicated by `client_message` on `resume()` or retire when earlier pages are fetched; if `landKnown` retires an in-flight `resume()` entry while its POST resolves, `sendingEntry(key)` returns `null` so state update does not resurrect it.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Task reply (`steer`, `new-turn`, `revision`, `restart`) committed on server while HTTP response drops | Reloading returns `clientMessageId` in `messages`; one server bubble shows, no duplicate or resend | `apps/server/test/message-client-id.test.ts`, `apps/web/test/outbox-retire-on-load.test.ts` | this change |
| Queued or `stop-and-send` task message reloaded while still in `queued_message` | `queuedMessages` carries `clientMessageId`; outbox entry retires and only the queued capsule renders | `apps/server/test/message-client-id.test.ts`, `apps/web/test/outbox-retire-on-load.test.ts` | this change |
| Queued task message drains into `message` (auto-drain or Send Now) | `deliverQueuedMessage` copies `row.clientMessageId` onto `message` via `sseClientMessageId` without `client_message` ledger conflict | `apps/server/test/message-client-id.test.ts` | this change |
| Queued message moves to a new build (`moveQueuedMessages`) or replaces stranded send | `clientMessageId` stays on target build and retires an outbox entry still pointing at the old `buildId` | `apps/server/test/message-client-id.test.ts`, `apps/web/test/outbox-retire-on-load.test.ts` | this change |
| Coordinator (`chief_message`) send commits while HTTP response drops | Reopening returns `clientMessageId` on `chief_message`; `chiefOutbox` retires with one server bubble | `apps/server/test/message-client-id.test.ts`, `apps/web/test/outbox-retire-on-load.test.ts` | this change |
| Coordinator-origin synthetic thread message using internal `nested:` ledger key | Internal `nested:` key never leaks onto `message.clientMessageId` | `apps/server/test/message-client-id.test.ts` | this change |
| Pre-migration rows with `clientMessageId = null` | Response omits `clientMessageId`; shared schemas and UI parse without errors | `apps/server/test/message-client-id.test.ts` | this change |
| Failed or returned-to-draft outbox entry already committed on server (even when IndexedDB `resume()` finishes after messages loaded) | Error banner clears and returned text strips from composer draft with zero stale resend | `apps/web/test/outbox-retire-on-load.test.ts` | this change |
| Reopening finished task with long (~2070 px) agent output before the user's single follow-up reply | Opens anchored at the user's follow-up bubble instead of jumping to `scrollTop = 0` | `apps/web/test/scroll-anchor.test.ts`, `apps/web/e2e/detail-lost-reply-reopen.spec.ts` | this change |
| Reopening finished task whose single user message is at start (`DEMO.cartMerge`, `!hasEarlier`, only `run` before `user`) | Opens cleanly at `scrollTop = 0` with no blank space below | `apps/web/test/scroll-anchor.test.ts`, `apps/web/e2e/detail-lost-reply-reopen.spec.ts` | this change |
| Reader scrolling during a pending send or loading earlier pages (`hasEarlier = true`) | View is never yanked away from the reader's scroll position; `opensAtTopOf` stays `false` | `apps/web/test/scroll-anchor.test.ts`, `apps/web/e2e/detail-lost-reply-reopen.spec.ts` | this change |
| Legacy client/daemon payloads omitting `clientMessageId` and existing daemon step-claim/turn protocol | Step claims and completes normally with no protocol or wire-schema rejection | `apps/server/test/message-client-id.test.ts` | this change |

## Out of scope

- Changing `commitStoppedRestart` (`POST /api/todos/:id/messages` on `phase === 'stopped'`) to insert an immediate `message` row (composer stopped replies go through `queueTaskMessage` -> `sendBuildSteer`, which already inserts `message.clientMessageId`).
- Backfilling `clientMessageId` on pre-migration rows already stored in SQLite.
- Item 5 send findings (queue body trim mismatch, deleted-task silent update on saved failed reply, send failure masked by panel loading/error state, double-click retry toast) — tracked in Slice 5.
- Adding provisional re-anchoring timers or loops to `TranscriptColumn`.

## Review

- Verdict: PASS
- Plan-SHA256: bd4d5a3b076343e2e6c4cd2f6b716951b1e77b1df298f5110a8b16c5e8ec8733
- Author-Model: google/gemini-3.1-pro
- Reviewer: openai-codex/gpt-6.2-sol (pi-review)
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: 0 blocking; ian 2026-11-27 directed single-pass review without waiting on a second plan review
