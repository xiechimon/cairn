# Automatic rollback and silent apply for the desktop updater (2026-11-21)

> **Question.** Cairn 0.1.536 installed itself and could not start: the bundled server exited with code 1 on a migration, and a human rolled the app back by hand. Which of Sparkle, Squirrel/electron-updater, the Chromium updater and VS Code already do the two things this issue asks for — restore the previous version when the new one fails its first start, and apply an update without bringing the app forward — and what do they get wrong that Cairn should not copy?
>
> **Marks.** **`实测`**: read first-hand in this session (source at a named ref, an official doc page, or a command run here). **`推断`**: derived from `实测` and checkable. **`猜测`**: everything else.
>
> **Refs.** Squirrel.Mac `main`; Sparkle 2 docs and `sparkle-project/Sparkle` issue 1274; electron-builder `master` (`packages/electron-updater/src/AppUpdater.ts`); Chromium `main` (`docs/updater/functional_spec.md`); VS Code enterprise update docs. Cairn evidence: `~/Library/Application Support/@cairn/desktop/logs/server.log`.

## 0. The failure this note is about

| Fact | Mark | Source |
|---|---|---|
| 0.1.536 started, ran its migrations, hit `DROP TABLE \`im_connection\`` → `SqliteError: FOREIGN KEY constraint failed`, and exited. It retried three more times with the same stack, at `1795193629`, `1795193636`, `1795193652`, `1795193746` ms. | `实测` | `logs/server.log` lines 45917-45920, all pointing at `file:///Applications/Cairn.app/Contents/Resources/server/dist/index.mjs` |
| The desktop main process treats that as fatal: the server's `exit` handler shows `Cairn server stopped` and quits, and `waitUntilServing` throws into the boot `catch`, which shows `Cairn could not start` and `app.exit(1)`. Nothing restores the previous bundle. | `实测` | `apps/desktop/src/main.ts` (`startServer`, `waitUntilServing`, `boot`) |
| The only copy of the updated app is the running bundle; the previous bundle is deleted by `removeFolderAfterExit(staging, process.pid)` right after the swap. | `实测` | `apps/desktop/src/updater.ts` (`swapBundle`, `install`) |
| The update is applied by `app.relaunch()` + `app.quit()`, and the relaunched app shows its window as soon as it is ready; the update button and the menu item raise a modal `dialog.showMessageBox` first. | `实测` | `apps/desktop/src/updater.ts`, `apps/desktop/src/main.ts` (`openWindow`, `installFromMenu`) |

## 1. Squirrel.Mac (what Electron's built-in `autoUpdater` runs)

| Fact | Mark | Source |
|---|---|---|
| The install never runs inside the app. `ShipIt` is a launchd job (`<bundle id>.ShipIt` mach service) that waits for every instance of the app to exit and only then replaces the bundle. | `实测` | `Squirrel/SQRLShipItLauncher.m` (`LAUNCH_JOBKEY_LABELS`, `LAUNCH_JOBKEY_MACHSERVICES`, `shipItJobDictionary`) |
| It moves the old bundle aside and puts it back if a previous attempt was interrupted: `restoreOwnedBundle` runs `installer.abortInstall` on the *next* ShipIt launch. | `实测` | `Squirrel/ShipIt-main.m` (`restoreOwnedBundle`, `abortInstall`) |
| Repeated attempts are capped: `SQRLShipItMaximumInstallationAttempts = 3`, after which it aborts the update instead of trying again. | `实测` | `Squirrel/ShipIt-main.m` |
| After installing it launches the app and does **not** wait for the app to become healthy; a bundle that installs but crashes on start stays installed and broken. | `实测` | `Squirrel/ShipIt-main.m` (`launchAfterInstallation` branch, `posix_spawn` / `NSWorkspace launchApplicationAtURL`, no health signal) |
| Rollback is a *server* decision, not a client one: "The server can remotely drive behaviors like rolling back or phased rollouts." | `实测` | `Squirrel/README.md` |

What this buys Cairn: the previous bundle is kept aside until the swap completes, and the attempt count is bounded. What it does not buy: a check that the new version actually runs.

## 2. Sparkle 2

| Fact | Mark | Source |
|---|---|---|
| Phased rollouts: 7 hardcoded groups, `<sparkle:phasedRolloutInterval>` seconds apart from `<pubDate>`, a random `SUUpdateGroupIdentifier` in user defaults, no effect for critical updates or a manual check. | `实测` | [sparkle-project.org/documentation/publishing](https://sparkle-project.org/documentation/publishing/) "Phased group rollouts" |
| For zip app bundles the replacement is atomic — "either entirely replaced or not at all" — but Sparkle keeps no copy afterwards: it "never tries to install any older version" and "doesn't remember any history". | `实测` | [sparkle-project/Sparkle#1274](https://github.com/sparkle-project/Sparkle/issues/1274), comments by the maintainer |
| Updates only run after the app has quit gracefully, so there is no running state to preserve during the swap. | `实测` | same issue thread |

So Sparkle guarantees *installation* succeeds or leaves the old bundle, and never guarantees the new build *starts*. Staged rollout (a smaller blast radius per day) is its answer to a broken build, not a rollback.

## 3. electron-updater (electron-builder)

| Fact | Mark | Source |
|---|---|---|
| `autoDownload = true`: the update is fetched in the background without asking. | `实测` | `packages/electron-updater/src/AppUpdater.ts` |
| `autoInstallEvent` is `'onQuit' \| 'onNextLaunch' \| 'manual'`, default `'onQuit'`, with `'onNextLaunch'` planned as the v28 default. `'onNextLaunch'` writes a marker at quit and installs at the next startup. | `实测` | same file, `autoInstallEvent` docs |
| The reason `'onNextLaunch'` exists is a documented failure class: an installer spawned during quit can be killed by the OS at session end, leaving the app not updated. `cancelQuitOnInstallFailure` keeps the app running instead of exiting without the update. | `实测` | same file, `autoInstallEvent` / `cancelQuitOnInstallFailure` docs |
| A pending install is never trusted blindly: the cached installer is re-validated against freshly fetched update info (checksum, and code signature where applicable) before it is applied, and the pending state is cleared when the version is not an installable change — "a loop guard, mirroring `isUpdateAvailable`". | `实测` | same file, `installPendingUpdateIfAvailable` docs |
| Nothing detects that the newly installed version fails after it starts. | `推断` | the four rows above plus the absence of any health or rollback path in the same file; not exhaustively grepped across the package |

## 4. Chromium's browser updater

| Fact | Mark | Source |
|---|---|---|
| The updater is its own process tree (updater plus a crash-handler child), separate from the browser it updates. | `实测` | Chromium `docs/updater/functional_spec.md`, "Crash Reporting" |
| Gradual rollout is decided by the server: clients send a "Major/Minor version rollout policy" preference so the server can place them early or late "in any gradual rollout process". | `实测` | same doc, policy section |
| We found no client-side rule of the form "the new browser failed to start, restore the old one"; halting a rollout or shipping a fixed build is the documented mechanism. | `推断` | from the doc above and `docs/updater/user_manual.md`; we did not find a rollback section |

## 5. VS Code

| Fact | Mark | Source |
|---|---|---|
| Its default update mode "is enabled and runs in the background"; `manual` and `none` exist for managed installs. | `实测` | [code.visualstudio.com/docs/enterprise/updates](https://code.visualstudio.com/docs/enterprise/updates) |
| A downloaded update is applied on restart rather than by bringing the window forward, which is why the product can be updated mid-session without interrupting typing. | `推断` | the row above plus the product's known "Restart to Update" affordance; not verified by operating VS Code in this session |

## 6. What Cairn takes, and what it rejects

| Choice | Why | Source of the idea |
|---|---|---|
| Keep the previous `.app` next to the new one until the new version passes a first healthy start, then delete it. | This is the one thing none of the four do after *applying* the update; Squirrel keeps the old bundle only until the swap is done, Sparkle deletes it at the atomic replace. | Squirrel's "move aside + restore" extended past the swap |
| Cap how many times one version may roll back and be retried. | Squirrel aborts after 3 attempts; without a cap a failed rollout loops forever. | `SQRLShipItMaximumInstallationAttempts` |
| Re-validate the staged zip (size + SHA-256 against the manifest) immediately before applying it, not only when it was downloaded. | electron-updater re-fetches update info before applying a pending install for exactly this reason. | `installPendingUpdateIfAvailable` |
| Remember the version that failed and do not auto-install that same version again. | electron-updater's loop guard; without it the restored old app re-downloads the same broken build on its next hourly check. | `isUpdateAvailable` loop guard |
| Download and stage in the background, apply on quit / at an idle moment / on an explicit restart, and never activate the window to do it. | electron-updater defaults to background download and install-on-quit; VS Code applies on restart. Cairn's current path shows a modal dialog and relaunches into a foreground window. | `autoInstallEvent: 'onQuit'`, VS Code |
| **Rejected:** a separate privileged installer process or launchd job. | Squirrel and Chrome both do this, and it is the only way to recover when the app's own main process cannot start. Cairn's swap is a rename beside the bundle and shipping a launchd helper is a bigger change than this issue; the gap is written down in the design instead of hidden. | — |
| **Rejected:** rolling back by republishing the previous version server-side. | Squirrel and Chrome both recover this way, but the user stays stuck until the release is replaced — exactly the hand-rolled recovery reported in this issue. Keep it as the second line of defence for the unbootable-main-process case. | Squirrel `README.md` |
| **Rejected:** Sparkle-style phased rollout as the primary safety net. | Cairn has one owner and one release channel; the failure was deterministic (a migration), so a 7-day ramp would still break every user in the first group and take a week to reach the rest. | Sparkle publishing docs |
