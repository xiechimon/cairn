# Native tray menu on the Mac

Someone who installed Cairn today clicks the spiral in the Mac menu bar. A native AppKit menu opens on mouse-down, the same way Wi-Fi and Control Center menus do, and stays open on mouse-up. Arrow keys move through it, Return picks, Esc closes it, and VoiceOver reads it. It shows the same content the web popover showed: the Coordinator, what waits on them, what each computer runs, today's usage, and two big buttons for the local Runner and for keeping the screen on. There is nothing to set up: no account, key or permission, and nothing new is stored. If the native menu cannot run, the old web popover takes its place, so the icon never disappears.

Why: the web popover is a borderless window that opens only on mouse-up, draws its own focus and keyboard handling, and has needed a long smoke to keep its open/close races right (`apps/desktop/scripts/smoke-mac.mjs`). The owner picked the native "AppKit big buttons" prototype on 2026-11-23 (`~/Pictures/cairn-review/tray-native/`, right side). An Electron `Menu` cannot hold big buttons; that branch (`c3bbf6f6a`) was not landed.

| Situation | What the user sees | What the system does | Wait and cost |
|---|---|---|---|
| Normal click | Native menu with live content | The helper shows the last snapshot; main sends `opened` to the page, which refreshes quota and machines | None; the menu opens on mouse-down |
| Click before the page loaded | Menu with "Open Cairn", the two big buttons, Quit | Main's skeleton snapshot, built from the desktop locale | None |
| Content changes while open | Rows update in place when their ids are unchanged; added or removed rows show when the menu is next opened | Helper defers rebuilds until close | None |
| Helper crashes | Web popover icon appears at once | Main restarts the helper after 1 s, 2 s, then 4 s; a fourth crash before a run lasted 60 s stops the retries for the session | One click may land on the web popover |
| Helper binary missing or never says `ready` in 5 s | Web popover, as before | Main counts it as a crash | Same |
| Linux | Unchanged Electron tray menu | No helper | None |

## Hosting: compared

| Option | For | Against |
|---|---|---|
| **Swift helper process (chosen)** | A crash or hang in AppKit code cannot take the app down; main restarts it and falls back. Menu tracking runs its own run loop, so Electron's main thread and Node event loop never block while the menu is open. Plain `swiftc`, no Electron ABI or node-gyp. Same shape as the existing `tray-driver.swift` test helper. | A second process (about 15 MB resident). Activating Cairn after a menu pick crosses processes. |
| N-API addon in main (like `electron-liquid-glass`) | No IPC; can reuse Electron's own `NSStatusItem`. | A fault kills the whole app, which is exactly the case the fallback must survive. Electron's main thread runs the nested menu-tracking loop, so IPC and timers stall while the menu is open (the reason `c3bbf6f6a`'s research says not to mutate during tracking). Needs a native build per arch tied to the Electron headers. |
| Electron `Menu` (`c3bbf6f6a`) | No native code. | Cannot hold custom views, so no big buttons; rejected by the owner. |

## Processes and protocol

`apps/desktop/native/tray/*.swift` builds to `CairnTray`, a plain executable with `NSApplication` in `.accessory` mode (no Dock icon). `build.mjs` compiles it on macOS for `arm64-apple-macos12.0` and `x86_64-apple-macos12.0` into `tray-helper/<arch>/CairnTray`. electron-builder copies `tray-helper/${arch}` to `Contents/Resources/tray`. `@electron/osx-sign` signs every Mach-O under `Contents`, so the helper carries the same identity as the app, and `check-signature.mjs` (`codesign --verify --deep --strict`) covers it in `desktop-mac` and `desktop-release`. Cairn is not notarized (self-signed, `hardenedRuntime: false`); when notarization arrives, the helper needs `--options runtime`. No entitlements: a status item and menu need none.

Main spawns `CairnTray <assetsDir>` with stdio pipes. Each message is one line of JSON.

Main → helper:
- `{"type":"menu","menu":NativeTrayMenu}`: the whole menu. The first one is the skeleton, then every page snapshot merged with main's state.
- `{"type":"icon","awake":boolean,"tooltip":string}`: the status-item image variant and tooltip.
- stdin EOF: the helper removes its status item and exits 0.

Helper → main:
- `{"type":"ready"}` once the status item exists.
- `{"type":"opened"}` and `{"type":"closed"}` from `menuWillOpen` / `menuDidClose`.
- `{"type":"action","id":string}` for a picked item.

`NativeTrayMenu` (`packages/shared/src/desktop-shell.ts`, checked with zod in main) is `{ label, items[] }`, each item one of `row` (title, status, tip, glyph, warn, enabled), `header` (title, and for a computer a `reading`: parts each with text and a strained flag, faint, spoken label, tip), `switch` (runner or keep-awake: title, detail, on, enabled), `command` (settings, quit) or `separator`. Main keeps the action for each id itself (a path checked by `isAppPath`, a command, a switch); the helper only ever names an id, so a confused helper cannot open an arbitrary path. When the picked item opens a window (a row with a path, or Settings), the helper also hands activation to its parent before writing the action (`yieldActivation(to:)` then `activate(from:)` on macOS 14+), because macOS no longer lets the background Electron app take the front by itself.

The `/tray` page stays loaded in its hidden window and stays the single source of content and strings: `trayMenuModel()` (`apps/web/src/tray/tray-native.ts`) turns the same `trayGroups()` / `trayUsage()` output and `t()` strings into a `NativeTrayMenu` and sends it through `cairnDesktop.tray.publish`. Main pushes `DesktopTrayState` to the page on every change (not only while the popover shows), and forwards `opened` as `desktop-tray:opened` so the page refreshes the Claude quota the way `visibilitychange` did. The popover window runs with `backgroundThrottling: false`, because it now feeds a visible menu while hidden. The fallback popover renders the same groups through `popoverGroups()`, which keeps its earlier rule: a computer appears only when it runs or queues something or is strained, and never while offline.

## States

From `tray-groups.ts`: Coordinator row (busy → "Replying"); "Waiting on you" (questions and waiting tasks, max 6); one two-line header per registered computer, idle ones included, online before offline: the name, then "Memory 42% · CPU 31% · Load 3.1 / 12 cores" from the Runner's hardware report, with a strained part (memory or CPU at 90 %, under 5 GB disk free, which adds a disk part) in bold warning colour; an offline computer reads "Offline · Last seen 2d ago" with no stale numbers and a faint name; a computer that has not reported hardware reads "No memory or load reported yet"; when the line is too wide the helper drops unstrained parts from the end (load first) and never a strained one; long names truncate; tooltip with memory, CPU, load and disk; and under each computer its running (stalled → attention glyph, warning colour, "no progress for N min"), queued (quota time or waiting) and "N more" rows; "In progress"; the empty line "Nothing is waiting on you" right under Coordinator when no group has a task row; usage ("Used today", Claude quota or used-up); Runner switch (starting = disabled, on, off, failed); keep-awake switch; Settings ⌘,; the user (disabled); Quit ⌘Q. Light and dark follow the system appearance; the accent is the system accent. Every row has an accessibility label of title, status and tip; big buttons are switches with a value.

Focus: a big button draws its focus ring only when the keyboard moved the highlight onto it (prototype defect: the first big button showed a ring on open because it became the menu window's first responder).

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Spawn error, missing binary | Fallback popover; restart schedule as for a crash |
| No `ready` in 5 s | Kill, count as a crash |
| Exit or crash | Electron `Tray` + web popover created at once; restart after 1, 2, then 4 s (later restarts wait 4 s); three restarts in a row whose runs each lasted under 60 s end the retries for the session (`restart-budget.ts`) |
| Restarted helper says `ready` | The Electron `Tray` is destroyed and the popover hidden |
| Malformed line either way | Dropped; the helper logs to stderr, which main forwards to the desktop log |
| Page fails to load | The helper keeps the last menu, or the skeleton |
| Quit | Main closes stdin; the helper exits; nothing restarts |

## Tests, one per path

- `apps/desktop/scripts/native-tray.test.mjs` (node, fake helper script): ready → menu sent; action ids map to open, runner, keep-awake, settings, quit and unknown ids do nothing; a crash shows the fallback and a restart hides it; three quick crashes stay on the fallback; missing binary falls back; no `ready` in time falls back; malformed lines are ignored; quit stops without restarting.
- `apps/web/test/tray-native.test.ts`: the model carries every state above with the same `t()` strings.
- `apps/desktop/scripts/tray-helper.test.mjs` (macOS, `swiftc`): the Swift menu built from a fixture has the right items, titles, key equivalents, accessibility labels and switch values; a big button has no focus ring on open and gets one on keyboard highlight; an in-place update keeps the item objects.
- `smoke-mac.mjs` (desktop-mac CI, real clicks via `tray-driver.swift`): click the helper's status item while the first page is held → skeleton menu opens and stays open after mouse-up; after load → the content menu; Esc closes it; a real click on Settings closes the menu and opens Settings in the main window; killing the helper four times (the first run plus the three restarts) → no helper is left and the Electron status item is back.
