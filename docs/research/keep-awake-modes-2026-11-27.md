# Keep-awake modes on macOS — prior art, 2026-11-27

Question: how should a Mac desktop app let a user choose between keeping the screen on, keeping only the system awake, and continuing with the lid closed while agents work?

Evidence marks: **first-hand** means read or run first-hand in this session; **inferred** follows directly from that evidence; **unverified** is unverified.

## Comparison

| Source | How it does it | Trade-offs | Link |
|---|---|---|---|
| Apple `caffeinate(8)` | `-i` prevents idle system sleep; `-d` prevents display sleep; `-s` prevents system sleep only on AC power; `-u` declares user activity; `-w pid` ends the assertion when the watched process exits. | No password needed. `-i` and `-d` do not protect lid-close sleep; `-s` is unavailable on battery. | **first-hand** local `man caffeinate`; [Apple caffeinate.c](https://github.com/apple-oss-distributions/PowerManagement/blob/main/caffeinate/caffeinate.c) |
| Apple IOKit power assertions | `PreventUserIdleSystemSleep` prevents only idle sleep and explicitly still allows lid close, Apple-menu sleep, low battery and other sleep causes. `PreventUserIdleDisplaySleep` keeps the display awake, and while it is held the system cannot idle sleep. | The documented application-level API maps cleanly to the first two Cairn modes, not directly to lid-closed operation. | **first-hand** local `IOKIT/pwr_mgt/IOPMLib.h` lines 275-314 |
| Apple powerd source | `PreventSystemSleep` is the assertion type created by `caffeinate -s`; powerd treats it as a demand-sleep prevention effect and marks it invalid on battery. | This is the strongest no-password assertion available to Cairn on AC. It still does not change the stored global `SleepDisabled` setting. | **first-hand** [PMAssertions.c](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmconfigd/PMAssertions.c), lines around `kPreventSleepType` and `kPrevDemandSlpEffect` |
| Apple `pmset` | `pmset` requires root to modify settings. Its undocumented `disablesleep` argument writes `SleepDisabled` into system power settings; powerd copies that value onto `IOPMrootDomain`. | This is global, persistent and not tied to a process or task. It can keep a lid-closed Mac awake even on battery, but it needs admin rights and a fail-safe. | **first-hand** local `man pmset`; [pmset.m](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmset/pmset.m), [PMSettings.m](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmconfigd/PMSettings.m) |
| Electron 45.2.1 `powerSaveBlocker` | `prevent-app-suspension` keeps the system active while allowing the screen to turn off; `prevent-display-sleep` keeps system and screen active and takes precedence. | Exactly matches Cairn's first two modes. It exposes no lid-closed or AC-only system-sleep mode. | **first-hand** [Electron power-save-blocker docs](https://github.com/electron/electron/blob/v45.2.1/docs/api/power-save-blocker.md) |
| Electron 45.2.1 `powerMonitor` | Emits `on-ac` and `on-battery`; `isOnBatteryPower()` reports the current source. | Lets Cairn show the lid-closed choice only while plugged in and re-evaluate it when power changes. | **first-hand** [Electron power-monitor docs](https://github.com/electron/electron/blob/v45.2.1/docs/api/power-monitor.md) |
| Amphetamine | Closed-display support can use a separate Power Protect installation. The published sudoers file permits exactly `/usr/bin/pmset -a disablesleep 1` and `/usr/bin/pmset -a disablesleep 0` without a password; its script otherwise runs the same commands `with administrator privileges`. | Works, including battery, but asks for admin once or installs persistent authentication-less sudo access. The setting is global and must be undone reliably. | **first-hand** [Amphetamine README](https://github.com/x74353/Amphetamine/blob/main/README.md), [amphetamine_PowerProtect](https://github.com/x74353/Amphetamine/blob/main/Files/amphetamine_PowerProtect), decompiled `powerProtect.scpt` from the same repository |
| KeepingYouAwake | A small menu-bar wrapper around `caffeinate`; its README says it does not work with a MacBook lid closed, citing macOS limitations and thermal considerations. | Good simple menu-bar precedent for the first two modes, but it deliberately does not solve lid-closed operation. | **first-hand** [KeepingYouAwake README](https://github.com/newmarcel/KeepingYouAwake/blob/main/README.md) |
| Apple closed-display mode | Apple's supported desk setup uses an external keyboard and mouse or trackpad, power, and an external display; then the lid can close while work continues. | No password and fully supported, but it is not the headless “close the lid and walk away” case Cairn's third mode names. | **first-hand** [Apple Support 117373](https://support.apple.com/en-us/117373) |

## What Cairn can and cannot do without a password

**first-hand** Without a password Cairn can hold process-scoped power assertions: display sleep off, idle system sleep off, and on AC the stronger `PreventSystemSleep` assertion through `caffeinate -s`. **inferred** That means the three user-visible modes can be implemented without admin rights as:

1. screen stays on: Electron `prevent-display-sleep`;
2. screen may sleep: Electron `prevent-app-suspension`;
3. lid closed: `caffeinate -s -i -w <desktop pid>` while a task is in flight. `-s` provides the AC-only system-sleep assertion; `-i` degrades to ordinary idle-sleep prevention if the machine is unplugged; `-w` ties the assertion to Cairn's lifetime.

**first-hand** Cairn cannot use `pmset disablesleep` without admin rights, because `pmset` settings changes require root. **inferred** Cairn therefore should not promise battery-powered lid-closed operation. On battery the lid-closed menu row is hidden; if the user unplugs after choosing it, the `-i` half still prevents idle sleep, but closing the lid may sleep. **`pmset disablesleep` remains out of scope** because it is global, persistent, requires admin, and needs a crash-safe undo design.

## Pattern that fits Cairn

The existing Cairn runner already records each in-flight step in its outbox journal as `claimed`, `running` or `awaiting-upload` (**first-hand** `apps/daemon/src/journal.ts`, `apps/desktop/src/runner-activity.ts`). The desktop already polls tray state every two seconds (**first-hand** `TRAY_REFRESH_MS` in `apps/desktop/src/main.ts`). A small state machine in the desktop can therefore hold exactly one power assertion while `runnerStepsInFlight() > 0` and release it when the count reaches zero. The daemon's current always-on `caffeinate -i -w <daemon pid>` must become task-scoped as well; otherwise the owner's rule “nothing blocks sleep when no task runs” remains false (**first-hand** `apps/daemon/src/machine-loop.ts`).

## Concrete recommendation

- Persist one tray setting: `screen-on`, `system` (default), or `lid-closed`; migrate the legacy manual `on` value to `screen-on` and everything else to `system`.
- Put the three mutually exclusive choices directly in the Mac menu-bar menu under a clear “while tasks run” heading. Hide `lid-closed` whenever `powerMonitor.isOnBatteryPower()` is true; refresh on `on-ac`/`on-battery`.
- Hold assertions only while the local runner journal has in-flight steps. Remove the manual always-on override and the schedule wake-ahead override because both violate the approved invariant that nothing blocks sleep when no task runs.
- Make the daemon's existing caffeinate prevention task-scoped too, preserving sleep protection for standalone runners while a step is genuinely in flight.
- Do not install a sudoers rule or use `pmset disablesleep` in this change. Tell the user in the plan/report that battery-powered lid-closed operation is a macOS/admin boundary, not a Cairn limitation that can be papered over.
