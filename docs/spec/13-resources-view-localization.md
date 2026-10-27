# 13 · Resources-View Localization: Skills and MCP Read-Only Local

> Ruling source = the 2026-09-28 grilling session (Q1–Q8 all pinned). This spec locks the terminal state of the skills / MCP two resource surfaces: the source flips from "DB registration" to "local file read-only", and the two DB tables plus the matching management surfaces are fully deleted. Parent issue = #365; construction tickets #367 (T1 skills local surface) / #368 (T2 MCP local surface) have no blocking edge and are parallelizable.
>
> Local source of truth: the skills directory defaults to `~/.agents/skills`; the MCP config defaults to the `mcpServers` section of `~/.claude.json`.

## Problem Statement

Both skills and MCP are currently a "register into pacman DB" model, with four pain points:

1. **Duplicate registration**: the user's machine already has a maintained skills directory (`~/.agents/skills`) and MCP config (`~/.claude.json`), but pacman requires re-registering them in the UI before they exist.
2. **Dual-truth drift**: the local directory changes and the DB does not know; `~/.claude.json` changes and the DB does not know. DB rows are copies that go stale sooner or later.
3. **The GitHub scan surface is a self-host burden**: `scanGithubSkills` depends on outbound REST (unauthenticated 60 req/h rate limit), pure complexity for the "skills are already on disk" single-user scenario.
4. **The credential surface is too wide**: MCP header secrets go through SecretBox into the server DB and then per-step across the server→daemon wire — while the daemon's local config already holds the plaintext.

## Solution

The two resource surfaces are unified into a **local file read-only** model:

- **skills**: the server now scans a local directory (default `~/.agents/skills`, configurable), each subdirectory containing a `SKILL.md` = one skill; **id = directory name**. Not stored, no import page, no GitHub scan.
- **MCP**: read the `mcpServers` section of `~/.claude.json`. UI display = **server reads local** config; task execution = **daemon reads local** config and resolves endpoints by itself — stdio commands launch on the real execution machine, semantically correct per machine. Secrets no longer land in the DB nor cross the wire.
- **Deletion surface** (No Negative Echo, all dead-path remnants cleared): the `skill` table, the `mcp_server` table, the skills import page, the MCP create/edit management write surface, the GitHub scan service, the chief `delete_skills` tool, the corresponding REST write endpoints.
- **Kept surface**: the agent-row `skills[]` / `mcpServers[]` authorization-checkbox semantics unchanged, the value semantics switch from "DB id" to "directory name / config key name"; the existing wire record shapes (`SkillRecord` / `McpServerRecord`) are kept to narrow the web change surface.

## User Stories

1. As a self-host user, I drop a directory containing SKILL.md into `~/.agents/skills/`, and refreshing the pacman skills page shows it — no "import" action at all.
2. As a Claude Code user, the MCP server I configured in `~/.claude.json` shows up directly in pacman's MCP page and the agent checkbox list — zero re-registration.
3. As a security reviewer, I see the MCP env/headers secrets only exist in the daemon's local config file, the server DB has no copy, the server→daemon wire only carries the slug list, and the UI interface only exposes the `hasCredential`/`credentialKeys` projection.
4. As a multi-machine user, my remote daemon reads the **remote machine's** `~/.claude.json` — a stdio command on the server machine is not taken to the remote and mis-executed.
5. As a maintainer, I delete the `~/.agents/skills/foo/` directory, and the next skills-page refresh no longer has `foo`; agent rows that referenced it tolerate "unknown skill skipped" at the next execution, without blowing up the task.
6. As an upgrade user, after upgrading, the old skill/mcp_server rows in the DB are exported to `~/.pacman/legacy-export-<ts>.json`, the dead old ids on agent rows are cleared, and I re-check once.
7. As a UI user, neither the skills page nor the MCP page shows a `新建/导入` button any more — the page's empty-state copy tells me which directory/file to add config to.
8. As a regression tester, the skills-page and MCP-page e2e pins flip from "can click new" to "no new entry + list from the local source", and the verify-pacman feature map updates in sync.

## Implementation Decisions

### Module change list (decision points, no concrete file paths)

**shared**
- The `SkillRecord` wire shape kept (id/teamId/name/description), `id` semantics = directory name, `teamId` filled with the current team placeholder (narrows the web change surface).
- The `McpServerRecord` wire shape kept; the stdio entry's `url` slot currently fills the command preview (mapMcpServers already consumes it so), kept.
- **machine-wire break**: the claim payload's `mcpServers` field switches from `McpEndpoint[]` (server-resolved endpoints) to `string[]` (slug list, daemon resolves by itself). The version-wall constant is bumped — old daemons no longer receive MCP config (treated as no-MCP running), no mixed-shape delivery.

**server**
- The skills service rewritten to local-directory scan: `readdirSync` one-level subdirectories + check `SKILL.md` in each + reuse the existing minimal frontmatter parser (name/description, the folded-block scalar fallback unchanged). Directory missing = empty set (no crash).
- New claude.json read seam: read the `mcpServers` section of `~/.claude.json` → zod-validate each entry (stdio: command/args/env; http: url/headers) → bad entries skip without killing the whole → project `McpServerRecord[]` (**env/headers values do not leave the server**, only the `hasCredential`/`credentialKeys` projection). File missing / bad JSON / no mcpServers key = empty set.
- `GET /api/skills?teamId=` and `GET /api/teams/{id}/mcp-servers` read endpoints switch source (the two seams above); the skills POST/scan endpoints, the mcp-servers POST/PATCH/DELETE endpoints all deleted.
- One drizzle migration: `DROP TABLE skill`, `DROP TABLE mcp_server`; within the same migration export the two tables' existing rows to `~/.pacman/legacy-export-<ts>.json` (upgrade guardrail), and clear the agent table's `skills`/`mcpServers` two columns to `'[]'` (old ids die with the tables, no dead references remain). The ticket does not hardcode the migration number, numbered main's tail +1 at merge time.
- chief-tools: the `skills` / `mcp_servers` read surfaces switch source; the `delete_skills` tool deleted; create-agent default `skills: []`/`mcpServers: []` unchanged. mcp-face's `skills` read surface switches source.
- The agent-row `skills[]`/`mcpServers[]` validation switches from "DB existence" to "local-source existence", unknown items tolerated and skipped (same rule as the existing resolveAgentMcpEndpoints unknown-slug skip).

**web**
- skills page: delete the `新建技能` button and the whole `/import` route (incl. the folder-upload/GitHub dual tabs, the chief hint copy); the empty-state copy becomes "drop a directory containing SKILL.md into <directory path> and it appears here".
- MCP page: delete the create/edit entries (CreateMcpDialog and inline editing), rows become read-only; the empty-state copy points to `~/.claude.json`.
- agent edit surface: the skills/MCP checkbox candidate set switches to the two read endpoints (data source changes, the control unchanged).
- the mention picker's skill group: candidate source switches with the read endpoint, id = directory name.
- i18n en/zh sync (delete the import-page copy, add two empty-state copy strings).

**daemon**
- config adds `mcpConfigPath` (default `~/.claude.json`, env-overridable).
- runner: the claimed payload's `mcpServers` is now a slug list → the daemon reads the local config and resolves `McpEndpoint[]` → feeds the existing `connectMcpBridge` (the bridge itself zero change). Unknown slug / bad entry skipped, the canonical degraded line `[mcp] <slug>: ...` family extends a "not found in config" line.
- **skills has no daemon surface**: the daemon source has zero consumption of skills (measured 2026-09-28, grep zero hits), this spec does not change that — skills execution-surface injection goes to a later ticket.

**verify / e2e**
- verify-pacman feature map: the skills-page/MCP-page two entries switch to "read-only list + no new entry" assertions.
- e2e: the skills page has no `res-new` button, no reachable `/import` route; the MCP page has no new button; the agent edit-surface checkbox candidates = fixture-ized local source.
- fixture surface: skills/MCP fixture data switched to simulate "local-source projection", the page render logic unchanged.

### Data contracts (ticket-internal final adjustments allowed)

- `GET /api/skills?teamId=` → `SkillRecord[]` (`id` = directory name; scanned now, no cache)
- `GET /api/teams/{id}/mcp-servers` → `McpServerRecord[]` (config projection; env/headers only key names)
- machine-wire claim: `mcpServers?: string[]` (slug list; version-wall constant bumped, old daemons do not receive this field)
- config file schema (consumed, not owned by pacman): `~/.claude.json` → `{ mcpServers: { <slug>: { command?, args?, env?, url?, headers? } } }`

## Testing Decisions

Testing leans end to end and boundary behavior, not implementation details.

- **server integration tests**: directory-scan six states (directory missing / empty directory / subdirectory with no SKILL.md / nested skill / folded frontmatter fallback / normal multiple skills); claude.json parse five states (file missing / bad JSON / no mcpServers key / one bad entry skipped / http+stdio mixed normal); the projection surface asserts env/headers values do not exit the interface.
- **migration test**: build an old DB with rows → migrate → the two tables absent, the legacy-export file landed with complete content, the agent two columns empty.
- **daemon unit tests**: slug → config resolution (normal / unknown slug skipped / bad entry skipped); `mcpConfigPath` env override.
- **web e2e**: skills page no new entry + list renders the local source; MCP page same; agent edit-surface checkbox candidates consistent with the local source; the old route `/app/resources/skills/import` 404s or redirects.
- **version wall**: a machine row with the old latestCliVersion's claim payload carries no mcpServers field.

## Out of Scope

- **skills execution-surface injection** (feeding skill content into the worker/chief session): the daemon currently consumes zero, this spec does not touch it; enters scope from S2 (see "write-path swing-back" below).
- **second config-source merge** (e.g. a pacman-specific `mcp.json` coexisting with claude.json): single-source first, merge semantics go to a later ticket.
- **multiple skill directories**: configurable but only one directory slot; multi-directory scan goes to a later ticket.
- **skill deletion surface**: deletion = deleting the directory from disk (the user's own), the server has no delete endpoint; delete_skills stays delisted.

### Write-path swing-back (XMON-109, 2026-10-01)

The original two Out-of-Scope items move into scope, and the skill store swings back from "read-only projection" to "single-directory read-write":

- **web/relay create skill and update skill**: `POST /api/skills` (member) + `PUT /api/teams/{id}/skills/{sid}` (overwrite semantics: listed files overwrite, unlisted preserved) + worker relay `create_skill`/`update_skill` (vocabulary always listed, enforced by the agent-row `创建技能`/`更新技能` switch, 403 shaped like requestMerge). Body `{name, description, files: [{path, content}]}`; frontmatter is the sole truth (name/description required and must match the body declaration; rename = carrying a new SKILL.md, the directory stays, the id follows the frontmatter). Validation gates: directory-name safe domain, path guard (rejects escape / rejects writes through symlinks), single file 512k / single skill 2M bytes total, directory occupied or id collision 409, unknown id 404. Both entries both actions land a `skill_audit` audit row (REST + relay same table, actor_type = member|agent).
- **chief auto-create skills**: the chief vocabulary adds `create_skill`/`update_skill` (organize bit, registered in CHIEF_TOOLS_ADDED), exempt from the agent-row switch (chief = trusted surface).
- **machine-wire skill-pack delivery**: `GET /api/machine/skills/{stepId}` ([designed] add-on endpoint, registered in MACHINE_WIRE_EXTENSIONS) — the S2 daemon materialization contract: a worker step packages the intersection whitelist of that step's agent skills (chief step = trusted-surface full set), including dirName and full file content, byte gate same as the write surface. Execution-surface injection (feeding the pack into the session) belongs to S2, not this surface. (#920 swing-back: delivery switches to "manifest + on-demand pull" — this endpoint returns the file manifest path/sizeBytes/sha256, the file bodies go through the same-prefix `/file` endpoint raw bytes on-demand pull, the distribution surface drops the byte gate; the source of truth = spec 14's "manifest + on-demand pull swing-back" section.)

## Further Notes

### Premortem (three causes of death + guardrails)

- **`~/.claude.json` written dirty by Claude Code or format drift** → guardrail: file-level parse failure = empty set + no server crash; entry-level zod failure = skip that entry; the daemon side same rule. The UI empty-state copy also carries the "file broken" guidance.
- **server display and daemon execution read different files** (multi-machine) → guardrail: the Q6 ruling is "each reads its own machine", documented in the doc and empty-state copy; the daemon prints the actually loaded slug set in the canonical log line every turn, drift visible at a glance.
- **dropping the two tables loses registered data** → guardrail: the migration exports `~/.pacman/legacy-export-<ts>.json` first then drops; the release note documents the re-check path (source now local, re-check takes seconds).

### Relationship to existing tickets

- #223 (skills GitHub scan discovery half): this spec deletes the whole surface, #223's scan/fetch dual-mode service endpoints removed with ticket T1.
- #231 (OAuth family): this spec is not involved; after MCP localization the server no longer holds MCP credentials, the OAuth surface unaffected.
- spec 11 (model service and machine localization): sibling file — the same "self-host local-first" philosophy extended to the resource surface.

### Cadence

Two construction tickets, no blocking edge, parallelizable (herdr dual lane):

- **#367 T1 skills local surface** (shared + server + web): directory-scan seam + read-endpoint source switch + import-page deletion + drop skill table migration + e2e/feature-map flip.
- **#368 T2 MCP local surface** (shared + server + web + daemon): claude.json read seam + read-endpoint source switch + machine-wire slug-ization + version-wall bump + daemon resolve path + management write-surface deletion + drop mcp_server table migration + e2e/feature-map flip.

Both tickets carry a migration — **drizzle numbering discipline**: the number follows main's tail at merge time, never hardcoded in the ticket.