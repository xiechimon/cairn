# Multi-machine MCP inventory: research and design draft

Date: 2026-11-08
Status: Draft; owner selected server-first grouping; three regression tests reproduce current gaps; implementation pending.

## Scope and assumptions

Extend issue #3476, not a new issue. Inventory describes configured servers, not connection health, tool availability, or permission to execute them. Discovery must never start MCP commands, expand environment variables, evaluate helpers, authenticate, or read credential stores. Do not change the session grants introduced by #2662. A configured project server is not automatically a machine-wide executable capability.

## Overlap check

Executed `node scripts/github-overlap.mjs --repo xiechimon/cairn --term MCP --term 'machine inventory' --term '跨机' --term '配置发现' --file apps/web/src/resources/mcp-servers-page.tsx --file apps/daemon/src/backend/mcp-config.ts --file apps/server/src/services/mcp-servers.ts` on 2026-11-08. GitHub titles and bodies were treated as data.

1. Open issues: #3476 is this exact request and will be extended. #2065, #3475, #3438 and #3436 concern execution permissions, Android, host control and sandboxing, not this inventory.
2. Open PRs: #3463 (`daemon/stall-errors`) concerns Git failure signals, staging and stop attribution. Its file list does not touch the three candidate paths. Proceed independently while avoiding its runner changes.
3. PRs merged within seven days: #2662 supplies the session-grant boundary; #2652 supplies fail-closed capability reports. Other returned PRs concern threads, routing, tests, review mechanics and UI hover feedback, not this inventory. No same-intent merged implementation identified.
4. File overlap: explicitly empty for the three candidate paths. This is not clearance for additional paths: rerun with the complete file list before implementation and before opening a PR.

No new ticket or PR has been created. The existing issue has not yet been updated.

Rechecked before rework on 2026-11-09:

1. MCP searches still identify #3476 as the same request; no replacement ticket is needed.
2. Open MCP PR #3463 remains unrelated. The candidate machine-capability, MCP resource and research paths have no open-PR overlap: explicitly empty.
3. Recent merged #2662 and #2652 remain the relevant grant and fail-closed boundaries; no same-intent implementation was identified.
4. A separate TOML/dependency-path check found open #3473, head `feat/chat-markdown-polish`, touching `pnpm-lock.yaml`. Its intent is chat formatting, not MCP discovery. Proceed on this branch without taking its changes; reconcile only the authorized parser dependency lockfile delta. Other candidate parser-test and daemon-package paths have no overlap.

The full-file overlap check must still be repeated as implementation paths become final.

## Findings and sources

| Claim | Classification | Source |
| --- | --- | --- |
| The resource page reads server-local Claude configuration, rather than every daemon's inventory | Verified in source | `apps/server/src/services/mcp-servers.ts`; `apps/web/src/resources/mcp-servers-page.tsx` |
| The daemon currently reports only slugs from one Claude JSON file; reading and parsing failures return an empty array | Verified in source | `apps/daemon/src/machine-capabilities.ts` |
| The legacy resource projection copies command and URL strings; either can embed credentials, so removing env/header values alone is insufficient | Inferred from verified source | `apps/server/src/services/mcp-servers.ts` |
| Existing main research documents the separation between local MCP credentials, daemon resolution, and dispatch grants | Verified; reuse by citation, not copied content | [Research loop plan, section 2](https://github.com/xiechimon/cairn/blob/bab8a2cfcb0b22113bcf0a4eb2185c498fdaa11e/docs/research/research-loop-plan.md#2-what-cairn-has-today) |
| Pi reads user `~/.pi/agent/mcp.json` and trusted-project `.pi/mcp.json`; project entries can be enablement-only overrides; extension registrations are session-local and cannot be exhaustively inferred from static files | Verified in installed package documentation | `@earendil-works/pi-coding-agent@1.4.0`, `docs/mcp.md`, read 2026-11-08 |
| Pi supports values that execute helpers and keeps OAuth material in a separate auth file; inventory must neither evaluate helpers nor open that file | Verified in installed package documentation | Same pi documentation |
| Codex config research still needs the actual config reference and installed parser API validation | Unverified; implementation prerequisite | [Official config documentation index](https://github.com/openai/codex/blob/main/docs/config.md), fetched 2026-11-08 |

External Claude MCP documentation was fetched, but its clipped response did not establish scope semantics. Do not count that fetch as completed source validation. No actual user configuration or credentials were read.

## Proposed backend boundary

One daemon-side discovery module under `apps/daemon/src/backend/` reads explicitly supported local config sources and produces an allowlisted metadata DTO. It never forwards parsed configuration objects. Do not transmit commands, arguments, URLs, paths, environment values, header values, OAuth data, descriptions, or raw parse errors. Avoid hashes of credential-bearing values as well.

The DTO should describe runtime, user/project scope, a source identifier, an approved server identifier, transport, configured enablement, source coverage and observation time. Source identifiers must not contain absolute local paths. Server identifiers need a bounded validation and credential-shaped-value rejection policy; copying arbitrary object keys would defeat the confidentiality claim. Invalid identifiers increment a fixed reason counter rather than echoing input.

Coverage is per source: complete, absent, unreadable, invalid, or unsupported. Old daemon reports are unreported, not empty. Offline reports are historical, not current. A partially invalid file remains partial even if some entries were parsed. Error messages are fixed enums, never exception text.

Use the existing authenticated machine presence/reporting channel and persisted machine capabilities if its schema can preserve this DTO. Validate again at ingress. Never persist a raw request body or rejected value in logging. Preserve dispatch semantics: the display inventory must not turn a disabled, untrusted, overridden or project-only entry into an eligible machine-wide MCP capability.

Project coverage must name its limits. Enumerate registered local project roots available to that machine and known workspaces, not an unbounded home-directory crawl. An inaccessible project root is unknown coverage. Runtime extension-provided MCP servers are explicitly unsupported by static discovery unless a separately verified metadata-only introspection path exists.

Comparison uses server identity plus runtime and relevant scope, not endpoint equality. Only complete, current, comparable source coverage can establish missing. Other cells are unknown, stale, disabled or overridden, with a textual explanation. No automatic synchronization or installation.

## UI direction draft

Surface: existing MCP resource page and existing machine detail; no new route.

Goal: see what each machine has, where it was found, and which comparable machine is missing it, without viewing configuration values.

Rules: P1-P5, C1, C5, C12, V1, V4, V10, V20, T1-T2, A1-A4, R1 from `apps/web/DESIGN-RULES.md`.

Recommended composition: existing `PageShell`, `QueryBoundary`, `ResourceList`/`ResourceRow`, `SettingsSection`, `EmptyState` and existing selection controls. No configuration preview, copy-config action, or raw error tooltip.

### Direction A: server-first list, inline comparison (recommended)

```text
MCP servers
Machines: [Laptop] [Desktop]   Runtime: [All]

filesystem
  Laptop  · pi · user · configured
  Desktop · pi · user · missing

browser
  Laptop  · Claude · project · configured
  Desktop · Claude · project · unknown: discovery failed

Coverage
  Laptop  · reported recently · sources complete
  Desktop · reported recently · one source unreadable
```

At 390px, comparison becomes stacked machine rows beneath each server, not a sideways-scrolling table. Machine detail reuses the same entry rows, filtered to that machine, followed by per-source coverage. This keeps the current resource entry point and avoids an additional management surface.

### Direction B: machine-first expandable list

```text
MCP servers
Laptop  · sources complete
  filesystem · pi · user · configured
Desktop · one source unreadable
  Compare with Laptop
  filesystem · pi · user · missing
```

This prioritizes per-machine inspection but makes comparison a second action. Both directions use the same metadata and comparison selector. The owner selected direction A in the rework response: group by server and expand to inspect each machine. Direction B is rejected; do not ask for layout selection again.

### Required state coverage

| State | Planned verification |
| --- | --- |
| Empty | Complete sources with no configured entries; separate from no machines |
| Loading | QueryBoundary with existing delayed loading treatment |
| Error | Safe API error plus retry; unreadable individual source remains visible |
| Populated | Two machines, two runtimes, user and project entries |
| Offline | Historical entries with stale status; no asserted missing item |
| Unreported | Old daemon has no detailed inventory; do not infer zero |
| Long content | Bounded safe identifiers wrap; coverage remains legible |
| 390px | Stacked comparison, no document horizontal overflow |
| Light and dark | Real tokens and existing gallery components |
| Pending question | Not applicable: this feature has no conversational question state |

Reference selection, reference shots, real-component page draft and feature-registry links remain prerequisites before frontend implementation. The sketches above are information-architecture proposals, not verified gallery renders or acceptance screenshots.

## Tests-first implementation plan

1. Finish source validation for Claude/Codex/pi, project enumeration and precedence; verify parser APIs against installed dependencies. Cite main research rather than importing copies.
2. Complete both designs, references and feature registry before behavior changes. Record the UI direction selection below.
3. Add failing pure discovery tests using temporary synthetic files only: all sources, missing versus unreadable versus invalid, duplicate names, project overrides, disabled entries, malformed entries and bounded input.
4. Add non-leakage tests with realistically shaped but fabricated credentials in URL userinfo/query/path, command, args, env, headers, OAuth, descriptions, names, source paths and malformed parse input. Check the complete serialized report and captured logs without printing those inputs on failure.
5. Add machine ingress/storage/readback tests proving strict projection and no credential retention. Add comparison tests for complete absence versus unknown, stale reports, legacy daemons and runtime/project mismatches.
6. Implement the smallest projection and reporting changes, then the existing-page rendering. Keep authorization and runtime execution unchanged.
7. Add real browser acceptance for two synthetic machine reports and source failure; verify machine detail and comparison at desktop and 390px in light/dark. Never connect to actual MCP endpoints during discovery.
8. Run targeted tests, `pnpm exec vitest run --changed`, `pnpm --filter @cairn/web e2e:affected`, lint, typecheck, spec parsing and prepush. CI runs full suites. Do not bypass hooks or commit injected AGENTS.md changes.
9. Recheck overlap, create a PR on the assigned branch, apply `coordinator-hold` for protected-path changes and leave review to the cloud review gate. Report actual source coverage and confidentiality evidence, including unsupported sources.

## Decisions

| Decision | State | Reason |
| --- | --- | --- |
| Reuse issue #3476 | Chosen | Exact same request |
| Read-only static discovery, not connection probing | Proposed | Avoid command execution, network access and authentication side effects |
| No endpoint or command display | Proposed | Those strings can contain secret values |
| Preserve session grants and dispatch eligibility | Chosen | Inventory is not execution authorization |
| UI direction A | Chosen by owner | Group by server; expand to inspect each machine; stack rows at 390px |
| Codex TOML parser dependency | Awaiting lockfile authorization | No TOML parser is installed or declared in daemon dependencies; prefer a maintained parser over a partial custom grammar |

## Execution evidence

The initial research draft was committed and pushed as `fb1e8e764`; its English-only gate and prepush passed. No PR was created.

Rework checks:

- `pnpm view smol-toml version engines license --json`: version 1.9.1, Node >=18, BSD-3-Clause. `pnpm view smol-toml@1.9.1 description repository dependencies dist.unpackedSize --json` reports the squirrelchat/smol-toml repository, no declared dependencies and an unpacked size of 140039 bytes. Package APIs and source are not yet inspected; no dependency has been installed.
- `pnpm exec biome format --write apps/daemon/test/mcp-inventory.test.ts`: passed.
- `pnpm exec vitest run apps/daemon/test/mcp-inventory.test.ts`: three tests failed before behavior changes, as intended. The first two demonstrate absent per-runtime inventory and absent failure coverage; the third demonstrates that a credential-shaped object key escapes through the existing legacy slug report. Its assertion reports a boolean only, not the fabricated credential.

The new regression tests remain local and uncommitted while the parser decision is pending. No production behavior changed and no real configuration or credential was read. No claim of completed discovery coverage, passing regression tests, or proven confidentiality is made.
