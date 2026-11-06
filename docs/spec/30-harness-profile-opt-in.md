# 30 · Harness profile: opt-in unified configuration across machines and harnesses

> Ruling source = ian, 2026-11-06: one configuration should serve every harness and every machine, and it has to be optional, because some people want their machines managed separately while he wants his unified. The decision row is D84 in the owner plan; the phased plan is section 22 of the same file. This volume locks the contract for T0 and names what later phases may not change.
>
> This volume does not overturn spec 13 Q6 ("server display and daemon execution each read their own machine"), spec 11 A4 (the daemon reports its local `~/.claude/settings.json`), or `docs/research/machine-execution-plane.md` §4-9 (runtime credentials do not cross machines). It adds a declared, secret-free layer above them and nothing else.

## Problem Statement

One person now runs two machines and three harnesses. The same five layers are maintained by hand on each pair:

1. Shared instructions (`CLAUDE.md` / `AGENTS.md`).
2. Skills (`SKILL.md` directories and the symlinks that expose them).
3. MCP server definitions (JSON `mcpServers`, TOML `mcp_servers`, `~/.pi/agent/mcp.json`).
4. Pi packages and their version pins.
5. Safe preferences (theme, TUI mode, telemetry-off).

Measured on the owner's two machines on 2026-11-06: Pi 1.5.0 against 1.4.0, seven packages against three, `-builtin:mcp` against built-in MCP, a remote-only `mcp.json` and `mcp-auth.json`, and an instructions file with uncommitted changes in opposite directions on the two hosts. The existing mechanism (`~/.agents` private git plus a 15-minute wiki-only rsync) covers skills and instructions text only, and its newest-wins copy has already dropped a change on one side.

A single file that every harness reads does not exist and cannot be made to exist: global paths and file formats are hard-coded per product.

## Solution

One secret-free declarative profile renders into each harness's native files, per machine, and only for teams and capabilities that opted in.

| ID | Decision | Landing form |
|---|---|---|
| **A1** | Three modes: `independent` (default), `unified`, `paused` | `harness_profile.mode`, default `'independent'`; a team with no row is `independent` |
| **A2** | Absent row changes nothing | No row = no manifest endpoint reachable, no fingerprint reported, no file written. `servesHarnessCapability` answers false for every capability |
| **A3** | One row per team | Unique index on `teamId`; the UI and the apply path read the same row |
| **A4** | Capability vocabulary is closed | `instructions`, `skills`, `mcpDefinitions`, `packages`, `safeSettings`; an unknown name is rejected, never ignored |
| **A5** | Target vocabulary is closed | `pi`, `claude-code`, `codex`; a renderer that does not exist for a target is a configuration error, not a silent skip |
| **A6** | No slot holds a secret | The profile carries MCP names, transports, commands, URLs and environment-variable **names** only. `patchHarnessProfileBodySchema` is strict: an undeclared key (`authToken`, `mcp.env`) is rejected |
| **A7** | Renderers fail closed on the unknown | A field the renderer does not understand, or a harness version whose schema is unverified, stops the apply and names the field; lossy mappings are reported before writing |
| **A8** | Apply never overwrites unmanaged content | Marker-block writes into files the user owns, backup before write, atomic replace, read-back check; a conflict is surfaced with `keep local` / `take profile` / manual merge and never resolved by recency |
| **A9** | Trigger is manual | `apply` runs when asked; no timer is installed (owner's earlier ruling: no automatic sync) |
| **A10** | Daemon sessions keep their own settings contract | `PI_SETTINGS_BYPASS` stays as is: a cairn-dispatched pi step ignores user-level packages, themes and prompt templates. The UI must say so instead of implying otherwise |
| **A11** | `paused` is not `independent` | Paused keeps the stored profile and stops serving; independent means the feature was never turned on. Neither deletes user files |

### What the profile may contain, per capability

| Capability | Portable content | Never in the profile |
|---|---|---|
| `instructions` | The shared instruction body, one source | Machine paths, tokens, hostnames |
| `skills` | `SKILL.md` trees and their relative files | Absolute symlink targets |
| `mcpDefinitions` | Server name, transport, command, args, url, environment-variable names | Header values, bearer tokens, OAuth state |
| `packages` | Package id plus version pin | Registry credentials |
| `safeSettings` | Normalised preferences expressible in every target | Anything a target marks machine-scoped |

### Data contract (T0, landed)

- `harness_profile` table: `id`, `teamId` (FK `team`), `mode` default `'independent'`, `capabilities` JSON default `'[]'`, `targets` JSON default `'[]'`, `version` default `0`, `createdAt`, `updatedAt`.
- `harnessProfileRecordSchema` and `patchHarnessProfileBodySchema` in `packages/shared/src/records/harness-profile.ts`.
- `apps/server/src/services/harness-profile.ts`: `harnessProfileOf`, `harnessProfileModeOf`, `servesHarnessCapability`, `upsertHarnessProfile`.
- `profileServesCapability` is the single predicate every later surface calls; it answers false for a null profile and for any mode other than `unified`.

## Failure modes

| # | Failure | Guard |
|---|---|---|
| F1 | The feature acts without being turned on | A2; a test asserts no row means independent and every capability false |
| F2 | A machine that never opted in receives the profile | Server filters by the machine's participation flag (T3) |
| F3 | An unknown field or harness version is silently dropped | A7; the renderer reports and stops |
| F4 | A path escapes the target directory | Reuse the spec 14 dirName/path checks: one segment, no `..`, no backslash, not absolute |
| F5 | A secret reaches the profile | A6; strict patch schema plus a record shape with no secret field |
| F6 | A two-sided edit is lost | A8; conflict is surfaced, recency never decides |
| F7 | A half-written apply | Prepare fully, back up, atomic replace, read back |
| F8 | An old daemon meets a new manifest | Version wall, same shape as the MCP gate |
| F9 | A daemon-dispatched session is assumed to inherit user packages | A10; the UI states the boundary |

## Phases

- **T0 (this volume):** the table, the shared schema, the service predicate, the F1/F2/F5 tests, the AGENTS.md rules. No route, no daemon change, no file write.
- **T1:** presence carries a harness fingerprint; the server only computes drift; the settings page shows a read-only matrix.
- **T2:** profile editing plus `pi` and `claude-code` renderers. Codex receives instructions and skills only until the repository takes on a TOML dependency, which needs the owner's word because it changes `package.json` and the lockfile.
- **T3:** machine-scoped manifest, on-demand pull, blob/view cache, atomic apply, conflict surface, `paused`.

## Acceptance

- A team with no profile row: `harnessProfileOf` is null, `harnessProfileModeOf` is `independent`, and every capability answers false.
- A row inserted with no explicit mode reads `independent` and serves nothing.
- `unified` with `skills` enabled serves `skills` and not `mcpDefinitions`; `paused` and `independent` serve nothing regardless of the stored capabilities.
- An undeclared key in a patch body is rejected; an unknown mode, capability or target is rejected; an empty patch is rejected.
- `upsertHarnessProfile` keeps one row per team and increments `version`.
