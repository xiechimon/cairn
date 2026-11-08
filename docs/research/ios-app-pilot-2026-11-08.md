# iOS app pilot: platform requirements, iOS 27 design and stack choice (2026-11-08)

Marks: **Measured** = read or run first-hand this session (link given); **Inferred** = derived from measured facts, re-checkable; **Guess** = everything else, including predictions. They correspond to `实测`, `推断` and `猜测` in the review convention.

## Question

Cairn wants a pilot native iOS client for its Coordinator threads and messages, talking to `apps/server` (Hono + SQLite, bearer-token auth). Before building it:

1. What do iOS 27 and Xcode 27 require, and when does the App Store minimum SDK move?
2. What changed in the iOS 27 design language versus iOS 26 Liquid Glass, and what should a chat or agent client adopt?
3. Which iOS 27 APIs matter for an agent client: Live Activities, App Intents and Siri, push, background work?
4. Which stack: native SwiftUI, Expo / React Native, or a WKWebView shell around `apps/web`?
5. How do reference products (Claude, t3code, Linear, Cursor, Amp, ChatGPT) build their iOS apps?

Facts measured by the requester before this note (Measured, ssh to ian's Mac): macOS 27.0.1, Xcode 27.2 (27B52), simulator runtimes iOS 18.0, 26.3, 27.0 and 27.1, an iPhone 18 Pro simulator on iOS 27.0.

Repository facts read this session (Measured, this worktree): `apps/server/src/lib/token-auth.ts` parses `Authorization: Bearer`; `apps/server/src/routes-remote.ts` exposes `POST /api/remote/pairing` and `POST /api/remote/pair`, backed by `apps/server/src/services/paired-devices.ts` (`pairedDeviceIdOfToken`, `revokePairedDevice`); `apps/server/src/routes-push.ts` and `services/push.ts` deliver Web Push with VAPID keys (`web-push` in `apps/server/package.json`), with no APNs path. The pilot app built from this note lives in `apps/ios/`; see Pilot results.

## Sources

Designated rows used from `SOURCES.md`: "UI, visual design, interaction feel" (claude.ai, t3code, Linear) and "Chat / agent product UX" (claude.ai, the Claude desktop app's Code tab, t3code, Cursor, Amp). Apple and Expo primary docs were added because the question is about a platform.

| Source | How it does it | Trade-offs | Link | Mark |
|---|---|---|---|---|
| Apple upcoming requirements | Lists active rules: since 2026-04-28 uploads must use Xcode 26 and the iOS 26 SDK; since 2026-09-09 apps must target iOS 13 or later. No iOS 27 SDK entry is listed yet. | The page lags the news post below. | https://developer.apple.com/news/upcoming-requirements/ | Measured |
| Apple news, "App Store submissions now open for the latest OS releases" (2026-09-09) | "Starting April 2027" uploads must be built with the iOS 27 and iPadOS 27 SDK or later. | Month only, no day. Past rule: "Starting April 28, 2026" for SDK 26 (news `ueeok6yw`, 2026-02-03). | https://developer.apple.com/news/?id=k1mtkt1k | Measured |
| Apple news, betas and Siri AI (2026-09-16, 2026-11-03) | Xcode 27.1 added iPhone Duo support (iOS 27.1 ships on it from 2026-10-23); iOS 27.3 and Xcode 27.3 betas are out; the Siri AI Developer Preview via App Intents opened in iOS 27.3 beta, with App Store submission "in the spring". Siri AI is unavailable in the EU and limited to supported languages. | Siri AI needs a 27.3 beta and an Apple Intelligence device. | https://developer.apple.com/news/?id=rfb1rooi , https://developer.apple.com/news/?id=gdk2umrf | Measured |
| WWDC26 Platforms State of the Union (102) | Liquid Glass retuned (more diffusion, darkened edge, user slider from clear to tinted), applied without recompiling; the old-design opt-out is removed once an app is rebuilt with Xcode 27; iOS apps become resizable on iPad and in iPhone Mirroring; Notion cited as moving from web tech to SwiftUI. | Apple's own advocacy for SwiftUI. | https://developer.apple.com/videos/play/wwdc2026/102/ | Measured |
| WWDC26 What's new in SwiftUI (269) and SwiftUI updates page | New: `visibilityPriority`, `ToolbarOverflowMenu`, `topBarPinnedTrailing`, `toolbarMinimizationBehavior`, `Tab(role: .prominent)`, swipe actions and reordering in any container, item-bound `alert` and `confirmationDialog`, HTTP-cached `AsyncImage`, the `@State` macro, `ContentBuilder`. September 2026 added `ArrangementView` and hinge APIs for iPhone Duo. | Most of these are iOS 27-only and need `#available` with a 26 target. | https://developer.apple.com/videos/play/wwdc2026/269/ , https://developer.apple.com/documentation/updates/swiftui | Measured |
| WWDC26 Modernize your UIKit app (278) | UIScene lifecycle is required with the latest SDKs ("your application will no longer launch" without it); supported orientations are only a preference in resizable environments; iPhone apps can opt into sidebars; navigation bars minimize on scroll; menus get an Ask Siri item driven by View Annotations. | Applies to any UIKit host, including RN and WKWebView shells. | https://developer.apple.com/videos/play/wwdc2026/278/ | Measured |
| WWDC26 Live Activities essentials (223) and ActivityKit docs | In iOS 27 Dynamic Island compact and minimal views show in portrait and landscape; updates come from the app, per-activity push tokens, or broadcast channels. The ActivityKit updates page has no June 2026 entry (last: June 2025 scheduled start, Mac menu bar, CarPlay). | Broadcast needs a channel per event and is enabled only on developer.apple.com. | https://developer.apple.com/videos/play/wwdc2026/223/ , https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications , https://developer.apple.com/documentation/updates/activitykit | Measured |
| WWDC26 App Intents (345, 343, 240) and App Intents updates | New `LongRunningIntent` (past the 30-second limit, progress shown automatically as a Live Activity with a stop button), `CancellableIntent`, `UndoableIntent`, `supportedModes`, `allowedExecutionTargets`, `SyncableEntity`, `OwnershipProvidingEntity`; app schemas for Siri AI; the UnicornChat sample is a messaging app. | Siri AI ships to customers later; schemas are domain-bound. | https://developer.apple.com/videos/play/wwdc2026/345/ , https://developer.apple.com/documentation/updates/appintents | Measured |
| APNs token-based connection doc | JWT signed ES256 with a `.p8` key, `kid` and `iss`, refreshed at least hourly; team-scoped keys can now be restricted to Sandbox or Production. | Needs a provider service and one secret key. | https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns | Measured |
| HIG Materials | Liquid Glass belongs to the navigation and control layer, not the content layer; use it sparingly on custom controls; the `clear` variant only over rich media. | Message bubbles must not be glass. | https://developer.apple.com/design/human-interface-guidelines/materials | Measured |
| App Review Guidelines 4.2 and 2.5.6 | 4.2: an app must be more than "a repackaged website"; 4.2.2 rejects web clippings. 2.5.6: web browsing must use WebKit. | Risk falls on wrapper apps. | https://developer.apple.com/app-store/review/guidelines/ | Measured |
| TestFlight | Up to 100 internal testers; App Review is required only for the first build sent to external testers. | Internal testing skips 4.2 review. | https://developer.apple.com/testflight/ | Measured |
| Expo SDK 58 changelog (2026-10-15) | "Built for iOS 27", React Native 0.88; prebuild generates a SceneDelegate for the UIScene requirement; Device Hub support for Xcode 27; `@expo/ui` gains SwiftUI `NavigationStack`, `Toolbar` and `ArrangementView`; `expo-app-intents` is alpha. | macOS is not supported in SDK 58; App Intents are still declared in Swift. | https://expo.dev/changelog/sdk-58 | Measured |
| Expo SDK reference and New Architecture guide | SDK 58: RN 0.88, React 19.3.0, iOS 16.4+, Xcode 26.4+. SDK 55 and later run only on the New Architecture. | Three SDKs a year to keep up with. | https://docs.expo.dev/versions/latest/ , https://docs.expo.dev/guides/new-architecture/ | Measured |
| Expo `expo-glass-effect`, `@expo/ui`, `expo-widgets` | `GlassView` wraps `UIVisualEffectView`, iOS 26+ only; `@expo/ui` maps SwiftUI primitives one-to-one inside a `<Host>`; `expo-widgets` builds widgets and Live Activities, with push support behind `enablePushNotifications`. | Glass and SwiftUI arrive as islands inside an RN tree. | https://docs.expo.dev/versions/latest/sdk/glass-effect/ , https://docs.expo.dev/versions/latest/sdk/ui/ , https://docs.expo.dev/versions/latest/sdk/widgets/ | Measured |
| t3code (`pingdotgg/t3code`, main at 2026-11-08) | `apps/mobile` is Expo 58.0.14 with RN 0.88.0 and `@expo/ui`, `expo-glass-effect`, `expo-widgets` and `expo-notifications`; it shares `@t3tools/client-runtime`, `contracts` and `shared` with web; it has ten custom native modules (`t3-agent-notifications`, `t3-terminal` on libghostty, `t3-review-diff`, `t3-composer-editor`, ...). Agent Live Activities: `src/features/agent-awareness/agentLiveActivity.ios.ts`. Pushes come from a separate relay (`infra/relay/src/agentActivity/ApnsClient.ts`, `ApnsProviderTokens.ts`, `LiveActivities.ts`). Shipped on the App Store and Google Play; TestFlight is invite-only. | Code reuse comes from shared TS packages, not from the web UI; native modules still need Swift and Kotlin. | https://github.com/pingdotgg/t3code/tree/main/apps/mobile , https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md | Measured |
| t3code "Devices" | `apps/server/src/device/` holds `DeviceHubProxy`, `DeviceToolchain.ensureDeviceHub`, `EasDeviceHost` and `AgentDeviceTarget`; mobile `src/features/devices/DeviceStreamWebView.tsx` streams a device into the thread. It is agent-driven control of iOS simulators and Android emulators, local or on EAS, not an end-user phone app. | Confirms the sibling note. | https://github.com/pingdotgg/t3code/tree/main/apps/server/src/device | Measured for file names and Device Hub calls; Inferred for the end-to-end feature |
| Claude iOS app (claude.ai row) | Anthropic hires "Staff Software Engineer, iOS" for the Claude mobile team, requiring "Swift, UIKit, SwiftUI". Claude Code docs: the Claude iOS app is a client for cloud sessions and Remote Control in a **Code** tab, with push notifications when a task finishes or needs a decision. | Hiring text, not a binary audit. Operating the app: blocked, because it needs a physical iPhone signed in to ian's account (simulators cannot install App Store apps) and the IPA is FairPlay-encrypted. | https://job-boards.greenhouse.io/anthropic/jobs/4572744008 , https://code.claude.com/docs/en/mobile | Measured for job text and docs; Inferred that the app is native Swift |
| Claude desktop app Code tab | Boris Cherny (YC Startup School 2026, quoted by Daring Fireball) says the desktop app is Electron and he was trialling an agent-driven Swift rewrite. | Desktop, not iOS; the quote is secondary. | https://daringfireball.net/linked/2026/08/02/cherny-claude-swift | Inferred |
| Linear (linear.app/now) | Launch post: "fully native iOS and Android applications". The Liquid Glass post: a two-engineer iOS team rebuilt its own glass in SwiftUI (UIVisualEffectView blur, an SDF specular shader, a custom tab bar), so the design also reaches iOS 18 users and does not depend on a moving Apple target; it skipped refraction. | More control and older-OS reach, for more work. | https://linear.app/changelog/2024-09-19-introducing-linear-mobile , https://linear.app/now/linear-liquid-glass | Measured |
| Cursor for iOS | "A native mobile app" for controlling cloud and local agents; Live Activities on the lock screen and push when an agent finishes, needs input, or is ready for review; PR review and merge in the app. | Stack not named beyond "native". | https://cursor.com/docs/cloud-agent/mobile , https://cursor.com/blog/ios-mobile-app | Measured |
| Amp for iPhone and iPad | Requires iOS 26 or later; distributed through a public TestFlight link, App Store later; push when a thread is ready; Shortcuts for dictation; share-sheet intake. | Stack not stated in docs. | https://ampcode.com/docs/apps/ios , https://ampcode.com/news/amp-on-ios-and-macos | Measured |
| ChatGPT iOS | OpenAI iOS job post asks for fluency in "Swift ... UIKit, SwiftUI". | Hiring text only. | https://openai.com/careers/ios-engineer-applied-foundations-san-francisco/ | Measured for text; Inferred native |

Blocked: operating the Claude iOS app (needs a physical device and ian's sign-in). Screen-recording the iOS apps of t3code, Linear, Cursor and Amp was not done for the same reason; source code or docs stand in, as listed.

## iOS 27 requirements and deadline

- Today, uploads need Xcode 26 and the iOS 26 SDK (since 2026-04-28), and the minimum deployment target is iOS 13 (since 2026-09-09). Measured, upcoming-requirements page.
- From **April 2027**, iOS uploads must be built with the **iOS 27 SDK or later**. Measured, https://developer.apple.com/news/?id=k1mtkt1k. Apple has not published the day; the 2026 rule took effect on April 28. Measured for the 2026 date, Guess for a similar late-April day in 2027.
- ian's Xcode 27.2 already meets both rules. Inferred from the measured Xcode version.
- Rebuilding with Xcode 27 removes the Liquid Glass opt-out (Measured, SOTU) and requires the UIScene lifecycle (Measured, session 278). A new SwiftUI app meets both by default. Inferred.
- iOS 27 iPhone apps are resizable, and orientation locks are ignored in resizable environments (Measured, session 278 and Expo SDK 58 notes). Layouts must use size classes, not idiom or orientation. Inferred.
- Deployment target: the pilot's iOS 26.0 target is right. `glassEffect(_:in:)` exists from iOS 26.0 (Measured, API page), and Amp also requires iOS 26 (Measured). Gate iOS 27-only APIs behind `if #available(iOS 27, *)`. Inferred. ian's own iPhone OS version is unknown. Guess.

## iOS 27 design and APIs to adopt

Design, versus iOS 26 (all Measured from sessions 102, 269, 278 and the SwiftUI updates page unless marked otherwise):

- Liquid Glass is the same material, retuned: more diffusion, a darkened edge, brighter highlights and a system clear-to-tinted slider. Standard bars and controls pick this up without code. Adopt it by using system `NavigationStack`, `TabView`, toolbars and `.searchable`, not custom chrome.
- Toolbars: `visibilityPriority(.high)` for send, stop and new thread; `ToolbarOverflowMenu` for archive and delete; `topBarPinnedTrailing` for the primary action; `toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)` on the transcript.
- Tabs: `Tab(role: .prominent)` places one tab at the trailing edge. Good for a "New task" or Coordinator tab. Inferred.
- Search: placement decides behavior. A bottom-toolbar search field rises over the keyboard; an inline field stays at the top (Measured, session 292). For thread search, use a search tab or a toolbar field. Inferred.
- Lists: swipe actions and reordering now work in any container (`swipeActionsContainer`, `reorderContainer`), so a custom `LazyVStack` thread list no longer has to give up swipe-to-archive.
- Dialogs: item-bound `confirmationDialog` and `alert(error:)` for destructive and error flows.
- `AsyncImage` now does HTTP caching, which covers avatars and attachments.
- HIG: no glass in the content layer, so message bubbles and cards use standard materials or solid colors (Measured, HIG Materials). Cairn's web UI mirrors claude.ai's flat look, which fits. Inferred.
- iPhone sidebars (`sidebar.preferredPlacement = .sidebar` in UIKit) and `ArrangementView` help on iPad, iPhone Duo and resizable windows. Later, not pilot scope. Inferred.

APIs for an agent client:

| Need | API | iOS version | Pilot? | Mark |
|---|---|---|---|---|
| Agent run progress on the lock screen and in the Dynamic Island | ActivityKit `Activity.request(..., pushType: .token)`, updated by APNs `liveactivity` pushes; broadcast channels are not needed for one user | 16.1+ (remote start 17.2+) | Phase 2 | Measured docs |
| "Needs your decision" and "finished" alerts | APNs token auth (ES256 JWT, `.p8` key) and a provider in `apps/server` | any | Phase 2 | Measured docs |
| Siri and Shortcuts: "ask Cairn …", "what is the Coordinator doing" | App Intents and `AppEntity` for threads; `LongRunningIntent` and `CancellableIntent` for runs over 30 seconds, which get a system Live Activity with stop | `LongRunningIntent` is iOS 27 | Phase 3 | Measured session 345 |
| Siri AI app schemas, onscreen awareness | App schema domains, View Annotations | 27.3 beta; submissions in the spring | Later | Measured news |
| Background freshness | Push-driven refresh beats `BGAppRefreshTask`, which runs at the system's discretion | — | Phase 2 | Guess |

## Stack comparison

| Row | Native SwiftUI | Expo / React Native (SDK 58) | WKWebView shell around `apps/web` |
|---|---|---|---|
| iOS 27 design fidelity | Full. System bars, tabs, search and toolbars get iOS 27 behavior on rebuild. Measured (SOTU, 269) | High where `@expo/ui` (SwiftUI in `<Host>`) or Expo Router `NativeTabs` and `Stack` are used; RN views in between are not system controls. Measured (Expo docs), Inferred for the mix | Low. Only the native chrome around the web view is glass; the content is the web UI. Inferred |
| Code reuse from `apps/web` | Low. Reuse is the HTTP contract (`packages/shared` zod schemas, ported by hand or generated). Inferred | Medium. `packages/shared` types and pure logic reuse well; `apps/web` React DOM components and Tailwind do not run in RN, so screens are rewritten (t3code shares `client-runtime` and `contracts`, not web UI). Inferred from t3code tree | High. The whole UI, unchanged. Inferred |
| Live Activities / App Intents / push | First-class: ActivityKit, App Intents and UserNotifications in Swift. Measured docs | Live Activities via `expo-widgets`; App Intents via `expo-app-intents` (alpha, intents still in Swift); push via `expo-notifications`. t3code still wrote a native module for agent notifications. Measured | Possible only through native glue code next to the web view; the web app's Web Push does not become APNs Live Activities. Inferred |
| Build tooling needs a Mac | Yes: Xcode 27 on ian's Mac (present), plus XcodeGen for the project file. Measured (requester) | Local iOS builds need a Mac; EAS Build can build in the cloud. Dev client is required once native modules are used (t3code README). Measured | Yes, Xcode for the shell. Inferred |
| Effort to TestFlight (pilot: sign-in, thread list, thread view, send) | About 1 to 2 agent-days: a small SwiftUI app plus signing. Guess | About 2 to 3 agent-days: Expo setup in a pnpm monorepo (Metro and workspace resolution), screens rewritten in RN, dev client. Guess | About 0.5 to 1 day for internal TestFlight. Guess |
| Review risk | Low. Inferred | Low. t3code is on the App Store. Measured | High for the public App Store under 4.2 ("repackaged website"); none for internal TestFlight, which skips App Review. Measured guidelines and TestFlight page |

## Recommendation

Build the pilot as **native SwiftUI**, targeting iOS 26.0 and built with Xcode 27, using only system navigation, tabs, toolbars and search. The pilot in `apps/ios/` follows this.

Why:

1. Every agent-client reference with a first-party statement is native: Linear ("fully native", SwiftUI), Cursor ("native mobile app"), and the Claude and ChatGPT iOS teams hire for Swift, UIKit and SwiftUI. t3code is the one Expo app, and it still needed ten custom native modules and a separate APNs relay. Measured for the statements, Inferred for the pattern.
2. The features that make a phone client worth having for Cairn (Live Activities for runs, decision pushes, App Intents, `LongRunningIntent`) are Swift-first APIs. In Expo they are alpha or need native modules anyway. Measured (Expo SDK 58 notes) and Inferred.
3. A web shell's reuse advantage is erased by 4.2 for any public release, and it gives up the iOS 27 design, which is the point of the pilot. Measured guideline and Inferred.
4. Cairn's reusable asset is the HTTP API and the `packages/shared` zod contract, not React components (the web UI mirrors claude.ai on DOM and Tailwind). An RN port would rewrite the screens anyway. Inferred.

Rejected for now: Expo, which fits better if an Android client becomes a goal (t3code shows the shape). The WKWebView shell is acceptable only as a throwaway internal TestFlight build.

Code areas this touches:

- `apps/ios/`: the SwiftUI app with XcodeGen `project.yml`, `CairnClient` (URLSession plus bearer token in the Keychain), models mirroring `packages/shared` schemas, and views for thread list, thread transcript and composer. Later targets: a Widget Extension for Live Activities and an App Intents extension.
- `apps/server` auth and token: reuse the existing paired-device flow (`routes-remote.ts` `/api/remote/pairing` and `/api/remote/pair`, `services/paired-devices.ts`, `lib/token-auth.ts`) so the phone gets a revocable device token instead of the owner token. `lib/token-auth.ts` is in the `credentials` list of `packages/shared/merge-gate-paths.json` (`routes-remote.ts` is not), so changes to it go through Codex cloud review. Measured.
- Push, later: add an APNs provider beside the existing VAPID Web Push in `apps/server/src/services/push.ts` and `push-alerts.ts`, with a device-token registration route next to `routes-push.ts`, ES256 JWT from a `.p8` key held by the server's secret store, and Live Activity push tokens per run (t3code's `infra/relay/src/agentActivity/*` is the reference shape). This needs ian for the Apple Developer key (a credential). Inferred.
- `packages/shared`: if Swift models drift, generate them from the zod schemas (JSON Schema to Swift) instead of hand-copying. Inferred.
- App Store: the iOS 27 SDK becomes mandatory in April 2027. Xcode 27.2 already meets it, so no action is needed beyond building with the installed Xcode.

## Pilot results

Built in `apps/ios/` as native SwiftUI (XcodeGen `project.yml`, deployment target iOS 26.0, Swift 6, no third-party packages), built with Xcode 27.2 and run on the iPhone 18 Pro simulator, iOS 27.0 (24A434). The iOS 27.1 runtime on the Mac accepts only the iPhone Duo device type, so iOS 27.0 was used. Measured.

What works, all Measured from `CairnUITests/PilotJourneyTests` passing in light and dark appearance against a scratch cairn server (`apps/server` on this branch, fresh `CAIRN_HOME`, `CAIRN_TOKEN` auth on, forwarded to the Mac over `ssh -R`):

- Sign in with a server address and token typed at runtime; the token goes to the Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). A wrong token shows "The server rejected this token." (401).
- Thread list: the Coordinator thread from `GET /api/teams/:id/chief/threads` and open tasks from `GET /api/todos`.
- Thread: transcript from `GET /api/conversations/:tid/messages`, send through `POST /api/conversations/:tid/messages`, the reply streamed over SSE (`text_delta`, then `message` and `step` trigger a reload). The in-server Coordinator ran each turn; the model behind it was a local OpenAI-compatible stub, so reply text is canned.
- iOS 26/27 design: system `NavigationStack` and toolbars (glass buttons), `glassEffect` and `GlassEffectContainer` on the composer, `.buttonStyle(.glassProminent)`, `scrollEdgeEffectStyle(.soft)`, `safeAreaBar` for the composer, and `toolbarMinimizationBehavior(.onScrollDown, for: .navigationBar)` behind `#available(iOS 27, *)` (signature checked in the Xcode 27.2 SDK `SwiftUI.swiftinterface`). Colors follow `apps/web` tokens and `apps/web/DESIGN-RULES.md` V5: ink-green primary, ochre only for a task that needs you.

Found and fixed during the pilot (Measured): `textContentType(.password)` on the token field triggered the iOS "Save Password?" sheet over the thread list; the transcript did not stay pinned to the newest message when the keyboard was up (fixed with `defaultScrollAnchor(.bottom)` and asserted in the UI test); white text on the dark-mode accent had low contrast; `localhost` failed to connect through an IPv4-only forward while `127.0.0.1` worked.

Gaps, not built in the pilot:

| Gap | Needed for | Notes |
|---|---|---|
| Pairing instead of the owner token | any device beyond ian's own | `POST /api/remote/pair` already issues revocable device tokens; the app needs a code-entry or QR screen. Inferred. |
| HTTPS reachability from a phone | a real device | ATS allows plain HTTP only for local addresses; a phone needs the server over HTTPS (for example Tailscale Serve on the tailnet). Inferred. |
| Task threads, approvals, `ask_user` answers, stop, attachments, markdown blocks | parity with web | Only the Coordinator thread is interactive; tasks are listed read-only; markdown renders inline styles only. Measured from the code. |
| APNs push and Live Activities | "needs you" and run progress on the lock screen | Server-side APNs sender plus a widget extension; needs ian's Apple key. Inferred. |
| App icon, launch polish, iPad layout | TestFlight review of the build | Measured: the asset catalog has no icon image. |
| Signing for distribution | TestFlight | The Mac has one "Apple Development" identity and no provisioning profiles; TestFlight needs a paid Apple Developer Program team and an App Store Connect app record. Measured for the Mac; Guess for the membership status. |

Estimate to an internal TestFlight build (Guess): about 2 to 3 agent-days for pairing, HTTPS setup notes, icon and archive/upload automation, plus ian's own steps (Developer Program membership if not already paid, App Store Connect app record, two-factor prompts). Push and Live Activities add about 3 to 5 agent-days, mostly server-side.

