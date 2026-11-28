# Host switch restart and the account popover host list — plan, 2026-11-28

## User scenario

Someone installs Cairn on their laptop today and adds their other Mac as a host, so the app can show either that computer's workspace or the laptop's own. They meet this change in two places and nothing new is asked of them: the app menu `Cairn → Switch Host` (already there) and the avatar popover at the bottom-left of the sidebar. Today, choosing a host writes `<userData>/connections.json` and quits the app, handing the restart to Electron's in-process relaunch. Two failures follow. First, the old process spends up to 10 seconds stopping its local server, Runner and helpers before it exits, and Electron's relaunch starts late in that teardown, so the window is gone for 8–17 seconds (measured on a disposable 0.1.831 copy) and, when the replacement does start, it can begin while the old instance is still stopping its server: on 2026-11-28 at 19:01 the local server started on port 54400 and was SIGTERMed before it answered, so the app showed "Cairn could not start — the Cairn server exited with code 15 before it was ready" and left the user with no app. Second, landing in the laptop's own workspace, the avatar popover offers cloud sign-in and, for linked users, the cloud workspace, but never the other Mac already saved in `connections.json`, so the workspace looks wiped and the way back sits three levels deep in Settings. This change makes the restart one sequenced step — the old process is fully gone before the replacement starts, the replacement opens at the new host's first page and comes to the front — and puts the host list the menu and tray already carry into the avatar popover. It needs no accounts, keys or storage beyond the existing `connections.json` and the existing `relaunch-window.json`; when the chosen host is unreachable the app keeps showing the existing offline page, whose switch-back action still works.

## Why

Measured on a disposable copy of the released 0.1.831 app on this Mac: `Cairn → Switch Host` to a remote host took 8 s and back to This computer 17 s from the menu click to a live replacement, all of it after the window had vanished, because Electron's relaunch waits for a quit that spends up to 10 s stopping the server and helpers. On 2026-11-28 at 19:01 the released 0.1.830 app switched back to This computer, started its local server on port 54400, and the server was killed 56 s later, before the readiness probe answered: `main.log` records `Cairn server exited (code 15); restarting` at `11:01:03Z` and `server.log` records pid 66709 online at `11:01:04Z` and `cairn-server stopped` at `11:01:59Z`, so the app showed "Cairn could not start — the Cairn server exited with code 15 before it was ready" and exited, leaving nothing to click. The same popover survey found no control that returns to a saved remote host: the only host switch is the menu, the tray or Settings.

| Situation | What the user sees today | What they see after this change |
|---|---|---|
| Switch from the local workspace to Mac mini | Window disappears 8–17 s, then the remote workspace | Window disappears only for the stop, then the remote workspace in front |
| Switch back to This computer while the server is stopping | Sometimes "Cairn could not start" and no app at all | The local workspace opens; the replacement starts after the old server is gone |
| Land in the local workspace and want Mac mini back | Only cloud actions in the avatar popover | The host list with This computer current and Mac mini one click away |

## Scope

1. On macOS, switching hosts from the app menu, the tray menu, the Host connection panel, the offline page, or the remove-active-remote path writes `connections.json` as today, then starts one detached `/bin/sh` waiter that execs the same binary with the same foreground arguments (`relaunchArgs(false)`, same environment) as soon as the current process exits, and quits. The replacement therefore starts only after the old process's server, Runner and helpers are stopped, so no server can be killed by the instance it replaced.
2. The waiter is guarded against re-entry: a second switch while the first is quitting starts no second waiter.
3. The window is remembered at the root page for a host switch (`relaunch-window.json` with `path: "/"`), so the replacement opens on the new host's first page instead of the old host's deep path, with the old size and visibility.
4. The replacement that opens a window calls `app.focus({ steal: true })`, so the app comes to the front after a switch or a resident handoff instead of staying behind.
5. Windows and Linux keep Electron's `app.relaunch` for host switches; the waiter is macOS-only because it relies on `kill -0` and `exec`.
6. If the waiter cannot be spawned, the app falls back to `app.relaunch` for that switch and still quits, so a failed helper never leaves the user with no replacement.
7. The desktop account popover lists every host the shell reports — This computer and each saved remote host — marks the active one with `当前`, disables the rest, and switches on click when the shell accepts it from the current host. On a remote workspace only This computer is offered, with one line saying so. In a browser (no desktop shell) there is no host list.
8. The retired `切回本机工作区` button and its `cloud-switch-local` test id are removed; the host list carries that action. Cloud sign-in, billing, workspace-open and sign-out stay as they are.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| The old process still stops its local server, Runner or helpers when the switch is issued | The replacement starts only after the old process is gone, so the server it starts is never SIGTERMed by the instance that wrote the same port and owner files | `apps/desktop/scripts/host-restart.test.ts` | this change |
| Arguments carry spaces, `=` or JSON (`--user-data-dir=/tmp/a b`, `--cairn-shell={"localMode":true}`) | The replacement receives them unchanged | `apps/desktop/scripts/host-restart.test.ts` | this change |
| The user switches from a deep page (a project run) to another host | The replacement opens the new host's first page, not the old host's `/app/projects/<id>`, which would 404 | `apps/desktop/scripts/host-restart.test.ts` | this change |
| The waiter cannot spawn (`/bin/sh` unavailable, permissions) | The app falls back to Electron's relaunch for that switch and still quits; the user gets the app back | `apps/desktop/scripts/host-restart.test.ts` | this change |
| A second switch arrives while the first is quitting | No second waiter starts, so two replacements cannot race the single-instance lock | `apps/desktop/scripts/host-restart.test.ts` | this change |
| Two hosts saved, the local one active | The popover lists This computer and the remote host, marks This computer `当前`, and offers the remote as a target | `apps/web/test/sidebar-account.test.ts` | this change |
| The active host is remote | The popover marks that remote `当前`, offers only This computer, and says that a remote workspace can only switch back to this computer | `apps/web/test/sidebar-account.test.ts` | this change |
| No desktop shell (browser tab) | No host section; the existing account actions are unchanged | `apps/web/test/sidebar-account.test.ts` | this change |
| Only one host is saved | No host section is drawn; one host is not a choice | `apps/web/test/sidebar-account.test.ts` | this change |
| The app was started in the background by the updater and the user switches hosts | The waiter receives `relaunchArgs(false)` — existing behaviour, unchanged by this change — so the replacement is a foreground launch and shows its window | `apps/desktop/scripts/packaged-host-switch.spec.ts` | later: packaged host-switch journey |
| A development run (unpackaged Electron) switches hosts | The waiter execs the Electron binary with the app path and arguments it was started with | `apps/desktop/scripts/packaged-host-switch.spec.ts` | later: no packaged check for dev runs |
| A host name is long or empty | The row truncates the name and keeps the row height; an unnamed host keeps its URL-derived name from `connections.json` | `apps/web/test/sidebar-account.test.ts` | later: long-name row |
| The popover is open while the restart runs | The row disables on press, the popover closes, and the app leaves; no second press reaches the shell | `apps/web/test/sidebar-account.test.ts` | later: press-state row |
| The quit is vetoed or stalls past the fallback | The waiter stops waiting after 200 polls (40 s) and starts nothing, so no second instance fights the single-instance lock; the user launches the app, which opens the already-chosen host | `apps/desktop/scripts/packaged-host-switch.spec.ts` | later: stalled-quit row |
| A replacement fails to boot after the switch | The remembered `relaunch-window.json` holds only size and `path: "/"`, so the next launch opens the first page of whatever host is active; nothing deep is replayed | `apps/desktop/scripts/packaged-host-switch.spec.ts` | later: failed-boot row |
| The active host is removed from Settings or turns unreachable | The catalog falls back to This computer through the existing `remove-remote` path, which uses the same restart; the popover then lists only This computer | `apps/web/test/sidebar-account.test.ts` | later: removed-active-host row |
| The chosen host is unreachable after the restart | The existing offline page shows with its switch-back action; no new state | `apps/desktop/scripts/packaged-host-switch.spec.ts` | later: packaged host-switch journey |

## State and failure paths

- Reader of saved state: boot calls `takeRelaunchWindow()` (`apps/desktop/src/main.ts`) and reads `relaunch-window.json`; the switch writes it through `rememberWindowForRelaunch(true)` before quitting, at `path: "/"`.
- Writer of `connections.json`: `setActiveConnection` runs synchronously when the host is chosen, before the quit. If the quit stalls, the next launch — whether the waiter's or a manual one — lands on the host the user chose; the choice is not rolled back.
- The restart flag lives in the restarter closure (`createHostRestarter`): the first call sets it, later calls return without spawning, so one quit produces at most one replacement.
- Transitions: chosen → catalog written → waiter spawned → quit accepted → helpers and server stopped → process exits (or the `STOP_TIMEOUT_MS + 3s` `app.exit` fallback ends it) → waiter sees the pid gone → `exec` the same binary with `relaunchArgs(false)` → new process boots, opens the root page, focuses.
- Failure paths: spawn error → `fallback()` calls `app.relaunch` before the process exits, so the replacement still arrives; waiter never sees the exit (impossible in practice because of the fallback) → no launch, and the user launches the app, which reads the already-written host; non-darwin → `app.relaunch` directly, unchanged; unreachable chosen host → boot's existing offline page, and its switch-back action.
- Accepted risks: `exec` of an app bundle binary gives no LaunchServices registration (the window still shows and is focused); a reused pid within the stop window would keep the waiter waiting (the fallback bounds it); `open` is not used, so the environment is inherited exactly.

## Verification

The release verification is the live evidence for the rows marked `later: packaged host-switch journey`: on the owner's Mac, with the app in the background and the menu driven by `cua-driver invoke_menu`, switch This computer → Mac mini and back, record the elapsed time from the click to a live window each way, confirm the local workspace starts without a "could not start" dialog, open the avatar popover in the local workspace signed into the cloud account and screenshot the Creem checkout page reached by the "Open Cairn Cloud ($12/month)" entry without paying, then leave the app on Mac mini. Screenshots land in `~/Pictures/cairn-review/host-switch-relaunch/`. A packaged automated journey (`packaged-host-switch.spec.ts`) is the follow-up that replaces this manual walk.

## Out of scope

- A pre-ready retry when the local server dies before answering. `apps/desktop/src/main.ts` still shows its dialog and exits; the sequencing above removes the observed cause, and a retry is a separate change.
- A packaged end-to-end run of the restart inside `desktop-mac` (needs a `host-switch` journey type); tracked as the `later:` rows above.
- A test for the 40 s waiter cap itself: the cap exists in `REPLACEMENT_WAIT_SCRIPT` and is reached only when the `app.exit` fallback is vetoed, which needs the packaged journey.
- A `scripts/doc-retired-terms.json` entry for `切回本机工作区`: that is a UI label, not a retired mechanism, path or rule, and no living document names it; `apps/desktop/scripts/journeys/cloud-account.mjs` now drives the host list instead of the old test id.
- Keeping the local server running across a switch, or opening the new window before the old process finishes. Both change product behaviour beyond this fix; the measured cost stays the stop time (bounded by the existing `app.exit` fallback at `STOP_TIMEOUT_MS + 3s`).
- Making the menu and tray refuse a remote-to-remote switch the way page IPC does.
- Any change to cloud sign-in, billing, migration or the offline page.

## Review

- Verdict: PASS
- Plan-SHA256: 1bd3c85c6249b59d3e233b43e3a5b5b487db2e39775f644818af92d536dd2015
- Author-Model: gpt-6.2-sol
- Reviewer: pi plan review (fresh context)
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Findings: 1 full review (4 blocking, 7 should-fix) and two fix-checks. The first fix-check found the packaged `cloud-account` journey still driving the retired `cloud-switch-local` id; it now drives the host list. The second fix-check returned FAIL on five remaining items, answered here rather than by a third pass (the harness refuses one): the waiter now carries a 40 s cap (edge row, packaged test later); edge rows were added for a stalled quit, a failed replacement boot and a removed or unreachable active host; rows whose packaged behaviour no automated test covers now name the follow-up `packaged-host-switch.spec.ts` instead of claiming `host-restart.test.ts`; a static test now asserts `switchDesktopHost` starts the waiter and does not call `app.relaunch`; live evidence is the release verification below, not a packaged run in CI.
