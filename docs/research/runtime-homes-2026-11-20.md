# Runtime homes: how each agent runtime locates its binary, config, skills and credentials

Date: 2026-11-20
Status: primary-source research for the RuntimeHome design (managed binary + config home per runtime under `~/.cairn`, one spawn path, copy-once import of user skills/MCP). No files outside `docs/research/` were changed.

Marks: **observed** = read or run first-hand this session (path/URL given). **derived** = inferred from observed, checkable. **guessed** = unverified.

Refs: cairn worktree HEAD `1c8c5ddf9`. Installed `@anthropic-ai/claude-agent-sdk@0.3.278` (with `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.278`, a 217 MB Mach-O binary) and `@earendil-works/pi-coding-agent@1.5.0` under `node_modules/.pnpm/`. Docs at code.claude.com, agentclientprotocol.com, `github.com/openai/codex` main, `github.com/zed-industries/zed` main — all read 2026-11-20.

## 1. What cairn does today (observed, all `apps/daemon/src/`)

| Piece | State | File |
|---|---|---|
| claude binary | probes `claude` on PATH + `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`; passed as `pathToClaudeCodeExecutable` (or `executablePath` opt) | `claude-code-bin.ts:88`, `backend/claude-code.ts:1470`, `machine-loop.ts:198,639` |
| claude home | `CLAUDE_CONFIG_DIR` → `~/.cairn/claude` (`claudeConfigDir`); confine allows `[dir]` which also covers `.claude.json` inside | `step-env.ts:89`, `agent-config.ts:24`, `confine-session.ts:77-81` |
| claude creds | `CLAUDE_CODE_OAUTH_TOKEN` from server-delivered `claudeSubscriptionToken`; inherited token deleted first | `step-env.ts:57-61` |
| MCP source | reads the **user's real** `~/.claude.json` top-level `mcpServers` via `mcpConfigPath`, passes endpoints as SDK `mcpServers` (`strictMcpConfig` only when managed/locked) | `config.ts:88-90`, `backend/mcp-config.ts:14-58`, `backend/claude-code.ts:1421-1428` |
| devin | **already a full RuntimeHome**: registry/manifest-driven tarball install under `~/.local/share/cairn/devin/versions/<v>` (sha256, lock, `.install-complete`), synthetic `HOME` at `…/devin/home`, XDG state dirs | `backend/devin-managed.ts:22,92-93,132,356` |
| antigravity | same installer shape; reads the **ACP registry** `cdn.agentclientprotocol.com/registry/v1/latest/registry.json`; HOME under `agent-homes/antigravity[-api-key]` with **symlinked** credentials + minimal settings.json | `backend/antigravity-managed.ts:41,126`, `agent-config.ts:95-114` |
| gemini | `GEMINI_CLI_HOME` → `agent-homes/gemini`, symlinked `.gemini` creds | `agent-config.ts:116-139`, `step-env.ts:101` |
| pi | in-process; `agentDir`=`~/.cairn/agent-runtime` + `sessionDir`=`chat-sessions` passed to `ModelRuntime.create({authPath,modelsPath})`/`SessionManager`; pi-host subprocess gets dirs via protocol frame, not env | `machine-loop.ts:449`, `backend/pi.ts:988-1012,1187`, `backend/pi-host.ts:81` |
| codex | runs inside pi's `openai-codex` provider; credential = `openai-codex` key in pi `agentDir/auth.json` | `backend/codex-login.ts:18-34`, `backend/pi.ts:92` |

## 2. Claude Code (observed)

| Question | Answer | Source |
|---|---|---|
| What `CLAUDE_CONFIG_DIR` governs | **The whole `~/.claude` layout *and* `~/.claude.json`** — every `~/.claude` path moves under the dir, and `.claude.json` becomes `$DIR/.claude.json`. Contents: `settings.json`, `.credentials.json`, `.claude.json` (account, user-scope `mcpServers`, per-project trust, global config keys), `skills/`, `projects/` (transcripts + auto memory), `plugins/`, `commands/`, `agents/`, `output-styles/`, plus app data (`file-history/`, `sessions/`, `shell-snapshots/`, caches) | observed [claude-directory](https://code.claude.com/docs/en/claude-directory): "every `~/.claude` path on this page lives under that directory instead. The same applies to `.claude.json`"; SDK `sdk.mjs` `Z9(e)=>{globalConfig: join(e||homedir(),'.claude.json'), userSettings: join(e||join(homedir(),'.claude'),'settings.json')}` called with `CLAUDE_CONFIG_DIR` |
| Settings sources & precedence | Tiers: `user`=`$DIR/settings.json`, `project`=`.claude/settings.json`, `local`=`.claude/settings.local.json`, `managed`=managed-settings.json/MDM/server-managed. Precedence high→low: **managed > command line (`--settings`, `--model`) > local > project > user**; env vars pair per-key, not a tier. `--setting-sources user,project,local` selects which tiers load; SDK `settingSources` maps to it (`[]` = SDK isolation mode). `--mcp-config` adds JSON server defs; `--strict-mcp-config` ignores `.mcp.json`/`~/.claude.json`/plugin MCP config, keeping only passed servers | observed [settings](https://code.claude.com/docs/en/settings), [cli-reference](https://code.claude.com/docs/en/cli-reference); `sdk.d.ts:2151,2200` (`SettingSource`, `strictMcpConfig` doc) |
| User-level skills | `$CLAUDE_CONFIG_DIR/skills/<name>/SKILL.md`. **Claude does not read `~/.agents/skills`** — no `.agents` skill path exists in the bundled binary | observed claude-directory `~/.claude/skills/` row; `sdk.mjs` grep (0 skill-dir hits for `.agents`) |
| Login → `.credentials.json` | macOS: OAuth creds go to the **Keychain**, entry *keyed to the config dir* — a new `CLAUDE_CONFIG_DIR` sees a different (empty) entry; file `…/.credentials.json` (0600) is the Linux store and the macOS fallback when Keychain rejects the write. Console sign-in without API key is stored **outside** the config dir (anthropic profile). So **copying `.credentials.json` is only portable on Linux/fallback installs**; `claude setup-token` prints a one-year OAuth token (saved nowhere) for `CLAUDE_CODE_OAUTH_TOKEN`, which ranks 5th of 7 in auth precedence (cloud providers > `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY` > `apiKeyHelper` > `CLAUDE_CODE_OAUTH_TOKEN` > profile > subscription OAuth) | observed [authentication](https://code.claude.com/docs/en/authentication) "credentials are stored… keys the macOS Keychain entry to that directory too" + precedence list + "Generate a long-lived token" |
| Binary placement & SDK override | Native installer: `~/.local/bin/claude` symlink → `~/.local/share/claude/versions/<v>` (auto-updates, keeps 2 newest + running). npm `@anthropic-ai/claude-code` is the legacy path. **SDK 0.3.278 with `pathToClaudeCodeExecutable` unset resolves `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude` via `createRequire`** (musl preferred on musl Linux; throws "reinstall without --omit=optional" if missing). The vendor's own managed-binary mechanism already exists: pinning the SDK pins a claude binary | observed [setup](https://code.claude.com/docs/en/setup) "the launcher at `~/.local/bin/claude`… `~/.local/share/claude/versions/`"; `sdk.mjs` (`xu='@anthropic-ai/claude-agent-sdk'`, `tW` resolves `${xu}-${plat}-${arch}/claude`); platform package on disk: `node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.278/…/claude` |

## 3. Codex CLI (observed, github.com/openai/codex `main`)

| Question | Answer | Source |
|---|---|---|
| `CODEX_HOME` layout | `~/.codex` (env `CODEX_HOME`): `config.toml`, `auth.json`+`auth.lock`, `log/`, `history.jsonl`, sessions, sqlite state; `.credentials.json` holds MCP-OAuth creds when store mode=`file` | `codex-rs/core/src/config/mod.rs` (`codex_home` field doc), `codex-rs/login/src/auth/storage.rs:167` (`codex_home.join("auth.json")`) |
| `config.toml` `[mcp_servers]` | Per-server table resolving to `McpServerTransportConfig::Stdio{command,args,env{},env_vars[],cwd}` or `::StreamableHttp{url,bearer_token_env_var,http_headers,env_http_headers,http_headers_helper}`. **`env_vars`/`bearer_token_env_var` are indirection** — they name an env var read at runtime, not a stored value | `codex-rs/config/src/mcp_types.rs:399-417,523-569` |
| Skills/agents dir | User skills: `~/.agents/skills` (live) + `$CODEX_HOME/skills` (deprecated); repo: `.agents/skills` in ancestors up to the git root; system: `/etc/codex/skills`, cache root | `codex-rs/ext/skills/src/host_roots.rs:27-28,144-177` (`AGENTS_DIR_NAME`, deprecated comment) |
| Config layers | `ConfigLayerSource`: user `$CODEX_HOME/config.toml` < project `.codex/config.toml` < system `/etc/codex` < MDM/managed < session flags | `host_roots.rs:135-181` layer match |

## 4. Zed / ACP (observed)

- **Registry install**: Zed's "Install from Registry" fetches `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`; each agent's `distribution` is `npx{package,args}` or `binary.<platform>{archive,cmd,sha256,args?}` — the *same schema* cairn's `antigravity-managed.ts:41,48-71` and `devin-managed.ts` already consume. Sources: `zed/crates/project/src/agent_registry_store.rs:20` (`REGISTRY_URL`), live registry JSON fetched 2026-11-20; `zed/docs/src/ai/external-agents.md`.
- **Custom agents**: `settings.json` `agent_servers.<id> = {type:"custom", command, args, env{}}`. Zed injects only a few vars (`GEMINI_API_KEY`, `CODEX_API_KEY`, `NO_BROWSER=1`, `SURFACE=zed`) and never overrides `HOME` or sandboxes the agent — "the External Agent usually owns its own runtime, auth, model selection, tools, and native configuration" (observed `zed/crates/agent_servers/src/custom.rs:230-260`, external-agents.md "Configuration Boundaries").
- **ACP spec** (observed agentclientprotocol.com/protocol/session-setup): agent = client **subprocess over stdio JSON-RPC**; `session/new{cwd, mcpServers[]}` — the client hands MCP servers per-session: stdio `{name,command,args,env[{name,value}]}`, http/sse `{name,url,headers[]}`. Spec is silent on agent `HOME`/env/sandboxing: "the root set declares the session's scope. It confines shell commands only when a sandbox enforces it" — sandboxing is the client's problem, which is exactly cairn's Seatbelt/bwrap layer. MCP `env`/`headers` "are credentials — SHOULD NOT log or persist".

## 5. Pi (observed, installed `@earendil-works/pi-coding-agent@1.5.0`)

- `PI_CODING_AGENT_DIR` → agentDir, default `~/.pi/agent`; `PI_CODING_AGENT_SESSION_DIR` → sessions, overridden by `--session-dir` (`dist/config.js:492-560`, `dist/cli/args.js:99,455-457`).
- agentDir layout: `auth.json`, `models.json`, `settings.json`, `skills/` (user scope, loaded by `loadSkills` when `includeDefaults`), `tools/`, `bin/` (managed fd/rg), `prompts/`, `sessions/`, `themes/` (`dist/config.js:509-560`, `dist/core/skills.js:313-345`).
- cairn uses the programmatic API — `PiBackendOpts.agentDir`/`sessionDir` → `ModelRuntime.create`/`SessionManager.create` — not the env vars; a pi-host subprocess receives them in the initialize frame (`backend/pi.ts:988-1012`, `pi-host.ts:81`). derived: if a managed pi ever spawns as a real CLI, `PI_CODING_AGENT_DIR`/`--session-dir` are the flags to set.

## 6. Migration/import prior art (observed)

- **Claude Code**: `claude import <source>` runs `/import` to pull config from other agents (e.g. `claude import codex --dry-run`) — vendor-built cross-agent copy (cli-reference, measured).
- **Codex**: `codex-rs/external-agent-migration` imports from Claude/Cursor: reads `.mcp.json` **and** `~/.claude.json` `mcpServers` (honoring `enabledMcpjsonServers`/`disabledMcpjsonServers`) → `[mcp_servers]` TOML (`src/mcp.rs:9-90`); copies hook scripts into `$CODEX_HOME/hooks` rewriting command paths (`hooks_common.rs:10-54`); converts subagents→TOML, plugins via marketplace records, memory. **Vendors ship copy-once importers in both directions** — validates the approach.
- **Claude Code's own split**: `~/.claude/` (settings/skills/state) vs `~/.claude.json` (account, MCP, trust) — both under `CLAUDE_CONFIG_DIR` when set, so a managed home mirrors the vendor layout 1:1.

## 7. Comparison table

| Source | How it does it | Trade-off for cairn | Link/path |
|---|---|---|---|
| Claude Code | One `CLAUDE_CONFIG_DIR` relocates config dir **and** `.claude.json`; Keychain creds keyed to dir | A managed home is a first-class vendor feature; but creds don't follow on macOS — keep env-token path | code.claude.com/docs/en/{claude-directory,authentication} |
| claude-agent-sdk | Bundled platform binary in optional deps; `pathToClaudeCodeExecutable` override | Free managed binary pinned to SDK version; probing user's PATH `claude` becomes unnecessary for tasks | `sdk.mjs` `tW`/`xu`; `sdk.d.ts:1889` |
| Codex | `CODEX_HOME` monolith; TOML config with env-indirection; `~/.agents/skills` | `config.toml` import needs TOML→JSON + resolving `*_env_var` names; codex native isn't spawned today (pi hosts it) | `mcp_types.rs`, `host_roots.rs` |
| Zed/ACP | Registry `{npx|binary}` install; client supplies MCP + env per session; no sandbox | Already cairn's model for devin/antigravity — extend, don't invent | registry.json; `agent_servers` settings |
| pi | `PI_CODING_AGENT_DIR` env or programmatic agentDir with `skills/` inside | Copy `~/.claude/skills` → `$agentDir/skills` gives pi native skills for free | `dist/config.js`, `dist/core/skills.js` |

## 8. Pattern that fits cairn

**Each runtime already defines exactly one "home root" knob** — `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `PI_CODING_AGENT_DIR`, synthetic `HOME` (devin/antigravity) — and ACP leaves env to the client. cairn's devin backend already implements the full shape (managed binary + owned HOME + confine); the RuntimeHome design generalizes it. The import is a **one-time seed**, matching vendor importers (`claude import`, codex `external-agent-migration`): translate, don't link.

Two corrections to the plan as stated:

1. **Credentials must not be copied** (and mostly can't): macOS claude creds live in a Keychain entry keyed to the config dir — a fresh `CLAUDE_CONFIG_DIR` has none; the file form is Linux/fallback only. Console-profile sign-ins live outside the dir entirely. Keep cairn's existing `CLAUDE_CODE_OAUTH_TOKEN`/`WINDSURF_API_KEY`/`GEMINI_API_KEY` env delivery (observed `step-env.ts:57-71`) — it is the portable credential channel; replace the antigravity/gemini **credential symlinks** (`agent-config.ts:57-70`) with the same env/one-time-copy treatment only where the vendor stores file creds (Linux).
2. **One shared skills dir does not work**: claude reads only `$CLAUDE_CONFIG_DIR/skills`; codex reads `~/.agents/skills`; pi reads `$agentDir/skills`. Import must copy per-runtime (`~/.claude/skills` → `<home>/skills`, and the same files into pi's `agentDir/skills`); `~/.agents/skills` can stay shared since cairn's `skillsDir` already points there (`config.ts:69-71`).

**Copy once**: `~/.claude/skills/` → `<claude-home>/skills/`; `~/.claude.json.mcpServers` (top-level user scope; skip `projects[*]` per-path entries) → `<claude-home>/.claude.json`; `~/.codex/config.toml[mcp_servers]` → translated `{command,args,env}`/`{url,headers}` entries — resolving `env_vars`/`bearer_token_env_var` names against the *user's* env at import time or dropping them (verbatim copy would read the daemon's env — silently wrong values or empty); `settings.json.env` minus `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`CLAUDE_CODE_OAUTH_TOKEN`/`apiKeyHelper` (cairn injects credentials itself).

**Never copy**: `projects/`+`sessions/`+`history.jsonl` (path-keyed transcripts — useless and large), hooks (executable config; codex's importer does copy them, but in a sandboxed headless runtime user hooks reference paths/secrets that don't exist — derived; cairn already sets `disableAllHooks` in locked mode, `claude-code.ts:1465`), `permissions`/trust decisions (`.claude.json.projects`, `settings.local.json`), plugin install records, `~/.claude/CLAUDE.md` global memory (would silently steer every task; cairn's brief owns instructions), caches/`statsig`/`shell-snapshots`, and `.claude.json` account fields beyond `mcpServers`.

## 9. Concrete recommendation

| File | Change |
|---|---|
| `apps/daemon/src/claude-code-bin.ts` | Keep `probeClaudeBin` for diagnostics/`claude auth status` against the user's install, but **stop feeding `executablePath` to task runs by default**: SDK 0.3.278 already runs its own bundled binary when `pathToClaudeCodeExecutable` is unset — that is the managed binary, version-pinned to the SDK. Keep `CAIRN_CLAUDE_BIN` as an escape hatch; update `claudeVersionAtLeast`/plugin gating to probe the resolved binary once (`backend/claude-code.ts:1308` uses `executableVersion`). |
| `apps/daemon/src/agent-config.ts` | Add `prepareClaudeHome`/`importUserConfig({cairnHome, realHome, runtimeId})`: mkdir `agent-homes/<runtime>` 0700; write `.claude.json` `{mcpServers: <merged claude+codex import>}` 0600; write `settings.json` `{env: <filtered>}`; copy `skills/` once; stamp `agent-homes/.imported-v1.json` so the import is one-time and idempotent (rerun only adds missing files, never overwrites user edits inside the home). Convert `linkCredentials` users (antigravity/gemini) to the same copy-once rule where file creds exist, or document env-token as the only channel. |
| `apps/daemon/src/step-env.ts` | `isolatedConfigEnv`: claude already returns `CLAUDE_CONFIG_DIR` — keep; add `CODEX_HOME` when a codex-native lane exists (today codex rides pi's `auth.json`); devin/antigravity keep synthetic `HOME`; pi needs nothing (programmatic agentDir). |
| `apps/daemon/src/backend/claude-code.ts` | Make `executablePath` optional-for-real (unset → SDK bundled); keep `settingSources: ['user','project','local']` — `user` now means the managed home's `settings.json`; keep `mcpServers`/`strictMcpConfig` as-is (already isolates MCP from file config when managed). |
| `apps/daemon/src/backend/acp.ts` | Unchanged spawn path; adapters' `command`/`args` already come from managed installs. `mcpServers` in `session/new` keeps client-supplied isolation per ACP. |
| `apps/daemon/src/backend/devin-managed.ts`, `antigravity-managed.ts` | Already the target shape — converge install roots and homes under `~/.cairn/runtimes/<name>` + `~/.cairn/agent-homes/<name>` for a single confine root (devin's home currently lives under `~/.local/share/cairn/devin/home`, outside `~/.cairn`). Keep the ACP-registry consumption. |
| `apps/daemon/src/backend/confine-session.ts` | `ownState`: claude's `[CLAUDE_CONFIG_DIR]` already covers `.claude.json`+skills inside; add `CODEX_HOME` when it exists; ensure `agent-homes/<name>` is state-writable while `daemonHome` stays denied. |
| `apps/daemon/src/config.ts` | `mcpConfigPath` default `~/.claude.json` becomes the **import source**, not the live read: after import, point resolution at `<claude-home>/.claude.json` so the managed home is self-contained (keeps `parseClaudeMcpEntries` format — zero parser work). |
| `apps/daemon/src/state.ts` | Add `runtimeHomesDir` (`<home>/agent-homes`) and `runtimesDir` (`<home>/runtimes`) to `StatePaths`/`ensureStateDirs`; persist the one-time import marker there. `agentRuntimeDir` remains pi's agentDir — its `skills/` subdir becomes a pi-native skills target. |

Open questions (derived unless noted): whether to also import `~/.claude/agents/*.md` subagent defs (declarative like skills but can pin models/permissions — recommend skip v1); whether managed-home `settings.json` should carry `cleanupPeriodDays` to stop transcript sweeps deleting cairn session jsonl (guess: set it high, cairn reads those files); whether `~/.claude.json.mcpServers` OAuth'd servers work headless (tokens may live in keychain — expect partial failures, mark them like today's `connectFailedLine`).
