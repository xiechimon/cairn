# Duet-shaped clients: one layout for web, iOS and desktop

Status: accepted by the owner on 2026-11-09 (decisions in section 8). No app code lands with this document; implementation follows the PR order in section 6.

The owner restarted the iOS app and the desktop app and wants both shaped like Anthropic's Claude Duet. This document maps Duet onto cairn once, so the web app, the iOS app and the Electron desktop shell share one information architecture. When it is accepted, it replaces the tab layout in `docs/design/mobile-information-architecture.md` (that file is updated in the first PR below, not here).

Owner decisions of 2026-11-09 that shaped this document (the full list is in section 8):

1. The iOS app copies Duet's structure closely; the desktop app borrows from it. Where Duet's order or default differs from a cairn preference, Duet wins (the home tab and the Tasks section order).
2. Duet's layout and interaction patterns, with cairn's own tokens and colors; never Duet's brand assets (logo, typeface, orange accent, illustrations).
3. A third tab like `Make` only if it maps to something real in cairn (section 2.7).
4. Distribution is free signing with on-phone re-signing, not the paid program; "needs you" must still reach the phone without APNs (section 4.4 and 4.3).

Marks used on every claim that drives a decision:

- **Seen**: visible in a reference image listed under Sources.
- **Read**: read in a primary text source (Anthropic page, Apple page, a GitHub repository, or this repository's code and docs at `origin/main` `45f00e7f8`).
- **Inferred**: derived from Seen or Read facts and checkable; anything predictive is also marked Inferred.

The signing write-up in 4.4 uses the review convention's marks: `实测` (seen or read first-hand: Seen and Read above), `推断` (Inferred) and `猜测` (a guess, not checked).

Duet is waitlisted, so nothing here comes from operating it. Every Duet row is Seen or Read from public material.

## Sources

| Source | What it gave | Link |
|---|---|---|
| Duet product page | Bottom tabs, morning brief, approval cards, "one thread" FAQ | https://claude.com/product/claude-duet |
| Duet launch article (2026-10-23) | One ongoing thread, checks every few hours, approval before send/pay/sign/delete, own app separate from Claude | https://claude.com/resources/articles/claude-duet |
| Duet help article, "Get started with Claude Duet" | Main thread, channels "share the same memory", Tasks tab, Make tab, only the user marks a task complete | https://support.claude.com/en/articles/17631495-get-started-with-claude-duet |
| TechCrunch launch coverage (2026-10-22) | Press screenshots: channel drawer, Tasks list, task sub-thread | https://techcrunch.com/2026/10/22/claude-duet-app-is-anthropics-bet-on-agents/ |
| Press and blog screenshots (TechCrunch, DataCamp, aibyaakash, aiagentslib, a YouTube walkthrough) | Web sidebar with groups and dots, new-channel dialog, task card in a channel, "marked complete" line | collected locally; not redistributed here |
| Apple: supported capabilities (iOS) | Push notifications: ADP yes, ADEP yes, free Apple Developer no | https://developer.apple.com/help/account/reference/supported-capabilities-ios |
| Apple: compare memberships, programs, devices, TestFlight | Personal Team limits (7-day profiles, 3 apps, 10 App IDs), $99/year, 100 devices per family, 90-day TestFlight builds, 100 internal testers | https://developer.apple.com/support/compare-memberships/ , https://developer.apple.com/programs/ , https://developer.apple.com/help/account/devices/devices-overview , https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview |
| Zapier hands-on review | Tab roles: Chat is "one continuous thread"; Tasks "starts empty and offers to scan your tools"; Make is "where you'll build out projects", with templates "like a daily to-do list and email triage" | https://zapier.com/blog/claude-duet/ |
| Seal (`imylhbot/MJorb`), AltStore, SideStore, LiveContainer, iloader READMEs | Re-signing mechanisms and licenses | https://github.com/imylhbot/MJorb , https://github.com/altstoreio/AltStore , https://github.com/SideStore/SideStore , https://github.com/LiveContainer/LiveContainer , https://github.com/nab138/iloader |
| Seal demo video, uploader `Sealsign`, 56 s, 2026-10-08 (frames viewed in a browser) | Seal's screens: pending and installed lists, sign sheet, batch renewal, expiry reminder | https://www.bilibili.com/video/BV1k5HS6aE5s/ |
| CatCoder video, "LiveContainer + SideStore", 2026-07-02 (title and description; no subtitle track) | Free signing via iloader, LiveContainer and SideStore, then a Shortcuts automation for refresh without a computer | https://www.youtube.com/watch?v=UjS2oob2KUk |
| WebKit blog, "Web Push for Web Apps on iOS and iPadOS" | iOS 16.4 adds Web Push to Home Screen web apps; permission only on a user gesture; "You do not need to be a member of the Apple Developer Program to use it" | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |
| Apple: Background Tasks, `earliestBeginDate` | "the system doesn't guarantee launching the task at the specified date, but only that it won't begin sooner" | https://developer.apple.com/documentation/backgroundtasks/bgtaskrequest/earliestbegindate |
| Community guide on SideStore refresh automation | Shortcuts `Refresh All Apps` in a personal automation; reports of "took too long" errors and VPN steps | https://kitsah.bearblog.dev/how-to-setup-livecontainer-sidestore-with-automatic-refreshing/ |
| cairn | `ownerOf` (`apps/server/src/services/owner.ts`), `docs/design/thread-owner-field.md`, `docs/design/coordinator-routes-verbatim.md`, `docs/design/mobile-information-architecture.md`, `docs/research/ios-app-pilot-2026-11-08.md`, `docs/research/desktop-app-stack-2026-11-08.md`, `docs/research/duet-proactive-coordinator.md`, `apps/web/DESIGN-RULES.md`, `apps/ios/` | this repository |

## 1. What Duet's layout is

| Element | What it is | Mark |
|---|---|---|
| Everything | The top sidebar row, subtitle "All chat context across every channel". One ongoing thread where quick replies and week-long projects start. | Seen (TechCrunch image); Read (launch article, "one ongoing thread") |
| Channels | Topic threads under Everything. The new-channel dialog says "A place to talk about one topic. Your main channel stays as it is." The web URL is `claude.ai/duet/chan_<id>`. | Seen |
| Channel groups | Folders in the sidebar ("Content", "Cohort", "Personal"), collapsible, with "Drag or move channels here" and a `+` per group. | Seen |
| Sidebar row | Web: icon and name, plus a blue dot on some rows and nothing else (no counts, no task rows). Phone drawer: icon, name and a one-line status ("Waiting on Tomas to sign"). | Seen |
| What the dot means | Not documented. New activity in that channel is the likely meaning. | Inferred |
| Channel memory | "You can also start separate channels for different topics, and they share the same memory." | Read (help article) |
| Tasks page | Two tabs, `Active` and `Up next`. Active groups `Ready for review` (green), `Needs input` (amber), `Working` (blue) and a collapsed `Resolved`, each with a count. Rows have a checkbox, a title and a status word, plus a reason ("Approve the $640 health permit"). Search, sort and a `+` button. | Seen |
| Completion | "It may suggest that a task looks finished, but only you can mark a task as completed." In chat: "Done, ✓ Skool News prep is marked complete". | Read (help article); Seen |
| Main thread noise | "Your main thread stays quieter: Claude Duet posts there when a task is done or needs a decision from you." | Read (help article) |
| Task sub-thread | Opens full screen. The header has back, the task title with its status word, and a `…` menu. The body is the task's own conversation with inline action cards (an email draft with `Not now` and `Send`). | Seen |
| Task card in a channel | A card with a spinner, the title, `Working · 3 updates`, the latest message and a step checklist. | Seen |
| Mobile tabs | `Chat`, `Tasks`, `Make`; `≡` top left opens the Everything and channels drawer. | Seen |
| Make tab | "Finished work appears in the Make tab." A hands-on review: "This is where you'll build out projects", with templates "like a daily to-do list and email triage". | Read (help article, Zapier review) |
| Home tab on launch | Not stated in any source read. The product page's phone frame shows the Chat tab with a message thread above the `Chat Tasks Make` bar. | Read (product page); the launch default is Inferred |
| Attention | A morning brief, then checks "every few hours", messaging only when something needs the user; a notification when a task completes or needs review. | Read (launch article) |

## 2. Information architecture mapped onto cairn

### 2.1 Mapping

| Duet | cairn | Notes |
|---|---|---|
| Everything | The Coordinator conversation (one per team) | The only conversational entry. Unchanged rule: the Coordinator only routes (`coordinator-routes-verbatim.md`). |
| Channel | A project | A lens on the one Coordinator, not a second chat (2.3). |
| Channel group | A project group | New nullable `group` on the project (2.3). |
| Sidebar dot | Ochre dot: a task in this project waits on the owner | Derived from `ownerOf`, no read state (2.3, D8). |
| Tasks: Needs input | `owner = 'owner'`, reason `question` or `confirm` | 2.4 |
| Tasks: Ready for review | `owner = 'owner'`, reason `review` | 2.4 |
| Tasks: Working | Every other open task: running, queued, or owned by the Coordinator | 2.4 |
| Tasks: Resolved | `done` or `closed` in the last 7 days, collapsed | 2.4 |
| Tasks: Up next | Phase `todo` (created, not started) | 2.4 |
| Task sub-thread | The existing task thread (`?thread=<todoId>` on web) | 2.5 |
| Task card in a channel | A task card in the Coordinator conversation | 2.5 |
| Make | No tab: nothing in cairn maps to it (2.7) | |

### 2.2 Everything is the Coordinator

- One Coordinator conversation per team, shown as the top sidebar row `Everything`. The row's label stays `Coordinator` in cairn copy, because that name is in the product, the docs and the MCP face. The row shows the Coordinator glyph and no count. Inferred: Duet's Everything row has no badge (Seen), and the count lives on Tasks.
- What the Coordinator posts there follows Duet's quieter rule, which cairn already has: owner notifications come only from the reconciler's change to `owner` (`thread-owner-field.md`, invariant 3, Read). The Coordinator posts a task card when it creates a task, and one line when a task reaches Needs input, Ready for review or Resolved. Running progress stays in the task thread.

### 2.3 Channels are projects, and a channel is a lens

Superseded 2026-11-13 (owner): each project channel is its own conversation and context; see `coordinator-project-channels.md`. The text below records the earlier decision.

Duet channels are separate chats that share one memory (Read). cairn should not add a chat per project, because the owner's rule is one Coordinator entry and D58 already says "projects as filters and context" (Read, `mobile-information-architecture.md`). So:

- Selecting a project shows the same Coordinator conversation filtered to messages whose `chief_message.projectId` is that project, plus that project's task cards. `chief_message` already has a nullable `projectId` column (Read, `apps/server/src/db/schema.ts`). Whether every owner message and every task card gets one written today is not verified; PR 3 checks it and writes it.
- The composer in a project view sends to the one Coordinator thread with that `projectId` preset. The Coordinator still routes; the preset is a routing fact, not a rewrite of the owner's words.
- Everything shows all messages, including those tagged to projects. Inferred: this matches Duet's "All chat context across every channel" (Seen).
- Groups: add `project.group` (nullable text). The sidebar renders projects without a group first, then each group as a collapsible header with its projects, in name order. Moving a project is a `Move to group` item in the existing project menu (`sidebar-project-menu.tsx`, Read), with drag as a later nicety. No group table: a group with no projects does not exist. Inferred: a name column covers Duet's folders (Seen) without a second entity.
- Sidebar row: project icon and name, plus an ochre dot when at least one of its tasks has `owner = 'owner'`. No count, no task rows, no status line on web. `apps/web/DESIGN-RULES.md` V5 allows ochre only for "waiting on you" and has no blue (Read), so Duet's blue dot becomes ochre and means needs-you, not unread (D8).
- Phone drawer rows add one status line, as Duet does (Seen): the reason of the newest owner-owned task, else `N working`, else nothing.

### 2.4 Tasks from `ownerOf`

The server computes one more field next to `owner`, `section`, in one function `sectionOf(todo)`, and returns it on every `TodoRecord`. Web, iOS and desktop read `section`; none of them derives it. This follows the owner-field invariant that no view computes ownership itself (Read, `thread-owner-field.md`, invariant 4), and it keeps Swift from re-implementing the rules.

| `section` | Rule, first match wins | Row status word | Glyph and color (DESIGN-RULES V5, L2) |
|---|---|---|---|
| `null` (not listed) | archived in any phase other than `done` or `closed`; or `done` or `closed` with `phaseAt` older than 7 days | none | none |
| `resolved` | phase `done` or `closed` with `phaseAt` within the last 7 days, archived or not | `Done` or `Closed` (the phase) | ink check, no color |
| `needs_input` | `ownerOf` is `owner` with reason `question` or `confirm` | `Needs input`, then the reason (`Asked you a question.`, `Plan ready. Approve to start.`) | ochre needs-you glyph |
| `ready_for_review` | `ownerOf` is `owner` with reason `review` | `Ready for review`, then the reason | ochre needs-you glyph |
| `up_next` | phase `todo` | `Up next` | ink glyph |
| `working` | everything else open: `queued`, `planning`, `building`, a `needs_input` or `failed` task owned by the Coordinator, a `review` waiting on the merge queue | `Working`, then who is on it (`Coordinator is on it.` when `owner = 'coordinator'`, else the run phrase from `status-words.ts`) | 6px green dot only while a run is active |

`section` is nullable on `TodoRecord`; clients drop `null` rows. The Tasks list reads `GET /api/tasks?teamId=`. Its single `entries` list combines unarchived tasks, rows archived in the last 7 days and pending standalone Coordinator questions. Each entry has `kind` (`todo` or `question`) and `section`; question entries come first. Todo entries carry the complete `TodoRecord`; question entries carry `requestId`, `threadId`, `projectId`, the first question header as `title`, `createdAt` and the question content. No client merges lists. The existing `GET /api/todos` reads retain their array contract for callers outside Tasks (Read, `apps/server/src/routes-todos.ts`). An archived task that never finished drops out of Tasks, as archiving means "stop showing me this". Inferred.

Read: `ownerOf` returns `owner` or `coordinator` with a reason from `question`, `confirm`, `review` (owner) or `question`, `failed`, `review` (Coordinator) (`apps/server/src/services/owner.ts`, `packages/shared/src/records/needs-you.ts`); phases are `todo`, `queued`, `planning`, `confirm`, `building`, `needs_input`, `review`, `done`, `failed`, `closed` (`packages/shared/src/phase.ts`).

Layout of the Tasks surface, same on all three clients:

- Two tabs, `Active` and `Up next` (Duet, Seen). Active lists `Ready for review`, `Needs input`, `Working`, then `Resolved` collapsed, each header with its count: Duet's order (Seen, DataCamp image), by owner decision.
- Both needs-you sections use ochre. Duet's green and amber pair is not copied: V5 gives ochre to "waiting on you" and green only to a 6px running dot (Read).
- The leading circle sits where Duet's checkbox is (Seen), but in cairn it is the status glyph, not a control. A task resolves from evidence (merge, close), not a tick; `Close` stays in the task's `…` menu. Inferred from the merge-gate design; section 7.
- Standalone Coordinator questions: a question the Coordinator asks the owner before any task exists is stored as a `chief_message` with no todo (Read, `chief-questions.ts` `createOrGetQuestion`), and today's iOS inbox lists it beside tasks (Read, `AppModel.swift` `inbox`). In Tasks it is a row at the top of `Needs input` with the Coordinator glyph, the question header as its title and `Asked you a question.` as its reason; it opens the question card (`cairn://question/<requestId>`, web `/app?question=<requestId>`). The same server read that returns tasks with `section` returns these pending questions as `needs_input` entries, so no client assembles them. It leaves Tasks when answered.
- Badge: the count of `needs_input` (tasks and standalone questions) plus `ready_for_review`, on the iOS `Tasks` tab, the desktop tray and the web Tasks toggle. One number everywhere.
- The `+` button (Duet, Seen) opens the Chat composer focused, so a new task still enters through the Coordinator. Search and sort (Duet, Seen) come after the first iOS PR.
- `Manage schedules` is a quiet link under Resolved, as the a326b prototype already has it (Seen, prototype capture).

### 2.5 Task sub-threads

- A task opens as a sub-thread: web `?thread=<todoId>` in the main pane (existing, Read, `thread-link.tsx`); iOS a pushed full-screen view (existing, Read, `ThreadScreens.swift`); desktop the same web route.
- Header: back, title, status word from `section` and the reason, `…` menu (Duet, Seen). Body: the owner's verbatim request as the first block (`coordinator-routes-verbatim.md`), then the task conversation and inline cards (question, plan approval, PR).
- In the Coordinator conversation, a task card shows title, status word, `N updates` and the latest step, and opens the sub-thread (Duet, Seen). The card replaces today's plain "created task" line. Superseded 2026-11-12 (owner): the card repeated the task reference row and is gone; the reference row above the reply is the task's one mark in the conversation (`apps/web/DESIGN.md`, Coordinator chat).

### 2.6 Layout sketches

Web and desktop, wide:

```text
┌ Sidebar ──────────┬ Main ──────────────────────────────┬ Tasks panel ──────────┐
│ Cairn         (⌕) │ Coordinator ▾ (or project name)    │ Active | Up next      │
│ ◎ Coordinator     │                                    │ Ready for review · 1  │
│   cairn        •  │  owner message                     │  ◐ Title — reason     │
│   docs            │  ┌ task card: title · Working ┐    │ Needs input · 2       │
│ ▾ Side projects   │  └ 3 updates · latest step  ┘     │  ◐ Title — reason     │
│   site         •  │  Coordinator line                  │ Working · 2           │
│   notes           │                                    │  • Title — phrase     │
│ + New project     │ [ Message the Coordinator      ↑ ] │ Resolved ▸            │
└───────────────────┴────────────────────────────────────┴───────────────────────┘
```

Phone (iOS app and the web at phone width):

```text
┌ ≡   Coordinator   ┐      ┌ ≡   Tasks         ┐      ┌ ‹  Title          … ┐
│ messages and      │      │ Active | Up next  │      │    Needs input       │
│ task cards        │      │ Ready for review  │      │ owner request        │
│                   │      │ Needs input · 2   │      │ conversation, cards  │
│ [ composer      ] │      │ Working · Resolved│      │ [ Message thread   ] │
├ Chat │ Tasks (3) ─┤      ├ Chat │ Tasks (3) ─┤      └──────────────────────┘
```

`≡` opens the drawer: Coordinator, ungrouped projects, groups. The tab bar hides on a pushed sub-thread (existing rule, Read). The center of the top bar holds cairn's spiral mark where Duet shows its own mark (Seen); no Duet asset is used.

### 2.7 A third tab like Make: none

Duet's Make holds finished artifacts and project templates such as "a daily to-do list and email triage" (Read, help article and Zapier review). The cairn candidates, checked one by one:

| Candidate | Why it is not a tab | Mark |
|---|---|---|
| Merged PRs and info reports (`output: 'info'`) | Each lives in its own task thread, which `Resolved` already lists; a Make tab would be a second index of the same rows | Read (`owner.ts` `row.output === 'info'`); Inferred |
| Schedules (`/app/schedules`, recurring tasks) | The nearest thing to Duet's templates, but it is configuration the owner opens rarely; a `Manage schedules` link under Resolved reaches it in one tap | Read (`App.tsx` route); Inferred |
| Artifacts the owner keeps editing (Duet's dashboards and decks) | cairn has no such object: its deliverable is a change to a repository | Inferred |

So the iOS app has two tabs, `Chat` and `Tasks`. If cairn later gains a standing artifact that is not a task (a live dashboard, a recurring report page), that is the trigger to revisit a third tab.

## 3. Web changes so all three share one layout

The web app is the reference implementation; iOS mirrors it natively and the desktop loads it.

1. **Server `section`**: `sectionOf` beside `ownerOf`, `section` on `TodoRecord` (`packages/shared/src/records/todo.ts`), a table test over phase, owner, reason and age.
2. **Sidebar**: Coordinator row, projects with the ochre dot, groups. Task rows leave the sidebar; they live in the Tasks panel. This is where the Threads-panel prototype on `worktree-agent-a326b87b0443747c5` already went: its screenshots show a Coordinator row, project names and a right-side Tasks panel grouped by status (Seen, local prototype captures). The prototype's sections are relabelled to the `section` values, and its Coordinator badge moves to the Tasks toggle.
3. **Tasks panel**: Active and Up next tabs, sections from `section`, Resolved collapsed. On phone width it becomes the `Tasks` tab.
4. **Project lens**: the main pane filters the Coordinator conversation by `projectId`; the composer presets it. The project home page (`project-home.tsx`) keeps files and settings behind the header menu.
5. **Task cards** in the Coordinator conversation.
6. **Phone width**: bottom tabs `Chat` and `Tasks` with the drawer, replacing the current narrow layout. The PWA and the iOS app then match.
7. **Deep-link routes** that both native clients target: `/app?thread=<todoId>` (exists), `/app?question=<requestId>`, `/app?project=<id>`, `/app?draft=<text>` (opens a prefilled composer, never sends).

Each step keeps DESIGN-RULES L1 to L7 for list rows (Read); the gate tests in `apps/web/test/anti-slop-foundations.test.ts` and the sidebar row specs need their selectors updated in the same PR as the change, not later.

## 4. iOS

### 4.1 Stack and base

- **Native SwiftUI**, as `docs/research/ios-app-pilot-2026-11-08.md` recommends (Read). Every agent client with a first-party statement is native, and a WKWebView wrapper risks App Review guideline 4.2 for any public release (Read, same note). A wrapper would also not get APNs Live Activities later. Not reopened.
- **Base: `apps/ios/` on `main`**, merged in #3424 (`afd3aaf8d`) and touched by #3520 (`5efa88c06`, `needs_input` phase in `Models.swift`) (Read, git log). The `claude/ios-pilot-3e7f36` branch is superseded: its only difference from `main` under `apps/ios` is an older `Models.swift` (Read, `git diff`). Do not revive the branch.
- Reused as is: sign-in and Keychain token, `CairnClient`, SSE follow, the question card, the task thread, the composer, the brand mark and the icon. Changed: the tab layout (4.2).

### 4.2 Layout change

- Tabs become `Chat` (the Coordinator) and `Tasks` (2.4), replacing `Needs you` and `Coordinator`, in Duet's order and with Duet's tab-bar shape (Seen). The `Needs you` inbox becomes the top of `Tasks`. Pending Coordinator questions to the owner surface as their task's `Needs input` row, or as a standalone question row when no task exists yet (2.4), plus inline in Chat.
- Home tab on cold start: `Chat`, following Duet by owner decision. No source states Duet's launch tab; the product page's phone frame shows Chat (Read), and Duet's brief and "needs you" messages land in the main thread (Read, help article), so Chat is the Duet default as far as public material shows. Inferred. This replaces the 2026-10-31 decision that the phone opens on the needs-you inbox; a notification tap still opens its sub-thread directly.
- `≡` in both tabs opens the drawer (Duet, Seen); picking a project filters Chat and Tasks to it, and a chip under the title clears it.
- Two tabs, not three (2.7).
- cairn tokens throughout (canvas, card, ink ladder, ink-green primary, ochre for needs you), the system tab bar and sheets, the cairn spiral as the center mark and app icon. No Duet logo, typeface, orange accent or illustration.

### 4.3 "Needs you" on the phone without APNs

The owner chose free signing (4.4). The free Apple Developer tier has no Push notifications capability (Read, capabilities table: Push notifications and Time Sensitive Notifications are ADP and ADEP only), so the native app cannot receive APNs. Background modes are allowed on the free tier (Read, same table). The triggers stay as they are: the reconciler's change to `owner` (`thread-owner-field.md`, invariant 3, Read), and a new Coordinator question to the owner, which already sends Web Push from `createOrGetQuestion` (Read, `chief-questions.ts`, `pushToUserSafely`).

| Option | Reaches a locked phone with the app closed | Latency | Work | Mark |
|---|---|---|---|---|
| A. PWA Web Push alongside the app | Yes: the server already sends VAPID Web Push, and iOS Safari 16.4+ delivers it to a home-screen web app | Seconds, the same path the PWA uses today | None on the server; the owner installs the PWA once and allows notifications | Read (`services/push.ts`, WebKit blog); delivery latency Inferred |
| B. Background refresh plus local notifications | Sometimes | Unbounded: "the system doesn't guarantee launching the task at the specified date, but only that it won't begin sooner"; the system weighs usage, power and a force-quit | A `BGAppRefreshTask` that fetches needs-you and posts `UNNotificationRequest`s, plus de-duplication against what the owner already saw | Read (Apple `earliestBeginDate`); usage and force-quit effects Inferred |
| C. Poll or stream while the app is open | No | Instant, but only in the foreground | Exists: the app already follows the SSE stream | Read (`apps/ios/README.md`) |

**Decision D7: A, and only A, is the alert path.** It is the one option that reaches a locked phone, and it costs no new code because the server, the service worker and presence suppression already exist. B would add a second, unreliable alert path that can fire hours late and duplicate A, so it is not built. C stays what it is: live data while the app is open, not an alert.

How A fits the native app:

- The PWA on the home screen is the notification receiver. A tap opens the thread in the PWA, which renders the same phone layout as the native app (section 3, step 6), and the thread page offers `Open in app` (`cairn://thread/<todoId>`). Inferred: a service worker can only open windows on its own origin, so the tap cannot launch the native app directly.
- The native app sends the same presence heartbeat as a visible web tab (`pwa/thread-presence.ts`, Read), so a thread on screen in the native app suppresses its Web Push.
- Per-device class toggles (`needs you`, `done`) on the PWA subscription, so `done` can be muted without muting needs-you. Proposed here; the server sends one class today (Inferred from `services/push.ts`).
- If the owner later pays for the program, APNs replaces Web Push on that phone from the same trigger, and the PWA is no longer needed for alerts.

### 4.4 Getting the app onto the owner's iPhone: free signing, re-signed on the phone

**Seal is the tool in the owner's video, and it is the `MJorb` repository.**

- The video (`BV1k5HS6aE5s`, "Seal: a different IPA self-signing tool", uploader `Sealsign`, 56 s, 2026-10-08) shows the Seal app's installed list, where Seal itself carries the bundle ID `com.mjorb.seal`, and every app it signs gets a `.seal` suffix. Seen. The repository `imylhbot/MJorb` is described as "Seal - iOS sideload signing and install tool (Swift/SwiftUI + rork-sign + Minimuxer)" (translated) (Read, GitHub API). The bundle ID and the repository name match. Inferred: the same project. The uploader's pinned comments hand out the IPA by direct message and a WeChat account, not by link (Read, video comments).
- The repository: AGPL-3.0, 1 star, last push 2026-09-04; a search index still lists it as `dmjorb/MJorb`, which now returns 404, so it moved once (Read, GitHub API, 2026-11-09).
- How it works (Read, README, summarised from Chinese): an on-device tool for iOS 16+ that signs with an Apple ID (free or paid team, two-factor supported) and installs over an imported pairing file and the LocalDevVPN loopback (Minimuxer), the mechanism SideStore uses. It keeps sessions and certificates encrypted on the device and never stores the Apple ID password. Seal itself ships as an unsigned IPA from GitHub Actions, so the first install needs another signing tool.
- **Renewal is on the phone but not automatic.** The video shows a `Renew all` button, a batch sheet that says to keep Seal open and not lock the screen or switch apps until renewal finishes, days-left badges (5 and 6 days), and a setting that reminds 24 hours before expiry. Seen. No background or scheduled renewal appears in the video or the README. Inferred: with Seal, the owner taps once every few days after a reminder.

**The second video shows the hands-free variant.** CatCoder's "LiveContainer + SideStore" tutorial (2026-07-02) installs the combined LiveContainer and SideStore app with iloader from a computer, signs in to SideStore with a secondary Apple ID, and sets a Shortcuts automation to refresh "without a computer" (Read, video description; the video has no subtitle track). SideStore's README: it "will periodically refresh your apps in the background, to keep their normal 7-day development period from expiring" (Read). Community guides run SideStore's `Refresh All Apps` Shortcuts action in a daily personal automation, and report that the action sometimes ends with "took too long" even when the refresh succeeded (Read, community guide; anecdotal). LiveContainer is AGPL-3.0 and active (pushed 2026-11-08); iloader is MIT, "User friendly sideloader" (Read, GitHub API).

| Route (all with a free Apple ID) | Re-sign | On-phone without a computer | Maintenance | Mark |
|---|---|---|---|---|
| Xcode Personal Team from the owner's Mac | Rebuild and reinstall every 7 days | No | A Mac session each week | Read (compare-memberships) |
| AltStore | Background, only on the same Wi-Fi as AltServer | No, AltServer on a Mac | A Mac kept running | Read (README) |
| Seal | One tap on `Renew all` after a 24-hour reminder; Seal open in the foreground | Yes | Bootstrap Seal with another signer; single-maintainer, 1-star project, IPA handed out by DM | Seen (video); Read (README) |
| SideStore (optionally combined with LiveContainer) with a daily Shortcuts automation | Automatic, daily | Yes | One-time iloader install from a computer and pairing file; occasional automation failures to watch | Read (README, video description, community guide) |

All four share Apple's free-tier limits: 7-day profiles, at most 3 sideloaded apps per device, 10 App IDs per 7 days (Read, compare-memberships), and no APNs (4.3). Every signer holds a session of the Apple ID it signs with; both videos and the guide use a secondary Apple ID (Read), and so should the owner.

#### The two signing videos, frame by frame

Neither video has a subtitle track (`实测`: agent-reach `bilibili subtitle` and `youtube subtitle` return none, and the Bilibili view API lists no subtitles), and audio transcription is unavailable without a Whisper key. Both were therefore read frame by frame in a browser tab, plus titles, descriptions and pinned comments. Personal data visible in the frames (Apple ID emails, device names) is left out here.

**Video 1: Seal, https://www.bilibili.com/video/BV1k5HS6aE5s/** (uploader `Sealsign`, 56 s, 2026-10-08, screen recording without narration)

| Question | Answer | Mark |
|---|---|---|
| What the tool is | Seal, an on-phone IPA signer. Its own bundle ID is `com.mjorb.seal`, which matches the `MJorb` repository; signed apps get a `.seal` suffix | `实测` (frames 0:15, 0:22); same project `推断` |
| Manual or automatic | Manual. Renewal is a `Renew all` button or a per-app `Renew now`; the batch sheet says to keep Seal open and not lock the screen or switch apps until it finishes. The only time-based feature is a reminder 24 hours before expiry | `实测` (frames 0:15, 0:29, 0:48) |
| What it needs | An Apple ID added in Seal, a paired device (`Device: Paired`), and LocalDevVPN per the README; no computer after Seal itself is installed, but the first install of Seal needs another signer | `实测` (frame 0:48); README `实测`; first install `实测` from the README |
| 7-day and 3-app limits | Badges show 5 and 6 days left, consistent with 7-day profiles; three apps are installed (Seal plus two), which is the free tier's cap | `实测` (frame 0:22); that a fourth app would fail `推断` from Apple's limit |
| Failure modes | A renewal interrupted by locking or switching apps (the sheet warns against it); a missed reminder lets the profile lapse and the apps stop launching until re-signed; the README's own commits mention interactive two-factor failing in batch renewal | `实测` (sheet text, README commit `4c24fda2`); lapse behaviour `推断` |
| Provenance | The IPA is handed out by direct message and a WeChat account; the repository has 1 star | `实测` (comments, GitHub API) |

**Video 2: LiveContainer + SideStore, https://www.youtube.com/watch?v=UjS2oob2KUk** (CatCoder, 8:40, 2026-07-02, title "permanently free, unlimited re-signing, no computer needed")

| Question | Answer | Mark |
|---|---|---|
| What the tools are | iloader on a Mac installs the combined LiveContainer + SideStore app; SideStore re-signs on the phone; LiveContainer runs further IPAs inside itself, so they do not use app slots | `实测` (frames 2:10, 3:10, 7:25; the presenter's notes) |
| Manual or automatic | A Shortcut named for auto re-signing runs: turn Wi-Fi on, `Start LocalDevVPN`, SideStore `Refresh All Apps`, `Stop LocalDevVPN`, then restart the presenter's proxy app. After it runs, SideStore shows both apps at `7 DAYS`. The frames sampled show the Shortcut being run by hand; the notes say "shortcut sets up automatic refresh". A daily trigger needs a personal automation in the Shortcuts `Automation` tab, which the sampled frames do not show being set up | `实测` (frames 1:10, 7:25, 8:25); automation `推断` |
| What it needs | A computer once (iloader on a Mac, iPhone paired over USB or Wi-Fi); a secondary Apple ID signed in to iloader and to SideStore; an anisette server (iloader's setting shows the `SideStore (.io)` one); a pairing file placed on the phone; LocalDevVPN running during each refresh; Wi-Fi on | `实测` (frames 2:10, 3:10, 7:25) |
| 7-day and 3-app limits | SideStore's `My Apps` shows two active apps at 7 days, a third app parked as `Inactive` with `ACTIVATE`, and "6 App IDs Remaining". The presenter's notes: AltStore and SideStore each take one of the phone's app slots; LiveContainer runs unlimited IPAs inside one slot, one at a time | `实测` (frames 0:20, 8:25) |
| Failure modes | The refresh depends on LocalDevVPN, Wi-Fi and the third-party anisette server all working at run time; the Shortcut must stop the VPN afterwards or it stays on (the presenter's proxy has to be restarted); community reports add "took too long" errors on `Refresh All Apps` | `实测` (Shortcut steps); anisette dependency `推断`; community reports `实测` (guide), anecdotal |
| Device | The phone in the video runs iOS 26.3 | `实测` (frame 4:10) |

**Check of the decision against the videos: confirmed, with one correction.** SideStore with a Shortcut is still the only route that re-signs without a tap: Seal's video shows a manual, foreground renewal with a reminder (`实测`), while the SideStore Shortcut chains the VPN and the refresh in one action (`实测`). The correction is that "automatic" needs two things the video does not show: a personal automation in the Shortcuts app with a daily time trigger and "Run Immediately", and the VPN stopped at the end of the Shortcut. Both go into the setup steps below (`推断`).

Setup the owner follows once (iOS 17 or later for "Run Immediately" automations, `猜测` on the exact version):

1. On the Mac, install iloader, sign in with the secondary Apple ID, pair the iPhone, install SideStore (the combined LiveContainer build is optional), and place the pairing file.
2. On the phone, sign in to SideStore with the same Apple ID, then install the cairn IPA as its own app (not inside LiveContainer).
3. Build the Shortcut: `Start LocalDevVPN`, `Refresh All Apps`, `Stop LocalDevVPN`.
4. Add a personal automation: time of day, daily, `Run Immediately`, running that Shortcut. Check SideStore's `My Apps` after the first run shows `7 DAYS`.

Free-tier budget on the phone: SideStore and cairn use two of the three app slots and two App IDs per week, leaving one slot (`推断` from the frames and Apple's limits).

**Decision (owner, 2026-11-09): cairn is signer-agnostic and runs under SideStore with a daily Shortcuts refresh, signed with a secondary Apple ID.** SideStore is the route that meets "re-signed automatically on the phone"; Seal re-signs on the phone but needs a tap, and its distribution by direct message is weaker provenance. If the owner prefers Seal, nothing in cairn changes: both sign the same unsigned IPA. Inferred.

What this means for the cairn app and build:

- **One unsigned IPA** built on a macOS runner (`xcodebuild archive` with signing disabled, `Payload/` zipped to `.ipa`) on every `apps/ios/**` change on `main`, attached to a rolling `ios-latest` prerelease. The owner opens it on the phone and shares it to the signer. Today `apps/ios` has no CI job (Read, `apps/ios/README.md`). Updates install over the same bundle ID without uninstalling, which Seal's README also requires (Read).
- **Install cairn as its own sideloaded app, not inside LiveContainer.** Inferred: an app run inside LiveContainer runs under the host app, so its own notification permission, background modes and keychain do not apply as a normal install.
- **No hard-coded bundle ID**: signers rewrite it (Seal appends `.seal`, Seen; SideStore appends a team suffix, Inferred). The keychain uses the default access group, and no code compares `Bundle.main.bundleIdentifier`.
- **No extensions in this version**: each extension needs its own App ID against the 10-per-7-days limit (Read), and Live Activities need APNs anyway.
- **No push entitlement in the project**, so a signer never fails on `aps-environment`.

### 4.5 Deep links

The scheme `cairn://` is shared with desktop: `cairn://thread/<todoId>`, `cairn://question/<requestId>`, `cairn://project/<id>`, `cairn://new?q=<text>` (opens a draft, never sends). The PWA's `Open in app` link uses it (4.3). Universal links need the Associated Domains capability, which the free tier is not expected to allow (Inferred), so they are out.

### 4.6 Out of scope for this version

Make tab (2.7); APNs, Live Activities and the widget extension; background-refresh notifications (4.3, option B); App Intents and Siri; voice mode; share extension; iPad and iPhone Duo layouts; plan approval, retry and merge buttons until those routes are wired for mobile (they show as the reason line, as today, Read); Android (the PWA covers it); TestFlight and App Store release.

## 5. Desktop

The desktop borrows from Duet rather than copying it: it keeps the wide web layout (sidebar, main pane, Tasks panel) with Duet's sidebar, sections and sub-threads, and adds no phone-style tabs. Electron, as decided in `docs/research/desktop-app-stack-2026-11-08.md` (Read; not reopened). The first slice is a client of the always-on server, not a bundled server: the owner's server and main daemon already run on an always-on machine, and bundling them serves the later stranger-install phase (D100/D105 in the stack note, Read). Inferred.

- **Window**: `BrowserWindow.loadURL(<server origin>)`, the same SPA, so the desktop layout is the web layout in section 3 with nothing desktop-only in the UI. First run asks for the server URL or a pairing link; single instance.
- **Tray badge**: the needs-you count from 2.4, the same number as the iOS tab badge. Linux shows it in the tray icon (StatusNotifierItem on waybar, unverified on Wayland, Inferred), macOS on the dock and menu bar. It is derived from task state and never cleared on focus: it drops only when a task leaves `needs_input` or `ready_for_review`, so tray, web toggle and iOS tab always show the same number. Inferred.
- **Notifications**: the main process subscribes to the team stream (`GET /api/teams/:id/stream`, Read, `routes-core.ts`) and raises an OS notification for each ownership notification the reconciler writes (`notifyOwnership`) and for each pending Coordinator question to the owner (`notifyChiefMessage`), both in `notifications.ts` (Read). A question notification opens `/app?question=<requestId>`. It does not use Web Push inside Electron (Inferred: the desktop is online whenever it can notify, and the stream already carries the events). Suppressed when the thread is on screen, through the same presence heartbeat. Clicking opens `/app?thread=<todoId>`.
- **Deep links**: register `cairn://` with `setAsDefaultProtocolClient`, handle `open-url` on macOS and `second-instance` on Linux and Windows (Read, stack note), and map each link to the web route in section 3, step 7. `cairn://new?q=` opens a draft and never runs.
- **Update and packaging**: electron-builder and electron-updater; AppImage for the Linux desktop, an unsigned DMG for the Mac. Signing and notarization cost money (D9).
- Later slices, not here: "use this computer as a worker" (it touches `apps/daemon/src/credentials.ts` and `apps/server/src/routes-machine.ts`, owner-routed security surfaces), and the bundled server for stranger installs.

## 6. Order of small PRs

Row 2 implementation: [#3586](https://github.com/xiechimon/cairn/pull/3586).

Each PR is independent off `main` unless it says otherwise, and each ends with screenshots from a live verify stack.

Owner decision on 2026-11-12: the web app is settled first, and iOS follows it. The iOS rows (8, 9 and 11) start once the web app is settled, not in parallel with its polish, whatever their listed dependencies allow. The decision did not restate where the desktop row sits.

| # | PR | Area | Depends on |
|---|---|---|---|
| 1 | `docs`: update `mobile-information-architecture.md` to Chat and Tasks, `section`, drawer, deep links | docs | this document accepted |
| 2 | `server`: `sectionOf` and a nullable `section` on `TodoRecord`; one Tasks read returning unarchived rows, rows archived in the last 7 days and pending standalone Coordinator questions; table test over phase, owner, reason, archive and age | server, shared | — |
| 3 | [#3581](https://github.com/xiechimon/cairn/pull/3581) `server`: `project.group` column; `projectId` written on owner messages sent from a project view and on task-card messages; test that a project filter returns them | server | — |
| 4 | `web`: Tasks panel with Active and Up next, sections from `section`, badge on the toggle (lands the useful part of the a326b prototype) | web | 2 |
| 5 | `web`: sidebar with Coordinator row, project dots, groups and `Move to group`; task rows removed from the sidebar | web | 3, 4 |
| 6 | `web`: project lens on the Coordinator conversation, composer preset, task cards | web | 3 |
| 7 | `web`: phone width with Chat and Tasks tabs and drawer; deep-link query routes | web | 4, 5, 6 |
| 8 | `ios`: Chat home tab and Tasks tab, drawer, `section` rows in Duet's order, task cards; no hard-coded bundle ID, no push entitlement, no extensions | ios | 2, 3 |
| 9 | `ci`: macOS workflow that builds the unsigned IPA on `apps/ios/**` changes and attaches it to the rolling `ios-latest` prerelease | ci | 8 |
| 10 | `server`+`web`: per-device Web Push class toggles (`needs you`, `done`); `Open in app` link on the PWA thread page | server, web | 7 |
| 11 | `ios`: `cairn://` deep-link handling and the presence heartbeat, so a thread on screen in the app suppresses its Web Push | ios | 8, 10 |
| 12 | `desktop`: `apps/desktop` Electron window on the server origin, tray badge, notifications from the team stream, `cairn://`, AppImage and DMG | desktop | 4, 6, 7 |

## 7. What cairn should not copy from Duet

| Duet does | Why cairn does not | Mark |
|---|---|---|
| Channels share one memory, so context from one topic can surface in another | cairn has one Coordinator, which only routes, and each task's worker sees only the owner's verbatim words plus at most 280 characters of routing facts (`coordinator-routes-verbatim.md`). A project lens filters what the owner sees; it adds nothing to what a worker reads. Keep it that way: never feed one project's task context into another project's task. The owner reported user complaints about bleed; the help article confirms the shared-memory design, but no complaint was found in the sources read for this document. | Read (help article, cairn doc); complaint not found |
| A separate chat per channel | One Coordinator entry is a product rule; a channel is a filter of it | Read (owner rule) |
| Green, amber and blue status colors; blue unread dots | DESIGN-RULES V5: ochre means waiting on you, green is only a 6px running dot, no blue | Read |
| A checkbox to mark a task complete | cairn resolves a task from evidence (merge, close); a tick could close work no gate judged. The circle stays as a status glyph in the same place | Inferred |
| The Make tab of finished artifacts and templates | Nothing in cairn maps to it (2.7): finished work is in its task thread, schedules are a link under Resolved | Inferred |
| Duet's brand assets (logo, typeface, orange accent, illustrations) | Owner decision: Duet's layout and interaction, cairn's own tokens and marks | Read (owner decision) |
| A morning brief built into the client | The brief is a Coordinator feature on its own track (#1784, `docs/research/duet-proactive-coordinator.md`); it arrives as a Coordinator message and a push, with no client screen | Read |
| Proactive checks of outside accounts every few hours | Not part of this client work; quota cost is the reason Duet limits it | Read (launch article) |
| A Tasks `+` button that creates a task directly | The `+` opens the Chat composer instead, so tasks still enter through the Coordinator and the verbatim request stays in one path | Inferred |

## 8. Decisions

Owner decisions of 2026-11-09 on this PR, each taking the recommendation that was offered. They replace the open questions.

| # | Decision | Where it applies |
|---|---|---|
| D1 | iOS copies Duet's structure closely; the desktop borrows from it | 4.2, 5 |
| D2 | Duet's layout and interaction patterns with cairn's own tokens and colors; no Duet brand assets | 2.6, 4.2, 7 |
| D3 | iOS opens on `Chat`; Tasks sections in Duet's order: Ready for review, Needs input, Working, Resolved | 2.4, 4.2 |
| D4 | No third tab: nothing in cairn maps to `Make` | 2.7 |
| D5 | Free signing: SideStore re-signs on the phone through a daily Shortcuts automation | 4.4 |
| D6 | Sign with a secondary Apple ID, not the owner's main account | 4.4 |
| D7 | The installed PWA's Web Push is the only needs-you alert channel; no background-refresh notifications | 4.3 |
| D8 | An ochre project dot means "a task in this project is waiting on you", derived from `ownerOf` | 2.3 |
| D9 | The desktop build stays unsigned for now (AppImage and DMG); signing is decided with the stranger-install phase | 5 |
| D10 | The top row keeps the name `Coordinator` | 2.2 |
