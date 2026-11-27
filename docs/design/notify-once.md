# Notify Once: Presence-Routed Notification Delivery — plan, 2026-11-27

Owner directive (2026-11-27, verbatim):

```text
1. 弹系统通知吧，并且我想知道这个应该怎么做？如果有一条信息会同时发送到我所有的软件、聊天应用上，会不会导致这条信息很重复呀？
```

Prior-art research: [`docs/research/notify-once-routing-2026-11-27.md`](../research/notify-once-routing-2026-11-27.md).

## User scenario

When a first-time user installs Cairn on their Mac and runs a scheduled task or leaves a long task running while they switch to another app or step away from their desk, Cairn routes each alertable event to **at most one active target** in the **one** place the user currently is: a macOS system notification banner on their active Mac (which opens that exact thread and marks it read on click, including failure reasons when a scheduled run fails), or a single alert to one connected chat app (or a single paired push endpoint if no chat app is ready) only after every desktop has been locked for 1 minute or idle/offline for 10 minutes — and reading the thread anywhere cancels pending away alerts and dismisses delivered desktop banners across devices.

## For a Newcomer

- **Where you meet it:** Native macOS system notification banners from Cairn.app when Cairn is not focused, or a single message in your already-connected chat app / paired iOS or Web Push device when you are away from your desk.
- **What you must already know:** Nothing about Cairn internals. Existing Cairn desktop notifications, chat app connections, and phone pairing work automatically with zero configuration.
- **Accounts, payments, keys, and settings:** None. Adds zero new `CAIRN_*` env vars, zero new settings toggles, and zero new UI panels. Reuses the user's existing Cairn session, desktop app, connected chat app (`im_connection`), or paired push subscription (`push_subscription` / `apns_device`).
- **Where data is stored:** Delivery state (`deliveryId`, `deliveryStatus`, `deliveryTarget`, `deliveryDueAt`) on `notification` rows and `lastDesktopActiveAt` on `user` in SQLite; pending away timers in `due_event`; persistent away dispatch outbox in `external_effect`; transient per-client presence (`clientId`, `kind`, `focused`, `activeThreadId`, `screenLocked`, `systemIdleSec`, `canNotify`, `seq`, `updatedAt`) in server memory.
- **Where you get stuck / failure view:** If macOS notification permission is denied, OS notifications are unsupported, or the user turned off desktop notifications in Cairn (`cairn.notifyEnabled === '0'`), the client reports `canNotify: false` so alerts fall back to away delivery instead of disappearing silently. If a scheduled run fails before or during execution, the notification carries the failure reason. Delivery guarantees are **at-most-once single-target routing** per generation (`selected` -> `desktop`/`away` or explicit pre-display `failed` fallback; `unknown` after OS submission never retries onto a second channel).

## Scenario Table

| Scenario | What the user sees | What the system does | Wait & cost | Proving test |
|---|---|---|---|---|
| **At Mac and focused** | Looking at that thread: unread clears immediately, 0 banners, 0 chat/phone alerts. Looking at another thread in Cairn: sidebar unread dot only, 0 banners, 0 chat/phone alerts. | `activeThreadId === entityId` -> marks `read` immediately (`readAt = now`, `deliveryStatus = 'read'`). `focused && activeThreadId !== entityId` -> `deliveryStatus = 'suppressed'`, SSE `targetClientId: null`. | Instant; 0 external calls. | `apps/server/test/notify-once.test.ts` |
| **At Mac, other app** | Cairn behind Chrome/Xcode or closed to menu-bar tray: 1 macOS banner appears with thread title and outcome (or failure reason); clicking focuses Cairn to that exact thread and clears unread everywhere; 0 chat/phone alerts. | Server picks 1 active-notifiable `desktop` client (or `web` only when no `desktop` is present and user explicitly enabled web push/notify), sets `deliveryStatus = 'desktop'`, sends private SSE `delivery`; desktop main process dedupes by `deliveryId` and opens `href` directly even if `mainWindow === null`. | Instant; 0 IM/push cost. | `apps/server/test/notify-once.test.ts`, `apps/web/test/sse-notify-once.test.ts`, `apps/desktop/scripts/desktop-notifications.test.ts` |
| **Mac asleep or away** | Locked `< 60s` or idle `< 10m`: 0 alerts yet. After 1m lock or 10m desktop idle/offline: 0 desktop banners, 1 message in the most-recently-updated ready chat app (or 1 push to newest paired device if no chat app). | Server stores `pending_away` + `due_event` `notification-away:<id>` until `awayDueAt`; if still unread & away at `awayDueAt`, `dueRunner` atomically claims `away` and inserts `external_effect` (`im-send` or single-device `web-push`) inside the same transaction. | 1m lock / 10m idle grace; max 1 away alert. | `apps/server/test/notify-once.test.ts` |
| **Two Macs** | MacBook active (`idle 3s`) + Mac mini idle/locked (`idle 900s`) or both unlocked: ONLY MacBook pops 1 banner; Mac mini pops 0; 0 chat/phone alerts. | Server ranks active-notifiable clients (`desktop > web`, lowest `systemIdleSec`, newest `updatedAt`, lexicographical `clientId`) and emits a single `targetClientId`; non-matching clients ignore `delivery`; offline Mac dismisses stale banners on reconnect sync. | Instant; 0 duplicate banners. | `apps/server/test/notify-once.test.ts`, `apps/web/test/sse-notify-once.test.ts` |
| **Phone paired** | Active at Mac: 1 desktop banner, 0 phone push. Away without chat app: 1 phone push (newest APNs device first, else newest Web Push). Away with chat app: 1 chat message, 0 duplicate phone push. Reading on phone clears desktop banner and cancels `pending_away`. | Server routes to `im_connection` before single-device push (never both); `markNotificationRead` deletes `due_event`, cancels pending `external_effect`, and emits private SSE `readAt !== null` so desktop calls `dismiss(tag)`. | Instant read sync; 0 duplicate push. | `apps/server/test/notify-once.test.ts`, `apps/web/test/sse-notify-once.test.ts`, `apps/desktop/scripts/desktop-notifications.test.ts` |

## Scope

1. **Shared notification & presence contracts (`packages/shared`):**
   - Remove `'schedule_run'` from `SILENT_NOTIFICATION_TYPES` in `packages/shared/src/records/notification.ts`.
   - Extend `notificationEventSchema` in `packages/shared/src/protocol/sse.ts` with optional `delivery: { id, targetClientId }`.
   - Add `deliveryId?: string`, `DesktopPresenceState`, and `isDesktopDismissTag` to `packages/shared/src/desktop-shell.ts`.
2. **Server persistence & unified presence (`apps/server`):**
   - Add `deliveryId`, `deliveryStatus`, `deliveryTarget`, `deliveryDueAt` to `notification` and `lastDesktopActiveAt` to `user` in `apps/server/src/db/schema.ts` + migration `apps/server/drizzle/0265_notification_delivery.sql` (default `deliveryStatus = 'none'`, existing rows unaffected).
   - Extend `apps/server/src/services/thread-presence.ts` and `apps/server/src/routes-push.ts` (`POST`/`DELETE /api/teams/:id/presence`) to track per-client presence (`clientId`, `kind`, `focused`, `activeThreadId`, `screenLocked`, `systemIdleSec`, `canNotify`, `seq`) with monotonic `seq` stale-request rejection, persist `lastDesktopActiveAt` only for `desktop` clients, recognize `/app?thread=` and `/app?chief=` in `isViewingThread`, and reconcile `pending_away` notifications when a desktop becomes active or focused.
   - Add `POST /api/teams/:id/notifications/:entityId/delivery-failed` (`{ deliveryId }`) so explicit pre-display desktop failures (OS unsupported/denied or `Notification` `failed` event) fall back cleanly when generation matches.
3. **Notify-once router, single-target away dispatch & schedule notifications (`apps/server`):**
   - Add `apps/server/src/services/notification-router.ts` implementing single-winner routing, `pending_away` `due_event` scheduling/re-scheduling/reconciliation, transactional `away` `external_effect` enqueueing (1 `ready` live `im_connection` with `pairedSenders` first, else single-device `pushToUserSafely`, never both), and read-cancellation.
   - Scope `TeamStreamHub.publishNotification` in `apps/server/src/services/events.ts` to `publishPrivate(teamId, record.userId, ...)` for user isolation.
   - Wire `apps/server/src/services/notifications.ts`, `apps/server/src/services/im/runtime.ts`, `apps/server/src/services/im/core.ts`, `apps/server/src/index.ts`, and `apps/server/src/services/scheduler.ts` (`notification-away` synchronous `dueRunner` handler returning `{ rescheduleAt }` + pre-step `runSchedule` failure notifications).
   - Remove duplicate immediate `pushToUserSafely` calls in `apps/server/src/services/owner.ts` (`notifyOwner`) and `apps/server/src/services/chief-questions.ts` (`pushQuestion`), skip desktop/away double-send when `imHasActiveOrigin` is true, and gate `apps/server/src/services/mail.ts` push on `isDesktopActive` (passing `skipAwayDispatch: true` to `notifyChiefMessage` so existing mail digest/delivery rules stay intact).
   - Update `apps/server/src/services/schedules.ts` (`finishScheduledStep`) so both `todoId` and `chiefThreadId` schedules emit `schedule_run` notifications on completion (with assistant summary snippet) and failure (with error reason); suppress `notifyChiefTurn` in `apps/server/src/services/coordinator-steps.ts` when `stepRow.scheduleId !== null` so a Chief schedule run never emits both `schedule_run` and `chief_message`.
   - Add `singleDevice?: boolean` option to `sendPushToUser` in `apps/server/src/services/push.ts` and register a `policy: 'unsafe'` `'away-push'` external effect in `notification-router.ts` so away push targets at most 1 newest device (APNs before Web Push) and never resends after a mid-flight crash on lost receipt (keeping existing `'web-push'` `replay-safe` semantics intact for `mail.ts` and `push-outcomes.test.ts`).
4. **Electron desktop notification & presence bridge (`apps/desktop`):**
   - Add `apps/desktop/src/desktop-notifications.ts` for `deliveryId` dedupe, `dismiss(tag)` via active `Notification.close()` and `Notification.getHistory()`, explicit `failed` callback reporting, and click-to-open (`app.focus({ steal: true })`, direct `openWindow(origin, null, href)` when closed, or `did-finish-load` queued `desktop-navigate`).
   - Wire `desktopClientId`, `desktop-notify:dismiss`, `desktop-presence:state`, and `desktop-presence:change` (including `powerMonitor` lock/unlock/suspend/resume and window focus/blur/open/close) in `apps/desktop/src/main.ts` and `apps/desktop/src/preload.ts`.
5. **Web presence, targeted SSE alerts & focus-aware read sync (`apps/web`):**
   - Add `desktopPresence()` + `notify.dismiss` in `apps/web/src/desktop-shell.ts`.
   - Upgrade `apps/web/src/pwa/thread-presence.ts` and mount `useClientPresence` in `apps/web/src/api/provider.tsx` (allowing `/tray` to hold presence with monotonic `seq` when `mainWindowOpen === false`, and reporting `canNotify: false` when `cairn.notifyEnabled === '0'` or OS permission is not granted).
   - Update `apps/web/src/api/team-stream-cache.ts`, `apps/web/src/api/sse.ts`, and `apps/web/src/i18n/en.ts` to enforce `delivery.targetClientId === currentClientId()`, dismiss banners on `readAt !== null` and on reconnect when `unreadThreadIds` no longer contains an entity, report pre-display `failed` via `delivery-failed`, fix `notificationHref` via `isChiefConversationId`, and display `schedule_run` title + summary/failure reason.
   - Update `apps/web/src/board/use-mark-thread-read.ts` to require `document.hasFocus()` alongside `visibilityState === 'visible'`, call `useThreadPresence` + `useMarkThreadRead` for `chiefThreadId` in `apps/web/src/board/home-c.tsx`, and handle missing/deleted `?thread=` / `?chief=` targets gracefully without leaving broken state.
   - Existing `todo_done`, `todo_failed`, and `marked_unread` notifications remain silent (`SILENT_NOTIFICATION_TYPES`), and manual/non-owner-waiting completions remain unpushed.

## States, transitions, readers, writers, and failure behavior

- **Persisted states on `notification`:**
  - `deliveryStatus`: `'none' | 'suppressed' | 'desktop' | 'pending_away' | 'away' | 'read'` (migration `0265` sets `'none'` on legacy rows).
  - `deliveryId`: generation ID per alertable event; guarded on every state transition (`WHERE id = ? AND deliveryId = ?`).
  - `deliveryTarget`: `'client:<clientId>' | 'im:<connId>' | 'im:origin' | 'push' | null`.
  - `deliveryDueAt`: epoch ms for `pending_away` escalation deadline, else `null`.
- **Delivery outcome model:**
  - `selected` (`desktop`): server selected 1 `targetClientId` and published SSE. If the client's `Notification` emits `failed` before OS submission (`explicit failed`), it posts `delivery-failed` with `{ deliveryId }` so the server falls back to away (at most once per `deliveryId`). Once handed to OS (`submitted`) or if SSE drops (`unknown`), the server never auto-retries onto a second channel; unread state remains in `unreadThreadIds` for sidebar recovery.
- **Transitions:**
  - Silent upsert (`todo_done`, `todo_failed`, `marked_unread`):
    - `markNotificationUnread`: resets `readAt = null`, `deliveryStatus = 'none'`, `deliveryTarget = null`, `deliveryDueAt = null` (never triggers OS banner or away send).
    - `todo_done` / `todo_failed`: if existing unread row is `type === 'schedule_run'` and `deliveryStatus IN ('desktop', 'pending_away', 'away')`, preserves `schedule_run` metadata and delivery state (since `finishScheduledStep` runs right before `finishTodoDone` in `build-step-complete.ts`); if existing `pending_away` was `plan_ready` / `build_review`, cancels the obsolete `due_event` (`deliveryStatus = 'none'`) while keeping `readAt = null`.
  - Alertable upsert (`plan_ready`, `build_review`, `coordinator_handoff`, `chief_message`, `quota_wait`, `model_fallback`, `no_machine`, `watchdog_flag`, `schedule_run`):
    1. `alreadyDeliveredExternally` (active IM-only origin): `deliveryStatus = 'away'`, `deliveryTarget = 'im:origin'`, SSE `targetClientId: null`.
    2. `focused && systemIdleSec < 600 && activeThreadId === entityId` (idle web tabs with `systemIdleSec >= 600` never count as focused): `readAt = now`, `deliveryStatus = 'read'`, delete `due_event`, SSE `targetClientId: null`.
    3. `focused && systemIdleSec < 600 && activeThreadId !== entityId`: `deliveryStatus = 'suppressed'`, delete `due_event`, SSE `targetClientId: null`.
    4. Active-notifiable client exists (`desktop` with `!screenLocked && systemIdleSec < 600 && canNotify`; `web` never suppresses away or updates `lastDesktopActiveAt` and only receives `desktop` banner when explicitly `canNotify: true && !focused && systemIdleSec < 600` and no `desktop` client exists): pick single winner -> `deliveryStatus = 'desktop'`, `deliveryTarget = 'client:' + winner.clientId`, delete `due_event`, SSE `targetClientId = winner.clientId`.
    5. Grace window (`screenLocked` < 60s on latest locked desktop, or `lastDesktopActiveAt + 600_000 > now`): `deliveryStatus = 'pending_away'`, `deliveryDueAt = awayDueAt`, upsert `due_event` `notification-away:<id>`, SSE `targetClientId: null`.
    6. Away (`now >= awayDueAt` or no active desktop): inside the SAME SQLite transaction, set `deliveryStatus = 'away'`, record `external_effect` (`im-send` for 1 ready live `im_connection`, OR single-device `away-push` if none), and drain via `runAfterCommit`; SSE `targetClientId: null`.
  - **Presence lifecycle & schedule failure rules:**
    - Clients send `POST /api/teams/:id/presence` with monotonic `seq` on mount, focus/blur, visibility/thread/power changes, and every `30s` heartbeat; entries expire after `75s` TTL (purged lazily on every `recordClientPresence` / `evaluatePresenceRouting`) and are removed on `DELETE /api/teams/:id/presence` (`pagehide`/unmount). Stale `seq < current.seq` requests are ignored.
    - Schedule runs notify **at most once per `lastRunStepId`** (on terminal step failure or pre-step `runSchedule` error, carrying the reason and whether the schedule paused or will retry in 5m; user `stopped` and stage-gate `skipped` emit nothing).
  - `due_event` `'notification-away:<id>'` (synchronous handler) or desktop active/focus reconciliation:
    - Re-reads `notification`; if `readAt !== null` or `deliveryStatus !== 'pending_away'` -> return `{ rescheduleAt: null }` (`dueRunner` deletes `due_event`).
    - If `focused && systemIdleSec < 600` -> update `WHERE id = ? AND deliveryId = ?` to `read` (same thread) or `suppressed` (other thread), return `{ rescheduleAt: null }`.
    - If active-notifiable desktop present -> update `WHERE id = ? AND deliveryStatus = 'pending_away' AND deliveryId = ? AND readAt IS NULL` to `desktop`, publish SSE with `targetClientId`, return `{ rescheduleAt: null }`.
    - Else recompute `awayDueAt`: if `now < awayDueAt`, update `deliveryDueAt = awayDueAt` and return `{ rescheduleAt: awayDueAt }`. Otherwise inside a transaction atomically claim `pending_away -> away` (`WHERE id = ? AND deliveryStatus = 'pending_away' AND deliveryId = ? AND readAt IS NULL`), enqueue 1 `external_effect` (`im-send` or single-device `away-push`), and return `{ rescheduleAt: null }`.
  - Read anywhere (`markNotificationRead`, `sweepIdleChiefUnread`): sets `readAt`, `deliveryStatus = 'read'`, `deliveryDueAt = null`, deletes `due_event`, cancels pending `external_effect` rows matching `deliveryId`, and republishes private SSE with `readAt !== null` so every connected Mac dismisses banners.
- **Complete Readers and Writers Inventory:**
  - *`notification` writers:* `notifications.ts` (`upsertAndPublish`, `markNotificationRead`, `markNotificationUnread`, `sweepIdleChiefUnread`), `notification-router.ts` (`routeNotificationDelivery`, `processNotificationAwayDue`, `reconcilePendingAwayNotifications`, `handleDeliveryFailed`).
  - *`notification` readers:* `notifications.ts` (`listUnreadEntityIds`), `notification-router.ts`, `routes-core.ts`.
  - *`user.lastDesktopActiveAt` writer/reader:* `thread-presence.ts` (`recordClientPresence`) / `thread-presence.ts` (`evaluatePresenceRouting`, `isDesktopActive`).
  - *`due_event` (`notification-away:*`) writers/readers:* `notification-router.ts` (`due_event` upsert/delete) & `scheduler.ts` (`dueRunner` handler `'notification-away'`).
  - *`external_effect` writers/readers:* `im/core.ts` (`sendAwayNotice` -> `enqueueSend` `'im-send'`), `notification-router.ts` (`away-push` + `cancelPendingNotificationDelivery`), `push.ts` (`sendPushToUser` with `singleDevice: true`).
- **Failure paths:**
  - Server crash after `away` commit before network send completes: `external_effect` row is already persisted in the same transaction; both `im-send` and `away-push` use `policy: 'unsafe'` (`sending -> interrupted` on stale crash recovery) so a lost receipt never triggers a resend or second-channel fallback.
  - `im_connection` offline/unpaired when away: `sendAwayNotice` returns `{ sent: false }`, transaction falls back to single-device `away-push` (`external_effect` `'away-push'`).
  - No push subscription and no IM connection: `deliveryStatus = 'away'`, `deliveryTarget = null`, unread row remains in `unreadThreadIds`.
  - Expired push subscription (`404`/`410`) or APNs `Unregistered`: `sendPushToUser` deletes the dead token/subscription row; does not fall back onto another channel.
  - Stale tray/window `POST`/`DELETE /presence` out-of-order: rejected by monotonic `seq` per `clientId`.
  - Deleted/inaccessible thread clicked from banner: web UI shows clean fallback / navigates to `/app` and clears stale unread banner.

## Edge cases

Red-first execution rule: Step 3 writes all three proving test files (`apps/server/test/notify-once.test.ts`, `apps/web/test/sse-notify-once.test.ts`, `apps/desktop/scripts/desktop-notifications.test.ts`) BEFORE any product code edits and verifies each fails on the parent commit's existing behavior (not missing-module errors).

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| At Mac looking at the same thread (`focused && activeThreadId === entityId`) | Unread clears immediately; 0 OS banners; 0 IM or phone push | `apps/server/test/notify-once.test.ts` | this change |
| At Mac focused on Cairn in another thread (`focused && activeThreadId !== entityId`) | Unread dot appears in sidebar; 0 OS banners; 0 IM or phone push | `apps/server/test/notify-once.test.ts` | this change |
| At Mac working in another app (unfocused behind Chrome, or closed to tray) | 1 macOS banner on that Mac; clicking opens exact thread (`?thread=` or `?chief=`) and marks read; 0 IM/push | `apps/server/test/notify-once.test.ts`, `apps/web/test/sse-notify-once.test.ts`, `apps/desktop/scripts/desktop-notifications.test.ts` | this change |
| Two Macs connected (active vs idle/locked, or desktop vs web tab, or idle web tab alone) | Only most recently active unlocked desktop wins; idle web tab never suppresses away alerts; non-winners pop 0; offline Mac dismisses stale banner on reconnect | `apps/server/test/notify-once.test.ts`, `apps/web/test/sse-notify-once.test.ts` | this change |
| Sequential lock across two Macs, brief disconnect `< 10m`, sleep/resume, server restart mid-grace, or window+tray handoff stale `seq` | `pending_away` reschedules cleanly (`{ rescheduleAt }`) using persisted `lastDesktopActiveAt` + `due_event`; stale `seq` dropped; unlocking/reading before deadline cancels away send | `apps/server/test/notify-once.test.ts` | this change |
| Desktop `canNotify: false` (denied / `cairn.notifyEnabled === '0'`) or explicit pre-display `delivery-failed` with matching `deliveryId` | Client reports `canNotify: false` or `delivery-failed`; falls back to away channel; stale `deliveryId` failures ignored | `apps/server/test/notify-once.test.ts`, `apps/web/test/sse-notify-once.test.ts` | this change |
| Away (`locked >= 60s` or `idle >= 10m`) with multiple IM connections + multiple push/APNs endpoints | Sends 1 IM to newest ready live connection with paired sender (0 phone push); if no IM, pushes to at most 1 newest device (APNs before Web Push); atomic `external_effect` dedupes crash/retry | `apps/server/test/notify-once.test.ts` | this change |
| Scheduled run completion/failure on both `todoId` and `chiefThreadId` (including pre-step failure, user stop, stage gate skip, retry, `finishTodoDone` order, and `notifyChiefTurn` suppression) | Chief/todo schedule completion notifies ONCE with summary or error reason (`notifyChiefTurn` suppressed on scheduled step; `todo_done` preserves `schedule_run`); stop/skip emit nothing | `apps/server/test/notify-once.test.ts`, `apps/web/test/sse-notify-once.test.ts` | this change |
| Read anywhere (`markNotificationRead` or `sweepIdleChiefUnread`), or `read -> markNotificationUnread`, or read after `away` claim before send | Dismisses desktop banners via SSE `readAt !== null`, cancels `due_event` and pending `external_effect`; `markNotificationUnread` stays silent (`deliveryStatus = 'none'`) | `apps/server/test/notify-once.test.ts`, `apps/web/test/sse-notify-once.test.ts`, `apps/desktop/scripts/desktop-notifications.test.ts` | this change |
| Both `mainWindow` and `/tray` receive SSE, `mainWindow === null` click, or deleted thread link | Desktop `preload` exposes `dismiss`/`presence`, dedupes by `deliveryId`, opens `mainWindow` directly to `payload.href`, and clears stale notifications safely | `apps/desktop/scripts/desktop-notifications.test.ts`, `apps/web/test/sse-notify-once.test.ts` | this change |
| Unfocused window still `visibilityState === 'visible'` behind another app | `useMarkThreadRead` does NOT mark thread read until window actually has focus | `apps/web/test/sse-notify-once.test.ts` | this change |
| IM-originated coordinator turn (`imTurnOrigin`) vs mixed IM/Web turn | IM-only turn replies in originating IM without desktop/away duplicate; mixed turn routes normally via presence | `apps/server/test/notify-once.test.ts` | this change |

## Out of scope

- User-configurable away delay sliders or per-notification-type channel preference matrix UI.
- Windows or Linux native notification center history cleanup beyond Electron `notification.close()`.
- Modifying iOS silent background push or native APNs payload schema.

## Review

- Verdict: PASS
- Plan-SHA256: 09c3e1696ce8f9d223c1c55e3b1d1d6a2666e0c0ef9c293f15dbaad66a0bd457
- Author-Model: gemini-4-neon
- Reviewer: openai-codex/gpt-6.2-sol (pi-review.sh plan + confirm pass, low)
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: Addressed all 7 findings (explicit selected/submitted/failed/unknown delivery semantics & offline banner reconnect sync; single-device unsafe away-push & atomic external_effect outbox; synchronous pending_away rescheduleAt, 30s/75s presence TTL & monotonic seq; complete reader/writer inventory, sweepIdleChiefUnread, markNotificationUnread, schedule_run preservation over todo_done, private SSE; suppress notifyChiefTurn on scheduled steps, single-step failure dedupe, stop/skip/deleted thread; red-first tests before product edits; active focus requires systemIdleSec < 600 and idle web tabs never suppress away alerts).
