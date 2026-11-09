# Duet-shaped clients: one layout for web, iOS and desktop

Status: proposal, 2026-11-09. Waits on the owner and the coordinator (PR labelled `coordinator-hold`). No app code lands with this document.

The owner restarted the iOS app and the desktop app and wants both shaped like Anthropic's Claude Duet. This document maps Duet onto cairn once, so the web app, the iOS app and the Electron desktop shell share one information architecture. When it is accepted, it replaces the tab layout in `docs/design/mobile-information-architecture.md` (that file is updated in the first PR below, not here).

Marks used on every claim that drives a decision:

- **Seen**: visible in a reference image listed under Sources.
- **Read**: read in a primary text source (Anthropic page, Apple page, a GitHub repository, or this repository's code and docs at `origin/main` `45f00e7f8`).
- **Inferred**: derived from Seen or Read facts and checkable; anything predictive is also marked Inferred.

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
| Seal (`imylhbot/MJorb`), AltStore, SideStore READMEs | Re-signing mechanisms and licenses | https://github.com/imylhbot/MJorb , https://github.com/altstoreio/AltStore , https://github.com/SideStore/SideStore |
| cairn | `ownerOf` (`apps/server/src/services/owner.ts`), `docs/design/thread-owner-field.md`, `docs/design/coordinator-routes-verbatim.md`, `docs/design/mobile-information-architecture.md`, `docs/research/ios-app-pilot-2026-11-08.md`, `docs/research/desktop-app-stack-2026-11-08.md`, `docs/research/desktop-mobile-mcp-forms-2026-11-08.md`, `docs/research/duet-proactive-coordinator.md`, `apps/web/DESIGN-RULES.md`, `apps/ios/` | this repository |

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
| Make tab | "Finished work appears in the Make tab." | Read (help article) |
| Attention | A morning brief, then checks "every few hours", messaging only when something needs the user; a notification when a task completes or needs review. | Read (launch article) |

## 2. Information architecture mapped onto cairn

### 2.1 Mapping

| Duet | cairn | Notes |
|---|---|---|
| Everything | The Coordinator conversation (one per team) | The only conversational entry. Unchanged rule: the Coordinator only routes (`coordinator-routes-verbatim.md`). |
| Channel | A project | A lens on the one Coordinator, not a second chat (2.3). |
| Channel group | A project group | New nullable `group` on the project (2.3). |
| Sidebar dot | Ochre dot: a task in this project waits on the owner | Derived from `ownerOf`, no read state (2.3, question 3). |
| Tasks: Needs input | `owner = 'owner'`, reason `question` or `confirm` | 2.4 |
| Tasks: Ready for review | `owner = 'owner'`, reason `review` | 2.4 |
| Tasks: Working | Every other open task: running, queued, or owned by the Coordinator | 2.4 |
| Tasks: Resolved | `done` or `closed` in the last 7 days, collapsed | 2.4 |
| Tasks: Up next | Phase `todo` (created, not started) | 2.4 |
| Task sub-thread | The existing task thread (`?thread=<todoId>` on web) | 2.5 |
| Task card in a channel | A task card in the Coordinator conversation | 2.5 |
| Make | Not built (section 7) | |

### 2.2 Everything is the Coordinator

- One Coordinator conversation per team, shown as the top sidebar row `Everything`. The row's label stays `Coordinator` in cairn copy, because that name is in the product, the docs and the MCP face. The row shows the Coordinator glyph and no count. Inferred: Duet's Everything row has no badge (Seen), and the count lives on Tasks.
- What the Coordinator posts there follows Duet's quieter rule, which cairn already has: owner notifications come only from the reconciler's change to `owner` (`thread-owner-field.md`, invariant 3, Read). The Coordinator posts a task card when it creates a task, and one line when a task reaches Needs input, Ready for review or Resolved. Running progress stays in the task thread.

### 2.3 Channels are projects, and a channel is a lens

Duet channels are separate chats that share one memory (Read). cairn should not add a chat per project, because the owner's rule is one Coordinator entry and D58 already says "projects as filters and context" (Read, `mobile-information-architecture.md`). So:

- Selecting a project shows the same Coordinator conversation filtered to messages whose `chief_message.projectId` is that project, plus that project's task cards. `chief_message` already has a nullable `projectId` column (Read, `apps/server/src/db/schema.ts`). Whether every owner message and every task card gets one written today is not verified; PR 3 checks it and writes it.
- The composer in a project view sends to the one Coordinator thread with that `projectId` preset. The Coordinator still routes; the preset is a routing fact, not a rewrite of the owner's words.
- Everything shows all messages, including those tagged to projects. Inferred: this matches Duet's "All chat context across every channel" (Seen).
- Groups: add `project.group` (nullable text). The sidebar renders projects without a group first, then each group as a collapsible header with its projects, in name order. Moving a project is a `Move to group` item in the existing project menu (`sidebar-project-menu.tsx`, Read), with drag as a later nicety. No group table: a group with no projects does not exist. Inferred: a name column covers Duet's folders (Seen) without a second entity.
- Sidebar row: project icon and name, plus an ochre dot when at least one of its tasks has `owner = 'owner'`. No count, no task rows, no status line on web. `apps/web/DESIGN-RULES.md` V5 allows ochre only for "waiting on you" and has no blue (Read), so Duet's blue dot becomes ochre and means needs-you, not unread (question 3).
- Phone drawer rows add one status line, as Duet does (Seen): the reason of the newest owner-owned task, else `N working`, else nothing.

### 2.4 Tasks from `ownerOf`

The server computes one more field next to `owner`, `section`, in one function `sectionOf(todo)`, and returns it on every `TodoRecord`. Web, iOS and desktop read `section`; none of them derives it. This follows the owner-field invariant that no view computes ownership itself (Read, `thread-owner-field.md`, invariant 4), and it keeps Swift from re-implementing the rules.

| `section` | Rule, first match wins | Row status word | Glyph and color (DESIGN-RULES V5, L2) |
|---|---|---|---|
| `resolved` | phase `done` or `closed`, or archived, within 7 days; older rows are not listed | `Done` or `Closed` | ink check, no color |
| `needs_input` | `ownerOf` is `owner` with reason `question` or `confirm` | `Needs input`, then the reason (`Asked you a question.`, `Plan ready. Approve to start.`) | ochre needs-you glyph |
| `ready_for_review` | `ownerOf` is `owner` with reason `review` | `Ready for review`, then the reason | ochre needs-you glyph |
| `up_next` | phase `todo` | `Up next` | ink glyph |
| `working` | everything else open: `queued`, `planning`, `building`, a `needs_input` or `failed` task owned by the Coordinator, a `review` waiting on the merge queue | `Working`, then who is on it (`Coordinator is on it.` when `owner = 'coordinator'`, else the run phrase from `status-words.ts`) | 6px green dot only while a run is active |

Read: `ownerOf` returns `owner` or `coordinator` with a reason from `question`, `confirm`, `review` (owner) or `question`, `failed`, `review` (Coordinator) (`apps/server/src/services/owner.ts`, `packages/shared/src/records/needs-you.ts`); phases are `todo`, `queued`, `planning`, `confirm`, `building`, `needs_input`, `review`, `done`, `failed`, `closed` (`packages/shared/src/phase.ts`).

Layout of the Tasks surface, same on all three clients:

- Two tabs, `Active` and `Up next` (Duet, Seen). Active lists `Needs input`, `Ready for review`, `Working`, then `Resolved` collapsed, each header with its count. Duet puts Ready for review first (Seen). cairn puts Needs input first, because a question blocks a running task while a review does not. Inferred; question 5.
- Both needs-you sections use ochre. Duet's green and amber pair is not copied: V5 gives ochre to "waiting on you" and green only to a 6px running dot (Read).
- No checkbox. In cairn a task resolves from evidence (merge, close), not a tick; `Close` stays in the task's `…` menu. Inferred from the merge-gate design; section 7.
- Badge: the count of `needs_input` plus `ready_for_review`, on the iOS `Tasks` tab, the desktop tray and the web Tasks toggle. One number everywhere.
- Search and the `+` new-task button (Duet, Seen) are later; the composer already creates tasks through the Coordinator.

### 2.5 Task sub-threads

- A task opens as a sub-thread: web `?thread=<todoId>` in the main pane (existing, Read, `thread-link.tsx`); iOS a pushed full-screen view (existing, Read, `ThreadScreens.swift`); desktop the same web route.
- Header: back, title, status word from `section` and the reason, `…` menu (Duet, Seen). Body: the owner's verbatim request as the first block (`coordinator-routes-verbatim.md`), then the task conversation and inline cards (question, plan approval, PR).
- In the Coordinator conversation, a task card shows title, status word, `N updates` and the latest step, and opens the sub-thread (Duet, Seen). The card replaces today's plain "created task" line.

### 2.6 Layout sketches

Web and desktop, wide:

```text
┌ Sidebar ──────────┬ Main ──────────────────────────────┬ Tasks panel ──────────┐
│ Cairn         (⌕) │ Coordinator ▾ (or project name)    │ Active | Up next      │
│ ◎ Coordinator     │                                    │ Needs input · 2       │
│   cairn        •  │  owner message                     │  ◐ Title — reason     │
│   docs            │  ┌ task card: title · Working ┐    │ Ready for review · 1  │
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
│ task cards        │      │ Needs input · 2   │      │ owner request        │
│                   │      │ Ready for review  │      │ conversation, cards  │
│ [ composer      ] │      │ Working · Resolved│      │ [ Message thread   ] │
├ Chat │ Tasks (3) ─┤      ├ Chat │ Tasks (3) ─┤      └──────────────────────┘
```

`≡` opens the drawer: Coordinator, ungrouped projects, groups. The tab bar hides on a pushed sub-thread (existing rule, Read).

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

- Tabs become `Chat` (the Coordinator) and `Tasks` (2.4), replacing `Needs you` and `Coordinator`. The `Needs you` inbox is the top of `Tasks`. Pending Coordinator questions to the owner surface as their task's `Needs input` row, plus inline in Chat.
- `≡` in both tabs opens the drawer; picking a project filters Chat and Tasks to it, and a chip under the title clears it.
- Home tab on cold start: `Tasks`, which keeps the owner's 2026-10-31 decision that the phone opens on what needs him (Read, `mobile-information-architecture.md`). Duet opens on Chat (Inferred from the product page's phone frame). Question 4.
- Two tabs, not three: no `Make` (section 7).

### 4.3 Push for needs-you

- One trigger: the reconciler's change to `owner` (`thread-owner-field.md`, invariant 3, Read). The server sends APNs next to its existing Web Push from the same place, so the phone, the PWA and the desktop get the same events. Today the server has VAPID Web Push and no APNs path (Read, the iOS pilot note and `apps/server/src/services/push.ts`).
- Server work: an APNs provider in `services/push.ts` with token auth (ES256 JWT from a `.p8` key), a device-token registration route next to `routes-push.ts`, and per-device class toggles (`needs you`, `done`) as the mcp-forms note recommends (Read). The `.p8` key is a credential the owner creates; it goes into the server's secret store, never the repository.
- Payload: the title, the reason line and `cairn://thread/<todoId>` (or `cairn://question/<requestId>`). Tapping opens the sub-thread on top of `Tasks`. Suppressed while that thread is on screen on any device, reusing `pwa/thread-presence.ts` (Read).
- APNs needs a paid Apple Developer Program membership: the capability table lists Push notifications for ADP and ADEP and not for the free Apple Developer tier (Read). This decides distribution (4.4).

### 4.4 Getting the app onto the owner's iPhone

**Seal exists.** Its repository description, translated from Chinese, is "Seal - iOS sideload signing and install tool (Swift/SwiftUI + rork-sign + Minimuxer)": repository `imylhbot/MJorb` on GitHub, AGPL-3.0, 1 star, last push 2026-09-04 (Read, GitHub API, 2026-11-09). A search index still lists it under `dmjorb/MJorb`, which now returns 404 (Read), so the repository was moved once. Per its README (Read, in Chinese, summarised):

- A personal on-device tool to import, sign, install and renew IPAs; iOS 16 or later.
- Signs with an Apple ID, with two-factor auth, using a free or a paid team. Installs through an imported device pairing file and the LocalDevVPN loopback, the same mechanism SideStore uses (Minimuxer). Single and batch renewal, resume after failure, self-renewal, expiry reminders.
- Keeps account sessions, certificates and pairing data encrypted on the device; does not store the Apple ID password.
- Seal itself ships only as an unsigned IPA built by GitHub Actions; the first install needs another signing tool (the README names a Windows one).

So Seal is a SideStore-style re-signer, not a way around the 7-day limit. With a free Apple ID it renews the same 7-day profile; with a paid team it signs with that team. Inferred from the README.

| Option | Cost | Re-sign cadence | APNs push | Maintenance | Mark |
|---|---|---|---|---|---|
| Xcode, free Personal Team, from the owner's Mac | $0 | Rebuild and reinstall every 7 days; at most 3 apps per device and 10 App IDs per 7 days | No | A Mac and a cable or Wi-Fi pairing each week; a widget or Live Activity extension uses more of the 10 App IDs | Read (compare-memberships, capabilities) |
| AltStore (free Apple ID) | $0 | Automatic background refresh while on the same Wi-Fi as AltServer on a Mac | No | AltServer running on a Mac; the Apple ID signed in to a third-party tool. AGPL-3.0, active (pushed 2026-10-21) | Read (README, GitHub API); push Inferred from the capability table |
| SideStore (free Apple ID) | $0 | Automatic on-device refresh through LocalDevVPN, no computer after setup | No | Pairing file and VPN; the Apple ID signed in to a third-party tool; occupies one of the 3 app slots. AGPL-3.0, active (pushed 2026-11-07) | Read (README, GitHub API); push Inferred |
| Seal (free Apple ID) | $0 | As SideStore: on-device renewal through LocalDevVPN | No | As SideStore, plus bootstrapping Seal from an unsigned CI build; a 1-star single-maintainer project with a Chinese-only README, moved once | Read (README, GitHub API); push Inferred |
| Seal or SideStore with a paid team | $99/year | Development profile, about one year | Uncertain: depends on whether the tool requests the `aps-environment` entitlement; not documented | Same third-party tool risk as above, for no gain over TestFlight | Inferred |
| Paid Apple Developer Program, TestFlight internal | $99/year | Each build expires after 90 days; CI uploads a new build on each `apps/ios` change | Yes | App Store Connect record and upload automation once; up to 100 internal testers; App Review only for external testers | Read (programs page, TestFlight overview, capabilities) |
| Paid program, ad hoc | $99/year | Profile about one year; reinstall on each build | Yes | Register the device UDID (100 per family per membership year); install from Xcode or a link; no update channel | Read (devices overview, ad hoc page); profile length Inferred |

**Recommendation: paid Apple Developer Program with internal TestFlight** (a payment, so question 1). It is the only row with both APNs push, which is the point of a needs-you app, and no weekly ritual. Every free route, Seal included, rules out APNs (Read, capabilities table), so the app could not tell the owner a task needs him while it is closed. Ad hoc gives the same push for the same price but no update channel. Inferred.

If the owner does not pay: install from Xcode with the free Personal Team for development only, and keep the installed PWA for push, since the server's Web Push already reaches home-screen web apps (Read, mcp-forms note, iOS Safari 16.4+). Do not adopt Seal or SideStore: they add a third-party tool holding an Apple ID session and still cannot push. Inferred.

The Mac has one "Apple Development" identity and no provisioning profiles, and whether the owner's Apple ID is in a paid program is unknown (Read, iOS pilot note).

### 4.5 Deep links

The scheme `cairn://` is shared with desktop: `cairn://thread/<todoId>`, `cairn://question/<requestId>`, `cairn://project/<id>`, `cairn://new?q=<text>` (opens a draft, never sends). Universal links on the server's HTTPS origin are later; the server is tailnet-only today (Inferred).

### 4.6 Out of scope for this version

Make tab; Live Activities and the widget extension; App Intents and Siri; voice mode; share extension; iPad and iPhone Duo layouts; plan approval, retry and merge buttons until those routes are wired for mobile (they show as the reason line, as today, Read); Android (the PWA covers it); public App Store release.

## 5. Desktop

Electron, as decided in `docs/research/desktop-app-stack-2026-11-08.md` (Read; not reopened). The first slice is a client of the always-on server, not a bundled server (`desktop-mobile-mcp-forms-2026-11-08.md`, 1.3, Read).

- **Window**: `BrowserWindow.loadURL(<server origin>)`, the same SPA, so the desktop layout is the web layout in section 3 with nothing desktop-only in the UI. First run asks for the server URL or a pairing link; single instance.
- **Tray badge**: the needs-you count from 2.4, the same number as the iOS tab badge. Linux shows it in the tray icon (StatusNotifierItem on waybar, unverified on Wayland, Inferred), macOS on the dock and menu bar. Cleared when the window is focused, as t3code does (Read, mcp-forms note).
- **Notifications**: the main process subscribes to the team stream (`GET /api/teams/:id/stream`, Read, `routes-core.ts`) and raises an OS notification for each ownership notification the reconciler writes (`notifyOwnership`, Read, `notifications.ts`). It does not use Web Push inside Electron (Inferred: the desktop is online whenever it can notify, and the stream already carries the events). Suppressed when the thread is on screen, through the same presence heartbeat. Clicking opens `/app?thread=<todoId>`.
- **Deep links**: register `cairn://` with `setAsDefaultProtocolClient`, handle `open-url` on macOS and `second-instance` on Linux and Windows (Read, stack note), and map each link to the web route in section 3, step 7. `cairn://new?q=` opens a draft and never runs.
- **Update and packaging**: electron-builder and electron-updater; AppImage for the Linux desktop, an unsigned DMG for the Mac. Signing and notarization cost money (question 6).
- Later slices, not here: "use this computer as a worker" (it touches `apps/daemon/src/credentials.ts` and `apps/server/src/routes-machine.ts`, owner-routed security surfaces), and the bundled server for stranger installs.

## 6. Order of small PRs

Each PR is independent off `main` unless it says otherwise, and each ends with screenshots from a live verify stack.

| # | PR | Area | Depends on |
|---|---|---|---|
| 1 | `docs`: update `mobile-information-architecture.md` to Chat and Tasks, `section`, drawer, deep links | docs | this document accepted |
| 2 | `server`: `sectionOf` and `section` on `TodoRecord`, table test | server, shared | — |
| 3 | `server`: `project.group` column; `projectId` written on owner messages sent from a project view and on task-card messages; test that a project filter returns them | server | — |
| 4 | `web`: Tasks panel with Active and Up next, sections from `section`, badge on the toggle (lands the useful part of the a326b prototype) | web | 2 |
| 5 | `web`: sidebar with Coordinator row, project dots, groups and `Move to group`; task rows removed from the sidebar | web | 3, 4 |
| 6 | `web`: project lens on the Coordinator conversation, composer preset, task cards | web | 3 |
| 7 | `web`: phone width with Chat and Tasks tabs and drawer; deep-link query routes | web | 4, 5 |
| 8 | `ios`: Chat and Tasks tabs, drawer, `section` rows, task cards | ios | 2, 3 |
| 9 | `ios`: TestFlight signing and upload automation | ios, ops | question 1 |
| 10 | `server`: APNs provider, device-token route, per-device class toggles | server | question 1 |
| 11 | `ios`: push registration and deep-link handling | ios | 9, 10 |
| 12 | `desktop`: `apps/desktop` Electron window on the server origin, tray badge, notifications from the team stream, `cairn://`, AppImage and DMG | desktop | 4, 7 |

## 7. What cairn should not copy from Duet

| Duet does | Why cairn does not | Mark |
|---|---|---|
| Channels share one memory, so context from one topic can surface in another | cairn has one Coordinator, which only routes, and each task's worker sees only the owner's verbatim words plus at most 280 characters of routing facts (`coordinator-routes-verbatim.md`). A project lens filters what the owner sees; it adds nothing to what a worker reads. Keep it that way: never feed one project's task context into another project's task. The owner reported user complaints about bleed; the help article confirms the shared-memory design, but no complaint was found in the sources read for this document. | Read (help article, cairn doc); complaint not found |
| A separate chat per channel | One Coordinator entry is a product rule; a channel is a filter of it | Read (owner rule) |
| Green, amber and blue status colors; blue unread dots | DESIGN-RULES V5: ochre means waiting on you, green is only a 6px running dot, no blue | Read |
| A checkbox to mark a task complete | cairn resolves a task from evidence (merge, close); a tick could close work no gate judged | Inferred |
| The Make tab of finished artifacts | cairn's finished work is a merged PR or a report inside its task thread; a second place to find it duplicates Resolved | Inferred |
| A morning brief built into the client | The brief is a Coordinator feature on its own track (#1784, `docs/research/duet-proactive-coordinator.md`); it arrives as a Coordinator message and a push, with no client screen | Read |
| Proactive checks of outside accounts every few hours | Not part of this client work; quota cost is the reason Duet limits it | Read (launch article) |
| Tasks created from the Tasks `+` button with no Coordinator | Tasks still enter through the Coordinator, so routing and the verbatim request stay in one path | Inferred |

## 8. Open questions for the owner

Each has a recommended answer; the recommendation applies if the owner does not answer.

1. **Pay for the Apple Developer Program ($99/year) to get TestFlight and APNs push?** Recommended: yes. Every free route, Seal included, cannot push (4.4).
2. **If not, which free route?** Recommended: Xcode Personal Team installs for development, plus the PWA for push; no Seal or SideStore.
3. **What the project dot means.** Recommended: ochre, "a task here waits on you", from `ownerOf`. The alternative, an unread dot, needs per-project read state and a second meaning for the one accent.
4. **iOS home tab on cold start.** Recommended: `Tasks`, keeping the 2026-10-31 decision; Duet opens on `Chat`.
5. **Section order.** Recommended: Needs input before Ready for review (a question blocks a running task); Duet's order is the reverse.
6. **Desktop signing (Apple Developer ID and notarization; Windows signing).** Recommended: unsigned AppImage and DMG for the owner's own machines now; decide signing with the stranger-install phase.
7. **Label of the top row.** Recommended: keep `Coordinator`, not `Everything`, since the name is already in the product and the MCP face.
