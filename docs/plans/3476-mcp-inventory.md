# MCP inventory boundary and implementation plan

Date: 2026-11-12
Status: Proposed; coordinator protocol review required before implementation

## Scope and assumptions

Extend issue #3476, not a new ticket. Inventory means configured definitions, not a connection test, installed executable, or authorization grant. Never launch MCP processes, expand environment variables, execute configuration commands, or read authentication stores during discovery. Keep session-rule authorization from PR #2662 unchanged. The approved dependency decision permits smol-toml@1.9.1 and only its own lockfile increment, installed with scripts disabled.

## Overlap check

Executed `node scripts/github-overlap.mjs --repo xiechimon/cairn --term MCP --term inventory --term discovery --term 清单 --file apps/daemon/src/backend/mcp-config.ts --file apps/server/src/services/mcp-servers.ts --file apps/web/src/resources/mcp-servers-page.tsx`.

1. Open issues: #3476 is this exact request; extend it. #3475, #3434 and the other returned issues concern separate work. No second same-intent issue identified.
2. Open matching PRs: #3494 repository access and #3487 Android design; neither implements inventory. Explicit same-intent result: empty.
3. Recently merged: 36 matches. #2662 moves MCP and secret selection to session rules; discovery must not mutate those rules or claim payload authorization. #2652 capability reports are a compatibility boundary, not proof of configuration coverage.
4. Planned-file overlap: #3528, head `web/unslop-signs`, touches `apps/web/src/resources/mcp-servers-page.tsx`. Proceed with research and boundary design only; recheck before UI implementation and preserve its wording/style changes. No overlap returned for the two other supplied paths. The expanded implementation file list below still requires another overlap check before building.

## Existing evidence to reuse

Baseline main: `8b6775e22ea009efdf12f7ef380c5034d02ce63a`.

- [Machine execution research](https://github.com/xiechimon/cairn/blob/8b6775e22ea009efdf12f7ef380c5034d02ce63a/docs/research/machine-execution-plane.md): reuse the daemon-outbound reporting and local runtime-credential boundary, not its historical gap list as current behavior.
- [Harness profile design](https://github.com/xiechimon/cairn/blob/8b6775e22ea009efdf12f7ef380c5034d02ce63a/docs/spec/30-harness-profile-opt-in.md): reuse closed capability vocabulary and strict metadata schemas. Inventory must be stricter than profile configuration: commands, arguments and URLs can themselves contain credentials.
- Local code inspection: `machine-capabilities.ts` scans only one Claude file and returns an empty array on every read/parse failure; `mcp-servers.ts` returns raw command or URL strings; the MCP page reads that server-local list, not all machine reports. These are findings from source, not a live credential inspection.
- Installed pi 1.4.0 `docs/mcp.md`: user `~/.pi/agent/mcp.json`, project `.pi/mcp.json`, project trust, disabled entries and policy-only overrides matter. `mcp-auth.json` is an authentication store and must not be opened. File discovery cannot establish whether an extension replaces built-in MCP or whether a configured server is connected.

## Proposed wire and persistence boundary

The daemon creates a fresh allowlisted object before any serialization: schema version, scan timestamp, source kind enum, scope enum, project identifier, source status enum, entries with validated display identity, transport enum and enabled/configuration state. Do not spread parsed configuration into reports. Exclude command, arguments, URL (including host/path), description, env/header names and values, OAuth fields, raw filesystem paths, parser messages and stacks. A server name can also contain credentials: define a conservative display-name policy and suppress suspicious names with a fixed diagnostic; arbitrary safe-looking credentials cannot be guaranteed detectable, so the name policy and guarantee require explicit coordinator review.

Use fixed diagnostics only: absent, unreadable, invalid, unsupported, partial, complete. Missing file is a successful observation of an absent source, not an I/O error. Invalid entries make the source partial, retaining valid metadata without authorizing negative comparisons. Bound file sizes, source counts and entry counts; exceeding a bound is partial, never silently complete. Validate the exact report again at authenticated server ingress before persistence, with errors that never interpolate received data. Old daemon reports remain explicitly legacy/unknown coverage.

## Source coverage and comparison

Enumerate Claude user and embedded project entries, known local project `.mcp.json`, Codex user and trusted project TOML, and pi user/project JSON. Verify Claude and Codex paths, environment overrides, precedence and trust from primary documentation/source before tests. Do not recursively search the home directory or invent paths for projects absent from that machine. Report project-not-materialized and unsupported adapters as unknown coverage. Preserve source provenance and duplicate definitions; do not lowercase away distinct names or claim runtime-effective precedence without evidence.

Comparison key: exact validated server name within selected harness and scope, not endpoint or command equivalence. Present observed, missing, disabled and unknown separately. Missing requires a fresh, online, complete scan of every relevant source in that comparison scope. Partial, offline, stale, legacy and unavailable-project reports cannot prove absence. Never union project-local definitions into global machine capability eligibility.

## State readers/writers and tests-first matrix

| Path | Expected behavior and mandatory test |
|---|---|
| Local source enumeration/read | Synthetic homes and explicitly supplied project roots only; absent, EACCES, invalid TOML/JSON, oversized and symlink-escaped files never imply complete empty coverage |
| Local projection | JSON/TOML fixtures containing realistic fake tokens in URLs, commands, args, env, headers, OAuth, names and malformed input produce no token-bearing report, exception or console output |
| Enrollment/presence serialization | Capture serialized payload; only schema-approved metadata crosses the boundary; source failures have fixed codes |
| Server ingress/persistence | Reject nonmetadata report fields without echoing them; query persisted rows and assert fake credential values absent |
| Cached/rescanned report | Changed/deleted/repaired files refresh; stale previous results remain explicitly stale after failure, not successful emptiness |
| Machine detail and MCP resource list | List machine/source/scope/coverage, including disabled and partial results; zero and unknown are visibly different |
| Cross-machine comparison | Complete absence is missing; partial/offline/legacy/project-unavailable is unknown; duplicates preserve provenance |
| Existing eligibility and session rules | No new project inventory or comparison state changes grants, secret access or claim matching |

## Frontend design brief still required

Reuse existing resource rows, query boundaries and machine detail panels. A machine selector plus harness/scope selector precedes the inventory; a comparison view shows one row per identity and one status cell per selected machine. At 390px use stacked machine/status rows rather than page overflow. Loading, empty-complete, partial/error, offline/stale, populated, disabled and long-name states require light/dark fixture captures and a real-stack populated capture. Read DESIGN-RULES and DESIGN, open the settings references, build the required real-component page draft and link research/frontend/backend designs in the existing feature registry row before UI implementation. No screenshots or rendered design acceptance have been produced yet.

## Execution and checks

After coordinator reviews this protocol, finish primary-source research and frontend design; recheck overlaps for all added paths, then add failing projection/schema/coverage tests before behavior changes. Implement behind daemon backend bridges, extend shared report schema and protected server ingress, then wire resource list, machine details and comparison. Run targeted tests and affected e2e, `pnpm lint`, `pnpm typecheck`, `pnpm spec:parse`, feature-map generation and `pnpm prepush`. Commit/push only through the approved bot path, request ready-for-review PR with `coordinator-hold` on protected changes, and report CI separately from local evidence. Do not bypass hooks or commit the injected AGENTS.md change.

No implementation, dependency installation, credential reads, tests, screenshots, commit, push or PR have occurred at this checkpoint.
