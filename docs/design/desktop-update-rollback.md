# Desktop updates: roll back a bad version, apply without taking focus

Issue #5396. Research: `docs/research/5396-desktop-update-rollback-prior-art.md`.

## For someone who installed Cairn today

You have a Cairn icon in your Dock and a Cairn icon in the menu bar. Cairn keeps itself up to date. Two things change about that, and both are about not interrupting you.

When a new version is published, Cairn downloads it while you work — no dialog, no progress take-over, no window coming forward. Your Cairn does not restart by itself in the middle of something. It swaps in the new version when you quit Cairn, when you have stepped away (screen locked for a minute, no keyboard or mouse for fifteen minutes, or another app in front of Cairn for ten minutes), or when you explicitly click "update now". A window you left open comes back where it was, on the same page, without taking focus.

If that new version cannot start — its bundled server crashes on a database migration, which is exactly what happened to 0.1.536 — you do not have to find a download and drag it into Applications. Cairn puts the version you were running a minute ago back, starts it, and tells you in one line that the update was rolled back. The failure itself (what the new version printed before it died) is in `~/Library/Application Support/@cairn/desktop/logs/`, and the line names the version that failed.

What you need to know: your data lives in the Cairn home directory, not in the app bundle, so a rollback never touches your tasks. A rolled-back version is not offered to you again automatically; the next release is. Nothing asks you for an account, a password or a payment — the update downloads from Cairn's public GitHub releases, the same place you installed it from.

When Cairn is closed, a small background job (`app.cairn.updater`, registered the first time a Cairn with this change opens) checks every half hour and when the Mac wakes. If a new version is out and Cairn is not running, it downloads, verifies and swaps it in, so the next time you open Cairn it is already the newest version. macOS shows one "Background Items Added" notice for it and lists Cairn under Login Items & Extensions; switching it off there just returns you to updating while Cairn is open. On Windows nothing changes: Cairn downloads while open and installs when you quit.

Where you can still get stuck: if the new version's *own launcher* (not the server it starts) cannot run at all, no Cairn code is running to roll it back. That case is covered by publishing a fixed build, and is listed under "not covered" below.

## Why

0.1.536 ran its migrations, hit `FOREIGN KEY constraint failed` on `DROP TABLE im_connection`, and the server exited with code 1 four times. The desktop shell turns that into "Cairn could not start" and `app.exit(1)`; the previous bundle had already been deleted by the updater, so the only way back was a human downloading the previous release. Meanwhile the update itself raised a dialog and relaunched into a window that showed itself — the update took focus whether or not you were using Cairn.

## Scenarios

| Situation | What you see | What Cairn does | Wait / cost |
|---|---|---|---|
| You installed a newer Cairn by hand while an older update was staged | Nothing extra; the older staged copy is dropped | Discards the staged record and its folder because it was staged for a different running version | The staged download is wasted |
| A new version is published while you are working | Nothing; the update arrow in the sidebar fills and its tooltip reads "updates to X when you step away", with no dot | Downloads and verifies the zip, extracts it beside the app, records it as staged | A few MB of disk next to the app; no interruption |
| You quit Cairn | Nothing | Renames the staged app into place, then exits | Under a second on top of the normal quit |
| You step away: the screen stays locked a minute, nothing is typed or clicked for fifteen minutes, or another app stays in front of Cairn for ten minutes | On return, the same window in the same place and on the same page; a full-screen window goes full screen again the first time you focus it | Same swap, relaunch with `--cairn-background-launch`; a window that was open reopens with `showInactive` | One restart while nobody watches |
| You step away while a Coordinator reply is still being written, a dialog is open, or a task step runs on this Mac's own Runner | Nothing changes | Waits; the Runner is a child of the app and a restart would stop its step. After 24 hours of steps without a gap, the next locked screen applies anyway | The update waits |
| You choose "Update to X Now" in the menu or click the sidebar button | The app restarts | Swaps in the staged version and relaunches with its window where it was | A normal restart |
| The new version starts fine | Nothing | After 30 healthy seconds it keeps its claim and deletes the previous version | — |
| A single health probe times out while the server is busy | Nothing | Three failed probes in a row are needed before it counts as a failed health check | — |
| The new version's server exits before it is ready, or fails three health probes in a row in the first 60 seconds | One line: "Cairn 0.1.536 did not start, so Cairn went back to 0.1.535" | Puts the previous version back, records the failure, relaunches the previous version hidden, and never auto-installs 0.1.536 again on that Mac | The broken version is gone after one restart; you keep your data |
| You ask to install the version that failed | A dialog naming it as the one that failed | Installs it only because you asked explicitly | — |
| The previous version is missing or the swap fails | The existing "Cairn could not start" dialog, plus the log line | Gives up loudly rather than looping | Manual download |
| Notifications are switched off for Cairn | One line in a dialog, after Cairn has started | Falls back to a dialog, because a silent rollback the user cannot see is worse than an interruption; it is raised after boot so its modal loop cannot stall the server starting | One dialog to dismiss |
| Cairn is not in Applications, or the folder is read-only | Unchanged from today | Reports `unsupported` and never stages an update; the background updater exits quietly | — |
| A release is published while Cairn is closed, and the Mac is awake for half an hour or wakes from sleep before you open Cairn | You open the new version | The background updater downloads, verifies and swaps it, writes `installed`, so the first open is guarded exactly like an in-app update | 0 s at open; the download happens while Cairn is closed |
| You open Cairn before the background updater has run | The old version, as before; it updates when you step away or quit | The background updater sees Cairn running and does nothing; the app checks and downloads itself | — |
| You open Cairn while the background updater is downloading | The old version opens at once | Before swapping, the updater sees Cairn running, gives up and removes its download | — |
| You open Cairn in the second the background updater swaps it | The Dock icon bounces a moment longer, then the whole new version opens | The app takes the same update lock at launch and waits for the swap; it then compares the version on disk with its own and relaunches if they differ, so a half-swapped bundle never runs. Both renames are in the same folder, so `Cairn.app` is always either the whole old or the whole new version | Up to a few seconds |
| A downloaded update is still waiting when you open Cairn (force quit, or the background updater was held) | The Dock icon bounces about four seconds longer, then the new version opens | Before any window or server, the launch verifies the staged bundle, swaps it in and relaunches; no network | About 4 s, rare |
| You quit Cairn while it talks to a remote server or a resident one | Nothing | Quit stops the Runner and installs the staged update, same as with Cairn's own server | Under a second |
| The resident server is writing a Coordinator reply when the background updater is ready | Nothing | The updater keeps the download and tries again in half an hour; after a swap it restarts the resident server so it runs the new code | — |
| The laptop runs on battery below 20% | Nothing | The background updater skips this run | — |
| Someone copies a Cairn.app over the installed one by hand | Nothing; it keeps updating | The next launch or background run writes "found X installed outside the updater" to `update.log`; the hand-installed copy passes the same signature check as any release | — |
| Cairn is moved to the Trash | Nothing | The job's launcher finds no Cairn executable, deletes its plist and boots itself out | At most one more half hour |
| Windows | Unchanged | No background updater | — |

## State

One file, `<userData>/update-state.json`, mode 0600, written atomically (temp file + rename). `<userData>` is `~/Library/Application Support/@cairn/desktop`. Nothing in it is a secret.

```ts
interface UpdateState {
  staged: {
    version: string;
    zip: string;          // verified download, kept until applied
    app: string;          // extracted Cairn.app beside the running bundle
    previousVersion: string;
    at: number;
  } | null;
  installed: {
    version: string;      // version that was just swapped in
    previousVersion: string;
    previousApp: string;  // <bundle dir>/.cairn-previous/Cairn.app
    at: number;
  } | null;
  blocked: { version: string; at: number; reason: string } | null;
  notice: { failedVersion: string; restoredVersion: string; reason: string; logPath: string; at: number } | null;
  knownVersion: string | null; // the version the updater last saw or installed
}
```

`<userData>/update.lock` (`apps/desktop/src/update-lock.ts`) serialises every swap: `{pid, holder, at}` created with an atomic `link`, removed by its holder; a lock whose process is gone or which is older than ten minutes is taken over. The background updater holds it only around the two renames, and refuses to wait; the app holds it around its own swap and around the launch check, and waits up to a minute.

Paths: `<bundle dir>` is the folder holding `Cairn.app` (normally `/Applications`). `<bundle dir>/.cairn-previous/Cairn.app` is the kept previous version. Staging lives in `<bundle dir>/.cairn-update-<random>/` so every rename stays on one filesystem; the desktop's existing "delete leftover staging folders on boot" cleanup skips the folder named by `staged.app`.

## States and transitions

`idle` → `checking` → (`available` → `downloading` → `ready`) | `current` | `unsupported` | `error`.

- `ready` means: zip downloaded, SHA-256 matches the manifest, extracted bundle carries the manifest's version in its `Info.plist` and an executable next to it, and `staged` is written. Nothing has changed on disk yet that the running app depends on.
- A staged record is only usable by the exact version that staged it (`staged.previousVersion` must equal the running version) and only from a folder the updater itself created beside the bundle (`<bundle dir>/.cairn-update-*/<the bundle's own name>`). Anything else in that record is discarded and its folder removed, so a stale or hand-edited record can never install over a newer copy, and `rm -rf` only ever runs on a staging folder derived from the running bundle's directory.
- Before the swap, the staged bundle must pass `codesign --verify --strict` with Cairn's pinned certificate and bundle identifier (see `docs/ops/desktop-signing.md`), regardless of what signs the running copy. If verification refuses the update, only exit 3 (valid signature, requirement not met) allows `apply()` to clear the staged record: it re-reads the file after verification and writes only `staged: null` over that state if the record still names the same app. It leaves the folder for the existing startup sweep. The next ordinary check can stage a newer release as usual.
- `ready` → swap on one of three triggers: quit (`app.before-quit`, after the server and Runner are stopped), away (`apps/desktop/src/idle-update.ts`: locked ≥ 1 min, system input idle ≥ 15 min, or no Cairn window focused for 10 min; held by an in-flight Coordinator turn, an open dialog, a step in the app-owned Runner's journal, or an armed guard), or explicit install (`install({ relaunch: 'foreground' })`).
- Swap: `rename(bundle → previousApp)`, `rename(staged.app → bundle)`. If the second rename fails, the first is undone and the state stays `staged` with an `error` published.
- Swap success writes `installed` and clears `staged`. The swap deletes nothing: the previous bundle is now `previousApp`.
- First launch of the new version (`installed !== null && installed.version === app.getVersion()`) arms the guard.
- Guard, in `apps/desktop/src/update-guard.ts`, pure and clock-injected: `armed → healthy` needs the server to answer a health probe for 30 s without exiting. A server exit while `armed` → `rollback` immediately; three failed probes in a row (one probe every 5 s, a 5 s timeout) → `rollback`, because a single slow answer while migrations run is noise, not a broken build. More than 2 rollbacks of the same version in `blocked` refuses to arm again.
- `healthy` deletes `previousApp`, clears `installed`, writes the file.
- When the app talks to a remote server or attaches to a resident one, there is no server of its own to probe; finishing `boot` counts as a health answer and staying up 30 more seconds confirms, so the guard never stays `armed` and the away apply is not held forever.
- `rollback` writes `notice` and `blocked`, renames `bundle → .cairn-previous/Cairn.app.failed`, renames `previousApp → bundle`, relaunches with `--cairn-background-launch`, exits. The failed bundle is deleted after the process exits by the existing `removeFolderAfterExit`.
- Any launch takes `notice` before anything else (clear it, append the line to `<userData>/logs/update.log`), and shows one line once the server, tray and window are up: a Notification, or a dialog when the Notification cannot be delivered. Only the main window's page may take the notice over IPC; the hidden `/tray` page gets nothing, so it cannot swallow the line before the window shows it. It is deliberately not shown during boot — a macOS modal dialog runs a modal event loop that blocks the main thread, which would stop the bundled server from ever starting.

### Every path that reads or writes the file

| Path | Reads | Writes |
|---|---|---|
| `updater.check()` | `blocked` (to decide whether to auto-stage) | — |
| `updater.stage()` | — | `staged` |
| `updater.apply()`, quit hook, idle hook | `staged`; re-reads the state on signature requirement mismatch | On swap, `installed` and clears `staged`; on requirement mismatch, clears only `staged` if it still names the same app |
| boot, no `installed` record or a different running version | `installed` | clears `installed`, removes the kept previous bundle |
| boot, guard armed | `installed` | — |
| boot, guard healthy | `installed` | clears `installed` |
| boot, guard rollback | `installed` | `notice`, `blocked`, clears `installed` |
| boot, version mismatch | `installed` | clears `installed` |
| boot, notice | `notice` | clears `notice` |
| launch check (`apps/desktop/src/launch-update.ts`), under the lock | `staged`, `installed`, `knownVersion` | on a staged swap `installed`, clears `staged`; `knownVersion` |
| background updater (`apps/desktop/src/background-update.ts`) | everything | `staged` after a download; under the lock `installed`, clears `staged`, `knownVersion`; clears `staged` on a refused signature |
| guard rollback | — | also sets `knownVersion` to the restored version |

### Failure paths

| Failure | Behaviour |
|---|---|
| Manifest fetch fails / no network | `error`; retried on the next hourly check; nothing staged |
| Download truncated or wrong hash | staging folder removed, `error`; previous bundle untouched |
| Extracted bundle missing or wrong version | staging folder removed, `error` |
| Rename across filesystems | cannot happen by construction (staging is beside the bundle) |
| `staged.app` points anywhere but a staging folder beside the bundle | refused, record and folder discarded, `error` published |
| The staged bundle disappeared from disk, or its version is not the recorded one | `apply()` clears the staged record and publishes `error`; the next `check()` sees no usable staged bundle, discards the record and downloads again, so `ready` never points at a bundle that cannot install |
| The menu's install fails | a warning dialog names the failure; the menu stays usable |
| Staged signature is valid but does not meet Cairn's requirement (exit 3) | refused, `error` published, staged record cleared only if it still names the same app, all folders untouched. Automatic checks and manual installs skip that version for the rest of the process; newer releases are still eligible. Refusals are not persisted, so restarting allows one download of that version per launch before it is refused again. |
| Staged signature verification fails for any other reason (including exit 1, a signal or a spawn error) | refused, `error` published, staged record and all folders untouched |
| The bundle is missing at launch but a kept previous copy is there | the previous copy is renamed back before anything else runs |
| Second rename fails after the first | first rename undone, `error`, app keeps running on the old bundle |
| Process dies between the two renames | boot sees `installed.version` ≠ running version, clears the record; the moved-aside bundle is restored by name if it is the only one there |
| New version's server exits before ready | rollback |
| New version's `boot()` throws (server start timeout, migration error) while the guard is armed | rollback at once, like a server exit; one failure is enough |
| New version's server answers, then dies inside 60 s | rollback |
| New version boots but never finishes its first window load | still `armed`; the health window closes on wall-clock, not on the window, so it either confirms by serving or rolls back |
| New version cannot start at all (its `main.mjs` throws before `boot`) | **not covered**; needs a fixed release. The background updater does not roll back: it only installs, and skips while `installed` is unconfirmed |
| Background updater: no network, manifest error, bad hash | logged to `update.log`, staging removed, retried in half an hour |
| Background updater: Cairn starts during the download or before the swap | download removed, no swap; the lock and the on-disk version check cover the swap itself |
| Background updater: the resident server cannot be asked about replies | logged; treated as idle so updates are not held forever |
| Launch check: lock still held after a minute | the launch goes on; the on-disk version check still relaunches into a finished swap |
| Previous bundle missing at rollback | error dialog, exit; `notice` and `blocked` still written so the next launch of anything explains it |
| Update applied at quit, then the app is launched again quickly and the new version is fine | confirms after 30 healthy seconds |
| The same bad version is the newest release | never auto-staged again on that Mac; explicit install still possible |

## Applying without taking focus

Three places bring Cairn forward today, and each gets one fix:

1. `updater.install()` is preceded by a modal `dialog.showMessageBox` in `installFromMenu`. The automatic path no longer goes through the menu; only an explicit user install keeps a dialog, and it now says what will happen.
2. `app.relaunch()` starts the app, and the new instance opens its window in `openWindow` (`window.show()` on `ready-to-show`). The relaunch passes `--cairn-background-launch`; with that flag `boot` starts the server, the tray and the update checks but does not create the main window. Clicking the menu bar icon, choosing "Open Cairn", or opening the app again creates it exactly as today.
3. Nothing else calls `app.focus()`; `focusWindow` runs only for `activate`, `second-instance` and explicit UI actions.

Before any relaunch (away, explicit, rollback) the main process writes `relaunch-window.json` in user data: visible, minimized, maximized, full screen and the page path, same origin only. The next launch reads and deletes it, loads that page, and reopens a visible window with `showInactive` under `--cairn-background-launch`; full screen waits for the first focus, because entering it moves the window to its own Space. Without the file the launch behaves as before. In remote mode the page reports in-flight turns and open dialogs over the `desktop-activity` IPC, accepted only from the main window's top frame on the app origin, so the rule is the same whichever server the app talks to.

## Not covered

- A new version whose own main process cannot start. The old launchd-helper shape (Squirrel's ShipIt, Chrome's updater service) is the only way to recover that; recorded rather than pretended.
- Rollback of a version installed by a release older than the one that ships this change: the restored old version's code does not know about `update-state.json`, so it will not show the notice and may re-download the same broken build. From the first release that carries this change onward, both sides understand the file.
