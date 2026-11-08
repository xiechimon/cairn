# Android installed web app: notifications and intake

Date: 2026-11-08
Status: Research complete for the proposed web-platform scope; device measurements pending

Requirement: [#3475](https://github.com/xiechimon/cairn/issues/3475). This concerns cairn installed from a browser, not a new native Android app. Research and designs precede separately dispatched implementation. No behavior described as proposed below is shipped by this document.

## Evidence labels

`[documented]` means a primary platform specification or vendor guide was read on the date above. `[observed-source]` means repository source was inspected, not exercised on a phone. `[inference]` is an engineering consequence of that evidence. `[proposed]` is a design recommendation, not an owner decision or device result.

## Primary sources

| Id | Source | Relevant finding |
| --- | --- | --- |
| S1 | [WHATWG Notifications API](https://notifications.spec.whatwg.org/#api) | `NotificationOptions` has actions, tag, data and navigation; `NotificationAction` has action, title, navigation and icon. Neither dictionary exposes Android channel creation or a standard text-input reply field. |
| S2 | [MDN showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification) | Persistent notifications can have actions; a clicked action without its own navigate URL reaches `notificationclick` through `event.action`. Denied permission rejects display. |
| S3 | [MDN actions](https://developer.mozilla.org/en-US/docs/Web/API/Notification/actions) | Actions have limited browser availability; browsers limit their number, discoverable through `Notification.maxActions`. |
| S4 | [Chrome Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target) | Installed apps register a manifest share target. Text can use GET; POST supports multipart files and can be intercepted in a worker. Android may put a URL in text rather than url. |
| S5 | [web.dev app shortcuts](https://web.dev/articles/app-shortcuts) | Installed-app launcher long-press shortcuts are in-scope URLs in manifest order. The Android guide describes three app slots; launcher/browser behavior still needs device verification. |
| S6 | [web.dev manifest updates](https://web.dev/articles/manifest-updates) | Android WebAPK manifest updates are asynchronous; guide describes daily checks, closed app windows, charging and Wi-Fi. `about://webapks` can expose update status. |

Sources were read through the agent-reach web/Jina route. Only findings and links are committed here, not copies of third-party pages or personal captures. Platform guides are not proof of the owner's browser/version behavior.

## Findings and consequences

### Categories are application preferences, not Android channels

- [documented, S1] The web API does not provide the native `NotificationChannel` registration interface. A tag is a replacement identifier, not a channel or a guarantee of separate OS groups.
- [inference, S1] cairn can offer independent server-side categories and distinguish notification titles and tags. It cannot promise two separately configurable entries in Android system settings from the existing web app.
- [proposed] Use `needs-answer` for questions and other decisions, and `completed` for finished work. Keep the existing per-device subscription master switch. Persist category preferences on each subscription, scoped by authenticated user and team.
- [observed-source] `apps/server/src/services/thread-push.ts` sends confirm/review/final-failure events, not done; [#2598](https://github.com/xiechimon/cairn/pull/2598) deliberately stopped done/merged pushes. The account page's twice-daily-digest help text is therefore not an accurate description of current phase notifications.
- [proposed] Preserve the existing quiet default: needs-answer enabled, completed disabled. Explicitly enabling completed opts into new done notifications; never backfill historical completions. This extends #2598, rather than silently undoing it.

### An Answer action navigates; it does not answer

- [documented, S1–S3] Notification buttons are possible on supporting browsers. They are neither portable nor guaranteed visible on a lock screen or collapsed notification.
- [inference, S1] Standard web actions do not provide a portable native inline text reply. Experimental browser extensions are not a suitable dependency for this task.
- [proposed] Offer one `Answer` action for a question. Both body tap and Answer open the exact pending question using a stable request id, then focus its existing answer UI after authorized data loads. No answer is sent by a worker; no credentials, question options or answer text are embedded in launch URLs.
- [observed-source] `apps/web/public/sw.js` currently displays title/body/tag and routes every click through the same stored href. `apps/web/src/pwa/register.tsx` consumes that href. Neither currently distinguishes actions or the specific question.
- [proposed] Keep the stored-navigation path required by existing iOS behavior. Validate same origin and permitted internal destinations at both worker and page boundaries. A stale question shows its resolved state, never a different question under the old action.

### Quick entry uses existing product surfaces

- [documented, S5–S6] Launcher shortcuts need installation and manifest refresh. They are not widgets, Android Quick Settings tiles or dynamic per-question shortcuts.
- [observed-source] `useOpenComposer` currently launches the Coordinator at `/app` via router state. Manifest URLs cannot carry router state; a URL-to-intent adapter is required, with one-shot consumption and refresh/back tests.
- [proposed] Two shortcuts only: New task, then Needs you. Use the existing task-creation intent and needs-you selector, with equivalent in-app controls when a launcher does not expose shortcuts. Preserve the manifest id and start_url.

### Share intake must survive a cold offline launch

- [documented, S4] Sharing text/links and sharing files are distinct manifest shapes. File reception needs POST and multipart. Accepting a Web Share API outbound call does not register an inbound target.
- [observed-source] The current manifest has neither shortcuts nor share_target. The worker has no fetch handler or offline shell. An online-only GET route would not meet a cold-offline share requirement and could put shared text in navigation logs/history.
- [proposed] Use POST multipart intake intercepted only at `/app/share-target`. Store a bounded local draft before redirecting to a small cached review shell. The shell must work without login, but must not contact the server or expose authenticated content until session validation. Display storage failure instead of a false Saved message.
- [proposed] Support title, text, URL and files through the existing attachment upload flow. Use exact file size/type constraints from that flow, verified at implementation time; do not invent a second uploader or silently discard files. Unsupported types receive a clear refusal while supported text remains recoverable. No shared content is executed, fetched, submitted, or sent to a model without the person's confirmation.
- [inference, S4] Android URL-in-text behavior makes field preservation safer than treating an empty url field as an empty share. Raw content remains plain text in the review UI.

## Reused main work and boundaries

Reuse [mobile information architecture](../design/mobile-information-architecture.md) for the needs-you mental model, not its future native tab bar or `cairn://` links. Reuse [claude.ai specification](../design/claude-ai-spec.md) and the existing gallery components for the web UI. Keep native iOS, desktop #136 and MCP #3476 outside this change.

Numbered overlap result (title/body search, open issues, open PRs, merged last seven days, and explicit file scans):

1. #3475 is this exact request; extend it, create no competing issue.
2. #3485 owns homepage question context, accepted-answer cleanup and counts; do not duplicate its lifecycle fix. #3476 is the independent MCP task.
3. #3462 merged the single-home Coordinator entry. #3148 supplied the question dock; #2713 retained old task links through a redirect. Consume those surfaces rather than restore the floating window.
4. #3424 supplies native mobile IA; #3447 supplies the feature registry. Neither implements Android installed-web-app intake.
5. Open PR matches for the initial manifest, worker and push-service paths: explicitly none. For the documentation segment, #3486 (`cairn/conv-01a1bc77-10b5-7dec-b021-4fe865bf6370`) touches the registry and both generated maps; #3473 (`feat/chat-markdown-polish`) touches the generated skill map. Proceed with an additive planned row only, preserving all existing rows; regenerate after their merges rather than hand-merge generated output.

The backend contract and tests-first handoff are in [backend design](../design/android-installed-web-app-backend.md); UI states and draft requirements are in [frontend design](../design/android-installed-web-app-frontend.md). The owner will perform [real-device acceptance](../verify/android-installed-web-app-acceptance.md). No physical-device result is claimed here.
