# How agent harnesses scope rules to paths, and how Cairn could scope `apps/web/DESIGN.md` (2026-11-20)

Question: how do existing agent harnesses load only the instructions that matter for the files being worked on, instead of one giant always-loaded file? Cairn's `apps/web/DESIGN.md` holds a 79-row rule table (ids P1–P6, C1–C25, V1–V30, L1–L9, T1–T4, A1–A4, R1) in one file. The Coordinator that writes task briefs never reads it, so lanes either get all of it (when an agent follows the AGENTS.md/CLAUDE.md pointer to `design-cairn`) or none.

Tag convention: **verified** = read first-hand in the named file or URL this session, or run live; **derived** = derived from verified facts, recheckable; **guess** = the rest.

Sources and pins:

- Cursor rules: `https://cursor.com/docs/context/rules`, fetched 2026-11-20. (verified)
- Claude Code memory/rules/skills/hooks: `https://code.claude.com/docs/en/memory.md`, `…/skills.md`, `…/hooks.md`, fetched 2026-11-20. (verified)
- OpenAI Codex: `https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs` (source, via search result snippet) and OpenAI's own doc mirrored at `https://learn.chatgpt.com/docs/agent-configuration/agents-md.md`, fetched 2026-11-20; corroborated by `https://docs.arantic.com/codex/agents-md` and `https://unwait.ai/blog/codex-agents-md`. (verified for the docs and the source docstring; the rust source body itself was seen only as an excerpt — flagged inline)
- Devin CLI: local docs at `/Users/xmon/.local/share/devin/cli/_versions/3000.14.30821/share/devin/docs/extensibility/{rules,skills/overview,hooks/overview,hooks/lifecycle-hooks}.mdx`, installed version 3000.14.30821. (verified)
- pi: `@earendil-works/pi-coding-agent@1.5.0` installed under the primary checkout at `/Users/xmon/Code/AgentProjects/cairn/apps/daemon/node_modules/@earendil-works/pi-coding-agent/` (this worktree has no `node_modules`); read `docs/configuration.md`, `docs/skills.md`, `docs/extensions.md`, `dist/core/resource-loader.js`, `dist/core/system-prompt.js`, `dist/core/skills.js`. (verified)
- Amp: `https://ampcode.com/docs/customize/agents-md`, fetched 2026-11-20. (verified)
- Cairn: this worktree — `apps/web/DESIGN.md`, `.claude/skills/design-cairn/SKILL.md`, `apps/daemon/src/backend/pi.ts`, `apps/daemon/src/backend/claude-code.ts`, `apps/daemon/src/backend/skills.ts`, `apps/daemon/src/brief-file.ts`, `apps/server/src/services/build-start.ts`, `packages/shared/src/records/prompts.ts`, `.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`. (verified)

## 0. Conclusions

1. **The dominant pattern is harness-side auto-attach on file access, not agent-side retrieval.** Four of six harnesses inject a rule when the agent *touches a matching file* (Read/Write/Edit or a shell read): Cursor `globs`, Claude Code `.claude/rules/` `paths:` plus lazy nested `CLAUDE.md`/`AGENTS.md`, Devin lazy subdirectory rules plus `trigger: glob`, Amp subtree `AGENTS.md` plus `globs:` on `@`-mentioned files. No model cooperation is needed. (verified, section 1)
2. **Every harness keeps a small always-on routing layer** — the root `AGENTS.md`/`CLAUDE.md`, rule descriptions, or skill name+description — that points to detail loaded later. Skills in Claude Code, pi and Devin all work this way: name+description always listed, body fetched on demand. Description routing is probabilistic; the docs themselves warn the model "might fail to load a relevant skill" (pi `docs/skills.md` line 45). (verified)
3. **Startup-only ancestor loading is the weakest common denominator.** pi loads `AGENTS.md`/`CLAUDE.md` from the agent dir + cwd + every ancestor at session start and nothing below cwd (verified in `dist/core/resource-loader.js` `loadProjectContextFiles`); Codex loads `~/.codex` + git-root→cwd only, once per run. A nested `apps/web/AGENTS.md` would never reach a pi or Codex lane. (verified)
4. **`node scripts/design-rules-for.mjs <paths>` is the right shared core but is not, by itself, the pattern prior art converged on.** A CLI the agent must remember to run is the "agent-requested" tier — the least reliable of the activation modes every harness offers. Prior art puts the trigger in the harness: glob frontmatter auto-attach, lazy subdirectory files, or a tool-hook that injects `additionalContext`. The better-fitting shape is the script as the single paths→rule-rows oracle, with one thin trigger adapter per harness that calls or embodies it. (derived, section 3)
5. **All three cairn harnesses have a deterministic adapter available today.** Claude Code lanes load project `.claude/rules/*.md` with `paths:` even when `disableAllHooks` is set (the daemon runs `settingSources: ['project']` in locked mode and rules are not hooks); pi lanes run cairn-registered `InlineExtension`s that can mutate `tool_result` — the exact analogue of Claude's `PostToolUse` `additionalContext`; Devin reads `.devin/hooks.v1.json` (`additionalContext` output) and lazily loads subdirectory `AGENTS.md`. (verified mechanisms; the Devin-managed-session behavior is derived — cairn drives Devin via `devin-acp.ts`/`devin-managed.ts`, and whether managed sessions honor `.devin/hooks.v1.json` is unverified)

## 1. Source findings

### 1.1 Cursor project rules

From `https://cursor.com/docs/context/rules` (verified):

- Project rules live in `.cursor/rules/` as **`.mdc` files** — one per rule, YAML frontmatter plus body. A plain `.md` file there is ignored. Folders inside `.cursor/rules/` (e.g. `frontend/components.mdc`) organize rules but are not a scoping mechanism.
- Frontmatter fields: `description`, `globs`, `alwaysApply`. Four activation types:

| `alwaysApply` | `description` | `globs` | Behavior |
|---|---|---|---|
| `true` | — | — | Always included (globs/description ignored) |
| `false` | — | provided | **Auto-attached when a matching file is in context** |
| `false` | provided | omitted | Agent reads the description and pulls the rule when relevant ("Apply Intelligently") |
| `false` | omitted | omitted | Only when `@`-mentioned in chat |

- Glob examples: `src/**/*.tsx`, `docs/**/*.md, docs/**/*.mdx` (comma-separated), `**/*.ts`.
- `@file` references inside a rule body are **not inlined** — "Agent reads the file with its tools when it needs the content."
- **Nested `AGENTS.md`**: "You can place `AGENTS.md` files in any subdirectory of your project, and they will be automatically applied when working with files in that directory or its children… combined with parent directories, with more specific instructions taking precedence." `AGENTS.md` is the metadata-free alternative to `.cursor/rules`.
- Also: User Rules (global), Team Rules (dashboard-managed).

### 1.2 Claude Code

From `code.claude.com/docs/en/memory.md` (verified):

- `CLAUDE.md`/`CLAUDE.local.md` load from cwd and **every directory above it** at launch, concatenated root→cwd. User `~/.claude/CLAUDE.md`, managed policy file, project `./CLAUDE.md` or `./.claude/CLAUDE.md`, `./CLAUDE.local.md`.
- **Subdirectory files load lazily**: "Claude also discovers `CLAUDE.md` and `CLAUDE.local.md` files in subdirectories under your current working directory. Instead of loading them at launch, Claude Code loads each one once Claude reads, writes, or edits another file in that subdirectory. Reading includes viewing the file with a Bash command that counts as a read, such as `cat` or `head` on a single file."
- `.claude/rules/*.md` — project rules directory (recursive, plus `~/.claude/rules/` user rules). YAML frontmatter **`paths:`** scopes a rule to globs; `paths` is the only frontmatter field read. "A path-scoped rule loads when Claude uses the Read, Write, or Edit tool on a matching file. It also loads when Claude views a matching file with a Bash command that counts as a read." Rules without `paths` load at launch like `.claude/CLAUDE.md`. Expansion budget: 1,000 patterns / 4 MiB per rule.
- `AGENTS.md` is read (v2.1.277+) when no `CLAUDE.md`/`CLAUDE.local.md` exists in cwd or ancestors; a subdirectory's `AGENTS.md` loads lazily when Claude opens a file there and that subdirectory has no `CLAUDE.md` of its own.
- `claudeMdExcludes` skips unwanted memory files in monorepos.

From `code.claude.com/docs/en/hooks.md` (verified):

- `PreToolUse`/`PostToolUse` hooks: `matcher` is a regex or `|`-list evaluated against **`tool_name` only** (`"Edit|Write"`), never the file path. Path filtering happens either in the handler's **`if` field** using permission-rule syntax — `"Edit(src/**)"`, `"Edit(*.ts)"` — or inside the hook script via `tool_input.file_path` (absolute) on stdin JSON.
- **`PostToolUse` supports `hookSpecificOutput.additionalContext`**: injected into Claude's context as a system reminder alongside the tool result (capped at 10,000 chars). `PreToolUse` does **not** support `additionalContext` — only `permissionDecision`/`permissionDecisionReason`/`updatedInput`.
- `SessionStart`, `UserPromptSubmit`, `UserPromptExpansion`, `Stop`, `SubagentStop`, `SubagentStart`, `ConfigChange`, `PreCompact` also accept `additionalContext`.
- `InstructionsLoaded` event fires "at session start and when files are lazily loaded during a session"; matcher values `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact` — confirming the two lazy-load mechanisms have names: `nested_traversal` (subdirectory memory files) and `path_glob_match` (`.claude/rules/` `paths:`).
- Settings locations: `~/.claude/settings.json` (user), `.claude/settings.json` (project, committable), `.claude/settings.local.json` (gitignored), managed settings; hooks can be globally disabled with `disableAllHooks`.

From `code.claude.com/docs/en/skills.md` (verified):

- `SKILL.md` frontmatter `name`+`description` "helps Claude decide when to load the skill automatically"; "a skill's body loads only when it's used". Skills live at project `.claude/skills/`, personal, enterprise, plugin locations; nested `<subdir>/.claude/skills/` "loads once Claude works on files there".

### 1.3 OpenAI Codex

From OpenAI's doc (`learn.chatgpt.com/docs/agent-configuration/agents-md.md`) and `codex-rs/core/src/agents_md.rs` docstring (verified):

- **Global scope**: `$CODEX_HOME` (default `~/.codex`) — `AGENTS.override.md` if it exists, else `AGENTS.md`; first non-empty file wins.
- **Project scope**: from the project root (default marker `.git`, configurable `project_root_markers`) **walk down to cwd**. Per directory: `AGENTS.override.md` → `AGENTS.md` → `project_doc_fallback_filenames`; at most one file per directory.
- Files concatenated root→cwd separated by blank lines; closer files win conflicts by appearing later. Combined cap `project_doc_max_bytes` = 32 KiB. Built **once per run**.
- **No lazy loading below cwd** (verified in docs.arantic.com's summary of vendor docs and corroborated by unwait.ai quoting the Codex 0.147.0 system prompt: "The contents of the AGENTS.md file at the root of the repo and any directories from the CWD up to the root are included… More-deeply-nested AGENTS.md files take precedence in the case of conflicting instructions"). An `AGENTS.md` in `services/payments/` is never loaded when codex starts at the repo root. The source file's own docstring confirms "We do **not** walk past the project root" and collects "from the project root down to the current working directory".
- No built-in glob-scoped rule mechanism found (derived — no such feature appears in the discovery code or docs read).

### 1.4 Devin CLI

From `…/docs/extensibility/rules.mdx` (verified, installed version 3000.14.30821):

- Rule files read as always-on: `AGENTS.md` (recommended), `AGENTS.local.md`, `AGENT.md`, `.windsurfrules`, `CLAUDE.md`. Global: `~/.config/devin/AGENTS.md`, and `~/.claude/CLAUDE.md` is also read.
- **Lazy subdirectory discovery** (rules.mdx line 112): "Files at the workspace root are loaded at session start. Files in subdirectories are discovered lazily when the agent accesses files in that directory, keeping the context focused on the relevant part of the codebase." Same for `.windsurf/rules/` subdirectories (line 168): "when the agent accesses files in that directory, any `.windsurf/rules/` found there (and in parent directories up to the workspace root) are automatically loaded."
- `.devin/rules/*.md` — one rule per file with `trigger` frontmatter: `always_on`, `manual`, `model_decision`, `agent`, `glob`. `.devin/global_rules.md` single always-on file. `.devin/` takes precedence over `.windsurf/`; both directories are read at workspace root and each directory between root and cwd; `~/.devin/rules/` and `~/.devin/global_rules.md` apply globally.
- Activation types table (line ~216): always-on / **glob-activated** ("Active when the agent works with files matching specific patterns") / agent-decided / user-invocable.
- Also reads `.cursor/rules/*.md` + `*.mdc` with the same frontmatter semantics, and `.claude/` content. `read_config_from` config toggles imports per tool.
- Guidance (line 11): "we highly recommend **using Skills instead whenever possible**. Skills are only injected into the context when relevant. **Rules and AGENTS should be kept as small as possible.** … use a rule to reference skills that the model should use in particular scenarios."

From `…/docs/extensibility/skills/overview.mdx` (verified): skills at `.devin/skills/`, `.agents/skills/`, `.windsurf/skills/`, `.kiro/skills/` plus global dirs and other tools' dirs (`.claude/skills/`, `.codex/skills/`); frontmatter `allowed-tools`, `triggers: [user|model]`; the agent invokes relevant skills autonomously.

From `…/docs/extensibility/hooks/overview.mdx` + `lifecycle-hooks.mdx` (verified):

- `PreToolUse` (can "block, modify, or **add context** to tool calls"), `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `PostCompaction` etc. `matcher` is a regex on `tool_name` only; path filtering inside the script via `tool_input`.
- Output format: `hookSpecificOutput.additionalContext` injects text into context (PreToolUse explicitly advertised; the field is part of the shared output spec for `PreToolUse`/`PostToolUse`/etc. — verified for the format; a PostToolUse-specific example is not shown, derived).
- Hook config: `.devin/hooks.v1.json` (recommended), `.devin/config.json` `hooks` key, `~/.config/devin/config.json`; "Existing hooks in `.claude/` directories are also picked up automatically." Project hook files discovered in cwd and ancestors up to repo root.

### 1.5 pi (`@earendil-works/pi-coding-agent@1.5.0`)

From installed docs and source at `/Users/xmon/Code/AgentProjects/cairn/apps/daemon/node_modules/@earendil-works/pi-coding-agent/` (verified):

- **Context files** (`docs/configuration.md` lines 41–47 + `dist/core/resource-loader.js` lines 129–210): candidates `AGENTS.override.md` → `AGENTS.md` → `AGENTS.MD` → `CLAUDE.md` → `CLAUDE.MD`, **at most one file per directory**, loaded from the agent dir (`<agent-dir>`, default `~/.pi/agent`), the working directory, and **every parent directory up to the filesystem root** — at startup. "A context file applies whenever Pi runs in its directory or anywhere below it." An `AGENTS.override.md` replaces `AGENTS.md`/`CLAUDE.md` in the same directory only. Worktree-aware dedup (`findShadowedContextFile`). **No lazy subdirectory loading and no glob-scoping** — confirmed in the `loadProjectContextFiles` source (walks `dirname` upward only).
- Rendered into the system prompt at session build as `<project_instructions path="…">` blocks (`dist/core/system-prompt.js` lines 25–99, called from `agent-session.js:1322`). Project `.pi/APPEND_SYSTEM.md` / `.pi/SYSTEM.md` append/replace the system prompt (trust-gated).
- **Skills** (`docs/skills.md` + `dist/core/skills.js` `formatSkillsForPrompt` lines 278–302): at startup each skill's `<name>`, `<description>`, `<location>` goes into `<available_skills>` in the system prompt; the prompt text tells the model "**Use the read tool to load a skill's file when the task matches its description**". `disable-model-invocation: true` hides a skill from model selection. Also `.agents/skills/` discovered cwd→ancestors→repo root (skills.md line 61).
- **Extensions** (`docs/extensions.md`, verified): `pi.on('tool_call')` can block or mutate tool input; `pi.on('tool_result')` can **modify the tool result content** — the pi equivalent of Claude's `PostToolUse` `additionalContext`, since the appended text lands in the model's context as part of the tool result. Event input carries `event.input.path` for `read`/`write`/`edit` and `event.input.command` for `bash`.
- How cairn consumes it (`apps/daemon/src/backend/pi.ts`, verified): `PiBackend` builds `DefaultResourceLoader` with `noSkills: true` and cairn's own `agentDir` (line 1167–1184) — pi's own skill discovery is off, cairn composes its own skills catalog into the brief via `composeSkillsSection`/`appendSkillsCatalog` (`apps/daemon/src/backend/skills.ts` lines 104–198; `pi.ts` lines 922–951). Context-file loading is not disabled, so a pi lane's system prompt does include ancestor `AGENTS.md` files below the agent dir (derived — `loadProjectContextFiles` is part of `DefaultResourceLoader.reload()`; no cairn code removes it). Cairn already registers an `InlineExtension` `gateExtension` on `tool_call` (`pi.ts` lines 1112–1139), so a second inline extension on `tool_result` is a proven in-repo pattern.

### 1.6 Amp

From `https://ampcode.com/docs/customize/agents-md` (verified):

- `AGENTS.md` in cwd + parent directories (up to `$HOME`) always included; **`AGENTS.md` files in subtrees are included when the agent reads a file in the subtree** — lazy attach on read. Fallback names: `AGENT.md`, `CLAUDE.md`. System-wide `/etc/ampcode/AGENTS.md`, `~/.config/amp/AGENTS.md`, `~/.config/AGENTS.md` always; workspace-level Global AGENTS.md from settings.
- **`@`-mentions with `globs:` frontmatter**: an `AGENTS.md` line like `See @docs/*.md` pulls in mentioned files; a mentioned file whose frontmatter sets `globs: ['**/*.ts','**/*.tsx']` is "only be included if Amp has read a file matching any of the globs". Without `globs` it is always included. Globs implicitly prefixed `**/`. This is glob-scoped granular guidance through plain markdown.
- `AMP_IGNORE_GUIDANCE_FILES` colon-delimited glob list disables matching guidance files.
- Docs explicitly recommend the monorepo shape: "keep the top-level `AGENTS.md` general and create more specific `AGENTS.md` files in subtrees for each subproject."

## 2. Comparison table

| Source | Mechanism for path scoping | How the agent is told to load it | Trade-offs | Link |
|---|---|---|---|---|
| Cursor | `.cursor/rules/*.mdc` `globs:` auto-attach when matching file in context; nested `AGENTS.md` auto-applied when working under its directory | Automatic (harness attaches); `description`-only rules and `@`-mention are agent/user-invoked | Deterministic glob attach; `.mdc` is Cursor-specific; "file in context" granularity depends on what Cursor counts as context | https://cursor.com/docs/context/rules (verified) |
| Claude Code | `.claude/rules/*.md` `paths:` globs (loads on Read/Write/Edit or `cat`-style shell read); lazy nested `CLAUDE.md`/`AGENTS.md`; `PostToolUse` hook `additionalContext` (+`if: "Edit(glob)"` or script-side `file_path` match); `InstructionsLoaded` audit event | Automatic on file access; skills route by description | `paths:` rules are not hooks → survive `disableAllHooks`; hooks are richer (arbitrary rows per path) but die under `disableAllHooks`; PreToolUse has no `additionalContext` | https://code.claude.com/docs/en/memory.md, …/hooks.md, …/skills.md (verified) |
| OpenAI Codex | None built-in; `AGENTS.override.md`/`AGENTS.md` merged `~/.codex` + git-root→cwd at session start, 32 KiB cap | Always-on only — nothing lazy, nothing glob-scoped | Simplest model; subdirectory files below cwd never load; per-path scoping would have to ride in the prompt | https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs (verified) |
| Devin CLI | Lazy subdirectory `AGENTS.md`/rule files "when the agent accesses files in that directory"; `.devin/rules/*.md` `trigger: glob`; reads `.cursor/rules` + `.windsurf/rules` too; PreToolUse/PostToolUse hooks with `additionalContext` | Automatic on file access (lazy files, glob trigger, hook); `model_decision`/`agent` triggers and skills are model-invoked | Broadest importer — honors almost every convention; hook-based path scoping needs a script-side `tool_input` match; whether cairn's managed Devin sessions honor `.devin/hooks.v1.json` is unverified | `/Users/xmon/.local/share/devin/cli/_versions/3000.14.30821/share/devin/docs/extensibility/rules.mdx`, `…/hooks/overview.mdx` (verified) |
| pi 1.5.0 | None for context files (agent-dir + cwd + ancestors at startup only — source-verified); skills: name+description+path in `<available_skills>`, model `read`s `SKILL.md` on match | Automatic at startup for ancestors; model-invoked via the `read` tool for skills; extensions can mutate `tool_call` input and `tool_result` content | No lazy/glob rules natively — but cairn owns the runtime and can add an `InlineExtension` `tool_result` injector, the deterministic equivalent | `…/pi-coding-agent/docs/{configuration,skills,extensions}.md`, `dist/core/{resource-loader,system-prompt,skills}.js` (verified) |
| Amp | Subtree `AGENTS.md` included when the agent reads a file in the subtree; `@`-mentioned files with `globs:` frontmatter included only after reading a matching file | Automatic on file access | Elegant: glob scoping expressed in plain markdown via mentions; Amp-only convention; no hook layer documented | https://ampcode.com/docs/customize/agents-md (verified) |

## 3. The pattern that fits Cairn

Prior art converges on a three-tier architecture (derived from section 1):

1. **A small always-on layer that routes** — the root instruction file and one-line descriptions/ids. Every harness keeps this cheap.
2. **A deterministic trigger on file access** — the rule arrives when the agent first touches a file it governs. Cursor `globs`, Claude `.claude/rules/` `paths:` and lazy nested files, Devin lazy files + `trigger: glob` + hooks, Amp subtree+globs: four independent implementations of the same idea. The trigger is harness-side; the rule rides in as injected context (`additionalContext`, mutated tool result, or a lazily attached file).
3. **An on-demand body** — skills, `@`-referenced files, or a CLI — fetched when the small layer or the trigger says so.

Assessed against the proposal, `node scripts/design-rules-for.mjs <paths>` is exactly tier 3 done right: one oracle, one source of truth (the `DESIGN.md` table), printable into any context. But on its own it is "agent-requested" — the same probabilistic tier as a skill description, and the failure mode is identical to today's: the lane never runs it. What prior art adds is tier 2: **per-harness deterministic triggers that call or embody the same oracle**. The good news is all three cairn harness families have a native trigger:

- **Claude Code lanes**: `.claude/rules/*.md` with `paths:` frontmatter is the deterministic attach, and uniquely it survives `disableAllHooks` (cairn sets that flag for locked sessions at `apps/daemon/src/backend/claude-code.ts:1490`) because rules are not hooks. `settingSources: ['project']` in locked mode still loads project rules (claude-code.ts:1475; the memory doc ties project rules to the `project` source). The richer alternative — a `PostToolUse` hook calling the script and returning `additionalContext` — supports arbitrary per-id filtering but is dead in locked sessions; keep it as an optional addition for interactive human sessions, not the lane mechanism.
- **pi lanes**: cairn already registers `InlineExtension` factories (`pi.ts` lines 1112–1184). A `tool_result` handler on `read`/`edit`/`write` (and `bash` inputs whose command names a file under scope) can run the same paths→rows mapping and append the matching rows to the tool result — functionally identical to Claude's `PostToolUse` `additionalContext`, deterministic, and entirely inside cairn's own code.
- **Devin lanes**: two verified triggers — a nested `apps/web/AGENTS.md` (lazily loaded when the agent accesses files there; also free coverage for Amp-style and Claude-style lazy subdirectory loading) and `.devin/hooks.v1.json` `PreToolUse`/`PostToolUse` hooks emitting `additionalContext`. The hook route is unverified for cairn's ACP/managed Devin sessions; the nested file route is verified in the CLI docs and zero-config.
- **The Coordinator's brief**: `design-cairn/SKILL.md` already defines the brief field "Rules: read apps/web/DESIGN.md; the ids that apply here: <…>". With the same mapping available to the dispatcher, the brief can carry the resolved rows (or just ids) at dispatch time — the fallback channel that reaches every harness including Codex-style always-on-only ones.

Two structural prerequisites fall out of this (derived):

- **The rule table needs scope metadata before any trigger can filter.** Today every rule implicitly scopes to `apps/web/src/**`, so a paths→rows function can only return "the file is in scope → all 79 rows" or "out of scope → nothing". The useful granularity is a per-rule scope column (e.g. L5–L9 → `apps/web/src/components/sidebar/**` + `sidebar` surface, C11/C13–C18 → conversation surfaces, C19–C25 → settings/pickers, P*/V*/T*/A*/R* → all of `apps/web/src`). `docs/design/surfaces/*.md` already partitions the product into named surfaces; the mapping can reuse those names.
- **One implementation, thin adapters** (Cursor's own shape: one `.mdc` format, four activation modes). The script emits rows; each adapter is <100 lines deciding when to inject them.

Rejected alternatives (derived):

- *Nested `apps/web/AGENTS.md` containing all rules*: reaches Devin/Amp/Claude lazily but never reaches pi (startup ancestors only, source-verified) or Codex (root→cwd, docstring-verified) — cairn's own pi lanes are the majority of dispatched work, so this alone fails.
- *A skill telling the agent to run the script*: pure description routing — the docs-warned probabilistic tier; it is the right *additional* advertisement (`design-cairn` can name the script), not the mechanism.
- *Stuffing all 79 rows into the brief*: works but is the giant-always-loaded-file problem restated at dispatch time.

## 4. Recommendation

Build `scripts/design-rules-for.mjs <paths…>` as the shared oracle, then wire the three harness-native triggers plus the dispatcher:

1. **`apps/web/DESIGN.md` + a generated scope map** — add a `Scope` column (or a checked-in `apps/web/design-rule-scopes.json` generated/validated from the table, the way `scripts/generate-feature-map.mjs` backs `feature-map.json`) mapping each rule id to globs under `apps/web/src` and/or a surface name. A prepush/CI check holds the map in sync with the table (mirroring `ui-page-style-gate` discipline).
2. **`scripts/design-rules-for.mjs`** — parses the table + scope map, prints the matching `Id | Rule | Check` rows for the given paths (empty ⇒ "no scoped rules"). Pure read; usable by humans, hooks, extensions and the Coordinator.
3. **Claude Code**: generated `.claude/rules/design-<scope>.md` files (one per scope group) with `paths:` frontmatter, each body = the same rows the script prints, regenerated by a script and asserted in tests — deterministic attach, works in locked lanes.
4. **pi**: a `cairn-design-rules` `InlineExtension` registered beside `gateExtension` in `apps/daemon/src/backend/pi.ts` (`extensionFactories`, lines 1175–1183): on `tool_result` for `read`/`write`/`edit`/`bash`, extract the touched path(s), invoke the mapping (in-process, not via subprocess — the same module the CLI wraps), append matching rows to the result content once per file per session.
5. **Devin**: add `apps/web/AGENTS.md` — a short pointer file ("Before editing here: run `node scripts/design-rules-for.mjs <paths>`; P-rules and V-rules always apply; load `design-cairn` for UI tasks") — which lazily loads in Devin, Amp, and Claude Code's nested-AGENTS.md path. Optionally `.devin/hooks.v1.json` `PostToolUse` for the deterministic attach, after verifying managed sessions read it.
6. **Dispatcher**: wherever the Coordinator's brief text is assembled for tasks touching `apps/web/src` (`apps/server/src/services/build-start.ts:158` `[SESSION_BRIEF, input.prompt, lessons]` and `packages/shared/src/records/prompts.ts` `SESSION_BRIEF`), resolve scope→ids via the same map and fill the `design-cairn` brief template's `Rules:` field — ids only, not full rows.

Code areas touched: `apps/web/DESIGN.md` (scope metadata), new `scripts/design-rules-for.mjs` + a generator/test pair, `.claude/rules/` (generated), `apps/daemon/src/backend/pi.ts` (new inline extension), `apps/web/AGENTS.md` (new), optionally `.devin/hooks.v1.json` and `.claude/settings.json` (hook adapter for human sessions), `apps/server/src/services/build-start.ts` / the Coordinator prompt path that writes `input.prompt`, `.claude/skills/design-cairn/SKILL.md` (name the script in the routing table).

What this buys, in the concrete scenarios the rules ask for: when a lane edits `apps/web/src/components/sidebar/…` it receives the L1–L9 rows plus the universal rows at first touch on every harness — without the Coordinator having known the paths at dispatch, and without the model having decided to look. When it edits `apps/daemon/**` it receives nothing and pays nothing.
