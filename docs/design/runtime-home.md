# Runtime homes: managed binaries, owned config, one spawn path

Date: 2026-11-20
Status: proposed. Replaces the runtime half of [agent-config-isolation](agent-config-isolation.md) and the binary half of [managed-runtime-installs](managed-runtime-installs.md); subsumes the second Claude start path ([enginerun-takeover-protocol](enginerun-takeover-protocol.md), deleted).
Research: [runtime-homes-2026-11-20](../research/runtime-homes-2026-11-20.md).

## The newcomer's view

You installed Cairn today and added a Claude connection. A task runs on your machine. Three things are true no matter what else lives on that machine:

1. The `claude` process is the binary Cairn installed with its own SDK — not the `claude` you put on `PATH`. The same for Devin and Antigravity: one managed install, one launcher.
2. The runtime's config directory lives under `~/.cairn`, not `~/.claude` or `~/.gemini`. Nothing the session does can read or write your own agent CLI's login.
3. The first time the daemon starts, it copies the skills and MCP servers you already had (Claude's `~/.claude/skills` and `~/.claude.json`, Codex's `~/.codex/config.toml`) into those managed homes — a one-time, additive copy. Your original files are untouched and nothing stays linked.

If you run Cairn with no Claude connection and no login, the machine reports "Claude Code: installed" (the binary is always present) and "not logged in" separately — the two facts were previously collapsed into one PATH probe. To log in: `cairn claude login` runs the managed binary's interactive login against `~/.cairn/claude`.

## RuntimeHome table

`apps/daemon/src/runtime-homes.ts` is the single source. Every caller (spawn, env, confine, probes, capabilities) asks it; nothing computes a runtime's home or binary elsewhere.

| Runtime | Binary | Config home | Launch | Sandbox (macOS / Linux) |
|---|---|---|---|---|
| `claude-code` | SDK-bundled `claude` (`@anthropic-ai/claude-agent-sdk-<plat>-<arch>`, resolved via `createRequire` bound to `sdk.mjs`); `CAIRN_CLAUDE_BIN` override only | `~/.cairn/claude` (`CLAUDE_CONFIG_DIR`; covers `.claude.json`, `skills/`, `projects/` transcripts) | native SDK, `pathToClaudeCodeExecutable` | Seatbelt / bwrap, own-state = the whole home |
| `pi` (incl. `codex` provider) | in-process (`@earendil-works/pi-coding-agent` in the daemon) | `~/.cairn/agent-runtime` (`agentDir`; `skills/`, `auth.json`, `models.json`, `sessions/`) | programmatic; `pi-host` child on confined sessions | Seatbelt / bwrap on `pi-host`, own-state = agentDir |
| `devin` | managed install `~/.local/share/cairn/devin` (ACP registry binary) | `~/.cairn/agent-homes/devin` (synthetic `HOME`) | ACP via `createAcpBackend` | Seatbelt / bwrap, own-state = synthetic `HOME` |
| `gemini` | managed install `~/.local/share/cairn/gemini` (registry `npx` distribution → npm tarball, `node bundle/gemini.js`) | `~/.cairn/agent-homes/gemini` (`GEMINI_CLI_HOME`) | ACP via `createGeminiBackend`; no PATH fallback | Seatbelt / bwrap, own-state = `GEMINI_CLI_HOME` + its credential files |
| `antigravity` | managed install `~/.local/share/cairn/antigravity` (registry `binary` distribution) — `localPreference` deleted | `~/.cairn/agent-homes/antigravity` (synthetic `HOME`; `antigravity-api-key` variant) | ACP via `createAcpBackend` | Seatbelt / bwrap, own-state = synthetic `HOME` + credential files |
| `codex` | none — runs inside pi's `openai-codex` provider | pi's `agent-runtime` (credential = `openai-codex` key in `auth.json`) | in-process | inherits pi |
| Orb Claude | `/usr/bin/claude`, baked into the VM template | inside the orb | native SDK inside the VM | the VM is the boundary; unchanged |

Managed-install roots stay under `~/.local/share/cairn/` (binaries, not config). Synthetic-`HOME` credential files (`~/.gemini/*` into the antigravity/gemini homes) remain live symlinks: OAuth refresh tokens rotate, and a copy would silently expire; the login itself (desktop `antigravity-auth.ts`, `gemini` login) still writes the real user home, which the link makes current. This is the only deliberate exception to copy-once.

`~/.agents/skills` stays the live shared skills catalog (`skillsDir` / `CAIRN_SKILLS_DIR`) — it is the user's designated cross-agent library, not a runtime home. Claude additionally gets its native `~/.claude/skills` copied into the managed home by the import below.

## One spawn path; the second Claude path is deleted

`CAIRN_ENGINE_PTY`, `createClaudePtyBackend`, the whole `apps/daemon/src/engine/` subtree, the `engine.screen`/`engine.lease` protocol, the `engine-screen` server routes and web channels, `enginePty` capability, takeover UI and `engine-pty.log` are removed; `createClaudeCodeBackend` is the only Claude launcher. The transcript-derived `EngineRunView` raw output stays — it needs no PTY.

## Every path that reads or writes a runtime home

| Path | Reads | Writes | On failure |
|---|---|---|---|
| `machine-loop` claim | RuntimeHome `bin`/`home` for the chosen runtime | — | missing managed install → step fails that claim with `runtime-missing` (never falls back to a user binary) |
| `step-env` per step | RuntimeHome env map | step env for the session process | home not creatable → the step fails before spawn, `prepare` error surfaces in the task |
| `prepareAntigravityHome` / `prepareGeminiHome` / devin home | real user-home credential files (to link) | synthetic `HOME`, `settings.json` | missing cred files → home without them; the runtime reports "not logged in" on launch |
| `probeClaudeBin` (capabilities only) | SDK-bundled path, `CAIRN_CLAUDE_BIN` | — | absent bundle (skipped optional dep) → `claudeInstalled: false`, machine reports the cause |
| `probeClaudeCodeAuth` | `<managed> auth status` with `CLAUDE_CONFIG_DIR` set | — | probe error → `claudeAuth: 'unknown'`; classified reason logged |
| `agent-config import` (below) | user's `~/.claude`, `~/.claude.json`, `~/.codex/config.toml`, `~/.agents/skills` | `~/.cairn/claude/*`, `~/.cairn/claude/.claude.json`, `~/.cairn/agent-config-import.json` | per below |
| session transcripts | — | `~/.cairn/claude/projects/<slug>/<session>.jsonl` | managed `settings.json` pins `cleanupPeriodDays` high so the runtime never sweeps its own transcripts |
| `credentials.ts` / `step-env` token env | server-delivered `CLAUDE_CODE_OAUTH_TOKEN` / `GEMINI_API_KEY` / `WINDSURF_API_KEY` | step env | unchanged; env tokens stay the portable credential channel (macOS Keychain creds are keyed to the config dir and cannot be copied) |
| `mcp-config.ts` | `config.mcpConfigPath` → `~/.cairn/claude/.claude.json` | — | file absent/malformed → zero endpoints, `connectFailed` line as today; `CAIRN_MCP_CONFIG` still wins |
| `skills.ts` catalog | `skillsDir` (`~/.agents/skills`) | — | unchanged, live read |
| confine (`confine-session.ts`, `confine.ts`) | own-state + denied roots from RuntimeHome | Seatbelt profile / bwrap args | preflight `unavailable` → machine stops claiming (existing contract) |

## One-time import

Daemon startup runs `importAgentConfig(cairnHome, realHome)` once, stamped by `~/.cairn/agent-config-import.json` (`{version, at, copied[], skipped[], failed[]}`). Idempotent and additive — a rerun adds only missing files and never overwrites what the managed home already has. `cairn agent-config import --force` re-runs it on demand (the settings action).

**Copied:** `~/.claude/skills/` → `~/.cairn/claude/skills/` (native user skills); `~/.claude.json`'s top-level `mcpServers` → `~/.cairn/claude/.claude.json` (the daemon's MCP library file and the managed Claude's user-scope file, one and the same); `~/.codex/config.toml`'s `[mcp_servers]` → same file, translated — `env`/`http_headers` verbatim, `env_vars`/`bearer_token_env_var` resolved against the user's environment at import time, and skipped with a recorded reason when unset; `~/.claude/settings.json`'s `env` (minus `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `apiKeyHelper`) and `model` → `~/.cairn/claude/settings.json`.

**Never imported:** credentials and auth state (rotation/Keychain — env tokens and `cairn claude login` are the channel), `settings.json` hooks/`apiKeyHelper`/permissions/`commands`/`agents`/`output-styles` (executable or permission-bearing config), `projects/`, `sessions/`, history, `~/.claude/CLAUDE.md` (global memory would silently steer every task), caches. A malformed source JSON/TOML marks that source `failed` and the rest still import; a missing source marks `skipped`.

## Existing users and the managed Claude login

An existing user's `claude` login does not carry over: their OAuth lives in a Keychain entry keyed to `~/.claude` (macOS) or in `~/.claude/.credentials.json` (Linux), and neither is read by `CLAUDE_CONFIG_DIR=~/.cairn/claude`. Two ways in:

- Team users: unchanged — the server-delivered `CLAUDE_CODE_OAUTH_TOKEN` from the Model-services connection already authenticates every managed session.
- Standalone: `cairn claude login` (new CLI subcommand that execs the managed binary with `CLAUDE_CONFIG_DIR=~/.cairn/claude`, forwarding stdin/stdout/TTY and argv, so `login`, `setup-token`, `--version` all work) signs the managed home in once. `probedAuth` and the machines page show the result.

The server-side subscription Verify keeps `CLAUDE_BIN`→`CAIRN_CLAUDE_BIN`→`claude` resolution — it checks the token format server-side and is not a task spawn path.

## Sandbox per platform

macOS keeps the approved Seatbelt seam — every row's own-state is its config home (already enforced for claude/ACP/pi-host). **Linux: agents run unsandboxed today, visibly.** The bwrap preflight reports the machine `ready`, but session launches are not yet routed through `launchConfined` — the adapter migration segment of [linux-harness-confinement](linux-harness-confinement.md) is the outstanding work, not a flag. The runtime homes here give that segment its writable-root list for free. This doc does not add a second Linux mechanism; the machines page's `sandbox-unavailable` claim block is what the user sees while the gap remains, and choosing "document it" is rejected because the approved design already requires bwrap and partial enforcement is worse than the honest claim gate.

## States

Per runtime: `installed`/`unavailable` (managed binary probe at capability scan) × `authed`/`not-logged-in`/`unknown` (auth probe). Import: `pending` (no marker) → `done` (marker written) with `copied`/`skipped`/`failed` detail; `failed` entries retry on `--force` only, so a user's own edits are never clobbered.
