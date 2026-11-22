# Machine capability defaults and folder grants

Status: superseded by the owner on 2026-11-20. Browser and desktop control are always on where a machine reports the capability, the agent may use any path on the machine, and the own-Mac action log lives only in the daemon log; the grant columns, folder grants and their settings rows were removed. The dangerous-command gate in `apps/daemon/src/backend/command-gate.ts` still applies. What follows is the historical design.

## Problem

Computer control is on by default for capable machines and explicit owner overrides win. The capability report, the nullable grants, the dispatch gate and the owner-Mac approval stamps were already in place; four gaps let parts of the system disagree about whether the computer is usable:

1. `teamHasVmComputer` checked only `capabilities.computerKind === 'vm'`, so with `desktopOverride: false` the Coordinator was still offered `shell`, `install_packages` and `request_cloak_license`, and each call then failed inside the turn.
2. The owner-claimed (in-server) Coordinator turn built its tool list with the grant-aware options, while the Runner-claimed chief payload called `coordinatorToolDefs()` with no options, so the same turn offered different computer tools depending on who ran it.
3. Owner-Mac calls carry an `ownComputerGrant` stamp the daemon verifies, but orb calls (shell, files, desktop, browser, `install_packages`) carried nothing the daemon could check, so the grant decision lived only in the server.
4. The two grants were writable only through `PATCH /api/machines/:id` and the compatibility `POST`/`PATCH /api/computers` routes; the settings machine row showed no computer grant controls.

## Mechanisms

These are separate mechanisms, not one switch.

| Mechanism | Behavior | Where |
|---|---|---|
| Capability report | Enroll and presence replace `machine.capabilities`. `computer` is set when an orb/host-desktop provider exists; `browser` when the desktop image offers agent-browser; `computerKind` is `vm` or `host`; `ownComputer*` flags mark the owner's Mac. A parsable report replaces these flags; an absent one keeps them. Owner grants are not in the blob. | `apps/daemon/src/machine-loop.ts` (capability report), `apps/server/src/services/machines.ts` (`markPresence`, `mergeReportedCapabilities`) |
| Browser grant | `machine.browserOverride`: `null` follows `capabilities.browser`, `false` is off, `true` is explicit on (still needs the capability). | `apps/server/src/db/schema.ts`, `apps/server/src/services/machine-computer.ts` (`machineAcceptsTool`, `assertMachineGrant`) |
| Desktop grant | `machine.desktopOverride`: `null` follows `capabilities.computer`, `false` is off, `true` is explicit on. | Same, plus `teamOffersDesktop`, `teamHasVmComputer`, `ensureCoordinatorComputer`, `infoComputerHosts` |
| Browser mirror | `computer.browserEnabled` mirrors the machine grant for the compatibility routes; a mirror write cannot undo an explicit machine off (409). | `apps/server/src/services/computer-feed.ts` (`compatibilityBrowserEnabled`, `setComputerBrowserEnabled`, `ensureComputerBrowserEnabled`) |
| User control lease | `controlHolder`/`controlLeaseExpiresAt` on `computer`: the owner taking the screen blocks agent mutation calls (409), read-only calls still run. Unrelated to the grants. | `apps/server/src/services/computer-control.ts`, `machine-computer.ts` (`acquireExecutionLease`, `acquireBrowserLease`, `handoffRefusal`) |
| Owner-Mac switch and stamps | `machine.ownComputerEnabled` plus `capabilities.ownComputer*` gate the `user_computer_*` offer and route; every forwarded call carries `ownComputerGrant` (`proposalId`, `key`) which the daemon re-verifies against `ownComputerGrantKey(tool, params)`. | `apps/server/src/services/own-computer.ts`, `packages/shared/src/protocol/own-computer.ts`, `apps/daemon/src/computer/dispatch.ts` (`ownerGrantMissing`) |
| Orb call stamp | Every call the server pushes to a scope computer carries `computerGrant: 'browser' \| 'desktop'`, computed from the same branch `machineAcceptsTool` used at selection time. The daemon refuses an orb tool whose stamp is missing or mismatched with `not_delivered`. | `computerCallSchema.computerGrant`, `machine-computer.ts` (`forwardComputerCall`, `holdPackageInstall`), `dispatch.ts` (`orbGrantNeeded`) |
| Folder grants | `machine.folderGrants`: `workspacesDir` always on; extra pins pending → confirmed → enabled only while step launch can bind them (enable stays 409 otherwise); absent roots disable and must be re-confirmed. | `machine-loop.ts`, `apps/server/src/services/machine-folders.ts`, `apps/daemon/src/backend/command-gate.ts`, `apps/web/src/resources/folder-grants-panel.tsx` |

## Tool surface

`coordinatorToolDefs(options)` is the single definition. `COMPUTER_REMOTE_TOOLS` (browser + `request_takeover`) is always offered; `COMPUTER_DESKTOP_TOOLS` needs `desktopTools`, `COMPUTER_VM_TOOLS` needs `vmComputer`, `request_secret` is always offered (`docs/design/secret-request-card.md`), `OWN_COMPUTER_TOOLS` needs `ownComputer`. Both chief-turn constructors compute the same options:

- In-server turn (`apps/server/src/coordinator/index.ts`, `claimedPayload`) and Runner claim (`apps/server/src/services/machine-claim.ts`, `chiefClaimPayload`): `desktopTools: teamOffersDesktop(db, teamId)`, `vmComputer: teamHasVmComputer(db, teamId)`, `ownComputer: ownComputerOffered(db, threadId, stepId)`.
- `teamHasVmComputer` means a machine reports `capabilities.computer === true` and `capabilities.computerKind === 'vm'` and has not `desktopOverride === false`, so the VM tools are offered exactly when their calls can run.
- `teamHasVmBrowser` means a VM-kind machine keeps `capabilities.computer === true` and `capabilities.browser === true` with `browserOverride !== false`: stealth browser calls can still need a CloakBrowser license there, so the license card stays offered even when the desktop grant is off.
- `chiefRemoteTools` in `routing-rules.ts` keeps the bare `coordinatorToolDefs()` list on purpose: it feeds `toolDefHashes`, which must name every tool a thread could ever see, not the subset of this turn.

Mail turns and memory-edit turns are locked and keep their own tool sets unchanged.

## Grant checks and stamps

Server side, before any dispatch:

- `selectTarget` filters the fleet by `capabilities.computer === true` and the connected machines by `machineAcceptsTool(row, tool)` (browser tools read the browser grant, everything else the desktop grant), then `assertMachineGrant` rejects 403 on explicit off or missing capability.
- `forwardComputerCall` rejects `computer_manage` and `browser_close_tab` (panel- and server-owned), gates `user_computer_*` through `ownComputerGate`, routes `request_takeover` and `install_packages` to their hold loops, and applies the browser-secret and license extras. Every call that reaches `pushComputer` for a scope computer is stamped `computerGrant`; `holdPackageInstall` stamps `desktop` on the approved install call.
- `manageComputer` and `closeInfoCardTab` push `computer_manage` and `browser_close_tab` without a stamp: owner lifecycle and server-initiated cleanup are not grant decisions. Revoking the desktop grant must not strand the VM so it cannot be stopped or deleted.
- `PATCH /api/machines/:id` writes the grants owner-session-only; `browserOverride`/`desktopOverride: true` returns 409 without the matching capability and writes nothing. Paired devices and agent credentials cannot write.
- `GET /api/computers` runs `ensureCoordinatorComputer`, materializing the Coordinator computer row on a capable, granted, connected machine — this is what makes default-on visible in the Computers panel.

Daemon side, `handle()` in `apps/daemon/src/computer/dispatch.ts`:

1. `ownerGrantMissing` — a `user_computer_*` call without a stamp matching `ownComputerGrantKey` is refused `not_delivered` (`NO_OWNER_GRANT_MESSAGE`).
2. `orbGrantNeeded` — `install_packages` and every `ORB_TOOLS` member needs a stamp: `browser_*` tools need `'browser'`, the rest need `'desktop'`. Missing or mismatched is refused `not_delivered` (`NO_COMPUTER_GRANT_MESSAGE`). `computer_manage`, `browser_close_tab`, `request_takeover`, `attach_file`, `open_path` and `launch_app` need no stamp; the last five still fail routing without a provider.
3. Provider/scope, guard, params and deadline checks run as before.

Zod strips unknown fields, so an old daemon ignores `computerGrant` and runs as before; the server rejection is what makes off take effect during a rolling upgrade. A new daemon against a server that does not stamp fails closed: unstamped orb calls are refused `not_delivered`, matching the `ownComputerGrant` rollout.

## States and transitions

| State | Values | Transitions |
|---|---|---|
| Capability | reported or absent | Daemon enroll/presence report only. A parsable report replaces the flag; absence keeps it. The owner cannot write it. |
| Browser grant | `null`, `true`, `false` | `null` follows `capabilities.browser`. Owner session sets `true`/`false`/`null`; `true` needs the capability at write time. `false` wins over a later report. Compatibility mirror writes set `true`/`false`, and cannot clear an explicit `false`. |
| Desktop grant | `null`, `true`, `false` | Same, against `capabilities.computer`. Does not change `controlHolder`. |
| Computer row | absent or `stopped`/`starting`/`running`/`failed` | `GET /api/computers` or first dispatch creates it only while the desktop grant resolves on; the row persists through grant-off so the grant stays visible and reversible. |
| User lease | `none`, `user`, `bot` | Acquire, renew, release, expiry. A live user lease still blocks agent mutation (409), independent of the grants. |
| Owner-Mac switch | `ownComputerEnabled` | Owner toggle; off withholds the offer and refuses the gate. |
| Owner-Mac call stamp | `{proposalId, key}` | Created by `ownComputerGate` from an approval proposal; daemon re-derives `key` from the call and refuses a mismatch. |
| Folder pin | `pending`, `confirmed`, `rejected`, `absent` | Owner `PATCH` creates pending; presence round-trip confirms/rejects; a vanished root becomes absent and disabled; reappearance needs re-confirmation and explicit enable. |

## Paths and failures

| Path | Reads or writes | On failure |
|---|---|---|
| Daemon capability report (enroll, presence) | Writes `machine.capabilities` | Probe error omits the flag; a parsable report without `browser: true` clears it |
| `markPresence` | Writes capabilities; never writes grants | Unparsable `capabilities` leaves grants and flags untouched |
| `PATCH /api/machines/:id` | Writes grants | 404 unknown/other-team machine; 403 paired device or agent credential; 409 explicit `true` without the capability, writes nothing |
| `POST`, `PATCH /api/computers` | Writes the machine grant plus the `browserEnabled` mirror | Owner session required; mirror on cannot undo explicit `false` (409); `browserEnabled: true` without `capabilities.browser` is 404/409 |
| `teamOffersDesktop`, `teamHasVmComputer` | Read grants + capabilities | Return false; the tool surface withholds the offer |
| `chiefClaimPayload` (Runner claim) | Reads grants via the same helpers | Same options as the in-server path; locked turns unchanged |
| `selectTarget` / `assertMachineGrant` | Reads grants + capabilities + connectivity | Grant off or capability absent: 403 before any dispatch; no connected candidate: 409; no capable machine: error text |
| `forwardComputerCall` / `holdPackageInstall` | Stamps `computerGrant` on every pushed orb call | Grant off at call time throws before the push; the call row is not created |
| `dispatch.ts handle` | Reads `computerGrant` / `ownComputerGrant` | Missing/mismatched stamp: error frame `not_delivered`, nothing ran, provider untouched |
| `ownComputerGate` + daemon `ownerGrantMissing` | Creates and re-verifies owner-Mac stamps | Missing, wrong-app or wrong-command stamp: refused `not_delivered` |
| `GET /api/computers` → `ensureCoordinatorComputer` | Reads grant + capability + connectivity | No eligible host: no row, panel shows nothing |
| Settings machine row grant switches | Writes `browserOverride`/`desktopOverride` via `PATCH` | PATCH failure toasts and the switch rolls back with the query refresh |
| Control lease | Writes lease columns | Unchanged 409s; desktop grant on still 409s mutation while the user lease is live |

## Settings UI

The settings machine row (`apps/web/src/resources/machine-row.tsx`) renders capability affordances through meta chips and drawers (`ownComputer`, folder grants). The computer grants follow the same pattern in `apps/web/src/resources/computer-grants-panel.tsx`: a `电脑授权` chip appears when the machine reports `capabilities.computer === true` or `capabilities.browser === true`, expanding to one switch per reported capability — desktop grant (`桌面与文件`: screen, shell and file tools) and browser grant (`浏览器`). A switch reads `override !== false`; turning it on writes `true` (explicit on), off writes `false`. Machines that never report the capability show nothing — no placeholder for a feature that does not exist (C2).

## Risks

A new daemon fails closed against an unstamped server for the rollout window; the same trade was accepted for `ownComputerGrant`, and the error frame names the fix (update the server). `computerGrant` asserts the server evaluated the grant at push time — it is not a signature; a stamped call replayed within the unsafe-call dedupe window behaves exactly as before. Grant-off does not interrupt a call already in flight. The settings switches write the same nullable fields the API exposes, so a grant set elsewhere shows correctly.

## Out of scope

The user takeover lease protocol, `computer_manage`/host-screen semantics, Seatbelt, and the pi command-gate predicate (already shipped with folder grants).
