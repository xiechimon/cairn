# Mobile information architecture

The single source the iOS app (`apps/ios/`) and a future Android app follow. Both apps share the screens, tabs, navigation, states and row content below; only the platform styling differs (last section). A change to the layout lands here first, then in both apps.

Decisions this follows, all in the owner's plan: the phone app copies the web app at phone width (`apps/web/src/board/phone-tabs.tsx`, DESIGN-RULES C10, C11, C13): the Coordinator conversation is the home, with `任务`, `成果` and the computers button beside it (owner 2026-11-14, replacing the needs-you inbox home of 2026-10-31); one global Coordinator, with projects as filters and context, and a home made of needs-you, going-on and the conversation (D58); web, desktop and phone show the same threads (D33); the needs-you inbox uses numbered option cards with a recommended option and fixed status words (D57). Stack choice and platform requirements: `docs/research/ios-app-pilot-2026-11-08.md`.

## Navigation

```text
Sign in ──► Tab bar
            ├─ Tab 1  Chat: the Coordinator conversation (home)
            │   ├─ Thread row ──► full-screen task thread
            │   └─ Question chips (answer in place)
            ├─ Tab 2  Tasks (badge = items waiting on you)
            │   ├─ Question ──► full-screen question
            │   └─ Task row ──► full-screen task thread
            ├─ Tab 3  Made: finished work
            └─ Computers: the trailing round tab (iOS 27 `Tab(role: .prominent)`)
Top of Tab 1: menu button (account sheet), the Coordinator status mark, a Tasks button with the count.
```

- The app opens on Tab 1 after sign-in and on every cold start.
- A pushed thread is full screen: the tab bar hides, back returns to the list at the same scroll position.
- A question answered from its chips shows `Answered · <choice>` in the conversation and leaves the Tasks tab.
- Deep links (push notifications, later): `cairn://thread/<todoId>` and `cairn://question/<requestId>` open the pushed screen on top of Tab 1.

## Data

| Screen | Source | Same as web |
| --- | --- | --- |
| Needs you | `GET /api/todos?teamId=` filtered with the web rule `threadStatus` (`awaitingReply`, `confirm`, `review` → needs you; `failed` → failed; archived rows excluded), sorted by `actRank` then newest `phaseAt`; plus pending Coordinator questions: `ask_user_question` messages with `status: pending` in `GET /api/conversations/<coordinator thread>/messages` | `apps/web/src/board/needs-you.ts`, `thread-copy.ts` |
| Going on | Same todos with status running (`queued`, `planning`, `building`) | `home-c.tsx` running list |
| Task thread | The todo, plus `GET /api/conversations/<latestBuildId>/messages` when a build exists; send with `POST /api/todos/:id/messages` | thread view |
| Question | The pending message; answer with `POST /api/teams/:id/chief/threads/:tid/questions/:requestId/answer` `{answers: [{header, choices}]}` | `chief-question-card.tsx` |
| Coordinator | `GET /api/teams/:id/chief/threads`, messages and SSE `GET /api/conversations/:tid/stream`; send with `POST /api/conversations/:tid/messages`, or `POST /api/teams/:id/chief/threads` for the first message | Coordinator pane |

## Screens

### Sign in

Brand mark (large spiral), title `Sign in to cairn`, server and token fields, `Sign in` primary button, the hint `Run cairn token on the server machine to print the token.` Errors show one line under the fields: rejected token, unreachable server, invalid address.

On a later launch with a saved token the app restores the session behind a centered progress view. If the server is unreachable, times out or answers 5xx, it shows the brand mark, the error sentence, the server address, `Try again` (primary) and `Sign out`; a rejected token returns to Sign in.

### Tab 1: Chat (home)

The one Coordinator conversation, newest at the bottom and pinned there while the keyboard is up, as on the web phone home.

- Top: three round glass controls and nothing else: the menu (account sheet), the Coordinator status mark, and `Tasks` with the blue count badge (C13). The status mark is the web's hand-drawn mark (`apps/web/src/chief/status-mark.ts`) with the same ten states and shapes: idle spiral, thinking, replying, looking through the project, running a command, creating a task, waiting for you (speech bubble), done (check, for 2.2 s after a reply), error (red cross) and offline. Its accessibility label names the state; it holds still under Reduce Motion.
- User messages in a right-aligned `--bubble-fill` bubble with a tail; Coordinator replies in a left-aligned `--reply-bubble-fill` bubble (V3).
- A thread started in a turn shows once as a reference row on the reply that started it: a small elbow, the status tile in the task's tone and the title (C10). It opens the task thread. Other tool calls are not shown.
- A pending question shows as a reply bubble with the question, then one chip per option, the recommended one first and filled, no numbers (C11). A tap on a chip answers a single-choice question; multi-select and free-text questions add `Submit`. While a question is open the composer reads `Type your own answer…` and sends its text as the answer.
- Composer: the web's narrow composer (`apps/web/src/chief/composer-surface.tsx`): a 14pt rounded rectangle in the composer fill with a 1px ring and a soft drop shadow, a leading `+` in the foreground colour, and a send arrow in a grey circle that turns from tertiary to foreground when there is a draft. `+` opens `Photo library` and `Add attachment`; each pick uploads at once and shows as a chip above the field, and the message carries it as an attachment token, as on the web. Sent attachments show as chips above the user bubble.
- Empty: brand mark and the composer, which starts the thread.

### Tab 2: Tasks

Sections, each headed by its status tile, label and count, as in the web Tasks panel (C10): `Needs you` (Coordinator questions, then tasks in `needs_input`, `confirm`, `review` and failed tasks), `In progress`, `To start`, `Done`. A needs-you row shows the title (2 lines), the reason and project under it, and a compact age (`7m`, `6h`, `2d`); other rows are one line with the age. Task numbers are not shown (C15).

| State | Shows |
| --- | --- |
| Loading (first load) | Centered progress, no skeleton rows |
| Empty | Brand mark and `Nothing needs you` |
| Error | One inline row with the error sentence and `Retry`; cached rows stay visible |
| Unauthorized | Return to Sign in with the server kept |

### Tab 3: Made

Finished tasks, newest first, with project and date. Empty: `Tasks show up here once they merge.`

### Computers

The machines from `GET /api/teams/:id/machines`, each with an online dot and `Online · N running` or `Offline`.

Wording comes from `apps/web/src/i18n/en.ts` (Chinese is the source string).

### Task thread (pushed)

Header: the task title as the inline navigation title with the reason and project as its subtitle (C14). Body: the conversation in the same bubbles as Tab 1; the spec shows only while the conversation is empty. Bottom: the composer `Message this thread`. Empty conversation shows `No messages yet` under the spec. A message that starts a replacement build switches the screen to the conversation the server returns. While the screen is open it follows the conversation stream, so new task messages and streamed text appear without reopening it. Actions that need server routes not wired on mobile yet (approve plan, retry, merge) do not appear as buttons; the reason line says what is needed.

### Question (pushed)

Opened from the Tasks tab. The same question bubble and chips as Tab 1. Earlier wording, kept for the Android app until it follows: the question card: header, question, numbered options with the recommended option marked `Recommended`, or a `Your answer` text field when the question has no options; a multi-select question adds `Pick any that apply.` and toggles each option. The `Answer` primary button is enabled once every question has a pick or non-blank text. After answering, the screen shows the chosen option and returns to the inbox.

## Platform styling

| Element | iOS 26/27 (Liquid Glass) | Android (Material 3 Expressive) |
| --- | --- | --- |
| Tab bar | System `TabView` with the floating glass tab bar (`Chat`, `Tasks`, `Made`) and the computers tab as the separate trailing circle (`Tab(role: .prominent)` on iOS 27); minimizes on scroll | `NavigationBar` with three destinations and a separate computers button, expressive active indicator |
| Top bar | Tab 1: three glass toolbar controls (menu, status mark, Tasks with count); other tabs: large title; pushed screens: inline title and subtitle; iOS 27 `toolbarMinimizationBehavior(.onScrollDown)` | `TopAppBar` with the same three controls on Tab 1, `LargeTopAppBar` elsewhere, collapse on scroll |
| Lists | Inset grouped list on the neutral canvas; rows on card color | `LazyColumn` with list items on surface containers, no dividers |
| Composer | A rounded rectangle with the web composer's fill, ring and shadow (not glass), holding `+` (a `Menu` with `PhotosPicker` and `fileImporter`), the field and a grey round send button | Filled text field in a bottom app bar, `FilledIconButton` send |
| Primary button | Filled ink capsule (the web `primary` is the foreground color) | `Button` (filled) in the primary color |
| Sheets | System sheet with detents | `ModalBottomSheet` |
| Color | cairn tokens from `apps/web/src/styles/shadcn.css` in `Cairn/Brand/Palette.swift` (canvas, card, ink ladder, bubble fills, task tone tiles, the blue count badge); system materials stay neutral | Same tokens mapped into a custom `ColorScheme`; dynamic color off |
| Count badge | The blue `--count-badge` on the Tasks toolbar button (V5); the system tab badge on `Tasks` stays the platform red | `Badge` on the `Tasks` destination in `--count-badge` blue |
| Brand mark | Vector `Shape` from the spiral generator; app icon as an Icon Composer `.icon` with light, dark and tinted appearances | Vector drawable from the same SVG paths; adaptive icon with a monochrome layer |
| Motion | System push and sheet transitions | Material shared-axis transitions, expressive spring motion |
