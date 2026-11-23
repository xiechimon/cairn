# UI state restoration

Status: shipped scope is view state only. Owner request (2026-11-22): leaving a page with Esc and coming back should land where you were (example: Settings → Appearance). The broader goal of keeping everything typed in every input was attempted and cut; see [Cut](#cut).

This is a persisted-state change, so it follows the one-page-design rule: states, the paths that read and write them, failure behavior, and one test per path.

## For a newcomer

You installed Cairn today. You meet this in four places:

- **Settings.** You open Settings, go to a section, press Esc. Next time you open Settings (sidebar, `Cmd+,`, search), it opens on that section, not on Account. The scroll position inside the section is not kept.
- **Tasks panel.** You switch the panel to Done and reload. It opens on Done again. Adding a task shows Next for the moment, but does not change the tab you chose.
- **Side panel width.** You drag the task side panel wider. It keeps that width after a reload.
- **Desktop app.** You quit and relaunch the Mac app. The window comes back at the same size and position. It opens on the normal start page, as it does today; the page you were on is not reopened.

You need nothing new: no account, key or setting. All of it is stored in this browser or app only (three plain localStorage keys and the desktop app's `window-state.json`), like any web app's UI preferences: it is not tied to who is signed in, and pairing again or revoking this device leaves it as it was, because it only says which section, tab or width was last used here. When it fails, you see what you see today: the default section, tab or width. Nothing blocks. What you typed is not covered by this change: drafts behave as they do on `origin/main`.

## Why

Every opener goes to bare `/app/settings`, which shows Account; the tasks tab is component state and is lost on reload; the desktop app always opens at a fixed 1280×800.

## Design

### View preferences

Three ordinary localStorage keys through `safe-storage.ts`, with no owner, scope, envelope or reload:

| Key | Value | Written | Read |
|---|---|---|---|
| `cairn.settings-section` | an id in `SETTINGS_SECTION_IDS` | when the user clicks a section in the Settings nav or tab strip, or picks one from Settings search | first render of bare `/app/settings` |
| `cairn.tasks-tab` | `active`, `next`, `scheduled`, `resolved` | when the user clicks a tab, including the one already shown | the Tasks panel's first render |
| `cairn.side-panel-width` | pixels | on pointer-up after a drag that moved, and on a keyboard resize or double-click | first use of the side panel; kept as saved and clamped to the window only for display |

An unknown value falls back to the default (Account, the opening tab from the data, 420). Pairing, revoking and the pairing gate do nothing to these keys. A second tab reads at mount and writes on change; last writer wins; no cross-tab sync.

### Settings

A bare `/app/settings` resolves on the dialog's first render to the stored section (Account if the id is no longer known) and replaces the URL. Storage is read only on that fresh mount: when the dialog is already open and the route goes bare again (search, `Cmd+K` then Settings), it stays on the section it shows, including Account shown for an unknown or legacy link such as `/app/settings/projects`. Choosing Settings from search while a section URL is already open only closes search, so it adds no Back step. Mounting, the restore itself and URL canonicalization (`providers`, `work-routing`, `appearance`) never write: only an explicit pick is stored, so reloading one tab never overwrites a section picked in another. The scroll offset inside a section is not restored.

### Tasks tab and panel width

The tasks panel opens on the stored tab, or the opening tab from the data as on `origin/main`; a `?tab=scheduled` link still wins. After a task is created the panel shows Next locally, and only if the user did not pick a tab while the request was pending; that switch is never stored, but clicking the tab it shows stores it like any other click. When the create finishes, the add field takes focus back only if focus is still in the add form or has fallen to the page body, so a tab focused meanwhile keeps it. The width has a committed value (memory and storage) and, during a drag, a preview shown on top of it in the panel being dragged. Only two things change the committed value: pointer-up after the drag moved, which commits the preview, and a keyboard resize (arrows, Home, End) or double-click, which commits at once and ends the drag of any pointer in progress: the drag record is cleared and its pointer capture released, so later moves and the release of that pointer change nothing. A pointer cancel or the handle unmounting mid-drag (for example `Cmd+J` leaves the panel) only drops the preview, so the panel shows the committed width: the one from before the drag, or a keyboard width set during it. A drag follows one pointer: a second press while it is active, and every event from another pointer, is ignored until it ends. Each panel keeps its own drag and its own preview and commits its own last position on release; only the committed width is shared, so one panel mounting, unmounting, resetting or taking a keyboard resize never drops another panel's drag. While two panels are dragged at once each shows its own preview, so they can show different widths until the drags end. An expanded thread docked beside Tasks lays out from the Tasks panel's rendered width, so it follows the preview during a drag. The saved width is the user's intent: a narrow window clamps only what is shown and never the remembered value, so widening the window brings the saved width back. A drag follows the same rule: it keeps the width the pointer asked for within the limits at that moment, the display clamps it to the live window, and release saves the asked-for width, so narrowing the window mid-drag does not shrink what is saved. A press that does not move commits nothing; once a drag has moved, every pointer position counts, including a return to where it started.

### Desktop window

The desktop main process stores `{bounds}` in `userData/window-state.json` on move and resize (not while full screen) and applies it at launch, clamped to a visible display. No route is stored or replayed: the window loads the origin, the app's normal start page. A `path` left in the file by an earlier build is ignored. This is desktop-only because a browser already keeps its window.

## Failure paths

| Failure | Behavior |
|---|---|
| localStorage full or disabled | writes are swallowed; a change holds for the page's life, defaults next time. No toast. |
| Stored value unknown or from an older build | default shown; overwritten by the next choice. |
| Identity slow or never resolves | nothing waits on it: the stored section, tab and width show at once. |
| Re-pair or revocation | nothing happens to the preferences; no reload. |
| Handle pressed without moving | nothing stored; the shown width stays. |
| Handle unmounted mid-drag, or the system cancels the pointer | preview dropped, nothing stored; the width before the drag, or a keyboard width set during it, shows. |
| Desktop stored bounds off-screen | clamped to the primary display. |

## Scenarios

| Situation | What the user sees | What the system does | Wait / cost |
|---|---|---|---|
| Settings section, Esc, reopen | same section, at its top | `cairn.settings-section` | none |
| Bare Settings on a slow connection | the stored section at once; no later jump | restore decided on first render | none |
| Tasks panel on Done, reload | Done | `cairn.tasks-tab` | none |
| Task added from Done, reload | Next after the add, Done after the reload | post-create switch is local | none |
| Tab picked while a task is being created | the picked tab stays | post-create switch skipped | none |
| Side panel resized, reload | same width | `cairn.side-panel-width` | none |
| Handle clicked without dragging | width unchanged, also after a reload | no write without movement | none |
| Panel drag abandoned with `Cmd+J` | the next panel opens at the committed width, including an End pressed during the drag | preview dropped on unmount | none |
| Done picked, task added, then Next clicked | Next, also after a reload | the click on the shown tab is stored | none |
| Machine enrollment link opened in an unpaired browser | the enrollment page keeps polling, no reloads | no reload on pairing | none |
| Remote device revoked, then paired again | gate screen, then the same section, tab and width as before | preferences are not credentials and stay | none |
| Desktop relaunch | same window size and position, on the start page | `window-state.json` holds bounds only | none |

## Test plan (each red on the previous head or `origin/main`, green after)

- `apps/web/e2e/settings-restore.spec.ts`: section on reopen, stored under its exact key; bare Settings opened while identity loads opens the stored section; reloading Settings never writes over a section picked in another tab; choosing Settings from search while Settings is open keeps the section on screen, leaves the history length unchanged and one Back returns to Home; after a legacy link shows Account, search, a pick and Back, search again keeps Account.
- `apps/web/e2e/chief-home-tasks-panel-restore.spec.ts`: tasks tab after reload; a created task does not store Next; a tab picked while a create is pending keeps its selection and focus when the create lands; a drag abandoned with `Cmd+J` does not resize the next panel; pressing the handle without moving writes nothing (stored width differs from the shown one, seeded once); a drag that returns to its start keeps the start width; clicking the tab shown after a create stores it; a keyboard resize during a drag survives Cmd+J; a cancelled drag returns to the width before it and stores nothing; with real touch input (CDP touch events in a `hasTouch` context): a finger pressed during a mouse drag neither takes it over nor leaves a width behind (red with the second-press guard removed); closing the file panel with Esc while a finger drags its handle keeps a mouse drag on the Made panel at its width, which then stores its own width; a double-click reset and a keyboard resize each end a finger drag, so moving and lifting that finger keeps the new width, and the handle holds the finger's pointer capture before the reset and no longer holds it right after, while the finger is still down.
- `apps/web/e2e/chief-home-side-chat.spec.ts`: a docked thread floats as soon as a held Tasks drag leaves the conversation under 400px; a wide width saved at a wide window shows clamped after a reload in a narrow one and comes back when the window widens; a drag held at 1000px while the window narrows to 1200px shows 720px, saves 1000px and shows 1000px again once the window widens.
- `apps/web/test/side-panel-width.test.ts`: the stored width is read as saved and clamped only for display.
- `apps/web/e2e/token-gate-enroll-poll.spec.ts`: an unpaired browser on a machine enrollment link loads one document while it polls, counted from before navigation.
- `apps/desktop/scripts/window-state.test.mjs`: bounds parse and clamp onto a visible display; a malformed file falls back to defaults; a page saved by an earlier build is not replayed.

## Cut

Twenty reviews (reviews `ui-state-6d920cde1`, `-a5bb69cef`, `-e054cb383`, `-8a4eb8738`, `-d6ae482ed`, `-9a5905fa1`, `-2c164807c`, `-e7a81808f`, `-54c00c9eb`, `-0634e308c`, `-9286a8768`, `-ea1746bc4`, `-deddd648d`, `-e863099c1`, `-26d5ce7ff`, `-6ce147dbb`, `-203384ddd`, `-8eb6fc7ec`, `-56780a90d`, `-00ff5662b`; the last sixteen cited below as R5 to R20) kept finding new defects in the same area: client-side ownership of typed content across re-pairing, remounts and slow identity. Without an ownership model that makes those races impossible by construction, each fix moved the defect. The following were removed in the same change and the code is back to `origin/main` behavior; none of it is left dormant.

| Dropped | Why |
|---|---|
| Server draft scope grammar (`chief:<id>`, `chief:project:<id>`, `question:`, `form:`) and draft deletion with its task | only consumers were the dropped client pieces below |
| Draft controller registry, owner era and abandon-on-owner-end | abandoned controllers still wrote, and a reopened form could show submitted text (R6 findings 2, 3); a late question attachment repopulated a revoked owner's draft (R5 1, R6 1) |
| Compare-and-clear submit tickets | a submit could leave the submitted draft behind (R5 2, R6 3); question cleanup bypassed the revision guard (R6 4) |
| Question answer persistence and the attachment answer delegate | multi-file uploads crossed a re-pair (R6 1) |
| Per-conversation Coordinator drafts with reply quote, form drafts with allowlists, owner-scoped draft cache keys and legacy draft migration | rest on the controller registry and tickets above |
| Outbox parking and hydrate-before-consume | a recovery could overwrite a draft that had not loaded (R5 5, R6 5) |
| Custom MCP sign-in retry storage | the callback could not identify the attempt that succeeded (R5 3, R6 6) |
| Draft 401 session recovery | a recoverable expiry could force pairing and drop edits (R5 6) |
| Sidebar collapsed / filter / groups, Made tab, skills sort, notify pref and first-run boot hint moved into the view store | not needed for the kept behaviors; left on their existing keys |
| Desktop restore of dialog routes and the `screen` field | a relaunch reopened overlays (R6 7) |
| Settings scroll-offset restore | a still-mounted dialog could save a revoked pairing's offset under the next one (R7 3); a late restore undid a wheel made before identity resolved (R7 8) |
| Task transcript reading-position restore | a pixel offset cannot address a message in older, unloaded history (R7 7); a late restore undid Jump to latest (R7 8) |
| Test-only store API (`useConfirmedStorageScope`, `clearView`, the leave-time save helper) and their tests | no production caller (R7 9) |
| Per-holder owner tracking (drag cancellation on revocation, owner revoke without reload, auth-generation keys on the `/me` and `/teams` queries) | in-memory state outlived a revoke in each holder separately (R8 2, 3, 4); the reload that replaced it was cut in R9 |
| Late Settings section restore after a slow identity | it switched sections under an edit in progress (R8 5) |
| Desktop restore of `thread` and `/app/todo/<id>` | in a narrow window the task opens over a scrim, so a relaunch started under an overlay (R10 1) |
| Desktop restore of `pane=machines` | a relaunch started live screen streams without a click (R8 1) |
| Desktop project route matched by a lookahead regex | `/app/project/New/tasks` passed and launched the New project dialog (R12 1); replaced by segment checks |
| Drag rollback on unmount and on cancel | the rollback overwrote a keyboard resize made during the drag (R12 2), and a cancel committed the preview (R12 pre-existing); replaced by a preview over a committed width |
| Desktop route restore as a whole (the saved page, its allowlist and alias mapping) | every round found a new cross-state hole: overlays (R6 7, R8 1, R10 1, R11 1), aliases into dialogs (R12 1) and finally a project from another team or a deleted one replayed on every launch (R13 1). The rows above record the earlier partial cuts; the window now restores bounds only and opens the start page |
| Desktop restore of `pane=tasks`, `pane=made`, `tab` and the Tasks aliases `/app/schedules`, `/app/project/<id>/tasks` | in a narrow window both panels open over a scrim, so a relaunch started under an overlay (R11 1) |
| Per-pairing ownership of view preferences: the `cairn.view.<user>/<team>/` store, waiting for a confirmed owner, clearing on gate close and the reload on pairing | it failed four reviews in a row (R6 to R9): R9 found a reload loop on the machine enrollment page (its exempt poll answers 200 and dismisses the gate), the old document writing back before the reload, a second tab resurrecting removed keys, and a restored Settings URL surviving the reload. Which section, tab or width was last used in this browser is not sensitive, so these are plain keys like any web app's UI preferences, untouched by pairing |

Known gaps left as on `origin/main`: a returning user on a shared browser sees the last section, tab and width used there (by decision, see R9); the legacy draft caches (`cairn.chief-draft`, `cairn.draft.todo:<id>`) carry no user or team; the legacy MCP retry record can still hold an address; the Coordinator outbox lifecycle is not bound to the owner.; any `200`, including one from an auth-exempt path such as the machine enrollment poll, dismisses the pairing gate while the browser is still unpaired (`apps/web/src/api/client.ts` `signedIn`, pre-existing since R8; a fix was tried in R10 and taken out in R11 because it stalled enrollment responses behind a slow check and let an old check swallow a fresh sign-in, and is tracked separately).

## Prior art (documentation read on 2026-11-22)

| Product | What the source says | Source | What we take |
|---|---|---|---|
| VS Code | VS Code "opens up in the same state it was in when you last closed it", controlled by `window.restoreWindows`. | [User interface](https://code.visualstudio.com/docs/getstarted/userinterface) | window size and position restore on relaunch; the page is not restored (R13) |
| VS Code | Settings opens in a modal overlay; the search bar remembers queries, not the live filter. | [Settings](https://code.visualstudio.com/docs/configure/settings) | Settings search text is not restored |
