# Machine OS and distribution identity

Research: [machine OS identity and icons](../research/machine-os-icons-2026-11-16.md). Coordinator approved the optional-field protocol on 2026-11-16; this follow-up is separate from machine-detail removal PR #5207.

## Contract and paths

`capabilities.osDistribution` is optional, bounded to 64 characters and restricted to os-release `ID` characters `[a-z0-9._-]`. It is display metadata, never a capability requirement, permission, URL or executable input.

| Path | Reads or writes | Expected behavior / failure |
| --- | --- | --- |
| One-shot daemon probe and cached presence probe | Read the Linux host's `/etc/os-release`, falling back to `/usr/lib/os-release` only on absence; report validated `ID` | Non-Linux, unreadable, absent or invalid ID omits the field without interrupting probing. Never execute the file. |
| Enrollment and presence | Existing capability payload and `parseReportedCapabilities` | Accept valid optional metadata. Drop malformed metadata without dropping MCP/skills or blocking enrollment/heartbeat. An old daemon stays unreported. |
| Machine JSON persistence and record projection | Existing capabilities column, `machineCapabilitiesSchema`, `toMachineRecord`, web `mapMachines` | Valid ID survives without migration. A later report that omits ID clears the optional metadata; offline rows retain their last report. Older servers strip the unknown field. |
| Shared web machine identity | OS platform, exact distro ID and machine name | macOS/Windows get their OS marks; known Linux IDs get distinct distribution marks; missing/unknown/invalid Linux ID gets Linux; unknown OS gets a generic computer. Never infer distribution from name or family. |
| Lists, selectors, model-machine headings and task/computer identity | Reuse the same machine name/icon component, retain capabilities in projections | Same machine gets the same mark. Historical string-only references use the generic mark instead of inventing metadata. Plain-text accessibility labels and sentences remain text. |

No new endpoint, permission default, server service, routing rule, migration or browser action. Failures affect the icon only. The metadata can be removed by reverting this additive change.

## UI brief

Surface: settings, computer side panel and thread identity. Goal: put the real OS/distribution mark before machine names everywhere a machine identity is rendered.

Rules: C1, C3, V1, V4, V5, V10, V14, A1, A2, R1. Keep existing Instrument Sans typography and neutral Cairn tokens; no logo backgrounds, new hues, badges or animations. The mark uses currentColor, 20px in rows and 16px inline; long names continue wrapping without overlapping actions.

References: `docs/design/references/settings/t3code-general.jpg` for divided rows; `docs/design/references/coordinator-chat/claude-duet-tasks-panel.jpg` for quiet leading glyphs. No OS-logo behavior is copied from either reference. Draft exempt: correction to existing machine identity presentation, no new layout, surface or interaction.

| Component | Empty / loading / error | Offline | Long content | Pending question | 390px / dark |
| --- | --- | --- | --- | --- | --- |
| Settings machine rows | Existing query boundaries unchanged; no phantom icon rows | Seed offline distro machine | Seed long machine name | Not applicable: identity has no question control | Capture both themes and widths |
| Machine selectors | Existing empty option and loading behavior unchanged | Offline option retains its OS mark | Seed duplicate/long names; keep disambiguation | Not applicable: selects existing machines only | Open selectors in both themes and widths |
| Computers panel and inline identities | Existing boundaries unchanged; historical metadata can be absent | Seed offline record | Seed long identity | Question text is not changed | Capture representative panel/inline states in both themes and widths |

Acceptance: daemon and wire tests cover each row above; rendered browser checks prove identical distro marks across surfaces, distinguish Arch from Ubuntu and generic Linux, retain name disambiguation, preserve selectors and avoid horizontal overflow. Capture live seeded SQLite data, inspect screenshots, and obtain independent read-only scoring strictly above 9 per element in light/dark at 1440/390. Stop test stacks afterward.
