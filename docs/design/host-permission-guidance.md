# Host permission guidance on the machine page

Status: implemented with the PR that adds this document. Baseline `origin/main` at `8aba71ac4`. This is the visibility slice only: it does not implement `docs/design/machine-capability-defaults-and-folders.md` (grants, owner route, proposal) and adds no gate anywhere.

## Problem

The owner's ask (2026-11-14) was to make the onboarding guidance good: guide the user to grant the permissions the assistant needs, so a second person goes from install to first result without help. Today the machine page shows `Agent 的权限` with a browser switch whose hint says `这台机器还不支持浏览器。` and nothing else. When the host screen tools fail on macOS because Accessibility is not granted, or on Linux because AT-SPI is not reachable, the only error is a late refusal inside a step transcript. Nothing on the settings page tells the person what to grant.

## What exists today

| Piece | Fact | Where |
|---|---|---|
| Permission state | `agent-desktop status` answers `{ ok, data: { permissions: { accessibility: { state }, automation: { state }, screen_recording: { state } }, platform } }` with states `granted`, `not_required`, `denied`, `unknown` (measured on agent-desktop 1.1.0, omarchy) | `apps/daemon/src/computer/host-screen.ts` runs this binary for every screen call |
| Capability report | The daemon builds `MachineCapabilities` at enroll and on every presence heartbeat; optional fields an old server drops are safe (`parseReportedCapabilities` keeps only known fields) | `apps/daemon/src/machine-loop.ts` `capabilitiesReport`, `packages/shared/src/records/machine-capabilities.ts` |
| Precedent | `agentReach` was added the same way: an optional field probed from a local binary, refreshed at most every 10 minutes, nothing dispatches on it | PR #4519, `apps/daemon/src/agent-reach.ts` |
| Web surface | `machine-agent-access.tsx` renders `Agent 的权限` with `SettingsCard`/`SettingsRow` and one browser switch | `apps/web/src/resources/machine-agent-access.tsx` |

## Design

**Probe.** A new `HostPermissionsProbe` in `apps/daemon/src/host-permissions.ts` follows the `AgentReachProbe` shape: it runs `agent-desktop status` (local, no network, 15 s timeout, 1 MiB cap) at most once per refresh window, returns `undefined` until the first run settles and whenever the output is not a usable envelope. The daemon resolves the same binary path `host-screen.ts` uses (`defaultAgentDesktopBinary(home)`), not a bare name from `PATH`, so the report is about the binary the screen tools would actually run. The binary path helper moves to an exported function on `host-screen.ts` so both callers share it; behavior of the screen path is unchanged.

**Report.** `MachineCapabilities` gains one optional field:

```ts
hostPermissions: {
  accessibility: 'granted' | 'not_required' | 'denied' | 'unknown';
  automation: 'granted' | 'not_required' | 'denied' | 'unknown';
  screenRecording: 'granted' | 'not_required' | 'denied' | 'unknown';
}
```

`parseReportedCapabilities` parses it with the same safeParse-and-spread pattern as `agentReach`, so an old server or daemon drops it silently. `machineCapabilitiesSchema` carries it as an optional strict object. The wire schemas stay `z.unknown()`; no migration, no new column: `capabilities` is a JSON column.

**No gating.** Nothing dispatches, blocks or allows on `hostPermissions`. `confinementDispatchReady` is untouched. The field exists so the settings page can state a fact. A machine that reports nothing (no agent-desktop, an old daemon) shows nothing new; the browser switch keeps its current hint.

**Web.** `machine-agent-access.tsx` renders one guidance row per permission that is not satisfied, only when the machine reports `hostPermissions`:

- `accessibility: 'denied'` (macOS) — `辅助功能未授予` with the hint pointing at `系统设置 → 隐私与安全性 → 辅助功能` and the app to enable.
- `screenRecording: 'denied'` (macOS) — `屏幕录制未授予`, same settings path, screen list section.
- Linux `denied`/`unknown` on accessibility — a hint that the AT-SPI bus is not reachable and desktop observe/act will be refused, with `orca` or `at-spi` availability wording.
- `not_required` and `granted` render nothing.

Rows use the existing `SettingsRow` shape with the label carrying the state and the hint carrying the fix. Labels go through `t()` and into the EN dict; the page stays otherwise identical. A machine without the report renders exactly today's page (fixture `scenario=06` unchanged in shape, one new row only when the fixture reports permissions).

## States and transitions

| State | Reporter | Consumer | Failure behavior |
|---|---|---|---|
| No agent-desktop on the machine | probe returns `undefined` | field absent from capabilities | page shows the current hint, no row |
| `agent-desktop status` fails or outputs garbage | probe returns `undefined` (last report dropped, same as agentReach) | field absent | same as above |
| All permissions granted / not required | probe returns the states | field present, all satisfied | page shows no row |
| A permission denied | probe returns the states | field present, one row per denied item | row states the fix; nothing blocks |
| Old daemon against new server | field never sent | `parseReportedCapabilities` keeps the rest | no row |
| New daemon against old server | field sent, dropped by the old parser | nothing stored | no row, no error |

Every path that reads `machine.capabilities` keeps its behavior: the field is additive and optional. The only writers are the probe (daemon) and, through presence, `mergeReportedCapabilities`, which stores whatever `parseReportedCapabilities` accepted; the new field needs no merge rule of its own because it is always fully reported (a full state object, never partially preserved), unlike `hardware` and `confinement`.

## Not in this slice

- No grants, overrides or owner routes (`machine-capability-defaults-and-folders.md` stays a proposal).
- No change to `routes-machine.ts` or `services/machine*.ts` beyond what presence already stores.
- No desktop-control enablement: the panel switches stay as they are.
- No Windows-specific probe: agent-desktop reports `platform`, but the states are advisory text only.
