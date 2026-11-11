# Machine capability defaults and folder grants

Status: proposal for the owner's review. Nothing here is built. Owner route. Baseline `7299c658e` on `origin/main`. Does not edit #3924. Prior art already in this repo: `docs/research/user-computer-model-2026-11-08.md`, `docs/design/linux-harness-confinement.md`, and class three in `docs/design/ai-native-actions.md` (the agent does not change its own boundary). No new research file: this page is the ask, checked against that baseline.

## Problem

The home redesign drops the computers-panel switches `桌面控制` and `浏览器`. The owner wants agent browser and desktop use on by default, a place to turn each off, and a daemon check. G2 also needs the folders an agent may use on a machine reported, stored and enforced, including in `apps/daemon/src/backend/command-gate.ts`.

## What the baseline does

These are three mechanisms, not one switch.

| Mechanism | Today | Where |
|---|---|---|
| Capability report | Enroll and presence replace `machine.capabilities`. `browser` is set only when an orb computer exists and the image marker contains the pinned agent-browser version. `ownComputer` is set only when `CAIRN_OWN_COMPUTER=1`. `computer` means an orb computer provider exists. | `apps/daemon/src/machine-loop.ts` (`capabilitiesReport`), `apps/daemon/src/orb/computer.ts` (`computerImageOffersBrowser`), `apps/server/src/services/machines.ts` (`markPresence`, `mergeReportedCapabilities`) |
| Browser grant | `computer.browserEnabled` defaults false. Agent `browser_*` calls return 403 unless that row is true and the machine still reports `capabilities.browser`. The daemon does not re-check. | `apps/server/src/db/schema.ts`, `apps/server/drizzle/0132_computer_browser_enabled.sql`, `apps/server/src/services/machine-computer.ts` (`forwardComputerCall`), `apps/daemon/src/computer/dispatch.ts` (`handleBrowser`) |
| Desktop switch | The panel switch acquires a user control lease (`controlHolder=user`, 30 minutes). A live user lease makes agent mutation return 409. It does not grant the desktop. Host tools `user_computer_*` stay refused until a separate approval gate. | `apps/web/src/board/machines-panel.tsx`, `apps/server/src/services/computer-control.ts`, `apps/server/src/services/machine-computer.ts` (`refuseOwnComputerUntilGated`, `acquireExecutionLease`) |

No folder list is stored. A step cwd is the prepared worktree or `join(workspacesDir, convId)` (`apps/daemon/src/runner.ts`, `apps/daemon/src/config.ts`). `command-gate.ts` is wired only into the pi backend and matches bash text plus permission-rule slots. It does not see file-tool paths. Claude Code and ACP do not call it. `launchConfined` runs the availability preflight only (`apps/daemon/src/backend/confinement-availability.ts`); it does not wrap a step. macOS confinement is `not-applicable`.

A parsable presence report that omits `browser: true` clears a stored `browser` flag, because `mergeReportedCapabilities` keeps hardware, platform and confinement, not `browser`, `computer` or `ownComputer`. An omitted or unparsable `capabilities` field does not clear those flags. Owner grants must not live in that blob.

## Recommendation

**Browser.** Add a nullable machine override. Do not give `browserEnabled` a new meaning. Null means on when `capabilities.browser` is true, and off otherwise. Explicit off stays off after the capability returns. Map an existing `browserEnabled=true` row to explicit on for that machine. Treat existing false as unset: false is the column default and cannot be told from an intentional off. Capable machines therefore turn on. That behavior change is an open decision below.

**Desktop.** On by default means the agent may use the orb desktop without the user holding a lease. Add a nullable machine override, default on when `capabilities.computer` is true, so the owner can turn it off. Do not hold the user lease by default: that lease blocks the agent (`COMPUTER_USER_CONTROL`). Do not lift `refuseOwnComputerUntilGated`, and do not start the host provider without `CAIRN_OWN_COMPUTER=1`. The panel label promised host app control; the code took a user lease. This page follows the code, and it does not pretend `computer_observe` and `computer_act` already run. `ORB_TOOLS` in `apps/daemon/src/computer/dispatch.ts` is shell, file, and browser tools only. `handle()` sends screen calls only for `user_computer_observe` and `user_computer_act`. The two orb names return `NO_COMPUTER_PROVIDER_MESSAGE`. The implementation adds an orb route for them, not a host-screen fallback, and tests that a granted call is delivered and an off grant never reaches the daemon.

**Off switch.** Owner session only. Durable home is the settings machine page (`apps/web/src/resources/machine-detail-pane.tsx`), through new fields on `PATCH /api/machines/:id` (`apps/server/src/routes-resources.ts`). That path is already owner-only (`OWNER_ONLY_PATTERNS` in `apps/server/src/lib/token-auth.ts`). No Coordinator tool. The current panel switches, while they still exist on main, write the same grant through `POST` and `PATCH /api/computers`. Those routes are not owner-only today, so a paired-device session can call them. The compatibility writers must require the owner the same way, and a paired-device call returns 403 and writes nothing. After #3924 merges, the access tab `Agent 的权限` binds those endpoints. This page does not edit that panel. An implementation branches from main and must not be based on #3924.

**Server and daemon.** `forwardComputerCall` rejects a newly submitted browser call, or an orb desktop call (`shell`, `write_file`, and `computer_observe` or `computer_act` once that route exists), when that grant is off or the capability is absent, before any dispatch. A call already in flight may finish. The server also stamps the grants on the `computer` stream call (`packages/shared/src/protocol/computer.ts`, `packages/shared/src/protocol/machine-wire.ts`). `apps/daemon/src/computer/dispatch.ts` refuses when the stamp is missing or off, with `delivery: not_delivered`. Zod strips unknown fields, so an old daemon would still run a call the server had forwarded. The server rejection is what makes off take effect during a rolling upgrade. A new daemon against an unstamped server fails closed.

**Folders.** New `machine.folderGrants` column, not a capabilities field. The daemon reports `workspacesDir`. It does not scan the home directory. Fixture paths such as `~/Code` are examples, not a discovery list. An extra path starts as an owner pin: `PATCH` stores it pending and not enabled. Presence today answers `{ ok: true }` (`machineOkResponseSchema`). That response carries all pending and confirmed pins on every presence, including after daemon restart. The daemon re-stats each pin and reports its canonical path and status on the next presence, separate from capabilities. A confirmed root that disappears or can no longer be resolved becomes absent and is disabled; if it returns, it must be re-confirmed and explicitly enabled by the owner. An old daemon that ignores the list leaves the pin pending, so it cannot be enabled. Store canonical absolute paths. `~` is display only. `workspacesDir` is always enabled and cannot be turned off, because the step cwd falls back under it. A project's `localPath` stays a per-step source, not a machine-wide grant.

**Enforce.** `command-gate.ts` is a required pi call site and is not the boundary. A script under an allowed root can read any other path without putting that path in a tool argument. A folder is enforced only when every enabled runtime is inside a filesystem boundary that can express the grant. On Linux that boundary is a step launch through `confine.ts`, which today runs only the availability preflight. macOS confinement is `not-applicable`, and Seatbelt is out of scope, so an extra root cannot be enabled there. Until that boundary exists, enable of a path outside `workspacesDir` returns 409, the row stays disabled, and the panel must not show `已开放`. Once the boundary exists, the predicate still denies an unresolvable path, a symlink whose real path leaves the grant, or substitution in a path operand. Orb computer files are a container filesystem, not a host folder grant. Host computer tools stay on the existing refuse.

## States and transitions

| State | Values | Transitions |
|---|---|---|
| Capability | reported or absent | Daemon report only. A parsable report replaces `browser`, `computer` and `ownComputer`. The owner cannot write it. |
| Browser grant | null, on, off | Null follows capability. Owner sets on or off. Off wins over a later report. |
| Desktop grant | null, on, off | Same, against `capabilities.computer`. Does not change `controlHolder`. |
| User lease | none, user, bot | Unchanged. Acquire, renew, release, or expiry returns to none. A live user lease still blocks agent mutation. |
| Folder pin | pending, confirmed, rejected, absent | Owner `PATCH` creates pending. Every presence response carries pending and confirmed pins. Daemon confirmation moves pending to confirmed or rejected. A later failed stat moves confirmed to absent and disables it; a returning path must be re-confirmed and explicitly enabled. |

## Paths, failures, and the first test

The table is the implementation contract. It is not a list of endpoints that exist today.

| Path | Reads or writes | On failure | First test |
|---|---|---|---|
| Daemon `capabilitiesReport` on enroll and presence | Writes the capability report | Probe error omits the flag; a parsable report without `browser: true` clears it | presence report without `browser` clears a stored `browser` flag |
| `markPresence` | Writes capabilities; must not write grants | Unparsable capabilities leave grants and browser flags untouched | a folder toggle survives the next presence |
| `forwardComputerCall` for browser and orb desktop tools | Reads the matching grant and capability | 403, no dispatched call | null grant on a capable machine proceeds; explicit desktop off returns 403 before dispatch |
| `dispatch.ts` browser, shell, file, and the new orb observe and act route | Reads the call stamp | Missing or off stamp: error frame, nothing ran | daemon refuses a desktop call with no stamp; `computer_act` is not `NO_COMPUTER_PROVIDER_MESSAGE` when the grant is on |
| `POST` and `PATCH /api/computers` | Writes the machine grant and mirrors `browserEnabled` for one release | Paired-device session 403 and writes nothing; a mirror write cannot override an explicit machine off | paired-device off-to-on is 403 and the grant stays off |
| Settings `PATCH /api/machines/:id` | Writes grants | Unknown or other-team machine 404; agent credential rejected; on while capability is absent returns 409 and writes nothing | agent credential cannot patch the grant |
| Control lease acquire, renew, release, expiry | Writes lease columns | Unchanged 409s | desktop grant on still 409s while the user lease is live |
| `refuseOwnComputerUntilGated` | Reads no new grant | Still 403 | `user_computer_*` stays 403 with desktop grant on |
| Presence response pin list | Server writes pending and confirmed pins on every presence; daemon reads them | An old daemon ignores the optional list; the pin stays pending and enable returns 409 | adding the optional list still parses as `{ ok: true }` for a daemon that does not know the field; confirmed pins remain in the list after restart |
| Daemon folder report | Writes confirmed, rejected, or absent and disables absent pins | Non-canonical, unstatable, or symlink-escaping path is not confirmed; a previously confirmed root becomes absent and disabled | `..` and a symlink escape are not confirmed; a confirmed root removed after restart becomes absent and disabled on the next report |
| Owner folder enable | Writes `enabled` | 409 unless the path is confirmed and step launch can bind it; row stays disabled | enable outside `workspacesDir` is 409 while step launch does not call `launchConfined` |
| `command-gate.ts` on pi `tool_call` | Reads grants and the step cwd | Unresolvable path or realpath outside an enabled root: block | `cat` beside `workspacesDir` is blocked; the step cwd is not |
| Step cwd in `runner.ts` | Reads `workspacesDir` and `localPath` | Prepare failure fails the step as today | folder grants do not move the step cwd |
| `launchConfined` preflight | Does not read folder grants | Unchanged | a grant does not mark confinement ready |

## Risks

Treating existing `browserEnabled=false` as unset turns the browser on for every capable computer left at the default. An intentional off, if any, is indistinguishable and would be lost. An old daemon still runs a desktop call the server forwards, which is why the server rejects before dispatch. A `已开放` row before step launch is confined would be a false grant. A Coordinator tool for these grants would let the agent widen its own boundary.

## Open decisions for the owner

1. Accept treating existing `browserEnabled=false` as unset, so capable machines turn on. Keeping them off misses the default.
2. Confirm desktop-on means orb desktop tools, not host `user_computer_*` and not a standing user lease.
3. Confirm extra-folder enable stays 409 until step launch confinement can bind the root for every enabled runtime. A command-gate check alone is rejected here.

## Out of scope

The host-computer approval gate, Seatbelt, edits to #3924, ticking the to-do list, and any change to the user takeover lease protocol.
