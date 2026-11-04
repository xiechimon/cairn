# R10 · Multica runtime model full reference (definition / discovery / protocol families / execution / credentials / custom profile / permissions)

> Purpose: ticket #517 — take Multica's runtime model from `what the docs say` to `how the code actually does it`.
> Seven surfaces: definition, discovery, protocol families, execution, task-level credentials, custom profile, permissions.
> Source A (documentation side): a 41-page snapshot of the official docs, `~/.agents/wiki/raw/sources/2026-09/2026-09-30-todos-vs-multica-docs/multica/`
> (captured 2026-09-30; the damage list is in the sibling `README.md`).
> Source B (documentation source): the in-repo canonical copies of the same docs, `apps/docs/content/docs/*.mdx` (follows the source version, cross-checkable against the snapshot).
> Source C (code side): a shallow clone of `multica-ai/multica` with `--depth 1`, HEAD = `43b0571f992567a919c7f1f699ff160922594b94` (2026-09-29 23:27:27 -0700),
> landed at `/tmp/multica-src-517` (outside the repo, does not pollute pacman).
> Inventory date: 2026-09-30 (local Asia/Shanghai). Ticket: #517. Map: #515.

## 0. Reading conventions

- Three kinds of sources, marked item by item:
  - **D** (docs) = `path:line` in the snapshot `.txt` or the in-repo `.mdx`;
  - **C** (code) = Multica source `path:line` (relative to the clone root; version above);
  - **[inference]** = a conclusion with no direct source, inferred from code behavior or naming. The ticket strictly states: assertions without a source may not be written.
- Documentation-side claims and source measurements are **listed separately**: each surface gives `Documentation side` first, then `Source measurement`, then `Differences`.
- No emoji anywhere; numbers and commands copied verbatim.
- One naming trap is pinned first and not explained again later: Multica's "permission / visibility" has three mutually unrelated layers —
  1. the CLI layer `--permission-mode` (Claude's `bypassPermissions` etc., a `protocol-critical flag`);
  2. the **agent** layer `agent.permission_mode` (`private` / `public_to` + a call allowlist, governing `who can trigger this agent`);
  3. the **runtime** layer `agent_runtime.visibility` (`private` / `public`, governing `who can start an agent on whose machine`).
  The ticket's `permissions surface` = layer 3; the `protocol-family surface's permission mode` = layer 1.

---

## 1. Conclusions first

1. **A runtime's four-tuple is (workspace × daemon/machine × provider/tool × profile)**, not the triple the docs write. The docs only say `computer + tool (× workspace)`; in the code the real unique keys are two **partial unique indexes**, one of which elevates `profile_id` into a fourth dimension, so the same machine can simultaneously host a `built-in codex` and any number of custom codex profile instances. (§2)
2. **`restart only updates, never re-registers` is a database-level `ON CONFLICT ... DO UPDATE`**, not application-layer dedup. The conflict keys are exactly those two indexes. (§2.3)
3. **Governs 25 protocol families (`SupportedTypes`) but probes 26 command names** — the extra one is `zeroclaw`, which is in both the protocol-family allowlist and the probe list yet **completely absent from both doc tables** (the `providers` tool table and the `install-agent-runtime` command table). The docs only mention `MULTICA_ZEROCLAW_PATH` in passing on the `environment-variables` page. (§3, §9 difference D1)
4. **The `starts only after at least one built-in tool is detected` exception is hung on the wrong gate in the docs.** The docs hang this exception on the `CLI detection` gate (`daemon-runtimes:51`); in the code it is hung on the **registration** gate (`errNoWorkspaceRuntimesRegistered`), triggerable by `dshInstallInFlight`. The CLI-detection gate's exemption switch `Overrides.AllowNoAgents` is used only by the read-only probe `daemon probe-runtimes`. (§3, §9 difference D2)
5. **The real numbers for online determination are `150s staleness threshold + 30s sweep period ≈ 180s`**, i.e. the docs' `about 3 minutes`; but this `staleness` has two data sources: the Redis TTL key is the hot path, while the DB's `last_seen_at` is only refreshed every 60s. The docs only write `heartbeat 15s`. (§5.2)
6. **The reconnect grace default is 3 hours**; the docs' `daemon-runtimes` page never gives a number, only the `environment-variables` page writes `3h`. A grace below 150s is rejected and clamped up. (§5.3, §9 difference D3)
7. **The 7-day GC criterion is three clauses, not one**: `status='offline'` + `last_seen_at` older than 7 days + **no unarchived user agent** + **no non-terminal task**. The docs only write the first two; `no agents` in the docs reads like `including archived agents`, but in the code an archived agent does **not** block GC. (§5.4, §9 difference D4)
8. **The block of protocol-critical flags is a `blocklist + family table`, not an `allowlist + fixed arguments`.** Each backend carries its own `*BlockedArgs` (with value / standalone / optional-value three modes), and `New()` filters the prefix at exactly one place; flags like `--model` that are not in the blocklist are allowed for the user to write, but Multica's value comes later and last-wins takes it. (§4.3, §7.3)
9. **The task-level credential `mat_` is bound as the four-tuple `(task_id, agent_id, workspace_id, user_id)` written in a separate table `task_token`**, and `user_id` takes the **runtime owner**, with a hard-coded 24h TTL. `MULTICA_TOKEN` is the identity credential: forging the `X-Agent-ID` / `X-Task-ID` headers cannot change the actor. (§6)
10. **Codex's shell environment policy is not `add one allow` but switching Codex's own secret filtering off entirely** (`ignore_default_excludes = true`) and then giving a precise `include_only`. The docs understate this step. (§6.4, §9 difference D5)
11. **A custom profile's fixed arguments come before Multica's arguments**, and **the position cannot be swapped back** — a code comment states it is a subcommand requirement of `Commander`-style parsers (GH #7046); the docs also admit residual risk for CLIs that `distinguish global flags from subcommand flags`. (§7.3)
12. **The runtime share right is owner-exclusive, with no admin bypass** — `canUseRuntimeForAgent` (cannot bind) and `canSetRuntimeVisibility` (cannot change sharing) both have **no admin branch**; admin only keeps `canEditRuntime`'s rename/delete. And **an ownerless runtime can never be bound** (`OwnerID` empty is refused outright), because minting a task-level token requires an owner. (§8)

---

## 2. Definition surface: what a runtime really is, and how restart dedup is implemented

### 2.1 Documentation side (D)

- `daemon-runtimes.txt:11`: "The daemon is the Multica background process running on one computer. It connects to the server, discovers local tools, claims runs, and reports results back."
- `daemon-runtimes.txt:13`: "A runtime represents one concrete execution environment available to a workspace. It corresponds to **one computer plus one AI coding tool** — or one custom runtime profile — on that computer."
- `daemon-runtimes.txt:15`: one machine with Claude Code + Codex connected to two workspaces → "the daemon registers Claude Code and Codex runtimes **for each workspace**" (the workspace dimension is implied by this sentence).
- Same sentence `daemon-runtimes.txt:15`: "**Restarting the daemon updates the existing records; it does not keep creating new runtimes for the same combination.**"
- `concepts.txt:31-33`: "Runtime: Where execution actually happens: a computer connected to Multica and the AI coding tools on it. The agent is the identity; the runtime is the computer that executes it."
- Same wording in the in-repo canonical copy: `apps/docs/content/docs/daemon-runtimes.mdx:15`.

### 2.2 Source measurement (C)

A runtime's row is the `agent_runtime` table, and registration goes through an upsert:

- `server/pkg/db/queries/runtime.sql:63` (`UpsertAgentRuntime`): `INSERT INTO agent_runtime (workspace_id, daemon_id, name, runtime_mode, provider, status, device_info, metadata, owner_id, last_seen_at) VALUES (...)`, `ON CONFLICT (workspace_id, daemon_id, provider) WHERE profile_id IS NULL DO UPDATE SET name = EXCLUDED.name, ..., status = EXCLUDED.status, ..., last_seen_at = now(), updated_at = now() RETURNING *, (xmax = 0) AS inserted` (the conflict clause is at `:83`).
- `server/pkg/db/queries/runtime.sql:95` (`UpsertAgentRuntimeWithProfile`): custom-profile instances go through a different path, `ON CONFLICT (workspace_id, daemon_id, profile_id) WHERE profile_id IS NOT NULL` (`:116`).
- Both indexes are landed by migrations: `server/migrations/121_agent_runtime_provider_partial_unique.up.sql:24-27` **downgrades** the old `UNIQUE (workspace_id, daemon_id, provider)` whole-constraint **to a partial unique index** `WHERE profile_id IS NULL`; `server/migrations/120_runtime_profile.up.sql:79-83` adds `(workspace_id, daemon_id, profile_id) WHERE profile_id IS NOT NULL`. The boundary comment at the head of 120 (`120_runtime_profile.up.sql:1-9` onward) states the reason: without this split, a built-in codex and a custom codex profile on the same daemon would be mutually exclusive.
- The purpose of `(xmax = 0) AS inserted` is in the comment at `runtime.sql:57-62`: only first-time registration triggers the `runtime_registered` / `runtime_ready` events.
- `custom_name` is deliberately excluded: `runtime.sql:139-147` (`UpdateAgentRuntimeCustomName`) comment says "Kept separate from the registration upserts above (which do `name = EXCLUDED.name` on every heartbeat) so a custom name is never clobbered by the daemon."
- The workspace dimension is given by `agent_runtime.workspace_id` together with the two indexes; the registration endpoint is `POST /api/daemon/register` (`server/cmd/server/router.go:1558`), handler `server/internal/handler/daemon.go:405`; `DaemonRegister` requires both `daemon_id` and `workspace_id` to be non-empty (`daemon.go:416-423`), and **"at least one runtime or failed profile is required"** (`daemon.go:424-427`) — i.e. one trip may carry only failed profiles and no usable runtime.
- Owner resolution: on the daemon-token (`mdt_`) path `ownerID` is left zero and the SQL `COALESCE(EXCLUDED.owner_id, agent_runtime.owner_id)` preserves the original owner; on the PAT/JWT path it is taken from the member (`server/internal/handler/daemon.go:434-451`).
- Registration-carried metadata (`daemon.go:486-491`): `{"version": runtime.Version, "cli_version": req.CLIVersion, "launched_by": req.LaunchedBy, "capabilities": ...}`.

### 2.3 Differences

- **The docs miss the profile dimension.** `daemon-runtimes.txt:13` only says `computer + tool (or one custom runtime profile)`, literally **either-or**; in the code the built-in runtime and the custom-profile instance are **coexisting** row kinds, each with its own unique key (`runtime.sql:75` vs `:106`). This also explains the premise of `daemon-runtimes.txt:155` "Deleting only the runtime instance on one computer does not delete the profile": instance and profile are two tables to begin with (`runtime_profile` is created at `120_runtime_profile.up.sql:32`), and `agent_runtime.profile_id` is just a no-foreign-key UUID column (`120_runtime_profile.up.sql:70-77`).
- **The implementation location of `restart updates, never re-registers`** is not written in the docs; measured it is the DB's `ON CONFLICT ... DO UPDATE` (§2.2), so it is **idempotent** and does not rely on application-layer dedup. [inference] This is also why `last_seen_at = now()` is written in the upsert — one registration equals one heartbeat.
- `daemon-runtimes.txt:121` says "Creating a profile does not install the command"; the code agrees: the daemon only does `lookPath(profile.CommandName)` plus per-machine override resolution, and skips the profile and records it into `failedProfiles` when it cannot resolve (`server/internal/daemon/daemon.go:3126-3145`).

---

## 3. Discovery surface: the PATH probe list and the startup gate

### 3.1 Documentation side (D)

- `install-agent-runtime.txt:13` onward has a 25-row "detects these commands" table: `agy` / `claude` / `codebuddy` / `codearts` / `codex` / `copilot` / `cursor-agent` / `dsh` / `deveco` / `grok` / `hermes` / `kimi` / `kiro-cli` / `mcode` / `openclaw` / `opencode` / `pi` / `omp` / `qodercli` / `qoderclicn` / `qwen` / `qwenpaw` / `reasonix` / `traecli` / `dim` (in-repo canonical `apps/docs/content/docs/install-agent-runtime.mdx:16-42`, likewise 25 rows).
- `install-agent-runtime.txt:58` / `.mdx:63`: the minimum-version bar lists only 8 — Antigravity 1.1.10, Claude Code 2.0.0, Codex 0.100.0, Copilot 1.0.0, Grok 0.2.89, Qwen Code 0.20.0, MiniMax Code 0.1.2, OpenCode 1.1.54. "Below the minimum version, the daemon does not register the corresponding runtime."
- `daemon-runtimes.txt:46`: "On startup, the daemon detects supported AI coding tools on `PATH` and registers runtimes for the workspaces you are allowed to connect. **If a tool was just installed or signed in, restart the daemon to detect it again.**"
- `daemon-runtimes.txt:48`: "The daemon needs **at least one built-in supported AI coding tool** detected before it will start."
- `install-agent-runtime.txt:98` / `.mdx:105`: the exception — "when the daemon has just begun installing the DSH runtime profile itself (`MULTICA_DSH_PROFILE_BUNDLE`), it starts with no runtimes and registers DeepSeek Harness once that install finishes."

### 3.2 Source measurement (C)

**Probe list** (`server/internal/daemon/config.go:974-977`):

```go
var defaultAgentCommandNames = append([]string{
    "claude", "codex", "opencode", "codearts", "deveco", "openclaw", "hermes",
    "pi", "cursor-agent", "copilot", "kimi", "reasonix", "dsh", "kiro-cli", "codebuddy", "agy", "qodercli", "qoderclicn", "traecli", "grok", "qwen", "qwenpaw", "mcode", "dim", "zeroclaw",
}, agent.BuiltinRuntimeCommands()...)
```

I.e. **25 hard-coded names + 1 from the descriptor registry** (`agent.BuiltinRuntimeCommands()` currently returns only `omp`, `server/pkg/agent/builtin_runtimes.go:86-128`) = 26. The per-name probe bodies are in `server/internal/daemon/agents_probe.go:169-334` (25 explicit `probe(...)` calls + `:194-202` iterating the descriptor table).

**Detection mechanism** (`agents_probe.go`):

- Main path `exec.LookPath`; each probe also carries the provider's own `MULTICA_<PROVIDER>_PATH` override and `MULTICA_<PROVIDER>_MODEL` default model (`agents_probe.go:111-115`).
- **Login-shell fallback**: a GUI-launched daemon does not inherit the interactive shell's `PATH` (fnm/nvm/volta multishell, Anthropic native install prefix, per-user npm prefix); only when the bare-name `LookPath` genuinely misses does it fork the user's login shell once (`agents_probe.go:95-105`), with the result cached process-wide `shellResolveTTL = 30 * time.Minute` (`agents_probe.go:32`), the cache key containing a `PATH/SHELL/HOME` fingerprint (`agents_probe.go:41-47`).
- **Non-portable fallbacks**: Codex Desktop bundles the CLI into the macOS app bundle, so the daemon scans `/Applications/ChatGPT.app/Contents/Resources/codex`, `/Applications/Codex.app/...` and the corresponding `~/Applications` (`config.go:979-993`; a comment records OpenAI moving the app from Codex.app to ChatGPT.app, #5205); DSH Desktop likewise, and it **checks the generated shim first, the app-bundle Node script last** (`config.go:1014-1040`, the reason being that the shim drives Electron's node by absolute path and does not depend on PATH).
- The probe **only discovers**, does not check versions and does not enforce the minimum-version bar — that is `detectBuiltinRuntimes`'s job on each registration round (`agents_probe.go:86-92` comment).
- Extra special case: CodeArts, when `MULTICA_CODEARTS_PATH` is unset, looks for a stable launcher under `~/.codeartsdoer/installers/{codearts.cmd,codearts}` (`agents_probe.go:176-195`).

**Minimum-version bar** (`server/pkg/agent/version.go:18-37`, `MinVersions`): 10 entries, two more than the docs —
`dim: "0.3.10"` (the per-process lock of cross-run `session/load` is released on graceful exit), `zeroclaw: "0.8.0"` (persistent ACP session and `session/resume` were added in 0.8.0).

**Startup gate** (`config.go:266-269`):

```go
agents := probeAgentCLIs()
if len(agents) == 0 && !overrides.AllowNoAgents {
    return Config{}, fmt.Errorf("no agent CLI found: install claude, ..., or zeroclaw and ensure it is on PATH")
}
```

`AllowNoAgents`'s comment (`config.go:189-191`): "reserved for read-only local configuration probes", with the only call site `multica daemon probe-runtimes` (`server/cmd/multica/cmd_daemon.go:162-165`, and that subcommand is also `Hidden: true`, `cmd_daemon.go:55-58`).

**The real DSH exception is at a different gate**: `server/internal/daemon/dsh_startup_bootstrap_test.go:22-68`'s `TestStartupMayProceedWithoutRuntimes` documents the sequence — the probe reports a missing profile and starts the install → registration finds nothing to register → `Run` returns `errNoWorkspaceRuntimesRegistered` → the process exits and takes the install's process tree with it, one round per 32ms. The allowance condition is `dshInstallInFlight`; and **only this failure kind is allowed**: 401, connection refused, and `nil` are not allowed (same test `:44-58`).

**Runtime-periodic re-detection** (`server/internal/daemon/agents_refresh.go`):

- `agentDiscoveryInterval = 2 * time.Minute` (`agents_refresh.go:15`), `refreshAgentAvailability` re-runs `probeAgentCLIs()` and publishes only **newly-added** providers, **deliberately keeping** disappeared ones (reason written at `agents_refresh.go:307-315`: a restart with a narrower PATH must not dismantle a runtime that is running a task). Related issue `MUL-5439`.
- `refreshAgentVersions` (`agents_refresh.go:366` onward) does `report a new version to the server after an in-place CLI upgrade without a restart`, likewise subject to the minimum-version bar and probe retries.

### 3.3 Differences

- **D1 · The counts do not line up.** Both doc tables have 25 rows; the code probes 26 command names (the extra `zeroclaw`). `zeroclaw` is in `SupportedTypes` (`server/pkg/agent/agent.go:389`), in `launchPrefixBlockedArgs` (`server/pkg/agent/launch.go:468`), in `skillsDirPath`'s default branch, and in `ModelSelectionSupported`'s false set (`server/pkg/agent/models.go:435`). The docs' only mention is a single sentence in `apps/docs/content/docs/environment-variables.mdx:256` — "ZeroClaw supports `MULTICA_ZEROCLAW_PATH` but has no model variable" — **neither the tool matrix nor the command table admits it**.
- **D2 · The exception is mounted at a different place.** The docs (`daemon-runtimes.txt:48` / `install-agent-runtime.txt:98`) describe the DSH exception as an exception to the `CLI-detection gate`; in the code the CLI-detection gate's exemption is `AllowNoAgents` (serving only read-only probes), and the DSH exception is at the **registration gate** (`startupMayProceedWithoutRuntimes` + `dshInstallInFlight`). Both really exist, but calling which one "one exception" sends the debugger to the wrong gate. The docs' description of the **phenomenon** (start with no runtimes, auto-register DSH once the install finishes) matches the code.
- **D6 · `restart to re-detect` is already inaccurate.** `daemon-runtimes.txt:46` and `install-agent-runtime.txt:88-93` both require a restart after installing a tool; since `MUL-5439` the code re-scans every 2 minutes and can pick up a newly installed CLI without a restart (`agents_refresh.go:15`, `agents_refresh.go:303-330`), with the login-shell-only path waiting at most `shellResolveTTL` = 30 minutes (`agents_probe.go:32`). The docs present restart as the **only** means; the code treats it as the **fallback** means.
- **D7 · The version-bar table is missing two entries** (dim 0.3.10, zeroclaw 0.8.0, `version.go:29,32`).
- Consistent items (cross-checked, no worry): the command-name mapping (`cursor-agent` → provider `cursor`, `kiro-cli` → `kiro`, `agy` → `antigravity`) matches one-to-one between the probe bodies and the doc tables.

---

## 4. Protocol-family surface: the capability matrix and protocol-critical flags

### 4.1 Documentation side (D)

`providers.txt:23-48` (in-repo canonical `apps/docs/content/docs/providers.mdx:21-47`) is a four-column table: Detected command / Session resumption / Multica-managed MCP / Skill injection path. Key points:

- Session resumption: all `supported` except MiniMax Code; `providers.txt:66` explains that MCode 0.1.2 "advertises no session-loading capability over ACP, so Multica starts a fresh MCode session for a later run"; `providers.txt:68` says Pi stores a local session file path, depending more on the original machine and the original file.
- Multica-managed MCP: Antigravity / Copilot CLI / DevEco Code / Pi are "—"; `providers.txt:74` adds "so the field is not shown when creating agents for them".
- Skill injection path: a per-tool table (`.claude/skills/`, `$CODEX_HOME/skills/`, `.dsh/skills/`, QwenPaw written "per-run workspace `skills/`", Dim written "—", etc.); `providers.txt:84-90` three exceptions — Codex uses per-run `CODEX_HOME`; Hermes uses per-run `HERMES_HOME` and **isolates only when the agent has skills bound**; OpenClaw writes `<workdir>/skills/` and pins that directory as the workspace.
- Model source: `providers.txt:54-60` — "the model list comes from the corresponding runtime. Some tools expose a fixed set of model names; others return available models based on local configuration, the signed-in account, and subscription entitlements." QwenPaw and MiniMax Code are exceptions with a lazy picker showing "Managed by runtime"; DSH uses `dsh --profile multica --list-models`, with model ids of the `provider/model` form.
- Permission mode: `providers.txt` has no such column; in the docs `--permission-mode` appears in only two places — `daemon-runtimes.txt:142` (protocol-critical flags get dropped) and `security-model.txt:45` (Claude runs with `bypassPermissions`).

### 4.2 Source measurement (C)

**Protocol-family allowlist** (`server/pkg/agent/agent.go:364-390`, `SupportedTypes`): 25 entries, matching the `runtime_profile.protocol_family` CHECK constraint item by item (latest constraint at `server/migrations/441_runtime_profile_add_codearts.up.sql:6-33`; the `agent.go:347-363` comment lists every expansion migration: 120→134→136→175→179→202→242→253→254→313→342→370→403→441; `126_runtime_profile_drop_gemini` once removed `gemini`).

**`Protocol family` and `runtime identity` are two layers** (`server/pkg/agent/builtin_runtimes.go:8-70`): a `BuiltinRuntime` descriptor declares `ID` (the provider key used for registration, e.g. `omp`), `ProtocolFamily` (the execution backend, e.g. `pi`), `DefaultCommand`, `EnvPrefix`, `DisplayName`, `SkillsDir`, `UserSkillsDir`, `LaunchHeader`, `ModelDiscovery`. Currently only `omp` is registered (`builtin_runtimes.go:86-100`). The dispatch entry `ResolveBackend` (`:153-158`): identity goes through `NewRuntime`, family through `New`.

**Model-list source** (`server/pkg/agent/models.go:195-245` onward): `ListModels` dispatches by provider, one discovery per family:

- Claude: **no `--list-models`**; it goes through a stream-json control-protocol `list_models` request, with the answer computed from **the installed binary + the signed-in account** (`server/pkg/agent/claude_models.go:15-40`, `MUL-6961`; the previous static catalog opened a `picked model must 400` window).
- Descriptor-type (e.g. omp): uses the descriptor's own `ModelDiscovery` (omp is `omp models --json`, because it refuses pi's `--list-models`); when the descriptor gives no strategy it **returns an empty catalog instead of falling back to the family's command** (`models.go:199-208`, `builtin_runtimes.go:62-69`).
- The rest go per-family via command line or ACP: `cursor-agent --list-models` (`models.go:2598`), `agy models` (`models.go:220-226`), traecli/hermes etc. ACP return the catalog from `session/new` (`models.go:227-247`), Pi `--list-models` (`models.go:1232`).
- **The `lazy picker` implementation**: `ModelSelectionSupported` returns false for `qwenpaw` / `mcode` / `zeroclaw` (`models.go:435-450`), the comment stating three reasons — QwenPaw's `session/set_model` writes the model into the shared `agent.json` (changing user config); MCode's ACP exposes no model options; ZeroClaw 0.8.4 answers `-32601` directly to `session/set_model`. The UI-side wording key `model_managed_by_runtime` = "Managed by runtime" (`packages/views/locales/en/agents.json:228`, rendering logic in `packages/views/agents/components/inspector/model-picker.tsx:28`).

**MCP delivery** (18 backends read `opts.McpConfig` directly): `claude`, `codearts`, `codebuddy`, `codex`, `dim`, `dsh`, `grok`, `hermes`, `kimi`, `kiro`, `mcode`, `opencode`, `qoder`, `qwen`, `qwenpaw`, `reasonix`, `traecli`, `zeroclaw`. The four "—" backends (antigravity / copilot / deveco / pi) indeed have **zero references** to `opts.McpConfig`.
- Cursor and OpenClaw go through **another channel**: Cursor has the daemon's execenv write a project-level `.cursor/mcp.json` + `.workspace-trusted` + `mcp-auth.json` (`server/internal/daemon/execenv/cursor_mcp.go:20-65`); OpenClaw has the wrapper config pin `mcp.servers`, and first clears the user's global manifest with a `{"mcp":{"servers":null}}` reset file (`server/internal/daemon/execenv/openclaw_config.go:25-48`, `:232-238`).
- Three-state semantics: `hasManagedMcpConfig` (`server/pkg/agent/mcp_config.go:8-12`) — only SQL NULL / JSON null means `inherit the runtime config`; **an explicit empty object is also a managed set** (enabling strict mode).
- The OpenCode family gets separate schema validation (`DisallowUnknownFields`, `server/pkg/agent/opencode_mcp.go:11-27`).

**Skill injection path** (`server/internal/daemon/execenv/context.go:328-439`, `skillsDirPath`): `claude`→`.claude/skills`, `codebuddy`→`.codebuddy/skills`, `copilot`→`.github/skills`, `opencode`→`.opencode/skills`, `codearts`→`.codeartsdoer/skills`, `deveco`→`.deveco/skills`, `openclaw`→`skills`, `pi`→`.pi/skills`, `cursor`→`.cursor/skills`, `kimi`→`.kimi/skills`, `reasonix`→`.reasonix/skills`, `dsh`→`.dsh/skills`, `kiro`→`.kiro/skills`, `qoder`/`qoderclicn`→`.qoder/skills`, `qwen`→`.qwen/skills`, `qwenpaw`→**`skill_pool`**, `mcode`→`.minimax/skills`, `traecli`→`.traecli/skills`, `antigravity`→`.agents/skills`, `grok`→`.grok/skills`; descriptor-type (`omp`) goes through `desc.SkillsDir`; the **default branch**→`.agent_context/skills` (`:435-438`). Codex / Hermes are not in this table: their special casing is in `execenv/execenv.go:1040` and `execenv/hermes_home.go:17-45` respectively (per-run home override + `skills.external_dirs`).
- Same-name conflict handling: `allocateCollisionFreeSkillDir` (`execenv/skill_visibility.go:50`) — opens another directory with a `-multica` suffix, only cleaning files it created itself.
- frontmatter normalization: `ensureSkillFrontmatter` (`context.go:441` onward) forces the `name` key = the directory slug, the reason (`MUL-5529`): Claude routes by directory name while OpenCode routes by frontmatter `name`, and a fork would give one skill two callable names.

### 4.3 Protocol-critical flags: why kept, why not user-overridable

**Documentation side (D)**: `daemon-runtimes.txt:139-141` two consequences —

- "Multica's own values win a conflict. If your fixed arguments set a flag Multica also sets, Multica's value comes later and takes effect. Most importantly, a model chosen on the agent overrides a `--model` pinned in the profile."
- "Protocol-critical flags are ignored. `-p`, `--output-format`, `--input-format`, `--permission-mode`, and the equivalents for other families are dropped from your fixed arguments, because overriding them would break the daemon's connection to the tool. Subcommands and other positional arguments always pass through."

**Source measurement (C)**:

- Three block modes: `blockedWithValue` / `blockedStandalone` / `blockedOptionalValue` (`server/pkg/agent/claude.go:1334-1340`). The filter functions `filterCustomArgs` (`claude.go:1354`) and `filterLaunchPrefix` (`launch.go:505`) first call `unshellQuoteArg` to strip the user's hand-written shell quotes (`launch.go:518`, `claude.go:1361`).
- Family→blocklist table: `launchPrefixBlockedArgs` (`launch.go:445-469`), 23 families have their own `*BlockedArgs`, two families share one (`qoder` and `qoderclicn` both point at `qoderBlockedArgs`). **A family absent from the table = accepts any prefix** (`launch.go:443-444`, `:509-512`).
- Samples (each with its original comment):
  - Claude: `-p`, `--output-format`, `--input-format`, `--permission-mode`, `--mcp-config`, `--effort` (`claude.go:1063-1076`). `--effort`'s reason is `owned by the per-agent thinking_level picker, and a user custom_arg must not silently speak for it`.
  - CodeBuddy: same five as Claude (`codebuddy.go:27-36`).
  - Copilot: `-p` / `--output-format` / `--allow-all(-tools/-paths/-urls)` / `--yolo` / `--no-ask-user` / `--resume` / **`--acp`** (`copilot.go:613-624`, `--acp` comment is "prevent switching to ACP mode").
  - Cursor: `-p` / `--output-format` / `--yolo` (`cursor.go:1009-1013`); the same file `:1017-1034` explains why the prompt **does not go through argv** (Windows PowerShell re-serializes `$args`, re-tokenizing prompts containing double quotes, #5649), hence `cursor-agent`'s prompt goes through stdin.
  - CodeArts: `--format` / `--auto` / `--sandbox` / `--dir` / `--variant` / `--dangerously-skip-permissions` (`codearts.go:38-45`).
  - DevEco: `--format` / `--dir` / `--variant` / `--dangerously-skip-permissions` (`deveco.go:61-66`).
  - Grok: the longest list (`grok.go:22-47` onward), including the **positional subcommands** `agent` / `stdio` / `headless` / `serve` / `leader` that must also be blocked, plus `-m` / `--model` / `--reasoning-effort` / `--resume` / `--system-prompt-override`.
  - Pure-ACP families block only one subcommand: `hermes` blocks `acp` (`hermes.go:37-39`), `kimi` blocks `acp` (`kimi.go:21-23`), `mcode` blocks `acp`/`login`/`--region` (`mcode.go:21-27`), `kiro` blocks `acp`/`-a`/`--trust-all-tools`/`--trust-tools` (`kiro.go:26-31`), `dim` blocks `acp`/`--auth-setup`/`--remote`/`--help`/`-h` (`dim.go:21-27`), `zeroclaw` blocks `acp` (`zeroclaw.go:29` onward).
  - Codex blocks only `--listen` (`codex.go:32-34`, for the `stdio://` transport).
- **The filter point is unique**: `New()` does `filterLaunchPrefix` at the one place that knows both prefix and family (`agent.go:466-471` upper comment in original: "Doing it per-backend would be the same opt-in arrangement that let ExtraArgs rot: a family that forgot the call would accept a fixed_args `--output-format text` and break its own stream-json channel."). The exported `FilterLaunchPrefix` is for the daemon's `--version` probe (`launch.go:471-480`).
- **Conflicts only log, never change behavior**: `warnLaunchPrefixOverlap` (`launch.go:553-571`) compares the prefix against this argv's flag names at process construction, warning on a hit (`exec` calls it at `launch.go:113`). The comment (`:543-552`) says this is a GH #7046 leftover: the prefix was once **placed last**, so a runtime's `--model composer-2.5` would **silently override** the model the user picked in the UI.
- Also: the `--version` probe carries the prefix too (`agent.go:514-521` comment: `ccms start q36 --version` reports the version of the CLI it execs, while `ccms --version` reports the wrapper's own), otherwise the minimum-version bar would get the wrong version number.

### 4.4 Differences

- **D8 · QwenPaw skill path name does not match.** The docs write "per-run workspace `skills/`" in two places (`providers.txt:45`, `providers.mdx:44`); the code writes `<workDir>/skill_pool` (`execenv/context.go:409-411`), and the comment even gives the upstream basis (QwenPaw `skill_system/store.py`'s `get_workspace_skills_dir`).
- **D9 · Dim's "—" is imprecise.** The doc table gives Dim a "—" skill path (`providers.txt:48`, `providers.mdx:47`); in the code `dim` has no case and falls into the **default branch** `.agent_context/skills/` (`context.go:435-438`). [inference] That directory's comment self-describes as "referenced by meta config"; I did **not** find evidence that Dim scans this directory, so `the docs say none, the code writes there` is a fact, while `whether Dim consumes it after writing` is an unverified item (§10).
- **D10 · The mechanism distribution of "Multica-managed MCP" is not written in the docs.** The doc's four-column table only gives the two states `supported / not supported`, leading the reader to think all go through one channel; actually 18 backends read `opts.McpConfig` directly, and Cursor / OpenClaw go through a second `write config files` channel (§4.2). The conclusion (who can use MCP) matches the docs; the mechanism differs.
- Consistent items: the four no-MCP backend names (antigravity / copilot / deveco / pi) match one-to-one between docs and code; the Codex / Hermes / OpenClaw three skill exceptions, MCode's no session resumption, and the QwenPaw+MCode lazy picker all match the code (ZeroClaw is the third lazy picker the docs do not list).

---

## 5. Execution surface: connection, heartbeat, concurrency, GC

### 5.1 Documentation side (D)

- `daemon-runtimes.txt:52`: "Once registered, a runtime keeps a persistent connection. When a new run enters the queue, the server notifies the matching daemon; the daemon also polls periodically as a backstop after connection interruptions."
- `daemon-runtimes.txt:54`: "The daemon sends a heartbeat every 15 seconds. ... after a daemon exits unexpectedly, the runtime usually shows as offline **within about 3 minutes at the latest**."
- `daemon-runtimes.txt:58`: a queued run "fail only once it has stopped heartbeating for longer than the reconnect grace **and** the run has itself been queued that long".
- `daemon-runtimes.txt:60`: an in-progress run fails, and those meeting the criteria retry automatically.
- `daemon-runtimes.txt:62`: a daemon restart re-registers and reclaims runs that did not end cleanly last time.
- `daemon-runtimes.txt:64`: "A runtime offline for more than 7 days with no agents bound to it (including archived ones) is cleaned up automatically."
- `daemon-runtimes.txt:70-72`: "One daemon executes at most 20 runs at a time by default; each agent at most 6. Effective concurrency is the smaller of the two." + "adjust a single agent's concurrency in the agent settings, and the machine-wide cap through `MULTICA_DAEMON_MAX_CONCURRENT_TASKS`".
- `tasks.txt:145-147`: `dispatched` over 5 minutes is judged failed; `running` has no fixed duration cap; heartbeat 15s, about 3 minutes to judge offline.
- `tasks.txt:74`: a normal run defaults to at most 2 attempts (first run + 1 retry); tool network interruption at most 3.
- `environment-variables.txt:214-218`: `MULTICA_DAEMON_POLL_INTERVAL` 30s, `MULTICA_DAEMON_WS_CLAIM_POLL_INTERVAL` 3m, `MULTICA_DAEMON_HEARTBEAT_INTERVAL` 15s, `MULTICA_DAEMON_MAX_CONCURRENT_TASKS` 20, `MULTICA_AGENT_TIMEOUT` 0.

### 5.2 Source measurement: connection and heartbeat (C)

- Transport: WebSocket `GET /api/daemon/ws` (`server/cmd/server/router.go:1565`), hub in `server/internal/daemonws/hub.go`.
- Constants (`server/internal/daemon/config.go`): `DefaultServerURL = "ws://localhost:8080/ws"` (:24), `DefaultPollInterval = 30 * time.Second` (:25), `DefaultWSClaimPollInterval = 3 * time.Minute` (:29, comment: the safe polling upper bound for missed events under a healthy WebSocket, jittered downward before each sleep), `DefaultHeartbeatInterval = 15 * time.Second` (:30), `DefaultHealthPort = 19514` (:71).
- Heartbeat producer: `runRuntimeHeartbeat` one goroutine per runtime, the first tick carrying **jitter of at most one period** (`server/internal/daemon/daemon.go:4479-4496`, preventing multiple runtimes from registering in a thunder herd simultaneously).
- **Offline determination**: `staleThresholdSeconds = service.RuntimeClaimFreshnessSeconds` (`server/cmd/server/runtime_sweeper.go:33`), and

  ```
  RuntimeClaimFreshnessSeconds = 150.0   // server/internal/service/task.go:189
  ```

  the comment (`task.go:182-188`) gives the derivation: must exceed `the 60s DB heartbeat-persist interval + one ≈15s daemon heartbeat + the ≈30s batch-scheduling tick` = 105s worst-case age, 150s leaving 45s of headroom.
- Sweep period `sweepInterval = 30 * time.Second` (`runtime_sweeper.go:24`) → 150s + 30s ≈ **180s**, matching the docs' `about 3 minutes`. Database predicate: `SELECTStaleOnlineRuntimes` (`server/pkg/db/queries/runtime.sql:249-256`).
- **The hot path has another lane**: the Redis TTL key `mul:runtime:hb:<id>` (`server/internal/handler/runtime_liveness_store.go:75-81`); the heartbeat writes only this key rather than rewriting `last_seen_at` every beat; when `Touch`/`IsAliveBatch` errors or Redis is not connected it **degrades wholesale** to `write the DB every beat + trust only the SQL staleness window` (same file `:11-27` interface comment). During the sweep, `filterStaleRuntimesByLiveness` uses Redis to keep rows where `the DB is merely lagging` (`runtime_sweeper.go:358-390`), and `Forget`s the key after confirming offline (`:280-287`).
- Heartbeat claim: `GetAgentRuntimeHeartbeatLeases` (`runtime.sql:33-40`) authenticates the whole runtime set in one round trip, after which only immutable ownership fields and liveness state remain in the connection lease.
- **Running tasks are not killed by the server wall clock**: `runningTimeoutSeconds = 9000.0` (2.5h) **and** requires `last_seen_at` to already be expired for it to apply (`runtime_sweeper.go:80-88` comment: a multi-hour research/training task on a heartbeat-healthy runtime is never wall-clock killed, `MUL-4107`).
- The daemon's own liveness net: `DefaultAgentTimeout = 0` (no absolute cap, `config.go:31-36`), `DefaultAgentIdleWatchdog = 2 * time.Hour` (`:47-65`, the comment explaining why it was raised step by step from 5min to 2h).
- `dispatched` timeout: `dispatchTimeoutSeconds = 300.0` (`runtime_sweeper.go:69-71`).

### 5.3 Source measurement: queue grace (C)

- `defaultRuntimeReconnectGrace = 3 * time.Hour` (`runtime_sweeper.go:38-43`), env override `MULTICA_RUNTIME_RECONNECT_GRACE` (`server/cmd/server/main.go:740`), lower bound `minimumRuntimeReconnectGrace = staleThresholdSeconds` = 150s, clamped up and logged when lower (`main.go:741-746`).
- Semantics: the runtime's status **still** flips offline after 150s (the UI tells the truth), **only the task termination is deferred**; a genuinely restarted daemon goes through `RecoverOrphanedTasksForRuntime` to bypass the grace (`runtime_sweeper.go:39-42`).
- The two conditions for a queued run: `ExpireStaleQueuedTasks` (`server/pkg/db/queries/agent.sql:1414` onward). The long comment (`:1415-1442`) spells out the history: this **used to be** a pure wall-clock TTL (default 2h), conflating `nobody will ever come` with `the queue ahead is long`; `MUL-6558` is a self-hosted low-concurrency runtime queueing its own queue past 2h and getting healthy tasks killed as `queued_expired`; it was changed into the AND of `can this runtime still prove it is alive` + `has this run itself been queued a full grace`. The heartbeat age is read **directly** without gating on `status='online'`, so rows stuck at online but whose heartbeat long died can also release the queue (`:1443-1445`).
- In-progress task termination: `FailTasksForOfflineRuntimes` (`runtime.sql:277-299`), victims being `dispatched`/`running`/`waiting_local_directory` with runtime offline and `COALESCE(last_seen_at, updated_at)` beyond the grace.
- The retry-grace terminal path: `sweepExpiredRuntimeReconnectRetries` (`runtime_sweeper.go:332-354`).
- Batch sizes: `offlineTaskFailBatchSize = 500`, `reconnectRetryExpireBatchSize = 500`, `queuedExpireBatchSize = 500` (`runtime_sweeper.go:48-51`, `:89-96`).
- The automatic-retry cap is server-side: `tasks.txt`'s 2 / 3 attempts (D side) correspond to the retry scheduling in code; this document did not chase each to a specific constant (§10 records it as not dug deep).

### 5.4 Source measurement: concurrency caps and the 7-day GC (C)

**Concurrency**:

- Daemon side: `DefaultMaxConcurrentTasks = 20` (`config.go:72`), env `MULTICA_DAEMON_MAX_CONCURRENT_TASKS` (`config.go:474`), CLI `--max-concurrent-tasks` (`server/cmd/multica/cmd_daemon.go:107`); the execution surface is a semaphore `newTaskSlotSemaphore(d.cfg.MaxConcurrentTasks)` (`server/internal/daemon/daemon.go:5349`), the slot number exposed to tasks via `MULTICA_TASK_SLOT` (`daemon.go:5445`).
- Agent side: `agentconfig.DefaultMaxConcurrentTasks = 6` (`server/internal/agentconfig/`, migration `server/migrations/023_agent_concurrency_default.up.sql` raises the default from 1 to 6 and backfills), bounds `[1, 50]`; gated at claim time (`server/internal/service/task.go:3541`: `if running >= int64(agent.MaxConcurrentTasks)` → `"task claim: no capacity"`).
- So "effective = min(daemon 20, agent 6)" is the natural result of each side gating itself — **no** place takes the min of the two numbers and judges on it. The doc's wording is a behavior summary, not an implementation description.

**7-day GC** (`ListStaleOfflineRuntimeGCCandidates`, `runtime.sql:510-533`):

```sql
SELECT id FROM agent_runtime
WHERE status = 'offline'
  AND last_seen_at < now() - make_interval(secs => @stale_seconds)
  AND NOT EXISTS (SELECT 1 FROM agent
                  WHERE agent.runtime_id = agent_runtime.id
                    AND agent.kind = 'user' AND agent.archived_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM agent_task_queue
                  WHERE agent_task_queue.runtime_id = agent_runtime.id
                    AND agent_task_queue.completed_at IS NULL)
```

- `@stale_seconds = offlineRuntimeTTLSeconds = service.OfflineRuntimeTTLSeconds = 7 * 24 * 3600.0` (`runtime_sweeper.go:52-57`, `server/internal/service/runtime_teardown.go:12-19`; the same constant is reused by the interactive delete endpoint to tell the user `when a row you cannot delete will disappear on its own`).
- Cadence: `runtimeGCSweepInterval = time.Hour` (`:27-30`), per-round cap `runtimeGCBatchSize = 500`, round timeout 15s, per-runtime operation timeout 5s (`:54-67`).
- Each row is re-judged under `FOR UPDATE` (`gcRuntime`, `runtime_sweeper.go:481` onward + `IsAgentRuntimeEligibleForGC`, `runtime.sql:535` onward).
- Interactive delete side: an instance whose profile is still alive is **rejected 409 outright** (`server/internal/handler/runtime.go:1017-1026`); only an orphan instance (profile no longer exists) is deletable (`:1027-1033`).

### 5.5 Differences

- **D3 · The grace number is not on this page.** `daemon-runtimes.txt` throughout only says "the reconnect grace"; the number 3h only appears on the `environment-variables` page (`environment-variables.txt:44`). A cross-page reference is not wrong, but the criterion cannot be read from this page when debugging online/offline behavior.
- **D4 · The 7-day GC criterion is missing one clause, and the `including archived agents` wording is inverted.** The docs `daemon-runtimes.txt:64` "no agents bound to it (including archived ones)"; in the code an archived agent does **not** enter the blocking set (the `agent.archived_at IS NULL` predicate), and **a non-terminal task also blocks GC** — the latter the docs never mention.
- **D11 · `heartbeat 15s` omits the persist cadence.** The real chain is `one beat per 15s → the Redis TTL key (hot) → `last_seen_at` persisted at most every 60s`, with offline determination using the 150s staleness window. The docs' two numbers 15s/3min are both right; the 60s persist interval in between is a third number the docs do not have.
- Consistent items: transport shape (persistent connection + polling backstop), restart re-registers and reclaims, `running` has no fixed cap, `dispatched` 5 minutes — docs and code match item by item.

---

## 6. Credentials surface: the task-level `mat_` token

### 6.1 Documentation side (D)

- `auth-tokens.txt:79`: "When the daemon claims a run, the server creates a temporary token for that run, prefixed with `mat_`. It is bound to the **current user, workspace, agent, and run**, is valid for **at most 24 hours**, and is cleaned up when the run ends."
- `auth-tokens.txt:81`: "The daemon injects this temporary token into the AI coding tool instead of handing the user's PAT to the agent. Requests made by the agent are therefore recorded as agent actions, and the token can't be used to reach sensitive operations restricted to users or owners."
- `auth-tokens.txt:89-93`: there are also `mcn_` (Multica Cloud Node) and `mdt_` (workspace-scoped daemon auth) machine credentials; a normal install never needs to construct them by hand.
- `auth-tokens.txt:19`: the PAT prefix `mul_`; `:35-42`: `multica login` creates a 90-day PAT stored at `~/.multica/config.json` (or `~/.multica/profiles/<name>/config.json`), auto-renewing to 90 days when fewer than 7 remain.
- `daemon-runtimes.txt:88`: "an agent's custom environment cannot override any `MULTICA_` variable or the task temporary-directory variables."
- `daemon-runtimes.txt:92-103`: the task environment-variable table, of which 5 are marked **Integration contract** (`MULTICA_TOKEN` / `MULTICA_TASK_ID` / `MULTICA_AGENT_ID` / `MULTICA_WORKSPACE_ID` / `MULTICA_SERVER_URL`), the rest marked Informational (`MULTICA_TASK_CONFIG_ROOT` / `MULTICA_TASK_WORKSPACES_ROOT` / `MULTICA_AGENT_NAME` / `MULTICA_DAEMON_PORT` / `MULTICA_TASK_SLOT` / `TMPDIR` (also giving `TMP`/`TEMP`)). Below the table it says "intentionally not exhaustive and is not a versioned API surface".
- `daemon-runtimes.txt:105`: write operations are accounted under the **assigned agent + active task** identity.
- `daemon-runtimes.txt:107`: child processes inherit everything by default (including `MULTICA_TOKEN`); stripping requires explicit stripping; the **reverse exception** is the tool self-filtering child-process env — "Codex's shell tool drops names containing `TOKEN`, `KEY`, or `SECRET`, so the daemon installs a managed shell policy that allows the required task variables."
- `security-model.txt:41`: "Run-scoped API tokens. The `MULTICA_TOKEN` handed to a run is bound to that agent and that run by the server, so a run cannot act as you or as another agent through the Multica API."

### 6.2 Source measurement: token minting and binding (C)

- Generation: `GenerateAgentTaskToken()` = `"mat_" + 40 hex` (`server/internal/auth/jwt.go:78-89`); same file `:61-75` is `mul_` (PAT, `GeneratePATToken`), `:68` onward is `mdt_` (`GenerateDaemonToken`). Library-wide uniform `HashToken` = SHA-256 hex (`jwt.go:92-95`).
- Two mint points: single-task claim `server/internal/handler/daemon.go:3826`, batch claim `daemon.go:1868`.
- The binding is written to the `task_token` table (created at `server/migrations/108_task_token.up.sql:14-25`):
  `(task_id → agent_task_queue.id, agent_id → agent.id, workspace_id → workspace.id, user_id → user.id, expires_at)`, all four columns `NOT NULL` + `ON DELETE CASCADE`; the long comment at `108_task_token.up.sql:1-8` explains the historical practice this table replaced — it **once** injected the daemon owner's `MULTICA_TOKEN` (a workspace owner/admin's PAT) directly into the agent process, i.e. giving the agent the full owner permission set (`MUL-2600`).
- Persist parameters (`handler/daemon.go:3843-3853`): `UserID: runtime.OwnerID`, `ExpiresAt: time.Now().Add(24 * time.Hour)`. **24h is hard-coded**, the accompanying comment at `:3810-3811`: "Token expires after the queue/runtime upper bound (24h) so it survives long-running tasks but cannot outlive a forgotten one."
- **No token for an ownerless runtime**: `if !runtime.OwnerID.Valid { ...CancelTask... }` (`:3812-3825`, `MUL-3292`), the batch path likewise (`:1859-1867`). This is the same root cause as §8's `ownerless runtime cannot be bound`.
- Validation: `GetTaskTokenByHash` (`server/pkg/db/queries/task_token.sql:6-8`) with `expires_at > now()`; cleanup `DeleteTaskTokensByTask` (`:10-11`), `DeleteExpiredTaskTokens` (`:13` onward).
- The identity mechanism (`daemon.go:3801-3806` comment in original): once the token is bound to (agent, task, workspace, owner), **even if the agent strips or forges the `X-Agent-ID` / `X-Task-ID` headers**, the server still accounts with actor=agent — sealing off the lateral-movement path to human-only endpoints (e.g. `/api/agents/{id}/env`). `108_task_token.up.sql:1-8` likewise: owner-only endpoints 403 every agent-sourced request.
- The daemon-side hard check: `taskScopedAuthToken` requires the server-issued token to have the `mat_` prefix, otherwise reporting `"server provided non-task-scoped auth token"` (`server/internal/daemon/daemon.go:167-177`). The CLI side also has the `must hold a `mat_` inside the agent execution context` gate (`server/cmd/multica/cmd_agent.go:261-271`, `cmd_auth.go:472-473`), the error wording being `agent execution context requires MULTICA_TOKEN to be a task-scoped mat_ token`.
- PAT caliber: `TaskTokenPrefix = "mat_"` has a constant on the CLI side (`server/internal/cli/client.go:77`), with a comment explaining "401 on one is not the 'your login expired' case" (`:71-76`).

### 6.3 Source measurement: the 13 injected variables (C)

`taskMulticaEnvironment` (`server/internal/daemon/daemon.go:178-194`) returns 13 keys at once:

```go
"MULTICA_TOKEN" / cli.TaskConfigRootEnv / TaskWorkspacesRootEnv / "MULTICA_SERVER_URL" /
"MULTICA_DAEMON_PORT" / "MULTICA_WORKSPACE_ID" / "MULTICA_AGENT_NAME" / "MULTICA_AGENT_ID" /
"MULTICA_TASK_ID" / "MULTICA_TASK_SLOT" / "TMPDIR" / "TMP" / "TEMP"
```

Constant values: `TaskConfigRootEnv = "MULTICA_TASK_CONFIG_ROOT"` (`server/internal/cli/config.go:19`), `TaskWorkspacesRootEnv = "MULTICA_TASK_WORKSPACES_ROOT"` (`server/internal/daemon/config.go:748`). Call site `daemon.go:8472`.

Against that stands the **user-cannot-override** rule (`isBlockedEnvKey`, `daemon.go:10355-10367`):

- The `MULTICA_` prefix is banned **as a whole block**;
- plus a precise name list: `HOME`, `PATH`, `USER`, `SHELL`, `TERM`, `TMPDIR`, `TMP`, `TEMP`, `CODEX_HOME`, `REASONIX_STATE_HOME`, `CURSOR_DATA_DIR`, `execenv.CursorMcpAuthSourceEnv`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_INCLUDE_ROOTS`.
- The only deliberate exception is `HERMES_HOME`: the `layerCustomEnvAndHermesHome` comment (`daemon.go:10369-10377`) explains — when skills are bound the per-task overlay is built **from** the user's `HERMES_HOME` and must win; when no skills are bound the user's `HERMES_HOME` passes through verbatim.
- Cross-check against docs: the docs' `any `MULTICA_` variable + task temporary-directory variables` = the prefix rule + `TMPDIR/TMP/TEMP`, consistent; the code's extra `HOME/PATH/CODEX_HOME/...` are not listed in the docs.

**Environment variables beyond the doc table** (the docs self-describe as "not exhaustive", so not a defect, but worth knowing): `MULTICA_DSH_SESSION_ROOT`, `DSH_TELEMETRY_DISABLED=1` (`daemon.go:8563-8564`), plus per-family home redirections (`HERMES_HOME`, `CODEX_HOME`, `CURSOR_DATA_DIR`, etc.).

### 6.4 Source measurement: Codex's shell environment allow rule (C)

- Problem (`server/internal/daemon/execenv/codex_shell_env.go:15-20`): Codex filters the environment before executing shell subprocesses, and the default secret guard drops names containing `KEY` / `SECRET` / `TOKEN`, so the Codex process the daemon launched has `MULTICA_TOKEN` while its inner `multica issue ...` does not.
- Approach: the daemon writes a **managed block** inside each task's isolated `CODEX_HOME`, wrapped with `# BEGIN multica-managed shell-environment (do not edit; regenerated by daemon)` / `# END ...` (`codex_shell_env.go:20-31`), rewritten on each run (`shellEnvBlockRe` matches and replaces wholesale, `:33-35`).
- The values written (`renderMulticaShellEnvBlock`, `codex_shell_env.go:112-125`): `inherit = "all"`, **`ignore_default_excludes = true`**, `include_only = [...precise list...]`.
- The list algorithm `CodexShellEnvAllowlist` (`codex_shell_env.go:38-100`): inherited variables keep Codex's default filtering; among the **explicit** values, a credential-looking name only enters if it also appears in `authorizedExplicit` (derived by the daemon from the current agent's blocklist-checked `custom_env`); **inherited `MULTICA_*` are all dropped** (they belong to the daemon process, not necessarily to this task), while explicit `MULTICA_*` may stay (because the daemon blocklists that namespace and constructs values from the current task). Case follows Codex's glob semantics, uppercased and deduped.
- Cross-check against docs (`daemon-runtimes.txt:107`): the docs say "installs a managed shell policy that **allows the required task variables**" — the direction is right, but the most critical step is understated: it is not `allow a few extra names beyond the default filter` but **switching Codex's default secret filter off entirely** (`ignore_default_excludes = true`) and replacing it with an explicit allowlist. The behavior equivalence is unchanged (the allowlist is precise names, not globs), but this decides which switch to look at when debugging.

### 6.5 Differences

- **D5 · The Codex shell policy's mechanism is understated** (see §6.4).
- **D12 · `MULTICA_TOKEN`'s owner semantics are not called out in the docs.** `auth-tokens.txt:79` says the token is bound to "the current user"; the code takes **`runtime.OwnerID`** (`handler/daemon.go:3850`), i.e. **the owner of the machine running the task**, not the task initiator. This explains why an ownerless runtime must refuse the task first (`:3812`) — without an owner there is no "current user" to bind.
- Consistent items: the `mat_` / `mul_` / `mdt_` / `mcn_` four prefixes, the 24h cap, the five Integration-contract variables, the non-exhaustive declaration, child inheritance, and the server-side storage of custom env and MCP (`agent.mcp_config` / `custom_env` both server-side, shipped down via `Sync`) — all match the code item by item.

---

## 7. Custom-profile surface: constraints and argument ordering

### 7.1 Documentation side (D)

- `daemon-runtimes.txt:82-84`: internal wrappers, version-pinned executables, and needing fixed extra arguments are the cases for a custom profile; "A custom profile does not add a new communication protocol. You still pick one of the protocol families Multica already supports ... and the command itself must be compatible with that family."
- `daemon-runtimes.txt:111`: "Only workspace owners and admins can create, edit, or delete custom runtime profiles."
- `daemon-runtimes.txt:121`: a profile is workspace-level shared; each machine looks for the command on its own `PATH`; only machines that find it register the corresponding runtime; creating a profile **does not install the command nor log anyone else in**.
- `daemon-runtimes.txt:123`: the command field is `executable + arguments`, not a shell script — quotes and backslash escapes work; pipes, redirection, `&&`, `;`, backticks, and variable expansion do not; for those, write a wrapper script and use the script as the command.
- `daemon-runtimes.txt:127-135`: **argument ordering** — "Everything you type in the command field stays directly after the executable, ahead of the arguments Multica adds", and why: a subcommand-style wrapper like `ccms start q36` must consume `start q36` before it can accept `-p`; and it explicitly admits "Your arguments used to be appended last instead" — flag-style commands usually parse the same either way, but **a CLI that distinguishes global flags from subcommand flags can still care where a flag lands**, so run once to confirm after upgrading.
- `daemon-runtimes.txt:143-153`: a Desktop-launched daemon that cannot find a command uses `multica runtime profile set-path <profile-id> --path /abs/path`, undone with `unset-path` (snapshot damage: the left angle bracket was eaten into `profile-id>`, see the sibling `README.md:14-16`).
- `daemon-runtimes.txt:155`: "Editing a profile only affects runs claimed afterwards. Before deleting a profile, deal with the active agents still bound to its runtimes. Deleting only the runtime instance on one computer does not delete the profile — a running daemon will re-register it."

### 7.2 Source measurement: the constraint chain (C)

The daemon fetches the profile list on each workspace sync round (`GET /api/daemon/workspaces/{id}/runtime-profiles`, `router.go:1568`), item by item:

1. `runtimeType := agent.ProfileRuntimeType(profile.RuntimeType, profile.ProtocolFamily)` — for backward compatibility with old profiles predating the `runtime_type` column (`builtin_runtimes.go:188-194`).
2. `if profile.CommandName == "" || profile.ProtocolFamily == ""` → skip + warn (`server/internal/daemon/daemon.go:3084-3087`).
3. `if _, supported := agent.RuntimeProtocolFamily(runtimeType); !supported` → skip and record into `failedProfiles`, reason = `unsupported runtime_type: <x>` (`daemon.go:3088-3098`). `RuntimeProtocolFamily` checks the builtin-runtime descriptor first, then `IsSupportedType` (`builtin_runtimes.go:196-203`).
4. Command resolution, three-tier priority: per-machine override (`ProfileCommandOverrides[profile.ID]`, from the CLI config's `runtime profile set-path`) → `lookPath(command_name)` → the path that provider discovery already found at startup (only when the command name matches and the path is non-empty). None of the three succeed → skip and write the reason into `failedProfiles` (`daemon.go:3109-3147`). The comment (`:3117-3126`) explains the third tier: a GUI-launched daemon's environment cannot resolve the CLI, but the provider discovery at startup (login shell / install paths) already found it.
5. Version probing **carries fixed arguments**: `detectAgentVersion(ctx, agent.NewCommand(resolved, agent.FilterLaunchPrefix(runtimeType, profile.FixedArgs, d.logger)))` (`daemon.go:3161-3163`). The comment (`:3154-3160`) in original: `ccms start q36 --version` reports the version of the CLI it execs, `ccms --version` reports the wrapper's own, and only the former matters for the minimum-version bar (GH #7046). Parse failure is only debug + empty version, does not block registration (`:3164-3170`).
6. The profile-set signature hash `profileSetSignature` (`daemon.go:3198` onward) covers `ID/Enabled/runtime identity/CommandName/FixedArgs/Visibility`, sorted by ID; after the server reports "create/edit/disable/delete", this value is diffed to decide re-registration (`MUL-3332`, comment `:3190-3197`).

DB-side constraints: `runtime_profile.protocol_family` has a `CHECK (... IN (25 families))` (latest `server/migrations/441_...up.sql:6-33`, `NOT VALID` to accommodate historical rows); `(workspace_id, display_name)` unique (`120_runtime_profile.up.sql:64`); `fixed_args JSONB NOT NULL DEFAULT '[]'` (`:61`); the comment (`:28-30`) calls out that **the only argument column is `fixed_args`** — "the fixed arguments that EVERY agent on this runtime must inherit to enter a compatible mode".

### 7.3 Source measurement: why the argument ordering cannot be reversed (C)

`Command`'s doc comment (`server/pkg/agent/launch.go:36-68`) is the canonical text of the whole matter, translated sentence by sentence:

- Position: `<Path> <Prefix...> <protocol args...> <ExtraArgs...> <CustomArgs...>`.
- In the real example the reasoning cites, the wrapper can only reach the actual Claude binary after consuming the `start` subcommand, so `-p` and the rest of the stream-json protocol flags are **meaningless before the prefix is consumed, and are rejected outright by a Commander-style parser** (GH #7046).
- "Subcommand-style prefixes work only in this position. Flag-style prefixes generally parse the same either way ... so prefix-first is the broader of the two orders, not a universally safe one: a CLI that separates global flags from subcommand flags can still care where a flag lands." — same origin as the docs' disclaimer at `daemon-runtimes.txt:135`.
- `Argv()` copies the prefix and places it before the args (`launch.go:99-104`), with the comment explicitly "Never mutate a Command's Prefix in place"; `exec()` is the **single repo-wide place** that constructs a runtime process (`launch.go:107-115`), guarded by a test named `TestOnlyLaunchGoSpawnsRuntimeProcesses` — "a new backend cannot forget the launch prefix and silently reintroduce GH #7046".
- Why the daemon does not carry fixed_args via `ExtraArgs` (`daemon.go:8635-8640` comment): only 6 backends read `ExtraArgs`, and among those that do it is placed **after** the protocol flags, so the wrapper's subcommand would either be dropped or squeezed behind `-p` (GH #7046).
- Fallback behavior: a protocol-critical flag in the prefix that gets dropped logs a warn and **continues** (`launch.go:531`), not an error; an overlapping but unblocked flag (e.g. `--model`) gets one warn from `warnLaunchPrefixOverlap`, and the final value is decided by last-wins (`:568-570`).

### 7.4 Differences

- **No substantive difference**; the docs' description of the ordering reason (subcommand-style wrappers) shares the same origin and cause as the code comments, down to the same `residual risk` disclaimer.
- Two additions the docs do not write:
  - **Profile-set change detection is a hash diff** (`profileSetSignature`), not per-item comparison — so `editing a profile only affects later-claimed runs` (`daemon-runtimes.txt:155`) gains an extra layer in implementation: the daemon **re-registers** on a hash change, and the new instance appears in the UI (`MUL-3332`).
  - **Deleting an instance and deleting a profile are two things, and instance deletion is actively refused**: deleting an instance while the profile is alive returns 409 + guidance (`server/internal/handler/runtime.go:1017-1026`, `profileInstanceDeleteRefusal`); only orphan instances whose profile has disappeared can be directly deleted (`:1027-1033`, `MUL-4158`). The docs' "Deleting only the runtime instance ... does not delete the profile" is on the soft side.

---

## 8. Permissions surface: private / public runtime

### 8.1 Documentation side (D)

- `daemon-runtimes.txt:76`: a local runtime is private by default; only the runtime owner can create an agent on it; "**Workspace owners and admins are no exception** — the runtime is someone else's computer, and running an agent there spends their machine and their tool credentials."
- `daemon-runtimes.txt:78`: only the owner can make it public; "workspace admins can **rename or delete** a runtime, but sharing one is the owner's decision." Other members selecting this runtime do **not** share the underlying tool's login credentials; they only allow their own agents' runs to be routed to this machine.
- `cli.txt:172`: deleting a runtime that still has active agents bound is refused by default; `multica runtime delete --cascade` unbinds those agents, keeps their configuration and history, and cancels their active runs.

### 8.2 Source measurement (C)

- Column definition and default: `agent_runtime.visibility` defaults to `'private'` (`AgentRuntimeResponse` comment `server/internal/handler/runtime.go:41-44` points to migration 083).
- **Bind or not** (`canUseRuntimeForAgent`, `runtime.go:870-889`):

  ```go
  if !rt.OwnerID.Valid { return false }        // ownerless always refused
  if rt.Visibility == "public" { return true }
  return uuidToString(rt.OwnerID) == uuidToString(member.UserID)
  ```

  The long comment (`:870-880`) corresponds to the docs sentence by sentence: "a `private` one is usable only by its owner, with **NO workspace owner/admin override** (MUL-6126): a private runtime is someone's own machine, and running an agent on it spends their credentials and their local files, which is not an administrative decision." And it calls out "An ownerless runtime is refused whatever its visibility: task claim needs an owner to mint the agent's task token and cancels the task without one (MUL-3292)" — the same root cause as §6.2's `runtime.OwnerID` check.
- **Change sharing or not** (`canSetRuntimeVisibility`, `runtime.go:891-900`): `rt.OwnerID.Valid && owner == member`. Comment: "Owner-only, and deliberately narrower than `canEditRuntime`: visibility is the owner's consent to lend their machine to the workspace, so an admin who could flip it would still hold the override `canUseRuntimeForAgent` removed. Admins keep `canEditRuntime` for the organisational actions — rename, delete."
- Three-tiers of editors: `canEditRuntime` (rename/delete, owner or admin), `canSetRuntimeVisibility` (share, owner only), `canUseRuntimeForAgent` (bind agent, public or owner). PATCH `/api/runtimes/:id` passes `canEditRuntime` first (`runtime.go:510-514`) then `canSetRuntimeVisibility` (`runtime.go:535`).
- List visibility: `ListVisibleAgentRuntimes` (`runtime.sql:11-19`) — `owner_id = $2 OR visibility = 'public'`; owner/admin go through `ListAgentRuntimes` (able to see others' private runtimes to rename/delete), ordinary members go through the visible set (`runtime.go:916-935`, comment: "Governance visibility preserves the existing owner/admin contract: admins can find a private runtime to rename or delete it, but the per-runtime read gate still denies data and machine access.").
- Client-side same rule: `packages/core/runtimes/access.ts` (`isRuntimeUsableForUser`) — the `runtime.go:882` comment says "This is the same rule the clients enforce ... so UI, API and CLI agree".
- Delete refusal: `DeleteAgentRuntime` passes `canEditRuntime` first (`:1010-1014`), then checks active agents, and 409 + a cascade plan if any (`:1035-1051`), confirm path `POST /runtimes/:id/unbind-agents-and-delete` (`:1044-1047` comment). Member revocation has another set: `ForceOfflineRuntimesByIDs` + `DeleteDaemonTokensByWorkspaceAndDaemons` + `CancelAgentTasksByRuntimeOrAgent` (`runtime.sql:301-325`, `:351-371`, `daemon_token.sql:13-24`).
- "A public runtime does not share credentials" is reflected in code as the full decoupling of `runtime reachability` from `CLI login state`: login state is stored locally by each CLI itself (`install-agent-runtime.txt:56` "Those login credentials are stored locally by the tool itself. Multica never receives login tokens from Claude, Codex, Cursor, or any other CLI."), and the daemon side neither reads nor uploads it.

### 8.3 Differences

- **Consistent**, and the code is even harder than the docs say (the docs say `admin cannot bypass`; the code does not even give admin the `visibility mutation surface`).
- One detail the docs only have on `cli.txt`, added here: **an ownerless runtime cannot be bound** is in service of token minting (§6.2); the docs' runtime page does not write this, but on the UI it shows as `this runtime cannot be selected`.

---

## 9. Difference list (summary)

| # | Location | Docs say | Code does | Source |
|---|---|---|---|---|
| D1 | `providers` tool table + `install-agent-runtime` command table | 25 tools | 25 protocol families, 26 probed command names (extra `zeroclaw`) | `config.go:974`, `agent.go:389`, `models.go:435`, `environment-variables.mdx:256` |
| D2 | DSH startup exception | exception to the `CLI-detection gate` | the exception is at the **registration gate** (`dshInstallInFlight`); the CLI gate's exemption is `AllowNoAgents`, only for read-only probes | `daemon-runtimes.txt:48` vs `dsh_startup_bootstrap_test.go:22-68`, `config.go:189-191` |
| D3 | reconnect grace | only names the concept, no number | default 3h, lower bound 150s, env `MULTICA_RUNTIME_RECONNECT_GRACE` | `daemon-runtimes.txt:58` vs `runtime_sweeper.go:38-47`, `environment-variables.txt:44` |
| D4 | 7-day GC criterion | offline + 7 days + no agents (including archived) | additionally `no non-terminal task`; an archived agent does **not** block GC | `daemon-runtimes.txt:64` vs `runtime.sql:510-533` |
| D5 | Codex shell policy | "installs a managed shell policy that allows the required task variables" | switches off Codex's default secret filter (`ignore_default_excludes = true`) + precise `include_only` | `daemon-runtimes.txt:107` vs `codex_shell_env.go:112-125` |
| D6 | after installing a tool | "restart the daemon to detect it again" | auto re-scans every 2 minutes (`MUL-5439`); login-shell path at most 30 minutes | `daemon-runtimes.txt:46` vs `agents_refresh.go:15`, `agents_probe.go:32` |
| D7 | minimum-version bar | 8 tools | 10 entries (extra `dim 0.3.10`, `zeroclaw 0.8.0`) | `install-agent-runtime.mdx:63` vs `version.go:18-37` |
| D8 | QwenPaw skill path | `per-run workspace skills/` | `<workDir>/skill_pool` | `providers.mdx:44` vs `execenv/context.go:409-411` |
| D9 | Dim skill path | `—` | falls into the default branch `.agent_context/skills/` (whether Dim consumes it unverified) | `providers.mdx:47` vs `execenv/context.go:435-438` |
| D10 | Multica-managed MCP | a single `supported / not supported` column | 18 backends go through `opts.McpConfig`; Cursor / OpenClaw go through config-file writing | `providers.mdx:50` vs `cursor_mcp.go`, `openclaw_config.go:232-238` |
| D11 | heartbeat | 15s / about 3 minutes | one more layer in between: the Redis TTL hot path + `last_seen_at` persisted at most every 60s | `daemon-runtimes.txt:54` vs `runtime_liveness_store.go:11-27`, `task.go:182-189` |
| D12 | the "current user" `mat_` is bound to | the current user | `runtime.OwnerID` (the machine owner), not the task initiator | `auth-tokens.txt:79` vs `handler/daemon.go:3850` |
| D13 | runtime dimension | computer + tool (× workspace) | + profile (two partial unique indexes, built-in and custom coexisting) | `daemon-runtimes.txt:13` vs `runtime.sql:83/116`, migrations 120/121 |
| D14 | profile-instance deletion | "does not delete the profile" | deleting an instance is **outright 409-refused** while the profile is alive | `daemon-runtimes.txt:155` vs `handler/runtime.go:1017-1026` |

---

## 10. Not found / only to [inference]

Per the ticket's discipline, this section only writes what was **not verified**, without filling gaps with imagination:

1. **Whether Dim consumes `.agent_context/skills/`** — the code writes there (default branch), the doc table gives Dim "—". Whether it is really scanned by Dim is unverified (no upstream basis, no test assertion). [unverified]
2. **The concrete retry-count constants** — `tasks.txt:151-157` gives the 2 / 3 attempts table; I verified `expiredRuntimeReconnectRetries` and the queued-expiry sweep path, but did **not** chase the implementation constants and judgment points for `first run + 1 retry` and `3 attempts on tool network interruption, last at about 5s delay`. [not dug deep]
3. **Whether the `mat_` token has server-side clock constraints beyond `24h`** — the code hard-codes `time.Now().Add(24*time.Hour)`; I did not re-check whether a background task revokes early (`DeleteTaskTokensByTask`'s exact call sites on the task-end path were not checked one by one). [not dug deep]
4. **The `mcn_` (Multica Cloud Node) server implementation** — `jwt.go` only has the `mul_` / `mdt_` / `mat_` three generators; `mcn_` was not found in this clone. The docs say it is managed by the Multica Cloud Fleet (`auth-tokens.txt:90`), possibly not in the open-source repo. [not found]
5. **The full value sets of `launched_by` and `capabilities`** — the registration metadata has these two fields (`handler/daemon.go:486-491`); their enumerations were not expanded this round. Related to server capability negotiation (`protocol.DaemonCapability*`), a separate depth. [not dug deep]
6. **Builtin-runtime identities beyond `omp`** — the descriptor mechanism is general (the `BuiltinRuntimes` list), but currently **only `omp` has one entry** (`builtin_runtimes.go:86-100`). Whether a second is planned is not reflected in code. [statement of fact, not a gap]
7. **Snapshot damage's effect on this document**: the `argument ordering` code block in `daemon-runtimes.txt` is empty in the snapshot (sibling `README.md:17`); this document's ordering conclusions are all taken from the **in-repo canonical** `apps/docs/content/docs/daemon-runtimes.mdx:129` and the source comments, not relying on that empty block. Other references, if from the snapshot, have had their line attribution cross-checked against the in-repo `.mdx`.

---

## Attached: one-sentence version (for the map)

Multica's runtime = an `agent_runtime` row on the `(workspace, daemon, provider, profile)` four-tuple, with registration made restart-idempotent by an upsert over two **partial unique indexes**; 25 protocol families / 26 command probes (`zeroclaw` entered no doc table); the task-level `mat_` token binds `(task, agent, workspace, runtime owner)` and is hard-coded at 24h; online determination = 150s staleness + 30s sweep, reconnect grace defaults to 3h, and the 7-day GC additionally requires `no unarchived user agent + no non-terminal task`; the runtime share right is owner-exclusive with no admin bypass, and **an ownerless runtime can never be bound** (because no token can be minted).