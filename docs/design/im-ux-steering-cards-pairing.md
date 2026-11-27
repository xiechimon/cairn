# IM channel UX polish (suppress internal wake leaks, settle card buttons, in-app pairing banner, and IM steering) — plan, 2026-11-27

## User scenario

Someone who installed Cairn today connects **Telegram**, **Slack**, **WeChat**, or **iMessage** in **Settings -> Chat apps** (`/app/settings/im`) so they can message the Coordinator from their phone and approve action or question cards directly in chat. Credentials are stored encrypted in SQLite (`im_connection.secretCipher`); paired senders are allow-listed per connection. Four live UX defects currently interrupt everyday use:

1. **Internal Coordinator wake bookkeeping leaks back into chat**: Because inbound IM messages run as `[wake:wake]` event turns, after the Coordinator sends a reply or `ask_user` card via `notify_user` / `ask_user`, `turnFinished()` also forwards the Coordinator's final internal assistant summary (`"...并已通过 notify_user (provenance: im:...) 将结果回复至原私聊。本轮结束。"`) back to Slack, Telegram, and WeChat as a duplicate meta-log message.
2. **Slack and Telegram card buttons remain clickable forever after answering**: Clicking a confirmation button (`同意` / `取消`) resolves the card on the server, yet the Slack `actions` block and Telegram inline keyboard remain interactive in chat. Pressing again triggers `"这条消息已经处理过了。"`.
3. **Unknown-sender pairing requests require hunting into Settings**: When someone sends a first message from Slack/Telegram/WeChat, Cairn records an `im_pairing_request`, but the owner only sees it if they manually navigate to Settings -> Chat apps. Unlike device pairing requests (`PairingRequestBanner`), no global in-app approval banner appears.
4. **Consecutive IM messages queue strictly one-by-one without steering**: Sending two quick follow-up messages (e.g., a photo followed immediately by instructions) while an earlier same-origin IM turn is queued or running forces the first turn to finish in isolation before the second turn starts.

When a best-effort card-button cleanup call fails against Slack or Telegram, the card answer in Cairn still commits and fails safely; pairing banner approvals enforce a 1.5 s arm delay to prevent misclicks and surface toast feedback (`已批准配对` / `已拒绝配对` or `处理配对请求失败，请重试。`).

### Scenario table

| Situation the user meets | What they see | What the system does | Wait / cost |
|---|---|---|---|
| Coordinator uses `notify_user` or `ask_user` during an IM-originated turn and then emits an internal wake completion note | User receives only the real reply or question card in IM; internal `provenance: im:...` summary stays hidden | `turnFinished()` checks for an `external_effect` (`kind='im-send'`, `stepId=stepRow.id`); if already sent during the step, skips `lastAssistantText(stepRow)` (turns with no `notify_user`/`ask_user` still forward direct `lastAssistantText` replies) | None |
| User clicks a Slack or Telegram option button on a pending (or already-settled) card | Interactive buttons disappear immediately (`chat.update` replaces `actions` block with context summary on Slack; `editMessageReplyMarkup` clears inline keyboard on Telegram) | Adapter captures `cardMessage` metadata on action and implements optional `settleCard(ref, summary)`; `answerCard` settles both fresh answers (`已选择：<label>`) and stale clicks (`已处理`) best-effort | <300 ms API call, $0 |
| Paired or unpaired contact initiates IM pairing while owner is anywhere in Cairn Web/Desktop (e.g., `/app` board) | Non-blocking top-right popover card shows platform (`Slack`/`Telegram`/`微信`/`iMessage`) and sender name with `拒绝` / `批准` buttons | `PairingRequestBanner` polls active team's `/api/teams/:id/im/pairing-requests` alongside device requests, filters `pending`, enforces 1.5 s arm delay on `批准`, and submits approve/reject | 5 s poll interval, $0 |
| Paired user sends consecutive follow-up messages in the same IM chat while the first message is still queued or actively running | Follow-up either merges into the still-queued turn or steers into the active running turn so one reply addresses both messages; different chats or Web turns stay isolated | Before claim: coalesces into same-origin unstarted `pending` step atomically. While running (`claimed`): enqueues waiting step + steers via `queueCoordinatorInput` (native) or `steerPending` (machine) + `steerSignal`; unconsumed IM steer migration preserves `imTurnOrigin` | Real-time wake, $0 |

## Scope

1. **Suppress internal wake summary leaks on `turnFinished` (`apps/server/src/services/im/core.ts`)**:
   - Add `stepAlreadySentToIm(stepId)` querying `external_effect` for `kind = 'im-send'` and `stepId = stepRow.id` across any state (`pending`, `sending`, or `delivered`).
   - In `turnFinished(stepRow)`, skip `lastAssistantText(stepRow)` when `stepAlreadySentToIm(stepRow.id)` is `true` while preserving `blockFallbacks(stepRow)` and preserving `lastAssistantText` fallback for turns that did not call `notify_user` or `ask_user`.
2. **Settle Slack and Telegram card buttons immediately upon action (`apps/server/src/services/im/{types,slack,telegram,core}.ts`)**:
   - Extend `types.ts` with `ImCardMessageRef`, optional `cardMessage` on `ImInboundAction`, and optional `settleCard(ref, summary)` on the live adapter session (and update `LiveSession` in `core.ts`).
   - In `slack.ts`, extract `payload.message?.ts ?? payload.container?.message_ts` and `payload.message?.text` into `cardMessage` on `block_actions`, and implement `settleCard` calling `chat.update` with text sections capped at `MESSAGE_MAX_BLOCKS - 1` plus a `plain_text` `context` summary line and zero `actions` blocks.
   - In `telegram.ts`, attach `cardMessage` (`chat.id`, `message_id`, optional text/caption) on `callback_query`, and implement `settleCard` calling `editMessageReplyMarkup` with `{ inline_keyboard: [] }`.
   - In `core.ts`, call `settleCard` best-effort (`catch(() => {})`) from `answerCard` on fresh resolution (`已选择：${option.label}`), already-answered stale clicks (`已处理`), and `HttpError` stale/already-decided catch branches (`已处理`).
3. **Global in-app IM pairing approval banner (`apps/web/src/overlay/pairing-request-banner.tsx`, `apps/web/src/i18n/en.ts`, `apps/server/src/services/im/core.ts`)**:
   - Extend `PairingRequestBanner` (which mounts outside `LiveDataBridge`) to query `useTeams(enabled)` + `useImPairingRequests(teamId, enabled)`, filter `status === 'pending'`, and stack pending IM pairing cards (`data-testid="im-pairing-request-banner"`) cleanly with device pairing cards inside one shared `fixed` top-right flex column (`pointer-events-none` container, `pointer-events-auto` cards).
   - Display platform label + sender identity (`senderName ?? senderId`) with `min-w-0 break-words` for `390px` viewports, independent 1.5 s arm delay (`armedImId`) before enabling `批准`, `拒绝` (`im-pairing-banner-reject`) / `批准` (`im-pairing-banner-approve`) buttons (`pointer-coarse:h-11`), and localized copy (`有新的聊天配对请求` in `en.ts`).
   - Update `PAIRING_REQUESTED_TEXT` in `core.ts` to mention approving in either the in-app popup or Settings -> Chat apps.
4. **Same-origin IM pre-claim coalescing and live steering (`apps/server/src/services/im/core.ts`, `apps/server/src/services/coordinator-inputs.ts`, `apps/server/src/services/chief-turns.ts`)**:
   - On paired inbound IM message in `core.ts`, wrap pre-claim coalescing in a transaction checking `.changes === 1` (`status = 'pending'`, `claimedAt IS NULL`, `holdReason IS NULL`) for an unstarted turn sharing `(connId, chatKey)` via `imTurnOrigin` and `turnIsImOnly`, appending the new prompt and `ownerSaid` into that pending step.
   - Otherwise, if a `claimed` step `running` shares `(connId, chatKey)` via `imTurnOrigin` and `turnIsImOnly`, enqueue the follow-up step (`deferWake: true` while `running` is verified `claimed` in transaction) with `imTurnOrigin` and call a shared `applyChiefSteer` helper in `chief-turns.ts` (`queueCoordinatorInput` + `steerSignal` + `signalCoordinator` for native turns passing `waiting.prompt` as `content`; `steerPending` + `steerSignal` for machine turns). Leave cross-chat and Web-originated turns untouched.
   - In `coordinator-inputs.ts` and `chief-turns.ts`, update `releaseCoordinatorInput` so unconsumed IM steers (`ownerMessageIds: []` with `imTurnOrigin` on `waiting.id`) create a `successorStepId` preserving `freshSession` and `ownerSaid` and migrating `imTurnOrigin.stepId` (guarding `chiefMessage` `steer_missed` updates on `surviving.length > 0`, and deleting orphaned `imTurnOrigin` if `waiting` is deleted without a successor). Clean up `imTurnOrigin` on retired/acked steered steps in `consumeCoordinatorInput` and `ackChiefSteer` (while leaving `releaseUnconsumedSteer` untouched on native `coordinatorInput` rows so durable reconciliation remains intact).

### State transitions, readers, writers, and failure paths

| State | Writers | Readers | Transitions & Failure Paths |
|---|---|---|---|
| `external_effect` (`kind='im-send'`, `stepId`) | `core.ts` (`sendToOrigin` via `enqueueSend`) | `core.ts` (`turnFinished` -> `stepAlreadySentToIm`) | Recorded synchronously before async send; suppresses duplicate `lastAssistantText` meta summaries on `turnFinished`; if turn emitted no `notify_user`/`ask_user`, `stepAlreadySentToIm` is `false` so direct reply still delivers |
| IM card message markup (Slack `chat.update`, Telegram `editMessageReplyMarkup`) | `slack.ts` / `telegram.ts` (`session.settleCard`) triggered by `core.ts` (`answerCard`) | External Slack/Telegram UI | Best-effort async call wrapped in `try/catch`; handles fresh answers, stale cards, and `HttpError` race paths; missing `cardMessage` (e.g. text reply card resolution) is a safe no-op |
| `step` (`pending`/`claimed`) + `coordinator_input` (`steer`) + `steer_pending` + `im_turn_origin` | `core.ts` (`onMessage`), `coordinator-inputs.ts` (`queueCoordinatorInput`, `consumeCoordinatorInput`, `releaseCoordinatorInput`), `chief-turns.ts` (`steerWaitingChiefStep`, `ackChiefSteer`) | `core.ts`, `pullCoordinatorInput`, Coordinator runtime | Pre-claim `pending` step updates atomically (`.changes === 1`); claimed same-origin turn queues steer; consumed steer cleans up waiting `im_turn_origin`; if running turn finishes before consuming native steer, `recoverThread` -> `releaseCoordinatorInput` preserves `freshSession`/`ownerSaid` and migrates `im_turn_origin` to `successorStepId`; cross-origin turns remain isolated |
| Pending `im_pairing_request` banner state | Settings API (`decidePairing`), `PairingRequestBanner` polling `useTeams` + `useImPairingRequests` | `PairingRequestBanner` (React portal in `App.tsx`) | Filters `status === 'pending'`; independently armed (`armedImId`, 1.5 s timer) from device pairing requests (`armedId`); disabled while mutation pending; failed approve/reject surfaces `toastError` without dismissing server state |

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| IM turn invokes `notify_user` or `ask_user` then finishes with an internal summary note | IM chat receives only the intended notice/card and never the internal `provenance: im:...` summary; turns without notice/card still forward direct `lastAssistantText` | `apps/server/test/im-core.test.ts` (`suppresses lastAssistantText in turnFinished after notify_user or ask_user while preserving direct replies`) | this change |
| Slack `block_actions` or Telegram `callback_query` answers (or re-clicks) an interactive card | Interactive buttons are stripped immediately (`chat.update` context block on Slack; `editMessageReplyMarkup` empty keyboard on Telegram) on both fresh and stale clicks | `apps/server/test/im-slack.test.ts` (`settleCard removes action blocks with chat.update`), `apps/server/test/im-telegram.test.ts` (`settleCard clears inline keyboard with editMessageReplyMarkup`), `apps/server/test/im-core.test.ts` (`settleCard clears platform buttons on fresh and stale card clicks`) | this change |
| Second same-origin IM message arrives while first turn is unstarted `pending` or `claimed`, vs cross-chat / Web turn | Unstarted same-origin turn coalesces into 1 prompt; `claimed` native same-origin turn queues `coordinatorInput` steer; unconsumed IM steer migrates `imTurnOrigin` to successor step; different chatKey or Web turn never steers/coalesces | `apps/server/test/im-core.test.ts` (`coalesces unstarted same-origin turns, steers claimed native turns, preserves origin on unconsumed release, and isolates cross-origin turns`) | this change |
| Pending IM pairing request arrives while user is on `/app` (including alongside a device request and on 390px viewport) | Top-right popover displays platform + sender name, keeps `批准` disabled for 1.5 s, approves via API with success toast, and causes zero horizontal overflow at `390px` | `apps/web/e2e/settings-im.spec.ts` (`IM pairing banner pops up on /app, enforces arm delay, and fits 390px`) | this change |

## Out of scope

- Suppressing Coordinator `ask_user` cards from the shared Coordinator Web thread (intentional shared-thread sync; answering on IM resolves the Web card immediately via `publishQuestion`).
- Editing or disabling buttons on WeChat iLink or iMessage (neither platform renders interactive button widgets).
- Modifying Telegram group mention gating, Slack `chat:write` manifest scopes (`chat:write` already covers `chat.update`), or `im_connection` SQLite schema migrations.

## Review

- Verdict: PASS
- Plan-SHA256: d1e76c325cff00f884054c5395f7bed77b0db8abd108a8bc8c94b178239ba548
- Author-Model: gemini-2.5-pro
- Reviewer: Wave 4B Plan Gate Reviewer (`eb35db66-f9c7-4d7a-834c-f2673fc46b96`)
- Reviewer-Model: gemini-2.5-flash
- Findings: Fixed 5s pairing poll cadence, `PairingRequestBanner` `useTeams` + `status === 'pending'` filtering + stacked container, `releaseUnconsumedSteer` `status !== 'claimed'` guard preserving durable reconciliation, `releaseCoordinatorInput` `hasImOrigin` + `freshSession`/`ownerSaid` migration + `consumeCoordinatorInput`/`ackChiefSteer` `imTurnOrigin` cleanup, `answerCard` `HttpError` settle path, and atomic coalescing/steer guards.
