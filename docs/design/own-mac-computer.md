# The agent uses the owner's own Mac

Status: built for step 5 (E1–E6) of [`mac-vm-computer-acceptance.md`](mac-vm-computer-acceptance.md) with the owner decisions below; the live end-to-end check on a real Mac waits on the TCC grants. The "What exists" table describes the baseline before this work. Baseline `70d39fa29`. Reference: Rakazo `docs/computer.md` "Use your own computer" and `docs/approvals.md`. Related designs: [`machine-capability-defaults-and-folders.md`](machine-capability-defaults-and-folders.md) (grants live outside `capabilities`), [`host-permission-guidance.md`](host-permission-guidance.md) (the `hostPermissions` probe). Facts carry `实测` (read or run for this page), `推断` (follows from a measured fact) or `猜测` (unverified).

## What exists

| Piece | Fact |
|---|---|
| Driver | `AgentDesktopHostScreen` runs agent-desktop `1.3.1` per call; `createHostScreenFromEnv` builds it only when `CAIRN_OWN_COMPUTER=1`; binary from `CAIRN_AGENT_DESKTOP` or `~/.cairn/tools/agent-desktop/1.3.1/agent-desktop` (`apps/daemon/src/computer/host-screen.ts`, `实测`). |
| Capability | `ownComputer: true` is reported when `CAIRN_OWN_COMPUTER=1` built a `HostComputerProvider` (host shell), not when the screen is usable (`apps/daemon/src/machine-loop.ts`, `实测`). |
| TCC probe | `HostPermissionsProbe` runs `agent-desktop status` every 10 minutes and reports `hostPermissions.{accessibility,automation,screenRecording}` as `granted / not_required / denied / unknown`. It resolves the binary from `homedir()`, ignoring `CAIRN_AGENT_DESKTOP` (`apps/daemon/src/host-permissions.ts`, `实测`). In the Mac app the runner home is `userData/runner`, so probe and driver can disagree (`推断`). |
| Gate | `forwardComputerCall` calls `opts.ownComputerGate ?? refuseOwnComputerUntilGated`, which always throws 403. Four tests pass `ownComputerGate: () => {}` (`apps/server/src/services/machine-computer.ts`, `apps/server/test/machine-computer-forward.test.ts`, `computer-private-audience.test.ts`, `实测`). `selectTarget` sends `user_computer_*` to the first connected team machine with `ownComputer` (`实测`). |
| Offer | `user_computer_shell/observe/act` are withheld from the Coordinator; no tool definitions exist for them in `computer-tools.ts` (`实测`). |
| Self protection | `isDaemonProcess` refuses windows whose process descends from the daemon, and browser windows titled with a Cairn origin (`host-screen-self.ts`, `实测`). Cairn.app is the daemon's parent, not a descendant, so its own window is not refused (`推断`). The agent could click its own approval card. |
| Mac app runner | `startLocalRunner` spawns `process.execPath` (Cairn's Electron binary) with `ELECTRON_RUN_AS_NODE=1` and a fixed env; no own-computer variable (`apps/desktop/src/runner.ts`, `实测`). The updater downloads, checks a manifest sha256 and extracts with `ditto` (`updater.ts`, `实测`). IPC handlers accept only `fromOwnPage` callers (`main.ts`, `实测`). |
| Approvals | `action_proposal` stores cards with `decision allow-once / always / refuse`, `decidedBy`, `expiresAt`; `answerProposal` refuses non-owners for the browser-password action and refuses `always` (`实测`). The CloakBrowser card holds the turn by polling the DB every 500 ms up to `COMPUTER_HANDOFF_TIMEOUT_MS` (15 min), ending early when the step is no longer claimed or the signal aborts (`cloak-license.ts`, commits `77fccddac`, `c498eea0b`, `实测`). |
| Turn origin | Owner messages enqueue `trigger: 'user'` with `ownerMessageIds: [message.id]`; wakes, watches, mail and gate wakes prefix the prompt with `[wake:` and pass `ownerMessageIds: []`; orchestrated sends pass `ownerWords: false`, giving `[]`; channel greetings pass `[]` (`chief.ts`, `orchestrate.ts`, `实测`). The instance owner is the first user row (`instance-owner.ts`, `实测`). |

agent-desktop publication (`实测` via `gh release view v1.3.1 -R vercel-labs/agent-desktop`, the release's `checksums.txt`, the repo's CHANGELOG at tag `v1.3.1`):

- GitHub release `v1.3.1` (2026-11-13) ships `agent-desktop-v1.3.1-aarch64-apple-darwin.tar.gz` (sha256 `9b7b7cfc74892eab46c2c85d6cb7dc4863bf8dab0a222cfcfb8ae4604c69c86c`) and `agent-desktop-v1.3.1-x86_64-apple-darwin.tar.gz` (sha256 `469da10cfb68928c58caff88b92b30526e0ca895ac06bc86b7f533b1d9b309b3`), both matching the release's `checksums.txt` and the downloaded files (`实测`). Each archive holds `agent-desktop` and `agent-desktop-macos-helper` side by side with no nesting directory (`实测`); the pinned CLI digests are `9a6b0829736a486da532a9d1ceed1e07192fa8967326c7b27125646adab6baf7` (arm64) and `f762f8ed6a14b114f8a50b902205d3ecb6bcf554d8031f67abd7938af88663cb` (x64). The npm package has a `postinstall` script, which this repo forbids running unasked; use the release archive. The agent's VM image pins the same v1.3.1.
- Upgrade from 1.1.0 (CHANGELOG 1.2.0, 1.3.0, 1.3.1, `实测`): the commands `host-screen.ts` uses (`list-windows`, `snapshot`, `find`, `screenshot`, `click`, `type`, `set-value`, `press`, `scroll`, `status`, `version`) keep their flags and output fields; `type` and `set-value` gain an optional `--stdin`. The one breaking change, macOS `menu` and `menubar` snapshots no longer carry `data.window`, is not read by this repo. The helper name and the `status` permission shape are unchanged. A 1.1.0 install sits in its own versioned folder: the runner env now points at `1.3.1/`, the installer finds no matching digest there and installs 1.3.1 beside it, and the daemon reports `ownComputer` only after the 1.3.1 digest and version match, so an unchanged 1.1.0 folder never counts. The old folder is left in place.
- The macOS archive carries a helper, `agent-desktop-macos-helper`, that must sit beside the CLI (installation docs). Whether the tarball nests them in a directory is `猜测`; the installer checks both names.
- Signing: the release workflow has build-provenance attestation (`gh attestation verify`) and sha256 files, and no `codesign` or `notarytool` step. The binary is therefore not Developer ID signed; arm64 binaries carry the linker's ad-hoc signature (`推断`). Files written by Node `fetch` get no `com.apple.quarantine` attribute, so Gatekeeper does not assess them (`推断`, checked on a clean Mac during verification).
- macOS permissions: Accessibility for "the app that launches agent-desktop"; Screen Recording only for `screenshot`; Automation only where a command reports it. `permissions --guide` opens System Settings at the missing Accessibility or Screen Recording entry with a panel naming the app; `permissions` never prompts. A grant needs no restart (docs, `实测`). The launching app here is Cairn.app (`推断` from the runner spawn). A dev build's grant goes to `Electron` (`推断`). Whether Screen Recording needs a Cairn relaunch on current macOS is `猜测`.

## Decisions

**D1 Setting.** New column `machine.ownComputerEnabled` (boolean, not null, default false), one migration. It is a grant, so it stays out of `capabilities`, which presence overwrites. Written only by `PATCH /api/machines/:id` with `{ ownComputerEnabled }`; that path is already owner-only for paired devices (`OWNER_ONLY_PATTERNS`, `实测`), and the handler also rejects agent credentials and any user who is not the instance owner. No Coordinator tool writes it. Turning it on returns 409 unless the machine reports `ownComputerHost` (D2), so a Linux CLI daemon or a phone cannot switch on a host it cannot drive. The web switch lives in Settings, Computers, on the local Mac's row, with the E1 warning: the agent can read files and run programs as you.

**D2 Delivery to the runner.** Env, and only the binary path. On macOS `runnerEnv` sets `CAIRN_AGENT_DESKTOP=<runner home>/tools/agent-desktop/1.3.1/agent-desktop`. The switch itself is not delivered: the server sees every own-computer call before dispatch, so it is the one place the switch is read, and off takes effect without restarting the runner (an env switch needs a restart; a file switch needs a watcher and still races the server). One resolver, `agentDesktopBinary(env)`, serves the driver and the probe (fixes the probe path split above). The daemon builds the host screen whenever that path is set; `CAIRN_OWN_COMPUTER` keeps meaning the host shell provider only, which the Mac app does not set. The daemon reports `ownComputerHost: true` when the path is set, and `ownComputer: true` only when the file there hashes to the pinned binary digest (computed once at startup and when the file's mtime changes) and `agent-desktop version` answers `1.1.0`.

**D3 Install and verify.** The Mac app main process installs, because install and the System Settings walk need the owner present and the app's own TCC identity. New IPC handlers, own page only: `own-computer:install`, `own-computer:guide`, `own-computer:permissions`. Install: pick the archive by `process.arch`; download the pinned URL into a staging directory inside `<runner home>/tools/agent-desktop/`; compare sha256 to the pinned digest in `packages/shared`; extract with `/usr/bin/tar`; require `agent-desktop` and `agent-desktop-macos-helper`; run `<staged>/agent-desktop version`; rename into `1.3.1/`. Any failure removes staging and leaves the final path untouched; the IPC returns `network`, `checksum`, `archive`, `version` or `disk`. An existing install with the pinned binary digest is a no-op. The switch's web handler calls `install` right after a successful turn-on when running in the Mac app; outside the Mac app the panel says to finish setup in the Cairn app on that Mac. Turning off keeps the binary.

**D4 TCC.** Accessibility is required: without it agent-desktop cannot read or act (`实测` docs). Screen Recording is optional: `user_computer_observe` already returns text with `screenshot: unavailable` when capture fails (`实测` host-screen), so a missing grant degrades to text and the panel says so. Automation is not shown. `own-computer:guide` runs `<binary> permissions --guide`; `own-computer:permissions` runs `<binary> permissions` so the panel updates at once in the Mac app. The daemon probe refreshes every 30 s while Accessibility or Screen Recording is not `granted`, every 10 min otherwise, and immediately after a call ends with agent-desktop `PERM_DENIED`.

Panel states for the local Mac's row — the switch sits on the machine row itself; the state folds into the row's meta line, and expandable segments open an inline drawer under the row:

| State | Meta segment | Drawer |
|---|---|---|
| Off | none — the warning rides the switch's hover | — |
| On, not in the Mac app and no `ownComputerHost` | "Finish setup in the Cairn app" | not expandable |
| On, installing or verifying | "Installing agent-desktop" / "Confirming agent-desktop" | not expandable |
| On, install failed or not installed | "Install failed" / "agent-desktop not installed yet" | open by default: the reason from D3, Retry/Install |
| On, Accessibility not `granted` (or no report yet) | "Missing the Accessibility permission" | open by default: the D4 text, Open System Settings (guide), Check again |
| On, Screen Recording not `granted` | "Missing the Screen Recording permission" | open by default: the degraded text, same buttons, grants |
| On, ready | "{n} grants" or "No grants yet" | collapsed by default: the approval explainer plus this conversation's approvals with Revoke when any stand |

**D5 Approval rows.** Reuse `action_proposal` with `actionId 'user_computer.app'`, `targetId '<machineId>:<app key>'`, where the app key is the app name trimmed and lowercased, the same exact, case-insensitive match the driver uses for `app_name` (`实测`). `inputJson` binds `{ machineId, app, threadId, sessionId, stepId, toolCallId }`. The card (built like the browser-password card) names the app and the Mac and offers allow once / allow in this conversation / deny. `decision` gains the value `conversation`; `answerProposal` accepts it only for this action.

| Scope | Allows | Ends |
|---|---|---|
| Once | The one call that asked (`stepId`, `toolCallId`), including its replay | That call settles |
| This conversation | Any call for that app on that Mac from the same `threadId` and `sessionId` | Switch off, a new Coordinator session (rewind or fresh session), thread archive, revoke on the panel, or 24 h after the decision |
| Pending card | Nothing | Answer, the turn stops or ends, the switch goes off, or 15 min (`COMPUTER_HANDOFF_TIMEOUT_MS`), then `expired` |

Who may approve: the instance owner from an owner session. Paired-device sessions get 403, matching the CloakBrowser license route and grant writes. A grant row whose `decidedBy` is no longer the owner is ignored, like `hasBrowserPasswordGrant` (`实测`). The agent cannot approve: Cairn.app and any browser showing Cairn are never driven (D7), and no tool answers cards.

**D6 The gate replacing `refuseOwnComputerUntilGated`.** `ownComputerGate(deps, stepRow, thread, tool, params)` runs in `forwardComputerCall` before any `computer_call` row exists. `refuseOwnComputerUntilGated`, `OWN_COMPUTER_UNGATED_MESSAGE`, the `ownComputerGate` option and the four test overrides are deleted in the same change. Refusals return a tool result text (as `COMPUTER_NO_CLOAK_LICENSE` does) so the Coordinator can tell the owner why; nothing is dispatched. Checks in order:

| # | Case | Result |
|---|---|---|
| 1 | `user_computer_shell` | Refused: not offered in this step (host shell stays withheld) |
| 2 | No team machine has `ownComputerEnabled` | Refused: the owner has not turned on "Let the agent use this Mac" |
| 3 | Turn not owner-started: prompt starts with `[wake:` (routine, watch, mail, gate), `ownerMessageIds` empty (orchestrated, greeting), or `thread.userId` not the instance owner | Refused: only conversations the owner starts can use their Mac; names the trigger |
| 4 | More than one switched-on machine connected | Refused with their names; the owner turns off the others |
| 5 | Switched-on machine not connected | Refused: `COMPUTER_NOT_CONNECTED` |
| 6 | No `ownComputer` capability (agent-desktop missing or wrong digest) | Refused: agent-desktop is not installed on `<Mac>`; finish setup in Settings |
| 7 | `hostPermissions.accessibility` not `granted`, or absent | Refused: Cairn lacks Accessibility on `<Mac>` |
| 8 | App key is `cairn`, `electron` (dev build), or `system settings` / `system preferences` | Refused always: the agent does not drive Cairn or change its own permissions |
| 9 | No live grant for this app (D5) | Post the card (once per pending key), hold the call by polling every 500 ms; each poll repeats checks 2, 3 and 5. Approve: continue. Deny: refused, "the owner denied <App>; do not retry it in this conversation". Timeout or turn end: refused, "no answer" |
| 10 | Granted | Dispatch with `ownComputerGrant: { proposalId, app }` stamped on the call |

The daemon refuses `user_computer_observe/act` with `delivery: not_delivered` when the stamp is missing or its `app` key differs from `params.app` (an old server forwarded nothing, so only a new daemon on an old server fails closed). agent-desktop `PERM_DENIED` maps to the same text as check 7 and triggers a probe refresh.

**D7 Self protection.** `isOwnProcess` also returns true for any ancestor of the daemon process, so Cairn.app's windows are refused by process, not only by the name list in check 8.

**D8 Turning off.** `PATCH ownComputerEnabled=false` in one transaction: sets the column, marks that machine's `conversation` grants and pending cards `superseded`, and marks its open `user_computer_*` calls `cancelled`. After commit the server pushes a cancel frame for each such call on the machine stream; the daemon aborts the call's controller, which kills agent-desktop mid-batch (`run` uses the call signal, `实测`). A daemon without the frame learns at its next heartbeat (≤ 10 s, `COMPUTER_HEARTBEAT_MS`, `实测`). A held call (check 9) sees the switch on its next poll. New calls fail check 2 at once. Turning back on asks again for every app.

**D9 VM versus own Mac.** Keep the wire names: `computer_observe/act` are the VM computer, `user_computer_observe/act` the owner's Mac. Renaming would be a wire change that old daemons reject (`computerToolSchema` enum), and the shapes already differ: the VM tools take pixel coordinates from a screenshot; the Mac tools require `app` and act on observed element numbers. New tool definitions open with "The owner's own Mac, not your VM computer" and the VM ones with "Your VM computer, not the owner's Mac"; results start with `[owner's Mac: <App>]`. The Mac tools are offered only when a team machine has the switch on and `ownComputer`, and only in turns that pass check 3. The prompt line: use the VM computer by default; use the owner's Mac only when the owner asks for something that lives there (their apps, files or signed-in sessions), and never to reach a website the VM browser can open.

## States and transitions

| State | Values | Writer | Transitions |
|---|---|---|---|
| Switch | off, on | Owner via `PATCH /api/machines/:id` | off→on needs `ownComputerHost`; on→off runs D8 |
| Host and binary | `ownComputerHost`, `ownComputer` reported or absent | Daemon presence | Absent until the path is set; `ownComputer` appears after a verified install, disappears if the file changes |
| Install | idle, downloading, verifying, installed, failed(reason) | Mac app main | failed→downloading on Retry; installed is checked by digest on every start |
| TCC | per grant `granted / denied / unknown / not_required`, or no report | Daemon probe; Mac app reads directly | Refreshed by D4's schedule |
| App approval | pending, executed(once or conversation), refused, expired, superseded | Server gate posts; owner answers; D8 and D5 end it | pending→executed or refused by the owner; pending→expired by timeout or turn end; executed→superseded by switch off, new session, archive, revoke or 24 h |
| Call | not created, dispatched, running, done, cancelled | `forwardComputerCall`, daemon frames, D8 | Not created on every refusal; cancelled by switch off or turn stop |

## Paths and tests

One test per path; each is written to fail on the baseline first.

| Path | Reads or writes | Failure behavior | Test |
|---|---|---|---|
| Migration | Adds `ownComputerEnabled` | Default false on existing rows | Existing machine reads off after migrate |
| `PATCH /api/machines/:id` on | Writes switch | Paired device 403; agent credential 403; non-owner 403; no `ownComputerHost` 409; nothing written | One test per refusal plus owner success |
| `PATCH` off (D8) | Writes switch, grants, calls | Transaction rolls back as a whole | Off supersedes grants and pending cards, cancels an open call, pushes the cancel frame |
| `runnerEnv` | Sets `CAIRN_AGENT_DESKTOP` | n/a | Env carries the runner tools path on darwin |
| Binary resolver | Driver and probe path | One function | Probe and driver resolve the same path with `CAIRN_AGENT_DESKTOP` set |
| Capability report | `ownComputerHost`, `ownComputer` | Wrong digest or version omits `ownComputer` | A tampered binary drops `ownComputer` |
| Mac app install | Tools folder | Each failure leaves no final file and returns its reason | Checksum mismatch, missing helper, wrong version, and re-install no-op |
| Install IPC origin | n/a | Non-own page ignored | A foreign frame's `own-computer:install` does nothing |
| TCC probe schedule | `hostPermissions` | Unusable output drops the report | 30 s while denied, 10 min when granted, immediate after `PERM_DENIED` |
| Panel | Reads switch, capability, permissions, grants | n/a | Fixture per state in D4's table (web, real components) |
| Gate checks 1–8 | Reads switch, step, thread, capability, permissions | Refusal text, no `computer_call` row, no push | One test per row: shell, off, wake, mail, orchestrated, greeting, non-owner thread, two Macs, disconnected, no binary, no Accessibility, Cairn and System Settings apps |
| Gate check 9 | Writes a pending proposal, holds | Deny, timeout, turn stop, switch off mid-hold each end with no dispatch | Nothing pushed before approval; one test per ending |
| Approve once | Proposal executed once | A second call for the same app asks again | Once covers its own replay and not the next call |
| Approve conversation | Proposal executed conversation | Other thread, new session, 24 h, revoke each ask again | One test per boundary |
| Approver | `answerProposal` | Paired device and non-owner 403; `conversation` decision refused for other actions | Each refusal |
| Daemon stamp | Reads call stamp | Missing or mismatched app: `not_delivered` | Unstamped and wrong-app calls never start agent-desktop |
| Self protection | `isOwnProcess` | Refused | A window owned by the daemon's parent is refused |
| Cancel frame | Daemon aborts | Old daemon falls back to heartbeat | agent-desktop is killed mid-batch on the frame |
| Tool offer and prompt | Tool list per turn | Not offered when off or not owner-started | Offered only with switch on, `ownComputer` and an owner turn; descriptions keep the VM / Mac prefixes |
| End to end (verify, real Mac) | All | n/a | Switch on, install, grant via guide, ask for Finder, card, allow once, observe shows Finder; off mid-act stops it; a routine is refused |

## Risks

- An approved app can launch another app as a side effect (Finder opening Terminal). The next call on Terminal asks, but the launch already happened.
- An app named like an approved one would share its grant; the key is the name agent-desktop reports, not a bundle identifier, because `list-windows` output used today carries no bundle id (`实测` for the fields host-screen reads; whether agent-desktop can report one is `猜测`).
- The binary is not Developer ID signed; trust rests on the sha256 pinned in this repo, read from the GitHub release API.
- Rakazo also asks before saving memory after outside content entered the run; this design does not narrow a conversation grant after the agent reads a web page.

## Owner decisions (ian, 2026-11-17)

1. The gate replacing `refuseOwnComputerUntilGated` is approved for E6; the replacing commit records this approval.
2. "This conversation" grants do not expire by time or session: they last until the owner revokes them on the panel or turns the switch off. The panel lists every standing grant per Mac with a revoke control. This supersedes the 24 h and new-session ends in the grant table and transitions above.
3. Host shell is in scope: `user_computer_shell` is offered behind the same switch and gate, and every command asks the owner first (allow once, or always allow this exact command line on this Mac, revocable on the panel). Gate row 1 changes from "refused" to "approval required". The command runs as the owner in the Runner's own working folder, with the existing host command guard.

## As built (2026-11-17)

Where the build differs from the sections above, this list wins.

- The Mac app's Runner env carries `CAIRN_AGENT_DESKTOP` and also `CAIRN_OWN_COMPUTER=1`, because owner decision 3 offers the host shell; the server switch still gates both. The daemon reports `ownComputerShell` for the shell, `ownComputerHost` for the path and `ownComputer` for the verified binary. Check 6 for `user_computer_shell` reads `ownComputerShell`; checks 6 to 8 for observe and act read `ownComputer`, Accessibility and the app name.
- A shell call that names `cwd` is refused; the command line the owner approves is the whole command. Command grants key on `sha256(command)` per Mac.
- "This conversation" grants are keyed by thread only (decision 2); no session or time end. Revoking marks the grant `superseded`.
- The daemon refuses an unstamped or mismatched call for all three own-Mac tools, not only observe and act.
- The D9 prompt line lives in the own-Mac tool descriptions. The in-server runtime offers the tools per turn and reopens a thread when the offer changes between turns.
- Owner-Mac cards create no wake subscribers: the held call is the answer's only reader.
