# Mobile information architecture

The single source the iOS app (`apps/ios/`) and a future Android app follow. Both apps share the screens, tabs, navigation, states and row content below; only the platform styling differs (last section). A change to the layout lands here first, then in both apps.

Decisions this follows, all in the owner's plan: the phone home is the needs-you inbox, an item opens the full-screen thread, and the Coordinator conversation is the second tab (ian, 2026-10-31); one global Coordinator, with projects as filters and context, and a home made of needs-you, going-on and the conversation (D58); web, desktop and phone show the same threads (D33); the needs-you inbox uses numbered option cards with a recommended option and fixed status words (D57). Stack choice and platform requirements: `docs/research/ios-app-pilot-2026-11-08.md`.

## Navigation

```text
Sign in ──► Tab bar
            ├─ Tab 1  Needs you (home, badge = item count)
            │   ├─ Question ──► full-screen question card (answer in place)
            │   └─ Task row ──► full-screen task thread
            └─ Tab 2  Coordinator (the one conversation)
Account: a toolbar button on Tab 1 opens a sheet (server, sign out).
```

- Two tabs, never more in this version. The app opens on Tab 1 after sign-in and on every cold start.
- A pushed thread is full screen: the tab bar hides, back returns to the list at the same scroll position.
- A question answered on its card disappears from the inbox and shows as answered in the Coordinator conversation.
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

### Tab 1: Needs you

Order, top to bottom:

1. Questions from the Coordinator (newest first).
2. Tasks that need a decision: `awaitingReply`, plan ready (`confirm`), ready for review (`review`).
3. Failed tasks.
4. `Going on`: one collapsed row, `N running`, that expands to the running tasks.

What each row shows:

| Row | Leading glyph | Line 1 | Line 2 | Trailing |
| --- | --- | --- | --- | --- |
| Question | Small brand mark (the Coordinator) | Question header, then the question text, 2 lines max | `Asked you a question.`, then `Coordinator · N options` | Relative time |
| Needs you task | Accent dot (the only accent in the list) | Task title, 2 lines max | Reason: `Asked you a question.`, `Plan ready. Approve to start.` or `Ready for your review.`; under it `#seq · project` | Relative time |
| Failed task | Neutral glyph (never a red icon) | Task title | Text tag `Failed` and `Open it to retry.`; under it `#seq · project` | Relative time |
| Running task | 6px running dot | Task title, 1 line | `Working on it.`, `Writing the plan.` or `Waiting for a machine.` | Relative time |

Wording comes from `apps/web/src/board/thread-copy.ts` and `status-words.ts` (English from `apps/web/src/i18n/en.ts`, Chinese is the source string) so both surfaces say the same thing.

States:

| State | Shows |
| --- | --- |
| Loading (first load) | Centered progress, no skeleton rows |
| Empty | Brand mark, `Nothing needs you`, and the `Going on` row if anything runs |
| Error | One inline row with the error sentence and `Retry`; cached rows stay visible |
| Unauthorized | Return to Sign in with the server kept |

### Task thread (pushed)

Header: task title (inline title), status word and reason line under it. Body: the spec as the first block, then the conversation. Bottom: the composer `Message this thread`. Empty conversation shows `No messages yet` under the spec. Actions that need server routes not wired on mobile yet (approve plan, retry, merge) do not appear as buttons; the reason line says what is needed.

### Question (pushed)

The question card: header, question, numbered options with the recommended option marked `Recommended`, and the `Answer` primary button enabled once an option is picked. After answering, the screen shows the chosen option and returns to the inbox.

### Tab 2: Coordinator

The one conversation, newest at the bottom, pinned to the newest message while the keyboard is up. User messages in a bubble, assistant text full width, tool calls as one muted line each (`Used ask_user`). A pending question renders as the same question card inline. Composer `Message the Coordinator` with a circular send button. Empty: brand mark and the composer, which starts the thread.

## Platform styling

| Element | iOS 26/27 (Liquid Glass) | Android (Material 3 Expressive) |
| --- | --- | --- |
| Tab bar | System `TabView` with the floating glass tab bar; minimizes on scroll | `NavigationBar` with two destinations, expressive active indicator |
| Top bar | Large title on Tab 1, inline on pushed screens; glass toolbar buttons; iOS 27 `toolbarMinimizationBehavior(.onScrollDown)` | `LargeTopAppBar` on Tab 1, `TopAppBar` on pushed screens, collapse on scroll |
| Lists | Inset grouped list on the neutral canvas; rows on card color | `LazyColumn` with list items on surface containers, no dividers |
| Composer | Glass capsule (`glassEffect`), circular `glassProminent` send button | Filled text field in a bottom app bar, `FilledIconButton` send |
| Primary button | `.glassProminent` in the ink-green primary | `Button` (filled) in the primary color |
| Sheets | System sheet with detents | `ModalBottomSheet` |
| Color | cairn tokens from `apps/web` (canvas, card, ink ladder, ink-green primary, ochre only for needs you); system materials stay neutral | Same tokens mapped into a custom `ColorScheme`; dynamic color off so the ochre rule holds |
| Count badge | System tab badge on `Needs you`; its red is the platform's unread-count convention, the one exception to ochre-only for needs you | `Badge` on the `Needs you` destination in the theme's error color, the same exception |
| Brand mark | Vector `Shape` from the spiral generator; app icon as an Icon Composer `.icon` with light, dark and tinted appearances | Vector drawable from the same SVG paths; adaptive icon with a monochrome layer |
| Motion | System push and sheet transitions | Material shared-axis transitions, expressive spring motion |
