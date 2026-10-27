# 14 · Skills Execution-Surface Injection (daemon wiring)

> Ruling source = the 2026-09-28/29 grilling session + pi v0.86.0 source study. spec 13 changed the skills "source" to local-directory scan; this spec feeds the scanned skills **into the agent execution surface** — the daemon no longer lets pi use its own default directory, but explicitly scans the pacman-configured directory, generates a catalog, and injects it into the session. Parent issue = to be opened (number filled in after review); one construction ticket T3.
>
> The preceding handoff = #365/#367 (spec 13 + T1 skills local surface). This spec fills the missing daemon half on its opposite side — T3 cannot land before T1 completes (the two tickets share the skills identity wire shape).

## Problem Statement

The skills data source already migrated to the local directory (spec 13), but the agent execution surface consumes zero — the daemon relies entirely on pi's default directories (`~/.pi/agent/skills` + `<cwd>/.pi/skills`) for auto-discovery, and does not read pacman's chosen `~/.agents/skills`. The result:

1. **Directory split**: pacman configures one directory, pi defaults to another; the user switching tools cannot see skills across them.
2. **Id model split**: spec 13 sets `id = directory name`; pi uses the frontmatter `name` (the agentskills.io industry standard) + realpath dedup. When the SKILL.md frontmatter and the directory name match they coincide; when they differ they silently drift.
3. **Execution-surface contract undetermined**: whether skill content is stuffed wholesale into the system prompt, or catalog-indexed with the agent reading on demand, lacks a spec. This decides the token budget and the skill-volume ceiling.

## Solution

Before creating an agent session, the daemon **explicitly scans** the pacman-configured skills directory (env `CAIRN_SKILLS_DIR`, default `~/.agents/skills`), calling pi's top-level exports `loadSkills` and `formatSkillsForPrompt`:

- **`loadSkills` mode**: does not read pi's default directory (`includeDefaults: false`, `agentDir` passed a non-pi-default value such as `CAIRN_HOME/agent` so pi skips its user-level default scan), only `skillPaths: [CAIRN_SKILLS_DIR]` as the single source of truth — aligned with spec 13's "single source of truth".
- **id model**: the skill identity = frontmatter `name` (the agentskills.io standard); no frontmatter / no `name` field = fall back to the directory name. The wire id and the runtime id come from the same source, no split.
- **Injection shape**: catalog, not full text. `formatSkillsForPrompt(skills)` generates the `<available_skills><skill><name/><description/><location/></skill></available_skills>` XML block (the agentskills.io/integrate-skills standard), **appended to** `SessionOpts.systemPrompt` (not replacing). The agent's own `read` tool reads the SKILL.md full text on demand when the description matches — pi already wrote the system-prompt section "Use the read tool to load a skill's file when the task matches its description." + "references are relative to the skill directory (parent of SKILL.md)" for this.
- **Conflict dedup**: pi already dedups by realpath + name-collision detection (winnerPath/loserPath), reused unchanged.

## User Stories

1. As a user who keeps all skills in `~/.agents/skills`, once the pacman daemon starts these skills automatically appear in the agent's available set — zero extra configuration.
2. As a self-hosted user, I start the daemon with `CAIRN_SKILLS_DIR=/path/to/other`, and skills load from there, not `~/.agents/skills`.
3. As a skills author, I write `name: foo-deploy` in the SKILL.md frontmatter, and the pacman UI list, the agent.skills checkbox, and the agent-session available set all use the same `foo-deploy` — renaming the directory does not affect it.
4. As a long-skills author, the full skill text is not stuffed into the system prompt; the agent sees the catalog (name + description + location) and `read`s the SKILL.md itself when the description matches — token budget linear, not exponential.
5. As a conflict handler, I put same-named skills in two directories (different realpaths), pacman follows pi's "winner path" ruling, and the daemon log prints the collision diagnostic.
6. As a regression tester, the daemon unit tests cover: env default, env pointing to a missing directory, directory with no SKILL.md, frontmatter missing name fallback, directory conflict — all `loadSkills` diagnostics passed through.

## Implementation Decisions

### Module change list (decision points, no concrete file paths)

**shared**
- The existing `SkillRecord` wire shape kept; the `id` field semantics = frontmatter `name`, falling back to the directory name (compatible with spec 13's "directory-name id": agreed that when SKILL.md writes `name: <dir-name>` the two coincide).
- The `agent.skills` slug list = the same frontmatter `name`, no frontmatter = directory name.
- `SessionOpts` adds no field — the daemon does not go through the SDK's "pass paths and let pi scan" path; it scans and stitches into the existing `systemPrompt` field itself.
- **Log prefix extends `skills`**: `DAEMON_LOG_PREFIXES` adds `'skills'` (standing beside the seven supervisor / machine / step / workspace / recover / wake / mcp); the `DaemonLogPrefix` union + `DaemonLogger` interface + `createDaemonLogger` implementation add a `skills(msg)` method (same type as `mcp(msg)`). This is the canonical landing spot for spec 14's diagnostic line shape `[skills] <type>: <msg>`.

**server**
- No change (spec 13's `GET /api/skills?teamId=` live-scan already suffices for the UI; this spec reuses its result for daemon-side comparison, but the daemon reads the local directory directly, not through the server — under the self-host single-machine model a server hop has no benefit).

**daemon**
- `apps/daemon/src/config.ts`: add `skillsDir: string` (schema), default = `env.CAIRN_SKILLS_DIR ?? join(homedir(), '.agents', 'skills')`. Env priority above the home default (continuing the existing settings seam discipline).
- `apps/daemon/src/backend/pi.ts`: before `createAgentSession({...})`, add a new step:
  1. `loadSkills({ cwd: config.home, agentDir: '<a non-existent pi-default path>', skillPaths: [skillsDir], includeDefaults: false })` → `{ skills, diagnostics }` (**`cwd` uses the daemon home, not the task worktree** — avoiding worktree switches causing project-level skills resolution jumps)
  2. catalog byte budget (#1116, 2026-10-10 user ruling switched tracks; the old "50-count gate + 200-char description truncation" retired): the visible set is decided by the binding surface (#372 allowlist ∩ #1106 injection selection; chief = trusted-surface full set), the budget only backstops prompt bloat — after catalog rendering it counts by **UTF-8 bytes** (CJK honest, not `.length`), on exceeding `SKILLS_CATALOG_BUDGET_BYTES` (1 MiB, aligned with the Multica pack-archive single-file tier) it **drops from the tail by priority** (priority = injection-selection order > allowlist order > the scan order with team directory first — the binding array order is exactly the user's sort/pin operation surface), and it is **not silent**: `[skills] budget: total=<B> budget=<B'> dropped=<N>: <names>` logs the names + the catalog tail appends an `<omitted_skills reason="byte-budget">` section (the agent itself can see who is missing). description no longer truncated (routing evidence full; the budget gate already covers the cost semantics).
  3. `formatSkillsForPrompt(skills, fileReadTool)` → catalog XML string
  4. ~~append the catalog to the end of `SessionOpts.systemPrompt`~~ → **the landing spot moves to the brief-file channel** (spec 24 / #958): the catalog content is still produced by this step, but the runner writes it into the task worktree's context file (pi: `AGENTS.md` family; claude-code: `CLAUDE.md`), loaded through the CLI's native memory mechanism; the systemPrompt channel is emptied for these backends. The stitching semantics unchanged (`\n\n` separator, appended to the runner-given body rather than overwriting). **Do not read these two things as contradictory**: item 1's "`cwd` uses the daemon home" is about the **scan position** of the skill directory (not jumping with worktree switches); this item's "write into the worktree" is about the **brief-file landing spot** — the scan position stays, the landing spot changed
  5. `diagnostics` passes through via `logger.skills` the "`[skills] <type>: <msg>`" family
- How `agentDir` fills "non-pi-default": pass an absolutely non-existent value like `join(homedir(), '.pacman-no-such', 'agent')`, forcing pi to skip the user-default scan; or read pi's source to confirm whether a "disable only user-default, not project-default" flag exists — if not, backstop with a non-existent path.
- **The read-tool reachable-path set extends the skills root**: the existing read-tool path allowlist (`apps/daemon/src/runner.ts`, per-task worktree boundary) must include `skillsDir`, otherwise the agent's `read SKILL.md` on a description match is rejected by the sandbox — **the hard blocking point that breaks spec 14's path; without fixing it this spec cannot ship**.

**web**
- No change (spec 13 already deleted the upload/import page; the UI read-only list already there).
- If a UI configurability surface is wanted later (one input on the account page), it is a later ticket per spec 13's "Out of Scope".

**i18n**
- No new copy.

**verify / e2e**
- daemon unit tests: `loadSkills` output assertions across five input states (env default / env points to missing / directory with no SKILL.md / frontmatter missing name fallback / directory conflict).
- verify-pacman feature map adds an entry "skills catalog injected into the system prompt after daemon session start" (with a capture fixture of a mock agent session).
- end to end: drop a fixture directory with SKILL.md under `~/.agents/skills/foo/`, run a passing task, assert the transcript shows the agent actively `read`ing SKILL.md (proving the catalog triggered on-demand read).

### Data contracts

- env: `CAIRN_SKILLS_DIR` — single string, dir path (default `~/.agents/skills`). Missing / non-existent directory = empty skill set (same rule as spec 13).
- daemon log: the `[skills] <type>: <msg>` family (`<type>` ∈ `loaded | collision | invalid-frontmatter | missing-skill-md | filtered | budget | catalog`), info level. #1116 ②: within collision, **content byte-for-byte identical mirrors** (the common single-machine shape where server skillsDir = daemon skillsDir) merge into one line `collision: <N> identical mirror(s) deduped (team view wins; budget counts the merged set once)` — per-entry lines are reserved for real content conflicts; the `catalog: entries=<N> chars=<C> bytes=<B>` observation line always lands (bytes = the budget caliber).
- SessionOpts.systemPrompt: the existing user-side stitching `+ '\n\n' + formatSkillsForPrompt(skills, 'read')`. `fileReadTool` passes `'read'` — the pacman daemon carries the `read` tool by default.

## Testing Decisions

Testing leans behavior contract, not implementation details.
- daemon unit tests: env default value, env unset, env pointing to a missing directory, directory exists but empty, directory with a normal skill, directory with a skill whose frontmatter misses name (fallback to directory name), directory conflict with two same-named skills (winner-path ruling).
- integration: start daemon + mock skill dir + mock agent session, assert session.systemPrompt contains the catalog XML; when the agent `read`s a SKILL.md, the daemon transcript contains the SKILL.md full text (proving the on-demand-read path works).
- regression: the existing 24 / integration tests must not fail from the systemPrompt append (the catalog is tail-appended, not overwriting existing sections).

## Out of Scope

- UI configurability (an account-page input) — spec 13 already deferred; this spec does not restart it.
- skills auto-follow (file watcher, reloading sessions on directory change) — this spec does not introduce it, it would complicate the daemon state machine; the user restarting the daemon takes effect.
- project-level skills (a `<cwd>/.pi/skills` analog) — this spec does not introduce it; spec 13's single-source-of-truth principle continues.
- the UI exposure of pi's `disable-model-invocation` frontmatter field — pacman UI does not distinguish catalog / skill, lists all as catalog per the agentskills.io standard, skill invocation goes through `/skill:<name>` explicit triggering (whether pi exposes the `/skill:` command is out of this spec's scope).
- runtime filtering of skills against per-agent authorization (the `agent.skills` checkbox) — this spec injects the full catalog; per-agent filtering goes to a later ticket (isomorphic to MCP's "agent edit-surface candidate-source switch").

## Team Skill Materialization Swing-back (XMON-112 S2, 2026-10-01)

spec 13 fixed the skill store's server-side write path (XMON-109 S1: REST write surface + the machine-wire delivery endpoint `GET /api/machine/skills/{stepId}`). This section fills the daemon consumption half: team skills' **step-level materialization** — without it, an agent-created skill is only visible in the server projection (the server directory ≠ each daemon's directory), and no machine's session can use it.

### Data flow

On step start (before the runner builds the session) pull the skill pack by stepId — the server packaging rule: worker step = the claim `agent.skills` allowlist ∩ the server-side live scan; chief step = trusted-surface full set; the byte gates single file ≤ MAX_SKILL_FILE_BYTES, pack total ≤ MAX_SKILL_TOTAL_BYTES, exceeding = 400 naming the item (the S1 surface) — materialize into a local cache directory, pass `SessionOpts.teamSkillsDir` to the backend, and `buildSkillsCatalog` merge-scans with the local `skillsDir`.

### Cache strategy (content-addressed)

- Cache root = `<CAIRN_HOME>/team-skills/`; an entry = `<sha256(pack deterministic serialization)>/`, under it one `dirName/` subdirectory per skill (files written byte for byte, including nested relative paths).
- Hit means reuse: the same pack across steps has zero rewrite, the directory mtime touched (LRU treats it as most-recently-used); content changes = a new hash directory. Why content-addressed rather than mtime-invalidated: the daemon cannot know the server-side directory mtime, while the pack-content hash naturally covers every "server changed any file" case, and concurrent steps hitting the same directory are naturally idempotent.
- Write atomicity: `.tmp-*` directory + rename to land — a half-written directory never visible under its hash name; a concurrent race where rename fails and the target already landed = same content, just reuse.
- Lifecycle: mtime LRU pruning, keep cap `TEAM_SKILLS_CACHE_MAX_ENTRIES = 16` (pack total ≤ 2MB, disk ceiling ≈ 32MB); crash-leftover `.tmp-*` reclaimed together. Pruning best-effort, failure only logs and does not affect this step.
- Path safety (defense in depth): the server write surface already has a directory-safe regex and relative-path guard (S1); the daemon independently re-checks each `dirName` (single segment, not `.`/`..`, no separators) and file `path` (relative posix, no empty segment / `.` / `..` / backslash / absolute path) — any illegal = **reject the whole pack** (a `team-invalid` line), never write partially.

### Merge and conflict ruling (team wins)

- `skillPaths` order = `[teamSkillsDir, skillsDir]`: pi `loadSkills` is first-wins (the first into the Map wins), same-name conflicts **team entry wins**, the local shadow lands a collision diagnostic line (winner=team path, loser=local path) — the allowlist grant is the authoritative signal, a local same-name shadow is void.
- The byte budget applies to the **post-merge (deduped) sequence** (#1116 ②): team entries at the scan-sequence front = high priority tier, when over budget the local tail entries drop first; mirror overlap does not double-eat the budget (identical mirrors merge into one line, catalog entries counted once). The allowlist filter still runs before the budget (#372 semantics unchanged, out-of-list team entries are also cut, `[]` = zero-injection discipline unchanged).
- loaded line: team directory present = `loaded: N skills from <teamDir> + <localDir>`; pure local = the original line shape unchanged.

### Degradation (same rule as spec 14 MCP degradation, the session is not blocked)

- Fetch failure (server unreachable / 4xx / 5xx; an old server without the endpoint 404 same-shape = version-wall fail-open) → `[skills] team-fetch-failed: <reason> — continuing with local skills only`, local skills only.
- Illegal pack / write failure → `[skills] team-invalid: <reason> — continuing with local skills only`.
- Empty pack `{skills:[]}` (empty allowlist) → zero materialization (the cache root not created), the catalog goes the pure-local path.
- **Zero-regression criterion**: with no `teamSkillsDir` (empty allowlist or fetch failure), `buildSkillsCatalog` output is **byte-for-byte equivalent** to before the change — a golden-sample comparison test freezes it (expected bytes = the actual output of the pre-change implementation frozen).

### Contract and log-family additions

- `SessionOpts` adds optional `teamSkillsDir?: string` (packages/shared, purely additive: old backends / old callers sense nothing; the consumption landing spot = the backend catalog build).
- The machine-wire response single source = `machineSkillsResponseSchema` (client-side zod parse cross-check, `MachineApi.skills(stepId)`).
- The `[skills]` log family adds four line shapes: `team: N skill(s) materialized → <dir>` / `team: N skill(s) cache hit → <dir>`, `team-invalid: …`, `team-fetch-failed: …`, `team-prune: failed …`.

## Manifest + On-Demand Pull Swing-back (#920, 2026-10-07)

S2's "one GET stuffs full text" distribution shape never succeeded against a real skill store: the two byte gates (single file 512,000 / whole pack 2,000,000) against the measured data (full store 104 skills / 1353 files / 18.40MB; a single archify asset 727,976 bytes exceeds the single-file gate) must overflow, and the daemon's fail-open degradation swallows the 400, so the remote machine's skill surface stays perpetually empty with no alarm (the local daemon log repeated the same text 43 consecutive failures). This section replaces the S2 section's distribution shape, cache topology and failure semantics three surfaces; the packaging selection rule (worker = allowlist ∩ live scan, chief = trusted-surface full set), merge and conflict ruling, the `SessionOpts.teamSkillsDir` contract, the path-safety guard and the zero-regression criterion are unchanged.

### Distribution shape (manifest + on-demand pull)

- `GET /api/machine/skills/{stepId}` → distribution manifest (response single source = `machineSkillsManifestResponseSchema`, client `MachineApi.skillsManifest(stepId)` zod parse cross-check): `selection` (`all` = chief trusted-surface full set / `whitelist` = the agent.skills allowlist intersection) + per skill the record three fields + dirName + file manifest (path / sizeBytes / sha256). The distribution surface sets no byte gate — after on-demand pull the single-request budget is a single file, store total is no longer the constraint; the write-surface gates (REST/relay's MAX_SKILL_FILE_BYTES / MAX_SKILL_TOTAL_BYTES) unchanged.
- `GET /api/machine/skills/{stepId}/file?dirName=&path=` (a new MACHINE_WIRE_EXTENSIONS registered bit, client `MachineApi.skillFile`) → a single in-manifest file's raw bytes (application/octet-stream, binary-honest — the old utf8 text projection corrupts non-text assets). The selection surface same-source as the manifest endpoint (skillsSelection recomputed, incl. realpath/id dedup): out-of-allowlist skills and out-of-manifest paths (unknown file / directory / symlink / escape shape) uniformly 404 without leaking existence.

### daemon cache topology (two-layer content addressing)

- The cache root `<CAIRN_HOME>/team-skills/` splits two layers: `blobs/<sha256>` single-file content store (write-once, tmp+rename atomic landing, mtime LRU cap `TEAM_SKILLS_BLOB_MAX_ENTRIES = 4096`) + `views/<sha256(manifest deterministic serialization)>` runtime read directory tree (one dirName/ subdirectory per skill, assembled from blobs via hardlink, cross-device falls back to copy; mtime LRU cap `TEAM_SKILLS_CACHE_MAX_ENTRIES = 16`).
- Incremental surface (#920 acceptance): pull only files locally missing or hash-different — changing one file transfers one file; manifest unchanged = view hit, zero requests. hardlink decouples the view and blob lifecycles: a blob path reclaimed by LRU does not damage an assembled view, and a view rebuild re-pulls missing blobs.
- Integrity: per-file sizeBytes + sha256 double-check before landing the blob, mismatch = explicit error (never materialize while sick).
- Write atomicity continues: view `.tmp-*` + rename, the failure path has no half-written view; the pre-#920 old-shape remnants (top-level content-addressed directories) reclaimed by prune together.

### Failure semantics (explicit error, no silent degradation to empty)

- Channel failure (server unreachable / 4xx / 5xx / illegal manifest / path escape / integrity-check mismatch / file on-demand pull failure) → throw `TeamSkillsError`, the runner closes as failed: `done.errorMessage` names `team skills distribution failed: <root cause>`, zero session creation. The S2 section's fail-open degradation (incl. the version-wall 404 shape) retires — silent degradation is exactly the shape #920 exists to kill.
- Empty manifest (200, `skills: []`) = the server has nothing to distribute as a configuration fact (empty allowlist / server skillsDir empty), not a channel fault: an explicit `team-manifest-empty` line (naming the selection context) + zero materialization, the session proceeds with local skills as normal.
- The `[skills]` log-family line shapes (replacing the S2 section's `team-invalid` / `team-fetch-failed` two shapes): `team: N skill(s), M file(s) materialized → <dir> (fetched K file(s) / B byte(s), reused R)` / `team: N skill(s) cache hit → <dir>` / `team-manifest-empty: … (selection=…) — running with local skills only` / `team-skills-failed: …` / `team-prune: failed …`.

## Further Notes

### Premortem (three causes of death + guardrails)

- **`CAIRN_SKILLS_DIR` points to a no-permission/unreadable directory** → guardrail: the daemon degrades to an empty set + `[skills] invalid: <msg>` log on `loadSkills` error, without killing daemon startup.
- **frontmatter `name` inconsistent with the directory name** → guardrail: pi's `loadSkills` already uses the frontmatter name as the primary key, the directory name only as the no-frontmatter fallback; this spec makes the semantics explicit, and the UI double-labels `directory name（name）` when ambiguous.
- **large skill content triggers prompt bloat** → guardrail: the catalog is an index, not full text (`formatSkillsForPrompt` does not expand by default); the agent reads full text on demand. The token budget only correlates linearly with catalog length, weakly with total skill length.

### Counterpart with spec 13

spec 13 locks skills' **source** (server live-scan, `GET /api/skills?teamId=`). This spec locks skills' **execution surface** (daemon loadSkills + catalog injection + agent on-demand read). The two specs are each other's half; landing order: spec 13 / T1 first, then this spec / T3 — T1's server live-scan is a reference T3 can borrow from (the same scan logic can be the alternative implementation of the daemon load, but the daemon currently reading the local directory directly is lighter).

### Cadence

One construction ticket T3, no lane blocking:
- **T3 skills execution-surface injection** (daemon): env config + loadSkills wiring + systemPrompt stitching + logging + unit tests + integration.
T1 (#367) does not block T3 but shares the wire shape; after T1 completes, open T3 and let lane367 self-review that the "frontmatter name fallback" contract is expressed consistently across both specs.

## Acceptance Criteria

- [ ] `apps/daemon/src/config.ts` adds the `skillsDir` field, env `CAIRN_SKILLS_DIR` overrides the default `~/.agents/skills`; missing / non-existent = empty skill set without error
- [ ] before `createAgentSession` in `apps/daemon/src/backend/pi.ts` inject the catalog: `loadSkills` (`cwd: config.home`, `includeDefaults: false`, `skillPaths: [skillsDir]`) + `formatSkillsForPrompt(skills, 'read')` stitched to the end of systemPrompt
- [ ] **the read-tool reachable-path set includes the skills root** — this is the hard acceptance of this spec's path connectivity; the end-to-end test asserts the agent's `read SKILL.md` is not rejected by the sandbox
- [x] the catalog byte budget takes effect (#1116 track switch; the old "50-entry cap + 200-char description truncation" retired): the 99-skill store enters the catalog fully; over budget it drops from the tail by binding order + `budget:` log naming + the `<omitted_skills>` catalog tail section; CJK counted by UTF-8 bytes; description no longer truncated
- [ ] `DAEMON_LOG_PREFIXES` adds the `'skills'` vocabulary entry; the `DaemonLogger.skills(msg)` method implemented; `isLogPrefix` validation passes; formatLine outputs `[skills] msg`
- [ ] the daemon log family "`[skills] <type>: <msg>`" outputs one example each of loaded / collision (incl. the identical-mirror merge line) / invalid-frontmatter / missing-skill-md / filtered / budget / catalog (fixture-verified)
- [ ] daemon unit tests cover the five input states + budget four states (full / over / boundary / priority) + read-tool reachability
- [ ] integration: daemon + mock skill dir + mock agent session verifies session.systemPrompt contains the catalog XML, and when the agent calls `read SKILL.md` the transcript contains the SKILL.md full text
- [ ] `pnpm lint` + `pnpm typecheck` + the relevant e2e and integration tests all green
- [ ] existing 24 / integration no regression

## Out of Scope (restated)

- project-level skills (`<cwd>/...` shape)
- file watcher / auto reload
- UI configurability
- per-agent runtime filtering (already revised twice by the #372 allowlist and #917 hard block below; this item no longer holds)
- the explicit exposure of pi's `/skill:<name>` command (at pi's own cadence)

## Skill Visibility Surface Fold-in (#917, 2026-10-07)

After #958 / spec 24 moved the brief (incl. this spec's skills catalog) into the worktree context-file channel, it cross-ruled #917's four calibers (source of truth = the same-named comment inside issue #917): caliber 1 (pacman directory injection becomes the sole source, cancel `SKILLS_CATALOG_CAP`) and caliber 2 (turn off the Claude Code native Skill tool surface) are **shelved** — the brief now depends on the native context-file channel, the "turn off the native surface" direction no longer holds; caliber 3 (explicit `settingSources`) and caliber 4 (allowlist hard block) promote to the brief channel's **landing prerequisites**, landing with this ticket. Also one finding surfaced during #958 wiring folds back into this ticket: pi's resource loader auto-injects an `<available_skills>` section (the duplicate-list problem predates pacman's catalog injection), fold-in goes to this section. This section is the post-ruling landing source; where it conflicts with the earlier text, this section wins.

**#1116 supplement (2026-10-10 user ruling)**: the earlier "cap-50 gate and description 200-char truncation stay as-is" item is **voided** — the cap caliber switches tracks to "byte budget + per-agent binding" (source of truth = the user ruling comment in issue #1116; landing sees the "catalog byte budget" section above): the visible set = the binding set (#372 ∩ #1106; chief = trusted-surface full set), the budget counts UTF-8 bytes (1 MiB, aligned with the Multica pack-archive single-file tier), over budget it drops from the tail by binding priority and is non-silent (`budget:` log naming + `<omitted_skills>` catalog tail section); the identical-mirror collision diagnostic merges for noise reduction, the budget counts the deduped set. Caliber 2 (turn off the native surface) stays shelved.

### The post-ruling scope (item by item)

1. **Explicit settingSources (caliber 3)**: the claude-code backend pins `settingSources: ['user', 'project', 'local']` when assembling SDK Options — changing "rely on SDK defaults (omitted = load everything)" to "rely on product declaration". `'project'` is the load-bearing spot of the CLAUDE.md brief (spec 24 §channel drift: if this tier is turned off or missing, the brief **disappears with zero errors**); any later change touching this list must first re-verify the brief survives.
2. **Allowlist hard block (caliber 4)**: files of skills outside `agent.skills` must be **rejected on read**, not just absent from the catalog. Per backend:
   - **claude-code**: SDK `settings.permissions.deny` (the flag settings layer, the highest priority among user-controllable settings) emits three rules per unauthorized skill scanned out:
     ① `Read(//<baseDir>/**)` — the file-tool surface. The `//` prefix = the filesystem-root-anchored gitignore shape (the Claude Code permissions canon), the gitignore metacharacters (`\ * ? [ ]`) in the path backslash-escaped. deny rules take effect **in every permission mode including `bypassPermissions`** (official docs state it + `docs/verify/917/` artifact comparison: without a rule a bypass read succeeds, with the rule the same read is rejected), and a Read-surface deny on the same path also blocks Edit/Write (≥2.1.208 semantics; bundled CLI 2.1.278).
     ② `Skill(<name>)` + ③ `Skill(skill:<name>)` — the Skill tool surface. **Two measured mechanism facts decide this layer must exist independently**: a Read deny does **not** also block the Skill tool's content load (a Skill call reading SKILL.md does not go through the Read permission check — `docs/verify/917/` B4: with only Read deny, unauthorized skill content still enters the model context); while `Skill(<name>)` deny rejects the call under bypassPermissions and lands `result.permission_denials` (B5 artifact). The `skill:` prefix shape matches that skill's any name (alias / display name) per the official docs, double insurance alongside the exact shape.
     **The SDK `skills` option is not used**: the d.ts claims "unlisted skills are hidden from the model's listing and rejected by the Skill tool", but measured (`docs/verify/917/` run1 B2) it is only translated by the SDK into a `Skill(<name>)` **allow** rule — allow rules have no effect under bypassPermissions, and the native listing count does not move at all (122 → 122). The claim mismatches the implementation, discarded.
     A chief step (allowlist default) emits no deny rule (CLI default behavior zero regression). An empty allowlist (`[]`) = all scanned skills enter the deny set (the mirror of the directory zero-injection discipline).
     **Known residual**: the deny rules only cover pacman-scannable skills (under `CAIRN_SKILLS_DIR` + the team directory); entries on the machine's native directory (`~/.claude/skills`, plugins) that pacman does not know remain model-visible and callable — that is the shelved caliber 2's (turn off the whole native surface) territory, this section does not overreach. Artifact baseline: the local native listing 122 entries (B1).
   - **pi**: the built-in `read` is overridden with a same-named customTool into a gated version (#866 T5 gated bash same-shape, the pi registry is last-write-wins by name). The gate lands on `ReadOperations.readFile/access`: a path hitting the unauthorized skill's `baseDir` prefix throws rejection — **both sides realpath-normalized before the comparison** (macOS `/tmp` → `/private/tmp` symlink drift must not pass), the rejection goes into the tool error result (the agent sees the rerouted copy) + a `[skills] denied-read:` line. pi's `operations` is a **whole replacement** (read.js `options.operations ?? defaultReadOperations`), so `readFile/access/detectImageMimeType` three pieces must be present — the last piece passes through pi's root export `detectSupportedImageMimeTypeFromFile`, zero disturbance to the image-read surface.
   - **The unauthorized set single source**: `collectDeniedSkillDirs` (exported from backend/pi.ts, consumed by claude-code.ts through the existing backend seam channel) — same-argument scan as `buildSkillsCatalog` (teamSkillsDir first, first-wins), allowlist default → empty set; an out-of-list entry's `baseDir` is the deny target. Scattered files in the directory not scanned as skills are not this section's authorization surface.
   - **Known boundary (registered truthfully)**: the bash bypass (`cat <unauthorized SKILL.md>`) is not blocked by either backend — this section's hard-block coverage = the file-tool surface, literally consistent with caliber 4's "permission deny path rules"; sandbox-level convergence is not this ticket.
3. **pi native discovery shutoff (#958 fold-back)**: pi's `DefaultResourceLoader` passes `noSkills: true`, eliminating the pi auto-injected `<available_skills>` section (discovery surface = agentDir/skills and the `.pi/skills` family default directories). After the shutoff the pi-side skill directory is **only the brief-file channel** (AGENTS.md, produced by `buildSkillsCatalog`). `noContextFiles` / `agentsFilesOverride` are **untouched** — that is the AGENTS.md brief's load-bearing spot (spec 24 same rule).
4. **pi keeps the catalog (caliber 5)**: the two backends' skill-visibility difference takes this item as source of truth — pi = brief-file channel only (native discovery shut off); claude-code = brief-file channel + native listing (the listing itself kept per the shelved caliber 2, among which pacman-scanned unauthorized entries are hard-blocked by deny rules — both the file read and the Skill call sides, see item 2).
5. **Observation**: the `[skills]` log family adds three line shapes — `catalog: entries=<N> chars=<C>` (**every** catalog build lands, entries=0 also lands: a clear signal of the skill-directory count), `deny: <N> skill dir(s) hard-blocked` (lands only when the hard-block set is non-empty at session build), `denied-read: <path> (skill <name> not in allowlist)` (one line per pi-gate rejection). The claude-code side's per-rejection happens inside the CLI process, no per-rejection line in the daemon log — the observation surface = the transcript's tool result (isError) and `result.permission_denials`.

### Version compatibility

This section changes the wire/schema **zero** (`SessionOpts.skillsAllowlist` / `teamSkillsDir` / the machine skills endpoints are all #372 / XMON-112 existing surfaces; this section only changes the daemon in-process consumption) — new daemon × old server, old daemon × new server structurally compatible. Acceptance = the shared snapshot surface unchanged + integration all green, no extra version-skew fixture.

### Acceptance (seam, both directions)

- **Unit tests**: the claude-code sdkOptions assembly surface (settingSources pinned; deny rules three shapes `Read(//…/**)` / `Skill(<name>)` / `Skill(skill:<name>)` with metacharacter escaping; chief emits no settings, the `skills` key never emitted); `collectDeniedSkillDirs` four states (default / partial authorization / empty list / unknown slug tolerance); pi gated read ops (unauthorized rejected with skill name, authorized passes, realpath normalization effective, image-mime surface present); `catalog:` / `deny:` log line shapes.
- **integration (skills-inject-e2e extended)**: take both sides' evidence in one run — worker step reads an **authorized** SKILL.md = the body marker lands (existing entry), reads an **unauthorized** SKILL.md = the tool result carries the rejection copy, its body marker does **not** land; after seeding a native skill in pi's agentDir, the stub-request surface does **not** show that skill's section (noSkills proof; before = the same harness red run without noSkills + the #958-era two-list coexistence wiring record); the `[skills] catalog: entries=` line lands.
- **Artifact evidence (docs/verify/917/, archived)**: real SDK/CLI (bundled 2.1.278 + real model) before/after comparison six pieces — A1/A2: deny rules block Read under `bypassPermissions` (no rule read succeeds / with rule the same read rejected, init.permissionMode bypass proven on both sides); B1: the native listing real-count baseline; B3/B4/B5: the Skill tool surface three states (no rule callable / Read-deny alone does not cascade block / `Skill(<name>)` deny rejects and lands permission_denials); C1: with explicit settingSources the CLAUDE.md brief channel survives. Mechanism claims always take runtime truth; reading source / reading config is not acceptance.