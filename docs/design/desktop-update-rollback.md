# Desktop updates: roll back a bad version, apply without taking focus

Issue #5396. Research: `docs/research/5396-desktop-update-rollback-prior-art.md`.

## For someone who installed Cairn today

You have a Cairn icon in your Dock and a Cairn icon in the menu bar. Cairn keeps itself up to date. Two things change about that, and both are about not interrupting you.

When a new version is published, Cairn downloads it while you work — no dialog, no progress take-over, no window coming forward. Your Cairn does not restart by itself in the middle of something. It swaps in the new version when you quit Cairn, or when Cairn has been sitting in the menu bar with no window open for ten minutes, or when you explicitly say "restart to update".

If that new version cannot start — its bundled server crashes on a database migration, which is exactly what happened to 0.1.536 — you do not have to find a download and drag it into Applications. Cairn puts the version you were running a minute ago back, starts it, and tells you in one line that the update was rolled back. The failure itself (what the new version printed before it died) is in `~/Library/Application Support/@cairn/desktop/logs/`, and the line names the version that failed.

What you need to know: your data lives in the Cairn home directory, not in the app bundle, so a rollback never touches your tasks. A rolled-back version is not offered to you again automatically; the next release is. Nothing asks you for an account, a password or a payment — the update downloads from Cairn's public GitHub releases, the same place you installed it from.

Where you can still get stuck: if the new version's *own launcher* (not the server it starts) cannot run at all, no Cairn code is running to roll it back. That case is covered by publishing a fixed build, and is listed under "not covered" below.

## Why

0.1.536 ran its migrations, hit `FOREIGN KEY constraint failed` on `DROP TABLE im_connection`, and the server exited with code 1 four times. The desktop shell turns that into "Cairn could not start" and `app.exit(1)`; the previous bundle had already been deleted by the updater, so the only way back was a human downloading the previous release. Meanwhile the update itself raised a dialog and relaunched into a window that showed itself — the update took focus whether or not you were using Cairn.

## Scenarios

| Situation | What you see | What Cairn does | Wait / cost |
|---|---|---|---|
| You installed a newer Cairn by hand while an older update was staged | Nothing extra; the older staged copy is dropped | Discards the staged record and its folder because it was staged for a different running version | The staged download is wasted |
| A new version is published while you are working | Nothing; the update arrow in the header turns into "restart to update" | Downloads and verifies the zip, extracts it beside the app, records it as staged | A few MB of disk next to the app; no interruption |
| You quit Cairn | Nothing | Renames the staged app into place, then exits | Under a second on top of the normal quit |
| Cairn sits in the menu bar with no window for ten minutes | Nothing | Same swap, relaunch hidden (menu bar icon only) | In-flight agent work in the server is interrupted; the design accepts this only while no window is open |
| You choose "Restart to Update" in the menu or the header | The app restarts | Swaps in the staged version and relaunches with its window | A normal restart |
| The new version starts fine | Nothing | After 30 healthy seconds it keeps its claim and deletes the previous version | — |
| A single health probe times out while the server is busy | Nothing | Three failed probes in a row are needed before it counts as a failed health check | — |
| The new version's server exits before it is ready, or fails three health probes in a row in the first 60 seconds | One line: "Cairn 0.1.536 did not start, so Cairn went back to 0.1.535" | Puts the previous version back, records the failure, relaunches the previous version hidden, and never auto-installs 0.1.536 again on that Mac | The broken version is gone after one restart; you keep your data |
| You ask to install the version that failed | A dialog naming it as the one that failed | Installs it only because you asked explicitly | — |
| The previous version is missing or the swap fails | The existing "Cairn could not start" dialog, plus the log line | Gives up loudly rather than looping | Manual download |
| Notifications are switched off for Cairn | One line in a dialog, after Cairn has started | Falls back to a dialog, because a silent rollback the user cannot see is worse than an interruption; it is raised after boot so its modal loop cannot stall the server starting | One dialog to dismiss |
| Cairn is not in Applications, or the folder is read-only | Unchanged from today | Reports `unsupported` and never stages an update | — |

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
}
```

Paths: `<bundle dir>` is the folder holding `Cairn.app` (normally `/Applications`). `<bundle dir>/.cairn-previous/Cairn.app` is the kept previous version. Staging lives in `<bundle dir>/.cairn-update-<random>/` so every rename stays on one filesystem; the desktop's existing "delete leftover staging folders on boot" cleanup skips the folder named by `staged.app`.

## States and transitions

`idle` → `checking` → (`available` → `downloading` → `ready`) | `current` | `unsupported` | `error`.

- `ready` means: zip downloaded, SHA-256 matches the manifest, extracted bundle carries the manifest's version in its `Info.plist` and an executable next to it, and `staged` is written. Nothing has changed on disk yet that the running app depends on.
- A staged record is only usable by the exact version that staged it (`staged.previousVersion` must equal the running version) and only from a folder the updater itself created beside the bundle (`<bundle dir>/.cairn-update-*/<the bundle's own name>`). Anything else in that record is discarded and its folder removed, so a stale or hand-edited record can never install over a newer copy, and `rm -rf` only ever runs on a staging folder derived from the running bundle's directory.
- Before the swap, the staged bundle must pass `codesign --verify --strict` with Cairn's pinned certificate and bundle identifier (see `docs/ops/desktop-signing.md`), regardless of what signs the running copy. If verification refuses the update, only exit 3 (valid signature, requirement not met) allows `apply()` to clear the staged record: it re-reads the file after verification and writes only `staged: null` over that state if the record still names the same app. It leaves the folder for the existing startup sweep. The next ordinary check can stage a newer release as usual.
- `ready` → swap on one of three triggers: quit (`app.before-quit`, after the server and Runner are stopped), idle (no window open and not focused for ten minutes), or explicit install (`install({ relaunch: 'foreground' })`).
- Swap: `rename(bundle → previousApp)`, `rename(staged.app → bundle)`. If the second rename fails, the first is undone and the state stays `staged` with an `error` published.
- Swap success writes `installed` and clears `staged`. The swap deletes nothing: the previous bundle is now `previousApp`.
- First launch of the new version (`installed !== null && installed.version === app.getVersion()`) arms the guard.
- Guard, in `apps/desktop/src/update-guard.ts`, pure and clock-injected: `armed → healthy` needs the server to answer a health probe for 30 s without exiting. A server exit while `armed` → `rollback` immediately; three failed probes in a row (one probe every 5 s, a 5 s timeout) → `rollback`, because a single slow answer while migrations run is noise, not a broken build. More than 2 rollbacks of the same version in `blocked` refuses to arm again.
- `healthy` deletes `previousApp`, clears `installed`, writes the file.
- `rollback` writes `notice` and `blocked`, renames `bundle → .cairn-previous/Cairn.app.failed`, renames `previousApp → bundle`, relaunches with `--cairn-background-launch`, exits. The failed bundle is deleted after the process exits by the existing `removeFolderAfterExit`.
- Any launch takes `notice` before anything else (clear it, append the line to `<userData>/logs/update.log`), and shows one line once the server, tray and window are up: a Notification, or a dialog when the Notification cannot be delivered. It is deliberately not shown during boot — a macOS modal dialog runs a modal event loop that blocks the main thread, which would stop the bundled server from ever starting.

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

### Failure paths

| Failure | Behaviour |
|---|---|
| Manifest fetch fails / no network | `error`; retried on the next hourly check; nothing staged |
| Download truncated or wrong hash | staging folder removed, `error`; previous bundle untouched |
| Extracted bundle missing or wrong version | staging folder removed, `error` |
| Rename across filesystems | cannot happen by construction (staging is beside the bundle) |
| `staged.app` points anywhere but a staging folder beside the bundle | refused, record and folder discarded, `error` published |
| Staged signature is valid but does not meet Cairn's requirement (exit 3) | refused, `error` published, staged record cleared only if it still names the same app, all folders untouched. Automatic checks and manual installs skip that version for the rest of the process; newer releases are still eligible. Refusals are not persisted, so restarting allows one download of that version per launch before it is refused again. |
| Staged signature verification fails for any other reason (including exit 1, a signal or a spawn error) | refused, `error` published, staged record and all folders untouched |
| The bundle is missing at launch but a kept previous copy is there | the previous copy is renamed back before anything else runs |
| Second rename fails after the first | first rename undone, `error`, app keeps running on the old bundle |
| Process dies between the two renames | boot sees `installed.version` ≠ running version, clears the record; the moved-aside bundle is restored by name if it is the only one there |
| New version's server exits before ready | rollback |
| New version's server answers, then dies inside 60 s | rollback |
| New version boots but never finishes its first window load | still `armed`; the health window closes on wall-clock, not on the window, so it either confirms by serving or rolls back |
| New version cannot start at all (its `main.mjs` throws before `boot`) | **not covered**; needs a fixed release. A launchd/ShipIt-style helper is the prior-art answer and is out of scope here |
| Previous bundle missing at rollback | error dialog, exit; `notice` and `blocked` still written so the next launch of anything explains it |
| Update applied at quit, then the app is launched again quickly and the new version is fine | confirms after 30 healthy seconds |
| The same bad version is the newest release | never auto-staged again on that Mac; explicit install still possible |

## Applying without taking focus

Three places bring Cairn forward today, and each gets one fix:

1. `updater.install()` is preceded by a modal `dialog.showMessageBox` in `installFromMenu`. The automatic path no longer goes through the menu; only an explicit user install keeps a dialog, and it now says what will happen.
2. `app.relaunch()` starts the app, and the new instance opens its window in `openWindow` (`window.show()` on `ready-to-show`). The relaunch passes `--cairn-background-launch`; with that flag `boot` starts the server, the tray and the update checks but does not create the main window. Clicking the menu bar icon, choosing "Open Cairn", or opening the app again creates it exactly as today.
3. Nothing else calls `app.focus()`; `focusWindow` runs only for `activate`, `second-instance` and explicit UI actions.

Idle apply additionally requires no window to be open, so it cannot steal focus from a window it just closed.

## Not covered

- A new version whose own main process cannot start. The old launchd-helper shape (Squirrel's ShipIt, Chrome's updater service) is the only way to recover that; recorded rather than pretended.
- Rollback of a version installed by a release older than the one that ships this change: the restored old version's code does not know about `update-state.json`, so it will not show the notice and may re-download the same broken build. From the first release that carries this change onward, both sides understand the file.
