# A phone as a computer on the runner Mac

Status: approved direction (ian, 2026-11-20), design for implementation. Research: [`phone-agents-2026-11-20.md`](../research/phone-agents-2026-11-20.md) (paths chosen there). Builds on [`own-mac-computer.md`](own-mac-computer.md) as superseded 2026-11-19 (the live own-Mac rules: owner-started turns only, no approval cards, hardline refusals, every call a `computer_call` row) and [`computer-login-handoff.md`](computer-login-handoff.md). Security surfaces touched: `apps/daemon/src/backend/command-gate.ts`, `apps/server/src/routes-machine.ts` (presence response), `apps/server/src/services/machine-computer.ts` (`machine*.ts`), `apps/daemon/src/machine-client.ts`; `/security-review` before the implementation lands.

A newcomer sees a Phones section in Settings, Computers, under their runner Mac. They pair each phone once and confirm one consent line; the Coordinator then gets `phone_observe`/`phone_act` in owner conversations, on top of the same `computer_call` log the Mac calls already write. "Pairing" here is the OS-level adb/Xcode pairing, not the `pairedDevice` rows, which are web clients.

## Goal

The owner's Pixel 8a (adb over Wireless debugging from the runner Mac) and iPhone 15 Pro (WebDriverAgent over the existing Wi-Fi CoreDevice pairing) become computers next to the VM computer and the own Mac. The daemon on the Mac spawns `adb`, `xcodebuild` and `devicectl`; the model never names a binary. Out of scope this slice: an Android virtual display, a live phone screen in the computer panel, phone shell.

## Pieces

|| Piece | Where | What |
|---|---|---|
| Phone grant row | new `phone` table, one migration | `{id, teamId, machineId, platform, deviceId, name, consentAt, consentedBy, lastError, executionStepId, executionLeaseExpiresAt, executionFence, handoffReason, handoffStepId, handoffRequestedAt, createdAt, updatedAt}` — the owner-side record; presence-reported link state is not stored (mirrors "grants live outside capabilities") |
| Report | `machineCapabilities.phones[]` (`records/machine-capabilities.ts`) | Daemon probe reports `{deviceId, platform, name, link}` per device, `link` in `seen / unauthorized / ready / locked / offline / signing_expired`; `phoneHost: true` when adb or Xcode is usable |
| Consented set | `machinePresenceResponse.phones` (`machine-wire.ts`) | Server returns `{deviceId, phoneId}` for rows with consent; the daemon manages drivers only for those (pushes the Android helper, keeps WDA alive, re-signs) |
| Daemon drivers | `apps/daemon/src/computer/phone-probe.ts`, `phone-android.ts`, `phone-ios.ts`, `phones.ts` | Probe like `host-permissions.ts`; drivers implement `observe`/`act` behind one `Phones` registry keyed by deviceId, wired in `machine-loop.ts` and `dispatch.ts` beside `options.screen` |
| Tools | `packages/shared/src/protocol/phone-computer.ts` | `phone_observe`, `phone_act` (Coordinator), `phone_manage` (panel only, like `computer_manage`); enum entries in `COMPUTER_TOOLS`, `phone_observe` replay-safe |
| Server | `apps/server/src/services/phone-computer.ts`, `routes-phones.ts`, `machine-computer.ts` | `phoneComputerTarget` mirroring `ownComputerTarget`; `managePhone` mirroring `manageComputer`; `phoneId` column on `computer_call` for the activity list |
| Panel | `apps/web/src/resources/phone-computer-panel.tsx` | Phones section on the local Mac's machine row: discovered devices with Pair, phone rows with state, Re-sign, Remove, and the call activity (the own-computer activity shape widened to the phone tools) |

## States and transitions

Merged panel state = f(phone row, reported `link`, in-flight call). `not_paired` is a reported device with no consented row; it is not a stored state.

|| State | Means | Enters | Leaves |
|---|---|---|---|
| `not_paired` | Probe reports `seen` or `unauthorized`, no consented row | Discovery; pair failure also returns here if the owner removes the row | Owner confirms consent → `pairing` |
| `pairing` | Consented row exists and a `phone_manage pair` call is in flight, or `link` is still `unauthorized`/`seen` | `POST /pair` (or first consent) | Call done and `link` `ready` → `ready`; call fails → stays `pairing` with `lastError` and a Retry affordance; owner removes → row gone |
| `ready` | `link` `ready` (Android: adb authorized; iOS: paired and WDA session live) | Probe report after pair or resign | `locked`, `unreachable`, `signing_expired` (iOS), `busy` while a call runs |
| `locked` | `link` `locked` (Android keyguard shown; iOS `GET /wda/locked` or session error) | Probe or a call result | `ready` on the next report; a `phone_*` call while locked returns the locked refusal |
| `busy` | `executionStepId` lease held by another step | Dispatch | Settle or lease expiry |
| `signing_expired` | `link` `signing_expired` (iOS only: provisioning profile expiry under threshold, or WDA launch fails with a signing error) | Probe or a failed call result | Daemon re-signs (`build-for-testing -allowProvisioningUpdates`); success → `ready`; failure keeps the state with `lastError` and a manual Re-sign button |
| `unreachable` | Consented row exists but `link` `offline` or the device is absent from the last report | Probe report | Back to the reported state on rediscovery |

`request_takeover` sets `handoffReason`/`handoffStepId`/`handoffRequestedAt` on the phone row, mirroring the computer handoff columns; while set, every `phone_*` call is refused (the owner may be typing a PIN — observes must not run either). The handoff route clears it, the held call returns "handed back". Phone tools are also refused in mail, memory-edit and report turns through the existing `refuseRestrictedTurnTool`.

## Discovery and pairing

The probe runs on a darwin runner every 30 s and right after each `phone_manage` call settles.

- Android: `adb mdns services` and `adb devices -l`. A Wireless-debugging service or an `unauthorized`/`offline` entry is a candidate. Pair: the owner opens "Pair device with pairing code" on the phone and types the 6-digit code and the dialog's `ip:port` into the Cairn panel; `POST /pair {code, endpoint}` dispatches `phone_manage {action:'pair'}`; the daemon runs `adb pair <ip>:<pairport> <code>` then `adb connect <ip>:<connport>` (the connection port comes from mDNS or the main Wireless debugging screen — the pairing dialog's port is not it). `adb pair` accepts the code on argv. USB cable plus "Allow USB debugging" is the fallback path to `ready`.
- iOS: `xcrun devicectl list devices`. A `paired`/`available` device is the candidate (ian's 15 Pro already is). Pair: `phone_manage {action:'pair'}` runs `xcodebuild -project <tools>/WebDriverAgent/WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner -destination 'platform=iOS,id=<udid>' -allowProvisioningUpdates build-for-testing`, then launches the runner and checks `GET /status`. WDA is a pinned source tree under the runner tools dir, fetched and sha256-verified like agent-desktop. During sessions the daemon reaches `http://<phone-wifi-ip>:8100` (devicectl reports the device on `localNetwork`); a usbmux forward is the fallback.
- Re-sign (iOS, free team): the probe parses `embedded.mobileprovision`'s `ExpirationDate` in the built runner; under 48 h, or when a WDA launch fails with a signing error, the daemon re-runs the same `build-for-testing` automatically and reports `signing_expired` until it succeeds.
- `phone_manage {action:'forget'}` runs `adb disconnect` for Android, stops the WDA process for iOS, then the row is deleted; open calls are cancelled first (the D8 off-path pattern).

## Tool surface

`phone_observe {phone, query?, apps?}` — whole-screen observe: numbered interactive elements from the tree (uiautomator XML on Android, WDA `/source` on iOS) plus a screenshot PNG fitted under the image cap, the same text-plus-image contract as `user_computer_observe`. `apps: true` returns the launchable app list (label and package/bundle id) instead, so `launch` has ids to take. `phone_act {phone, actions[]}` — at most 24 ordered actions, then a fresh observation, same shape as `user_computer_act`/`computer_act`: `tap {element}|{x,y}`, `long_press`, `drag {element|x,y → to_x,to_y}` / `scroll {direction,element?}`, `type {element,text}` or `{text}` into the focused field, `key {back|home|app_switch|enter|delete}` (Android keyevents; iOS maps `home` to `pressButton`, other keys are refused on iOS), `launch {id}` (`monkey -p` / `activateApp`), `wait {ms≤10000}`. Element numbers resolve to element center coordinates in the daemon; `x,y` are screenshot pixels. `phone` is the panel name; optional when exactly one consented phone is ready. `phone_manage {action, endpoint?, code?}` is panel-only — `forwardComputerCall` throws for it as for `computer_manage`.

Tool descriptions open with "The owner's real phone <name>, not your VM computer or their Mac", carry the ask rule below, and are offered only in owner-started turns while a consented phone is not `unreachable`/`signing_expired` (`phoneComputerOffered`, mirroring `ownComputerOffered`). Each call is stamped with `{phoneId, deviceId}` by the server (the `ownComputerGrant` stamp pattern); the daemon refuses an unstamped or mismatched call `not_delivered`.

## Approvals, consent and handoffs

- Gate: no phone call exists until the owner confirms the consent below on a per-device row. Owner threads only, same as the own Mac.
- Ask before acting (tool-description rule, the `browser_act` ask pattern): the model calls `ask_user` and waits for yes before any action that sends a message or mail, pays or orders, or changes a system or account setting. Every call is logged and visible; there is no mechanical per-action approval in this slice — the residual risk is the same as `browser_act`'s, and `action_proposal` is the upgrade path if it proves too weak.
- Always handed to the owner. Mechanically enforced: lock-screen PIN and passcode (the `locked` state refuses calls; the model calls `request_takeover`), and Android `FLAG_SECURE` windows (the observe comes back black or empty; the daemon appends a fixed `[secure screen]` marker and no image). Model-recognized, same handoff: Face ID and other biometric prompts and Apple Pay sheets — the tool description directs `request_takeover` on any system auth UI. `request_takeover {reason, phone?}` reuses `holdTakeover` against the phone row's handoff fields; the card is the phone variant — "Done on the phone" hands back, "Stop this step" ends it — with the same `sendMustReachAlert` push and 15-minute expiry. There is no screen control: the owner picks up the physical phone.
- `phone_act` on Cairn itself is refused (self-protection parity with the own Mac).

## Consent text (shown on pair, stored as consentAt/consentedBy)

> Pairing lets the Coordinator see and control this phone like a computer. Everything on its screen — private messages, photos, signed-in accounts — is captured as screenshots and element text and sent to the model provider, the same provider as your other Coordinator work. The agent asks before sending messages, paying or changing settings; the lock screen, Face ID and payment screens are always yours. You can remove the phone any time in Settings.

## Security

- New daemon command surface: `adb`, `xcodebuild`, `devicectl` spawn only from the phone drivers and `phone_manage` handlers, always `execFile` argv arrays — never `bash -c`. Every argv is built from the stamped `deviceId`, a validated `ip:port` and the 6-digit code (`^\d{6}$`); no model-supplied string reaches argv. Typed text goes to the helper on stdin, never argv.
- Single path: `user_computer_shell`'s hardline list gains the phone input surface — `adb` subcommands `shell input`, `shell app_process`, `push`, `install`, `pair`, `connect`, `disconnect`, `tcpip`, `forward`, `emu`; `xcrun devicectl` device-mutating verbs; `xcodebuild` invocations matching `WebDriverAgent`; `iproxy`/`tidevice`/`idev*` — so the agent cannot drive the phone around consent, state refusals or handoffs. `command-gate.ts` gains `ask` rules for the same shapes in worker shells (workers may legitimately use adb on emulators, so ask, not reject).
- Signing credentials: none stored by Cairn. The owner signs WDA with the Apple ID already in Xcode (personal team); the identity and profiles stay in the owner keychain and `~/Library`. The adb private key (`~/.android/adbkey`) is only used by `adb` itself; the pairing code rides the pair call's params and expires with the pairing attempt.
- Routes: `POST /api/machines/:id/phones*`, `DELETE`, and the handback route sit under the existing `/api/machines/` owner-only pattern; handlers additionally require an owner session and a `local` darwin machine, mirroring `routes-computers.ts`. GETs stay readable (reported state is already in machine reads). Phone tools are never offered to non-owner threads or info-card steps.
- Screenshots of a real phone reach the model provider: the consent is recorded before any call; without it the tools are not offered and every call returns the not-paired refusal.

## Failure behavior

|| State | Call behavior | Recovery |
|---|---|---|---|
| `not_paired` | Tools not offered; a call naming it returns "pair it in Settings, Computers" | Pair flow |
| `pairing` | Refused "pairing is still running"; a second `POST /pair` while one is in flight 409s | Settle, or Retry after failure; pair call itself has a 5-minute deadline |
| `ready` | Normal dispatch | — |
| `locked` | Refused "the phone is locked; ask the owner to unlock it (request_takeover)" | Probe or call result reports unlocked |
| `busy` | Calls from another step refused `COMPUTER_BUSY`-style text naming the holding step | Lease settle or expiry |
| `signing_expired` | Refused "the iPhone signature expired; re-sign runs automatically or from Settings" | Auto or manual re-sign → `ready` |
| `unreachable` | Refused "the phone is unreachable (offline; check Wi-Fi or cable)" | Next probe report; a mid-call drop ends the call `error`, `delivery: 'unknown'` |
| `handoff` set | All `phone_*` refused; the held takeover call returns handed-back or not-done at 15 min | Owner's handback press |
| Consent/row removed | Calls cancelled; tools stop being offered | — |

## Tests

One test per path, each red on the baseline first.

|| Path | Test |
|---|---|
| Migration | `phone` table and `computer_call.phoneId` exist after migrate |
| Probe parse | Fake adb/devicectl outputs map to the `link` states, including `unauthorized`, `offline`, `locked`, `signing_expired` |
| Consent gate | No row → tools not offered and observe refused; row without consent same |
| Pair route | Owner POST creates row + dispatches `phone_manage`; paired device, agent credential and non-owner each 403; a second in-flight pair 409s |
| Pair call (Android) | Fake `adb` records `pair`/`connect` argv exactly; wrong code → failed call, `lastError`, row kept |
| Pair call (iOS) | Fake `xcodebuild` records the `-allowProvisioningUpdates build-for-testing` argv; a signing-error exit marks `signing_expired` |
| Resign | Probe expiry < 48 h triggers one automatic build; manual `POST /resign` dispatches one call |
| Target resolution | `phoneComputerTarget` per refusal: non-owner thread, no consent, `locked`, `unreachable`, `signing_expired`, machine disconnected, ambiguous `phone` name, busy lease |
| Stamp | Unstamped or wrong-deviceId call → `not_delivered`, driver never spawned |
| observe mapping | Fake driver XML → numbered elements + image; secure screen → marker, no image |
| act mapping | Each action kind → exact adb argv / WDA request; element → center coordinate; `key` refused on iOS for names it has no button for |
| Handoff | `request_takeover {phone}` holds, refuses `phone_*` while held, returns on handback and on timeout |
| Forget | DELETE cancels open calls, dispatches `forget`, removes row; later calls refused |
| Shell bypass | `adb shell input tap` via `user_computer_shell` refused by the hardline; worker `adb pair` gets the `ask` verdict |
| Tool offer | `phone_*` offered only with consent, owner turn, non-dead state; report/mail turns refuse |
| Activity | Phone calls appear in the panel activity with tool, summary and thread |

## Owner setup, once per device

Pixel 8a: Settings → About phone → Build number ×7; Developer options → USB debugging, Wireless debugging, "Always allow on this network", and Stay awake while charging if long runs are expected. In Cairn: Settings, Computers → Pair on the Pixel row → confirm the consent → open "Pair device with pairing code" on the phone and enter the 6-digit code and `ip:port` it shows. Keep the phone unlocked while the agent works; adb cannot enter the PIN.

iPhone 15 Pro (Developer Mode and Wi-Fi pairing already done): Xcode → Settings → Accounts → sign in the Apple Account once. In Cairn: Pair on the iPhone row → confirm the consent → wait for the WDA build; on the phone, Settings → General → VPN & Device Management → trust the developer app, and Settings → Developer → UI Automation. Keep the phone unlocked while the agent works; "Automation Running" shows on it. A free account re-signs every 7 days — automatic.

## Limits

The agent drives the same screen the owner sees on both phones (no virtual display this slice). Wireless debugging needs re-pairing after reboot or Wi-Fi change; iOS needs the phone unlocked for WDA. Apps can detect or ban automation. A live phone screen in the computer panel is a later change; the takeover is physical.
