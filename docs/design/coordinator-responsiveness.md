# Coordinator Chat Responsiveness — plan, 2026-11-27

## User scenario

Someone who installed Cairn today opens Home or a project channel and chats with the Coordinator like a person. They need to learn no shortcuts, flags, or modes: when a question needs lookups or multi-step work, the Coordinator replies within a couple of seconds with a short natural acknowledgement (or answers straight away when no lookup is needed) and continues working; if the user sends a follow-up, correction, or cancellation while the Coordinator is working, the composer clears synchronously on `Enter` (so sent text cannot remain in the box to merge with the next message into one bubble), and the Coordinator handles the interjection at the next step boundary without waiting for an entire lookup chain to finish. It asks for no new account, payment, key, or database table—only the existing local `chief_message`, `coordinator_input`, and `pi-durable` stores. During a provider quota outage, messages wait safely in the held strip; if an outbox delivery request fails, existing failed-send handling (`chief-conversation.tsx:367` + `withoutReturnedText`) applies without breaking synchronous normal sends.

## Why

Measured on production Cairn (`mac-mini 8787`, `~/Pictures/cairn-review/coordinator-feel/interject-1.jpg`):

1. A lookup question received no message for ~25 s (only the "Looking through the project" status indicator) before emitting one answer.
2. An interjection (`"你听到我刚才那句了吗？"`) sent mid-work was only answered after the first answer finished (~40 s).
3. Pressing `Enter` while a turn ran left text in the composer and merged it with the next message into one bubble.

Root causes measured in the codebase:

- `COORDINATOR_SYSTEM_PROMPT` (`apps/server/src/services/chief.ts`) instructs the model to "say nothing when there is nothing new" and permits inline multi-minute work, with no ack-first or interjection-first rule; `SUBAGENT_TIMEOUT_DEFAULT_SEC` (`packages/shared/src/protocol/subagent.ts`) defaults to 120 s.
- `requireTurnProvenance()` (`apps/server/src/services/chief.ts:1391`) already allows user turns on `notify_user` without `provenance`, but `notify_user`'s schema/prompt wording frames it as an event-turn (`[wake:…]`) tool, `noticeId` (`apps/server/src/services/chief-tools.ts`) omits `toolCallId` (collapsing identical mid-turn calls and failing to distinguish replay from a fresh call), and `notify_user` always calls `notifyChiefMessage` (coupling IM delivery to desktop notification banners).
- `runCoordinatorTurn` (`apps/server/src/coordinator/runtime/turn.ts`) delivers mid-tool steers at `postTools`, but injects no runtime reminder for interjections vs long silent tool chains. (Single long non-subagent tools still finish undisturbed because aborting side-effecting tools mid-call risks duplicate/torn side effects; read-only `subagent`-only rounds barge in via `turn.ts:265`.)
- `createTurnMirror` (`apps/server/src/coordinator/runtime/mirror.ts`) does not reset `streamed` when an earlier assistant text row commits in a multi-round turn, and `liveTextStore` (`apps/web/src/api/live-text.ts`) tracks only a single `handoff` entry rather than an ordered list.
- `useChiefSurface.onSend` (`apps/web/src/chief/use-chief-surface.ts`) returns `Promise.resolve()`, deferring `writeFull('')` to a microtask during which concurrent SSE re-renders overwrite `fullDraftRef.current` with a stale `draftProp` in `useComposerWire` (`apps/web/src/overlay/composer-wire.ts:161`).

## Scope

1. **Ack-first, bounded-lookup, and interjection-intent prompt contract** (`apps/server/src/services/chief.ts`): Update `COORDINATOR_SYSTEM_PROMPT` to answer simple no-tool questions straight away; emit a 1-sentence acknowledgement before/alongside the first lookup tool call; avoid repeating already-sent progress in the final bubble; keep Coordinator lookup rounds short (batch reads, default `subagent` timeout 30 s) and delegate repo/code/deep-research work expected to take >~30 s to `create_todo` while keeping inline handling for small host/local file jobs (e.g. uploaded document conversion or actions needing no Runner/repo); and handle all mid-work interjection intents (cancel earlier work immediately, replace/redirect target, or answer a side question briefly first before continuing remaining work) while keeping existing consecutive-user-message correction wording (`barge-in.test.ts`).
2. **Generalise `notify_user`, decouple user-turn desktop banners from IM relay, and lower default subagent timeout** (`packages/shared/src/protocol/chief-tools.ts`, `packages/shared/src/protocol/subagent.ts`, `apps/server/src/services/chief-tools.ts`): Document `notify_user` as available in user turns (omit `provenance`) for mid-turn acknowledgements/updates/interjection replies without interrupting the loop. In `chief-tools.ts`: include `ctx.toolCallId` (when present) in non-report user-turn `noticeId` dedupe (falling back to the legacy key when `toolCallId` is absent); on fresh user-turn inserts, publish via `convHub` and schedule `runAfterCommit(..., () => imNotice(...))` without calling `notifyChiefMessage` (so interactive web chat gets no mid-turn desktop notification banner while `notifyChiefTurn` still notifies on turn completion, and `stored === null` replay does not re-send IM); keep event-turn (`[wake:…]`) `provenance` validation and `notifyChiefMessage` unchanged. Lower `SUBAGENT_TIMEOUT_DEFAULT_SEC` from `120` to `30` (max `300`).
3. **Runtime responsiveness middleware & message-derived state** (`apps/server/src/coordinator/runtime/responsiveness.ts`, `server-runtime.ts`, `turn.ts`): Install `coordinatorResponsivenessExtension` after `volatileContextExtension` using per-thread `createResponsivenessTracker()`. Derive `workStarted` and `silentToolCalls` deterministically from `messages.slice(turnStartIndex)` (resetting silence on non-empty `assistant` text, successful `notify_user`/`ask_user` `toolResult` where `isError !== true`, or a prior silence reminder; failed `notify_user` with `isError: true` never resets silence). Inject: (a) interjection-first `<system_reminder>` on a new `steer` user message only when `workStarted` is true (never on pre-work `[M1, M2]` barge-in or mail turns); (b) silence-guard `<system_reminder>` on `toolResult` in interactive user turns when `silentToolCalls >= 4` or `(silentToolCalls >= 1 && elapsed >= 12_000 ms)`. Maintain prompt-cache byte-invariance via an epoch-bounded `injected` map re-applied cleanly when source JSON matches.
4. **Multi-bubble streaming handoff integrity** (`apps/server/src/coordinator/runtime/mirror.ts`, `apps/web/src/api/live-text.ts`): Reset `mirror.ts`'s `streamed` buffer when a new assistant text row commits; upgrade `liveTextStore` `handoffs` to an ordered array handling idempotent duplicate `messageId`, out-of-order `knownIds` visibility, terminal step during Round 2 streaming, and SSE reconnect cleanup.
5. **Synchronous Enter-while-running composer clear** (`apps/web/src/chief/use-chief-surface.ts`, `apps/web/src/board/home-c.tsx`, `apps/web/src/chief/chief-conversation.tsx`, `apps/web/src/overlay/composer-wire.ts`): Return `void` synchronously from `useChiefSurface.onSend` after `chiefOutbox.enqueue(...)` (matching `useThreadChat.send`) and `() => {}` from the `home-c.tsx` fixture callback; clear `replyQuote` synchronously in `sendQuoted` when `sent` is non-Promise; guard `fullDraftRef`/`draftRef`/`tokensRef` in `useComposerWire` via `prevWireDraftRef` so stale-prop SSE re-renders cannot restore cleared drafts (preserving exact-match `fullDraftRef.current === fullDraft` for remaining async callers).
6. **Latency target verification**: Verify live-stack warm-cache `TTFR <= 3 s p50` and `TTIR <= 5 s p50` across >= 3 trials before vs after (plus cold-cache and slow-tool tails reported separately).

## State machines, readers/writers & cache-epoch lifecycle

### 1. `ResponsivenessTracker` (`apps/server/src/coordinator/runtime/responsiveness.ts`)

- **State per `conversationId`**: `{ interactive: boolean, mailTurn: boolean, turnStartIndex: number | null, lastVisibleAt: number, injected: Map<number, { source: string, reminder: string }>, cacheEpochAt: number }`.
- **Writers & lifecycle transitions**:
  - `turn.ts` calls `beginTurn(activeRootKey, { interactive: !mailTurn && claimed.chief.trigger === 'user', mailTurn })` right before `root.submit` and `endTurn(activeRootKey)` in `finally` (clearing `interactive = false`, `mailTurn = false`, `turnStartIndex = null` on normal completion, Esc/stop abort, cancellation, or thrown error while keeping `injected` bounded to the active cache epoch; cold daemon restart drops the in-memory map cleanly and re-derives state from `messages` on reload).
  - `server-runtime.ts` calls `clearConversation(threadId)` on `closeThread` (releasing all state for the conversation on close/teardown).
  - `afterResponse(message, api)`: when `!state.mailTurn && message.stopReason !== 'aborted'` and `message.content` has non-empty `text`, sets `lastVisibleAt = now()`.
  - `beforeRequest({ messages }, api)`:
    1. If `now() - state.cacheEpochAt >= reuseMs` (matching `volatile.ts` cache TTL), clears `state.injected`. Otherwise re-applies each `{ source, reminder }` entry where `index < messages.length && JSON.stringify(messages[index]) === source`, deleting any diverged or out-of-bounds entry (handles compaction, fork, and rewind cleanly). Updates `state.cacheEpochAt = now()`.
    2. Captures `turnStartIndex ??= messages.findLastIndex(m => m.role === 'user')`.
    3. Scans `messages.slice(turnStartIndex)` to compute `workStarted` (`assistant` or `toolResult` present before `lastIdx`), `silentToolCalls`, and updates `lastVisibleAt` when a newly settled successful `notify_user`/`ask_user` `toolResult` is observed.
    4. When `!state.mailTurn && !state.injected.has(lastIdx)`: injects interjection-first reminder on `lastIdx` (`user` after `workStarted`), or silence-guard reminder on `lastIdx` (`toolResult` when `state.interactive && (silentToolCalls >= 4 || (silentToolCalls >= 1 && now() - lastVisibleAt >= 12_000))`), recording `{ source: originalJson, reminder }` in `state.injected`.

### 2. `liveTextStore` (`apps/web/src/api/live-text.ts`)

- **State**: `buffers: Map<string, string>`, `handoffs: Map<string, Array<{ messageId: string, prefixLen: number }>>`.
- **Writers**: `sse.ts` (`append`, `noteSettled`, `clear`, `clearUnlessSettling`) and `useChiefSurface` / `useThreadChat` (`prune`).
- **Readers**: `useSyncExternalStore` calling `getVisible(convId, knownIds)` where `knownIds` retires through the LAST matching handoff (if `m2` lands in `knownIds` before `m1`, everything through `m2.prefixLen` retires atomically).
- **Exit / failure transitions**: duplicate `noteSettled` with same `messageId` updates existing `prefixLen`; `clearUnlessSettling` truncates to last settled `prefixLen` so uncommitted Round 2 tail clears on failed/stopped step; SSE reconnect `onResync` calls `clear` to reset stale live buffers.

### 3. `useComposerWire` & `useServerDraft`

- **Writers**: user input (`handleChange`), synchronous `writeFull('')` on `submit()`, async `submit().then(...)` (only when caller returns a Promise), and prop sync guarded by `wireDraft !== prevWireDraftRef.current`.
- **Exit / failure transitions**: when `sendAfterUploadRef` queues a send while attachments finish uploading, `handleSubmit` waits for upload completion and calls the synchronous `onSend`; when an outbox HTTP POST fails, `chief-conversation.tsx:367` + `withoutReturnedText` restores the unsent text once and `useServerDraft.refresh()` re-syncs cleanly with server drafts; switching threads/channels resets `prevWireDraftRef` to the new `wireDraft` prop.
- **Guarantee**: Synchronous `onSend` clears `fullDraftRef`, `draftRef`, and `tokensRef` immediately before `handleKeyDown(Enter)` returns, immune to concurrent SSE re-renders with stale `draftProp`.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Simple question requiring no tools | Direct streamed answer at model TTFT with no filler acknowledgement bubble | `apps/server/test/coordinator/responsiveness.test.ts` (asserts 0 ack injection / single response on text-only turn) | this change |
| Slow model TTFT / cold prompt cache vs warm cache | Warm runs meet `<= 3 s p50` TTFR; cold/slow-model tail renders cleanly once first delta arrives and is reported separately in benchmark | `apps/server/test/coordinator/responsiveness.test.ts` (asserts elapsed clock triggers timer only once threshold crossed; warm vs cold reported separately) | this change |
| Lookup turn emitting Round 1 ack + Round 2 answer with shared prefix | Ack bubble 1 streams immediately, then answer bubble 2 streams complete without clipping shared leading characters | `apps/server/test/coordinator/responsiveness.test.ts` (asserts `mirror` resets `streamed` after row 1 commits so shared prefix emits intact) | this change |
| Mid-turn `notify_user` in user turn: two identical messages across distinct `toolCallId`s vs same-`toolCallId` replay | Both intended notices appear in chat and relay once each to IM with zero desktop notification banners; same-`toolCallId` replay dedupes both DB row and IM relay | `apps/server/test/coordinator/responsiveness.test.ts` (asserts 2 rows + 2 `imNotice` calls + 0 `notifyChiefMessage` across `tc-1`/`tc-2`, 1 on replay) | this change |
| Mid-work interjection during tool round (`cancel`, `replace`, or `side-question`) | `postTools` steer receives interjection-first reminder instructing cancel/replace/reply-first; pre-work `[M1, M2]` barge-in and mail turns receive zero reminder | `apps/server/test/coordinator/responsiveness.test.ts` (asserts `<system_reminder>` present iff `!mailTurn && workStarted`) | this change |
| Post-ack correction (`M1` acked then `M2` "I misspoke earlier"), Round 2+ streaming interjection, conflicting rapid steers, and user steer into active non-mail `[wake:…]` event turn | `M2` interjection receives interjection-first reminder even after Round 1 ack/Round 2 text; conflicting steers keep latest intent; user steer into running `[wake:…]` turn injects interjection reminder; `withdraw` after read still returns `409 CHIEF_MESSAGE_READ` | `apps/server/test/coordinator/responsiveness.test.ts` (asserts reminder on post-ack steer, `[wake:…]` non-mail steer, multi-round steer, conflicting steer reminder taking latest intent, and `409` on read withdraw) | this change |
| Long tool / slow non-subagent tail / explicit `subagent` `timeoutSec: 300` vs barge-in (`turn.ts:265`) / failed `notify_user` | Normal tools finish before `postTools`; failed `notify_user` (`isError: true`) does NOT reset silence counter; `SUBAGENT_TIMEOUT_DEFAULT_SEC === 30` (explicit `300` allowed) and `subagent`-only rounds still barge in immediately; `ask_user` waits until answered | `apps/server/test/coordinator/responsiveness.test.ts` (asserts `isError: true` preserves `silentToolCalls`, default timeout `30`, max `300`, normal slow tool finishes before `postTools`, and explicit `timeoutSec: 300` `subagent` round still barges in) | this change |
| Silence guard trigger at 4 silent tool calls or >= 12 s elapsed | Silence `<system_reminder>` injects once, resets on visible text or successful `notify_user`/`ask_user`, and repeats if another 4 silent calls occur | `apps/server/test/coordinator/responsiveness.test.ts` (asserts exact firing at 4th silent tool result and >= 12 s boundary) | this change |
| Prompt-cache prefix byte invariance across rounds, warm cross-turns, epoch expiry & compaction | `messages[0..priorLen-1]` is byte-identical across rounds and within warm cache epoch; diverged/expired/compacted entries clean up cleanly | `apps/server/test/coordinator/responsiveness.test.ts` (asserts byte-for-byte prefix equality, epoch expiry reset, and compaction prune) | this change |
| Event turn (`[wake:…]` with no user steer) & legacy Runner `notify_user` without `toolCallId` | Silence guard stays off; `notify_user` still enforces `provenance` and calls `notifyChiefMessage`; missing `toolCallId` falls back to content hash | `apps/server/test/coordinator/responsiveness.test.ts` (asserts missing `provenance` throws `400`, `notifyChiefMessage` fires, absent `toolCallId` hashes content) | this change |
| Multi-bubble `liveTextStore` handoffs (`m1` then `m2`, `m2` before `m1`, duplicate `noteSettled`, terminal step in Round 2, SSE reconnect) | Settling `m1` keeps only Round 2 text visible; out-of-order `m2` retires through `m2`; failed Round 2 keeps only settled prefix | `apps/web/test/chief-stream-handoff.test.ts` (asserts ordered slice retirement, out-of-order `knownIds`, duplicate `noteSettled` `prefixLen` update, `clearUnlessSettling` truncation, and `onResync` `clear` reset) | this change |
| Pressing `Enter` while turn streams + stateful stale-prop re-render + failed-send restore + upload-in-flight / `useServerDraft.refresh()` | Draft clears synchronously on `Enter` and stays empty across stale-prop renders; failed HTTP send restores once via `withoutReturnedText`; upload-queued send and server-draft refresh preserve current input | `apps/web/test/composer-queue-stop.test.ts` (asserts sync `onSend` clears draft before stale `draftProp` re-render, failed restore does not merge, and `sendAfterUploadRef` + `useServerDraft.refresh()` preserve typed input) | this change |
| Async composer caller where M2 is typed before M1 resolves | Exact-match check avoids clobbering M2 when M1 resolves | `apps/web/test/composer-queue-stop.test.ts` (asserts `fullDraftRef.current === fullDraft` guard preserves M2) | this change |
| Rapid typing with live SSE `text_delta`/`activity` ticks in busy Coordinator chat | M1 clears composer immediately on `Enter`; immediate M2 sends as separate second POST, never merged with M1 | `apps/web/e2e/chief-home-busy.spec.ts` (asserts two distinct POST payloads and separate bubbles under live SSE stream) | this change |

## Verification

- Automated proving tests above fail against parent `6293fda47` and pass after implementation.
- Live-stack timing benchmark (`>= 3` warm-cache trials each before vs after, plus cold-cache and slow-tool tails reported separately): measure `TTFR` (user POST to first visible assistant/notice SSE) targeting `<= 3 s p50`, and `TTIR` (mid-work interjection POST to first visible SSE addressing it) targeting `<= 5 s p50`.

## Out of scope

- Adding a separate `send_message` tool alongside `notify_user` (generalising `notify_user` keeps `CHIEF_TOOL_COUNT = 47` and preserves Runner parity in one path).
- Asynchronous non-blocking `subagent` wake protocol outside existing `create_todo` background tasks.
- Preemptively aborting side-effecting non-subagent tools mid-execution during `tool_round` (only read-only `subagent`-only rounds barge in immediately; normal tools finish cleanly before `postTools`).
- Failed-send non-merging UI redesign (existing `chief-conversation.tsx:367` + `withoutReturnedText` outbox failure restore stays as-is).

## Review

- Verdict: PASS
- Plan-SHA256: 889edcd93026971569ea71c4a86346a683ec450fb690d82326b5178256c30b4d
- Author-Model: google/gemini-2.5-pro
- Reviewer: codex-plan-review
- Reviewer-Model: openai/gpt-6.1-sol
- Reviewed-At: 2026-11-27
- Findings: Initial 10 findings resolved and verified in confirm-only follow-up passes (`Verdict: PASS`).
