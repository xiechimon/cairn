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

**Desktop.** On by default means orb desktop tools (`computer_observe`, `computer_act`, `shell`, orb file tools) may run without the user holding a lease. That is already true when a computer row exists. Add a nullable machine override, default on when `capabilities.computer` is true, so the owner can turn it off. Do not hold the user lease by default: that lease blocks the agent (`COMPUTER_USER_CONTROL`). Do not lift `refuseOwnComputerUntilGated`, and do not start the host provider without `CAIRN_OWN_COMPUTER=1`. The panel label promised host app control; the code took a user lease. This page follows the code.

**Off switch.** Owner session only. Durable home is the settings machine page (`apps/web/src/resources/machine-detail-pane.tsx`), through new fields on `PATCH /api/machines/:id` (`apps/server/src/routes-resources.ts`). No Coordinator tool. The current panel switches, while they still exist on main, write the same grant. After #3924 merges, the access tab `Agent 的权限` binds those endpoints. This page does not edit that panel. An implementation branches from main and must not be based on #3924.

**Daemon.** The server stamps the current grants on the `computer` stream call (`packages/shared/src/protocol/computer.ts`, `packages/shared/src/protocol/machine-wire.ts`). `apps/daemon/src/computer/dispatch.ts` refuses browser tools and orb desktop tools when the stamp is missing or off, with `delivery: not_delivered`. An in-flight call finishes. Zod strips unknown fields, so an old daemon ignores the stamp until it is upgraded. A new daemon against an unstamped server fails closed. Ship the stamp and the check together.

**Folders.** New `machine.folderGrants` column, not a capabilities field. The daemon reports `workspacesDir` and owner-pinned paths it can `stat`. It does not scan the home directory. Fixture paths such as `~/Code` are examples, not a discovery list. Store canonical absolute paths. `~` is display only. `workspacesDir` is always enabled and cannot be turned off, because the step cwd falls back under it. Extra roots default disabled. A project's `localPath` stays a per-step source, not a machine-wide grant.

**Enforce.** One predicate. `command-gate.ts` is the pi call site and the only live tool gate, so it is the first enforcement point. It is not a sandbox. A path the predicate cannot resolve, a symlink whose real path leaves the grant, or substitution in a path operand is denied and nothing runs. Claude Code and ACP must call the same predicate before an extra root can show `已开放`. Until they do, and until a Linux step launch can bind that root in `confine.ts`, enable of a path outside `workspacesDir` returns 409 and the row stays disabled. macOS stays there while confinement is `not-applicable`. Orb computer files are a container filesystem, not a host folder grant. Host computer tools stay on the existing refuse.

## States and transitions

| State | Values | Transitions |
|---|---|---|
| Capability | reported or absent | Daemon report only. A parsable report replaces `browser`, `computer` and `ownComputer`. The owner cannot write it. |
| Browser grant | null, on, off | Null follows capability. Owner sets on or off. Off wins over a later report. |
| Desktop grant | null, on, off | Same, against `capabilities.computer`. Does not change `controlHolder`. |
| User lease | none, user, bot | Unchanged. Acquire, renew, release, or expiry returns to none. A live user lease still blocks agent mutation. |
| Folder row | path, enabled, absent | Report upserts a confirmed path. A path that disappears is kept, marked absent, and not enabled. Owner enable only when every enabled runtime can enforce it. Disable always works. |

## Paths, failures, and the first test

The table is the implementation contract. It is not a list of endpoints that exist today.

| Path | Reads or writes | On failure | First test |
|---|---|---|---|
| Daemon `capabilitiesReport` on enroll and presence | Writes the capability report | Probe error omits the flag; a parsable report without `browser: true` clears it | presence report without `browser` clears a stored `browser` flag |
| `markPresence` | Writes capabilities; must not write grants | Unparsable capabilities leave grants and browser flags untouched | a folder toggle survives the next presence |
| `forwardComputerCall` browser branch | Reads browser grant and capability | 403, no dispatched call | null grant on a capable machine proceeds; explicit off returns 403 |
| `dispatch.ts` browser and orb desktop tools | Reads the call stamp | Missing or off stamp: error frame, nothing ran | daemon refuses a browser call with no stamp |
| `POST` and `PATCH /api/computers` | Writes the machine grant and mirrors `browserEnabled` for one release | Mirror write cannot override an explicit machine off | old panel off still 403s the next browser tool |
| Settings `PATCH /api/machines/:id` | Writes grants | Unknown or other-team machine 404; agent credential rejected; on while capability is absent returns 409 and writes nothing | agent credential cannot patch the grant |
| Control lease acquire, renew, release, expiry | Writes lease columns | Unchanged 409s | desktop grant on still 409s while the user lease is live |
| `refuseOwnComputerUntilGated` | Reads no new grant | Still 403 | `user_computer_*` stays 403 with desktop grant on |
| Daemon folder report | Writes reported paths | Non-canonical, unstatable, or symlink-escaping path is dropped | `..` and a symlink escape are not stored |
| Owner folder enable | Writes `enabled` | 409 when a runtime cannot enforce; row stays disabled | enable outside `workspacesDir` is 409 while Claude Code does not call the predicate |
| `command-gate.ts` on pi `tool_call` | Reads grants and the step cwd | Unresolvable path or realpath outside an enabled root: block | `cat` beside `workspacesDir` is blocked; the step cwd is not |
| Step cwd in `runner.ts` | Reads `workspacesDir` and `localPath` | Prepare failure fails the step as today | folder grants do not move the step cwd |
| `launchConfined` preflight | Does not read folder grants | Unchanged | a grant does not mark confinement ready |

## Risks

Treating existing `browserEnabled=false` as unset turns the browser on for every capable computer left at the default. An intentional off, if any, is indistinguishable and would be lost. A daemon that has not been upgraded does not enforce a new off until it restarts onto the build that reads the stamp. A `已开放` row before every runtime enforces the predicate would be a false grant. A Coordinator tool for these grants would let the agent widen its own boundary.

## Open decisions for the owner

1. Accept treating existing `browserEnabled=false` as unset, so capable machines turn on. Keeping them off misses the default.
2. Confirm desktop-on means orb desktop tools, not host `user_computer_*` and not a standing user lease.
3. Confirm extra-folder enable stays 409 until every enabled runtime calls the predicate and, on Linux, step launch can bind the root. A pi-only check is rejected here.

## Out of scope

The host-computer approval gate, Seatbelt, edits to #3924, ticking the to-do list, and any change to the user takeover lease protocol.
