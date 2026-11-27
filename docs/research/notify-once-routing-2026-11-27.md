# Prior-Art Research: Notify-Once Presence-Routed Notification Delivery (2026-11-27)

## Question

When a scheduled run or any task needing the owner finishes while the user is not looking at Cairn, how should Cairn deliver **exactly one** alert in the **one** place the user currently is, without spamming every connected Mac, browser tab, phone push endpoint, and chat app (`im_connection`)?

## Primary Source Comparison

| Source | How it routes and deduplicates notifications | Trade-offs | Link |
|---|---|---|---|
| **Slack** | **Presence-based escalation (`实测`):** Desktop receives alerts while active. Mobile push is suppressed until **1 minute after screen lock** or **10 minutes after cursor/keyboard inactivity** (`When I'm not active on desktop`). Reading a thread anywhere clears unread badges across desktop and mobile. | Requires accurate OS idle/lock telemetry from the desktop app and a brief grace window during transient lock/away transitions; zero extra settings needed for the default 1m/10m behavior. | [Configure your Slack notifications](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications) |
| **Linear** | **Single Inbox source of truth + active-session routing (`实测`):** Every notification populates the Linear Inbox. Desktop/mobile/Slack alerts fire in real time, FAQ notes delivery may route to an active desktop app or browser session, and delayed email digests are skipped/suppressed when the item is already read in the Linear Inbox. | Real-time channels still need per-channel suppression if both desktop and mobile are enabled unless routed by presence; read-sync before delayed dispatch cleanly prevents late duplicates. | [Linear Docs: Notifications](https://linear.app/docs/notifications) |
| **GitHub** | **Synced inbox across web, mobile, and email (`实测`):** Notifications live in one inbox synced between Web and GitHub Mobile; reading an email notification automatically marks the corresponding inbox notification read (`notifications@github.com` sync). | Solves post-read sync across surfaces, though initial push vs web delivery relies on user subscription filters rather than desktop idle detection. | [GitHub Docs: Configuring notifications](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications) |
| **Apple `UNUserNotificationCenter`** | **Delivered banner lifecycle (`实测`):** Supports `removeDeliveredNotifications(withIdentifiers:)` and `getDeliveredNotifications(completionHandler:)` so notifications already shown in Notification Center can be dismissed once read elsewhere. | Requires the app to be code-signed on macOS; identifier-based removal keeps Notification Center clean after cross-device reads. | [Apple Developer: UNUserNotificationCenter](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter) |
| **Electron `Notification` & `powerMonitor` (v45.2.1)** | **Native OS alerts + OS idle/lock telemetry (`实测`):** `Notification` uses Apple `UNNotification` on macOS (requires code-signing), supports `notification.close()` and `Notification.getHistory()` (macOS) to clear delivered banners; `powerMonitor.getSystemIdleTime()`, `powerMonitor.getSystemIdleState(1) === 'locked'`, `lock-screen`, `unlock-screen`, `suspend`, `resume` report OS presence. | Unsigned dev builds emit `failed` on `Notification.show()`, so production/signed testing or `canNotify` capability reporting is required so missing OS permission falls back to away channels rather than dropping alerts silently. | [Electron Notification](https://www.electronjs.org/docs/latest/api/notification), [Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor) |

## Codebase Audit (`实测`)

1. **`schedule_run` is silenced in shared config:** `packages/shared/src/records/notification.ts:18-23` includes `'schedule_run'` in `SILENT_NOTIFICATION_TYPES`, preventing `apps/web/src/api/sse.ts:190` from ever popping a desktop notification for scheduled runs.
2. **Schedule completion/failure coverage gaps:** `apps/server/src/services/schedules.ts:880-889` (`finishScheduledStep`) only calls `notifyScheduleRun` when `row.todoId !== null`; `chiefThreadId` schedules never notify, successful runs pass `snippet: null` without a result summary, and pre-step failures in `apps/server/src/services/scheduler.ts:380-383` never call `notifyScheduleRun`.
3. **Broken chief deep-links & multi-window duplicates:** `apps/web/src/api/sse.ts:162-165` (`notificationHref`) checks `record.type === 'chief_message'` instead of `isChiefConversationId(record.entityId)`, so a chief `schedule_run` routes to `/app?thread=...` instead of `/app?chief=...`. Furthermore, `apps/web/src/api/sse.ts:198-200` forwards every SSE notification to `desktop.show` even when focused, on every open Mac simultaneously, while `/tray` (`apps/web/src/api/sse.ts:189`) skips notifications completely—meaning a Mac running with its main window closed (`--cairn-background-launch`) never pops notifications.
4. **Electron main-process gaps:** `apps/desktop/src/main.ts:1413-1436` (`serveNotifications`) has no `deliveryId` deduplication, no `dismiss(tag)`/`close()` handler for cross-device read sync, and `sendToWindow('desktop-navigate', payload.href)` (`apps/desktop/src/main.ts:965-979`) calls `openWindow(appOrigin)` when `mainWindow === null`, losing `desktop-navigate` before the page finishes loading.
5. **Dual-dispatch & IM away gap:** `apps/server/src/services/owner.ts:242-258` and `apps/server/src/services/chief-questions.ts:78-84` unconditionally call BOTH `notifyOwnership`/`notifyChiefMessage` (SSE) AND `pushToUserSafely` (Web Push + APNs) even when the user is active on Mac; meanwhile connected chat apps (`im_connection`) receive nothing when the user is away unless the turn originated from IM (`imTurnOrigin`).
6. **Focus vs visibility & chief unread sync:** `apps/web/src/board/use-mark-thread-read.ts:12-21` checks `document.visibilityState === 'visible'` (which stays `visible` on macOS even when Cairn is behind another app), and `apps/web/src/board/home-c.tsx` does not call `useThreadPresence` or `useMarkThreadRead` for `chiefThreadId`.

## Chosen Pattern: Server-Authoritative Presence Routing ("Notify Once")

Adopt the **Slack + Linear** pattern enforced centrally on the Cairn server:

1. **Single routing decision per alertable event:** The server maintains per-client presence (`clientId`, `kind: desktop | web | ios`, `focused`, `activeThreadId`, `screenLocked`, `systemIdleSec`, `canNotify`, `updatedAt`) plus persisted `user.lastDesktopActiveAt`.
2. **Exact-once target selection:**
   - Focused on that exact `entityId` -> mark `read` immediately (`0` banners, `0` away alerts).
   - Focused elsewhere in Cairn -> `suppressed` (in-app unread dot only, `0` banners, `0` away alerts).
   - Unfocused & an active-notifiable client exists -> pick **one** winner (`desktop` over `web`, lowest `systemIdleSec`, newest `updatedAt`, lexicographical `clientId`), persist `deliveryStatus = 'desktop'`, and emit SSE with `delivery: { id, targetClientId }`. Only the winner client pops an OS banner.
   - Locked `< 60s` or recently active desktop (`< 10 min` idle) -> persist `deliveryStatus = 'pending_away'` with a `due_event` (`notification-away:<id>`) so transient locks/reconnects do not immediately fire mobile/IM; if the user unlocks or reads before `awayDueAt`, cancel the away send.
   - Away (`>= 60s` locked or `>= 10 min` since last active desktop, or no active desktop ever) -> atomically claim `away` and send **exactly one** alert: to the single most-recently-updated `ready` live `im_connection` with a `pairedSenders` entry, OR if no ready chat app exists, to `pushToUserSafely` (phone/browser push). Never both.
3. **Read-anywhere clears everywhere:** Marking a notification read anywhere sets `readAt` & `deliveryStatus = 'read'`, deletes `notification-away:<id>`, cancels pending `external_effect` rows, and broadcasts the read record over SSE so connected Macs dismiss delivered banners (`notification.close()` / `Notification.getHistory()`).

## Concrete Code Areas

- `packages/shared/src/records/notification.ts`, `packages/shared/src/protocol/sse.ts`, `packages/shared/src/desktop-shell.ts`
- `apps/server/src/db/schema.ts`, `apps/server/drizzle/0265_notification_delivery.sql`
- `apps/server/src/services/thread-presence.ts`, `apps/server/src/routes-push.ts`, `apps/server/src/services/events.ts`
- `apps/server/src/services/notification-router.ts`, `apps/server/src/services/notifications.ts`
- `apps/server/src/services/im/runtime.ts`, `apps/server/src/services/im/core.ts`, `apps/server/src/index.ts`
- `apps/server/src/services/schedules.ts`, `apps/server/src/services/coordinator-steps.ts`, `apps/server/src/services/scheduler.ts`
- `apps/server/src/services/owner.ts`, `apps/server/src/services/chief-questions.ts`, `apps/server/src/services/mail.ts`
- `apps/desktop/src/desktop-notifications.ts`, `apps/desktop/src/main.ts`, `apps/desktop/src/preload.ts`
- `apps/web/src/desktop-shell.ts`, `apps/web/src/pwa/thread-presence.ts`, `apps/web/src/api/provider.tsx`, `apps/web/src/api/team-stream-cache.ts`, `apps/web/src/api/sse.ts`, `apps/web/src/board/use-mark-thread-read.ts`, `apps/web/src/board/home-c.tsx`, `apps/web/src/i18n/en.ts`
