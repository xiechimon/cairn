# Agent runtime sourcing: where Cairn should get the agent CLIs it runs

Date: 2026-11-22. Status: prior-art research and recommendation; no code changed.

Marks: **observed** = read on disk, run, or read in primary source/docs in this session (path or link given). **derived** = derived from observed, checkable. **guessed** = unverified.

Credit: the install-cost findings in section 3 come from the bundle-slim lane's research, `docs/research/2026-11-21-desktop-install-cost.md` (untracked in the `bundle-slim` worktree, not on `main`); runtime home layouts come from `docs/research/runtime-homes-2026-11-20.md`.

## 1. For the newcomer

You installed Cairn today and asked it to do a coding task with Claude Code. Cairn runs a Claude Code program on your Mac to do that work. You may already have Claude Code in your terminal (`claude`), or you may never have installed it.

- **Where you meet this.** Every task that runs on Claude Code, Devin, Gemini or Antigravity. You see it only when it goes wrong: a task fails with "Claude Code 2.1.278 does not support this model" while `claude` in your terminal works, or Cairn asks you to sign in to Claude again although you are signed in in the terminal.
- **What you must already know.** Nothing. You need an Anthropic (or OpenAI, Devin, Google) account for the agent you pick; Cairn never asks for a payment.
- **What it asks of you.** Today: a separate Claude sign-in inside Cairn (`cairn claude login` signs the Cairn copy into `~/.cairn/homes/claude`). With the recommendation below: one first-run download (~120 MB compressed for Claude Code) and nothing else.
- **Where it stores things.** Today the Claude Code program lives inside `Cairn.app`; Devin, Gemini and Antigravity already download to `~/.cairn/tools/<name>/versions/<v>`. Under the recommendation Claude Code moves to the same `~/.cairn/tools/claude/versions/<v>` layout.
- **Where you get stuck.** No network on first run (the download cannot happen), a corporate proxy that blocks the vendor CDN, or a vendor revoking a signing certificate for the version Cairn pinned. Section 6 gives what you see in each case.

Why this matters (observed, owner report 2026-11-21): the user's own Claude Code had auto-updated to 2.1.330; Cairn's bundled copy stayed at 2.1.278 until the next Cairn release; a new model needed ≥ 2.1.280, so Cairn tasks failed while the terminal worked. The user could not tell why there were two copies, or why getting a newer Claude Code meant updating Cairn.

## 2. What Cairn does today (observed, `main` at `846ebfc4b`)

| Runtime | Source | Update path | Login | File |
|---|---|---|---|---|
| Claude Code | Bundled inside `Cairn.app`: the `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude` binary under the runner's `node_modules`. `CAIRN_CLAUDE_BIN` env override wins; no PATH scan since `1e248e2e7`. | Nightly `agent-sdk-bump` workflow bumps `@anthropic-ai/claude-agent-sdk` (now `0.3.330` → Claude Code 2.1.330, commit `5affc9c61`), which lands and then ships a full desktop release. | Separate home `~/.cairn/homes/claude` via `CLAUDE_CONFIG_DIR`; `cairn claude login`; server-delivered `CLAUDE_CODE_OAUTH_TOKEN`. | `apps/daemon/src/claude-code-bin.ts`, `.github/workflows/agent-sdk-bump.yml`, `apps/desktop/scripts/check-runner-claude.mjs` |
| Codex | Not a CLI: runs inside pi's `openai-codex` provider (OAuth in pi's `auth.json`). | Bundled with pi (`@earendil-works/pi-*` 1.5.0). | pi `auth.json` | `apps/daemon/src/backend/codex-login.ts`, `backend/pi.ts` |
| pi | In-process library, bundled. | Desktop release. | pi `auth.json` | `backend/pi.ts` |
| Devin | Managed download: `static.devin.ai/cli/current/manifest.json` → sha256-checked tarball in `~/.cairn/tools/devin/versions/<v>`, `current.json` pointer. | Follows vendor `current` channel, independent of Cairn releases. | Synthetic `HOME` | `apps/daemon/src/backend/devin-managed.ts` |
| Gemini | Managed download: ACP registry → npm tarball, checksum vs npm metadata, `~/.cairn/tools/gemini/versions/<v>`. A task before install fails with retry-later. | Registry `latest`. | `GEMINI_CLI_HOME` | `apps/daemon/src/backend/gemini-managed.ts` (commit `520cbd748`) |
| Antigravity | Managed download from the ACP registry, `~/.cairn/tools/antigravity`. | Registry `latest`. | Synthetic `HOME` | `apps/daemon/src/backend/antigravity-managed.ts` |

So Cairn already runs two models side by side (derived): three runtimes are managed downloads on the vendor's schedule; Claude Code, the most used one, is bundled and moves only with a Cairn release. The user's config is imported once (`apps/daemon/src/import-agent-config.ts`: `~/.claude/skills`, `~/.claude.json` `mcpServers`, `~/.codex/config.toml` `[mcp_servers]`, `~/.claude/settings.json` model and env) and never read again.

## 3. Install cost of bundling (from the bundle-slim research, credited above)

- Each Cairn desktop update extracts a 437 MB zip into a 1.2 GB `.app` (~45k files) and pays `ditto`, `codesign --deep` and Gatekeeper verification, 6–17 times a day because every app-touching push releases. ~894 MB of that is the runner dependency tree, including the ~208 MB `claude` binary.
- A signed `.app` is sealed (Apple TN2206), so a newer Claude Code cannot be dropped into the bundle; version-volatile payload has to live outside it, under `~/Library/Application Support` or the app's data dir.
- Every product in that research that ships a heavy versioned runtime keeps it outside the bundle in per-version directories: VS Code server `~/.vscode-server/bin/<commit>/`, Claude Desktop `…/Claude/claude-code/<ver>/`, Zed `…/Zed/node|languages/`, Discord `…/discord/app-<ver>/modules/`.
- Deltas shrink the download, not the extract-and-verify cost; the runtime-download channel removes the payload from the release loop instead.

New this session (observed): the nightly `agent-sdk-bump` exists to keep Claude Code current, and each bump is itself an app-touching push, so the fix for version skew is one of the causes of the release count. Decoupling the CLI from the bundle removes both costs at once (derived).

## 4. Products examined

### 4.1 Claude Desktop (Anthropic), installed on this Mac, read-only

- **Managed download outside the bundle, pinned per Desktop build (observed).** Desktop 6.28899.6 embeds a manifest (`Vs()` in `/Applications/Claude.app/Contents/Resources/app.asar` → `.vite/build/index.chunk-nq69RXOm.js`) naming one Claude Code version (`"version":"2.1.330"`) with per-platform sha256 and size, `baseUrl: https://downloads.claude.ai/claude-code-releases`, and `sdkWrapperVersion: 0.3.330`. The code calls it `buildPinVersion`.
- **Install layout (observed).** `~/Library/Application Support/Claude/claude-code/2.1.328/c141a31688d6/claude.app` — a separately signed bundle, `Identifier=com.anthropic.claude-code`, `TeamIdentifier=Q6L2SF6YDW`, `spctl`: "accepted, source=Notarized Developer ID". A `.verified` file next to it holds the full sha256 (`c141a316…`, the dir name is its prefix). Binary is 354,630,016 bytes; `--version` prints `2.1.328 (Claude Code)`. Total `claude-code/` = 338 MB; a second Linux copy for the Cowork VM sits in `claude-code-vm/` (355 MB).
- **Update flow, from `~/Library/Logs/Claude/main*.log` (observed).** On launch: `[CCD] Initialized with version 2.1.328` → `Downloading bundle from …/2.1.328/darwin-arm64/claude.app.tar.zst` (~121.8 MB) → while downloading, `Falling back to installed version: 2.1.326` so sessions keep working → `Bundle verified (expected size: …)` → `Installed the 2.1.328 bundle into c141a31688d6/` → `Keeping version 2.1.326: in use or downloading this run` → next launch `Removing old version: 2.1.326`. Downloads resume (`resumed from 51154168`) and a `.verified` mismatch triggers a re-download.
- **Lag (observed).** Versions used by Desktop, from the same logs: 2.1.309 (10-31) → 2.1.317 (11-04) → 2.1.321 (11-12) → 2.1.325 (11-14) → 2.1.326 (11-20) → 2.1.328 (11-21). The user's `~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.330` was already newer. The Claude Code version moves only when Desktop itself updates; Desktop updates often (6.28899.6 downloaded 2026-11-22 08:39 and pins 2.1.330), so the lag on this Mac was about a day (derived).
- **Never runs the user's CLI (observed).** Every `Using Claude Code binary at:` log line points into `Application Support/Claude/claude-code/`; none points to `~/.local/bin`. The only override is `CLAUDE_CODE_LOCAL_BINARY`, logged as `LOCAL OVERRIDE: Using local binary at …` — a developer escape hatch, not a setting (derived from the env-allowlist entry and the log string).
- **Shares the user's config (observed).** `aI()` returns `CLAUDE_CONFIG_DIR` or `~/.claude`; an error string tells users "to relocate Claude Code's config directory, symlink ~/.claude itself or set CLAUDE_CONFIG_DIR in Desktop Settings". Skills, commands, agents, hooks under `~/.claude` are the same files the terminal uses. `DISABLE_AUTOUPDATER` is in the env set it passes, so the managed copy does not self-update (derived).
- **SDK/CLI compatibility is published (observed).** `https://downloads.claude.ai/claude-code-releases/2.1.330/manifest.json` carries `sdkCompat.testedWrapperVersions` (… `0.3.327`, `0.3.328`, `0.3.329`) and `harnessSchema: 1`. Channel pointers exist: `…/claude-code-releases/latest` → `2.1.330`, `…/stable` → `2.1.323` (both fetched 2026-11-22).

### 4.2 Multi-agent orchestrators (subagent research, primary sources linked)

- **Conductor** (closed source; docs and changelog, not installed here). Bundled Claude Code and Codex, installed to `~/Library/Application Support/com.conductor.app/bin`; "Do not update or modify them". Almost every release says "Updated the bundled Claude Code to 2.1.321 and Codex to 0.166.0" (0.94.0, 2026-11-09). Settings → Advanced has an executable path with a "Use system Claude Code (from PATH)" button; since 0.97.0 a failure on a custom executable older than the bundled one says so. Login and chat state use the user's `~/.claude` and `~/.codex`. observed docs: <https://www.conductor.build/docs/faq>, <https://www.conductor.build/docs/troubleshooting/issues>, <https://www.conductor.build/changelog.md>.
- **Sculptor** (Imbue). Managed download: fetches `claude-code-releases/<version>/manifest.json`, sha256-checks the binary, installs to `<sculptor>/internal/dependencies/claude/version-X.Y.Z/`, keeps 2. Code-level version range: min = recommended = 2.1.321, max 2.99.99, blocklist 2.1.101; the comment says the floor must "carry every `--model` id the picker offers". Startup runs `--version` on each tool and auto-installs anything out of range; UI shows "Claude Not Available" with "Go to Settings". `dependency_paths.claude` = `MANAGED` (default) / `CUSTOM` / path. Uses the user's `~/.claude`. observed source: <https://github.com/imbue-ai/sculptor/blob/60a91f6245a85942b0f73cf6831ec07fe256e672/sculptor/sculptor/services/managed_tools.py#L316-L405>, <https://github.com/imbue-ai/sculptor/blob/60a91f6245a85942b0f73cf6831ec07fe256e672/sculptor/sculptor/services/dependency_management_service.py#L770-L790>.
- **Vibe Kanban** (BloopAI). Pinned `npx -y @anthropic-ai/claude-code@2.1.119`, `@openai/codex@0.132.0`, `@google/gemini-cli@0.29.3`, `@sourcegraph/amp@latest`; hand-bumped (Claude pin unchanged for 7 months). OpenAI revoked the signing certificate of the pinned 0.124.0/0.130.0, so Gatekeeper rejected them (`CSSMERR_TP_CERT_REVOKED`) until a hand bump (PR #3504). `base_command_override` per profile. Shares `~/.claude.json`, `~/.codex`. observed: <https://github.com/BloopAI/vibe-kanban/blob/3f095f0186f6e68d67143d38b02da2238f6524d8/crates/executors/src/executors/claude.rs#L61-L66>, <https://github.com/BloopAI/vibe-kanban/pull/3504>.
- **Crystal** (stravu, deprecated for Nimbalyst). User's CLI: `claudeExecutablePath` or `findExecutableInPath('claude')` via login-shell PATH; `--version` for detection only; "Claude Code is not installed or not found in your PATH". observed: <https://github.com/stravu/crystal/blob/1e18e0bc981225f75b5226f82a300fa741970c6f/main/src/services/panels/claude/claudeCodeManager.ts#L156-L164>.
- **Nimbalyst** (Crystal's successor). "Leave Custom Claude Installation empty to use Nimbalyst's bundled runtime … You do not need to install a separate CLI" (observed <https://nimbalyst.com/docs/detailed-install-guides/mac-detailed-install-guide/>); issues report a bundled 2.1.257 older than the system's 2.1.267 (guessed, search summary only: <https://github.com/nimbalyst/nimbalyst/issues/1489>).
- **Superset → Paradev.** User's CLI behind a PATH wrapper (`claude --dangerously-skip-permissions`); "claude not found in PATH … exit 127"; extra accounts are separate `CLAUDE_CONFIG_DIR`/`CODEX_HOME` profiles. observed: <https://github.com/ParadevAI/Paradev/blob/9d7adc6214326ab4ab861dd83f228a545e321339/packages/agent-setup/src/agent-wrappers-common.ts#L137-L310>.
- **Claude Squad.** User's CLI via `which claude` in the user's shell, saved to config. observed: <https://github.com/smtg-ai/claude-squad/blob/070eb9387cda2be2e64aa1a32ee81be160c457a1/config/config.go#L107-L150>.

### 4.3 IDE integrations (subagent research, primary sources linked)

- **VS Code Claude Code extension** (`anthropic.claude-code`). Bundled per-platform binary: `~/.vscode/extensions/anthropic.claude-code-2.1.295-darwin-arm64/resources/native-binary/claude`, 240 MB, `--version` 2.1.295, while the user's `~/.local/bin/claude` is 2.1.330 (observed on this Mac). The chat panel always runs the bundled copy; the docs say "The extension's version number is the Claude Code version it bundles" (observed <https://code.claude.com/docs/en/vs-code>). Override `claudeCode.claudeProcessWrapper` wraps the bundled path; a too-old wrapped CLI gets a named error ("the Claude Code run by the claudeCode.claudeProcessWrapper setting is too old"). `useTerminal` mode runs the user's `claude` from PATH. Shares `~/.claude` settings, plugins, MCP and history; honours `CLAUDE_CONFIG_DIR` (observed docs); login shared via the config-dir-keyed Keychain entry (derived).
- **JetBrains Claude Code plugin.** User's CLI: "runs the `claude` command in your IDE's integrated terminal… It does not bundle its own copy of the CLI"; "Claude command" setting for a path or `npx`; "Cannot launch Claude Code" when missing (observed <https://code.claude.com/docs/en/jetbrains>).
- **Zed** (Claude Agent, Codex over ACP). Managed download: installs agents from the ACP registry `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` (refreshed at most hourly) into Zed's data dir, signals `new_version_available` on a registry bump, holds a lease so a running version is not deleted (observed source `crates/project/src/agent_server_store.rs`, `agent_registry_store.rs`, <https://github.com/zed-industries/zed>). The `claude-agent-acp` release archive carries its own `claude`; "To use a Claude CLI you already have instead, set `CLAUDE_CODE_EXECUTABLE`" (observed adapter README and `src/claude-cli.ts`). `codex-acp` depends on `@openai/codex` with a `CODEX_PATH` override (observed). Auth and config come from the default `~/.claude` / `~/.codex` (derived).
- **Cursor agent CLI.** Self-managed: `~/.local/bin/{agent,cursor-agent}` → `~/.local/share/cursor-agent/versions/2026.10.22-27dcf5f/`, two versions on disk, each with its own `node` and `rg` (observed on this Mac); "Cursor CLI will try to auto-update by default" (observed <https://cursor.com/docs/cli/installation>); updates download a tarball into `versions/` and flip the symlink, keeping a running version (observed launcher code).
- **OpenAI Codex extension and desktop app.** Bundled: the `openai.chatgpt` .vsix carries `extension/bin/<platform>/codex` (observed for one platform, derived for the rest); `chatgpt.cliExecutable` is "DEVELOPMENT ONLY" (observed package.json). The Codex desktop app, now inside `/Applications/ChatGPT.app` (`com.openai.codex`), ships `Contents/Resources/codex-cli/` at `0.169.0-alpha.11.1` while the user's `~/.local/bin/codex` is 0.166.0, updates via Sparkle with the app, and honours an absolute `CODEX_CLI_PATH` env override (observed on this Mac). Config and MCP shared through `~/.codex/config.toml` (observed <https://learn.chatgpt.com/docs/developer-settings.md?surface=ide>).
- **Warp.** User's CLI: detects Claude Code, Codex and Gemini the user runs in a pane and adds a toolbar; installs nothing (observed <https://docs.warp.dev/agents/cli-agents/overview/>, derived for "installs nothing"). Raycast not examined.

Pattern (derived): every host whose own UI drives the CLI pins a copy it controls (bundled or managed); hosts that only open a terminal use the user's CLI. Every one of them, managed or not, shares the user's `~/.claude` / `~/.codex` for login and config.

## 5. Comparison

Columns: version skew with new models / login sharing / config, MCP, skills sharing / reproducibility and support / security of what runs / auto-update / disk and install cost / failure UX.

| Product (option) | Skew | Login | Config/MCP/skills | Repro & support | Security | Auto-update | Disk/install | Failure UX |
|---|---|---|---|---|---|---|---|---|
| **Cairn today** (bundled Claude; managed Devin/Gemini/Antigravity) | Claude lags until the next Cairn release; caused the 2026-11-21 outage | Separate Cairn sign-in | One-time import, then diverges | Version known per Cairn build | Only Cairn-signed or checksum-verified binaries | Claude: nightly SDK bump → full app release; others: vendor channel | 208 MB claude re-extracted and re-verified on every one of 6–17 releases/day | "Claude Code 2.1.278 does not support this model" |
| Claude Desktop (managed, pinned per app build) | ~1 day lag, app updates often | Its own sign-in | Shares `~/.claude` | Exact version + sha256 per build | Notarized, separately signed `claude.app`, sha256 marker | With the app, but the payload downloads outside it, resumable, fallback to last good | ~120 MB download per version, old versions pruned | Falls back to installed version while downloading |
| Sculptor (managed, version range) | Floor raised in code per model | User's `~/.claude` | User's `~/.claude` | Range + blocklist | sha256 vs vendor manifest | Background install when out of range | One copy per version, keep 2 | "Claude Not Available" → Settings |
| Conductor (bundled, override) | Lags to app release | User's `~/.claude`/`~/.codex` | Shared | Bundled version known | Bundled | With the app | In the app | Post-failure hint "older than bundled" |
| Vibe Kanban (pinned npx) | Months-stale pin | Shared | Shared | Exact pin | npm package; revoked-cert pin broke macOS | Hand bump | npx cache | Raw error |
| Crystal / Paradev / Claude Squad (user's CLI) | None if user updates; broken if user's CLI is old | Shared | Shared | Unknown version per user | Runs whatever `claude` is first on PATH | User's own | Zero | "not found in PATH" |
| VS Code Claude ext (bundled) | Lags to extension release (2.1.295 vs user 2.1.330 here) | Shared | Shared `~/.claude` | Version = extension version | Anthropic-signed in the .vsix | Marketplace | 240 MB per extension version | Named "too old" error for the wrapper |
| JetBrains plugin (user's CLI) | Follows the user | Shared | Shared | Per user | User's binary | User's | Zero | "Cannot launch Claude Code" |
| Zed via ACP (managed registry download) | Registry bump, hourly check | Shared (derived) | Shared (derived) | Registry-pinned | Registry sha256 | Own schedule, reconnects | Per-version dir in Zed data | "native binary not found… set CLAUDE_CODE_EXECUTABLE" |
| Cursor agent (self-managed) | Self-updates | Own | Own | Per version dir | Vendor tarball | Own schedule | Per-version dir, 2 kept | — |
| Codex app/ext (bundled) | Lags to app release | Shared `~/.codex` | Shared | Version = app version | Signed in app | Sparkle / marketplace | In the app | — |

## 6. Scenarios, per option

Options: **A** user's installed CLI · **B** bundled in the app (Cairn today) · **C** managed download outside the bundle on its own schedule · **D** hybrid (user's CLI if new enough, else managed) · **R** the recommendation (C, plus an explicit "use my installed CLI" choice the user turns on).

| Situation | A | B (today) | C | D | R: what the user sees, what Cairn does, wait and cost |
|---|---|---|---|---|---|
| User's CLI auto-updates to 2.1.330 | Cairn uses it at once | Cairn stays on its own copy; terminal and Cairn now differ | Cairn's copy follows `latest` within one poll (hours) | Cairn switches to the user's copy | Nothing visible; Cairn's copy moves to 2.1.330 on the next poll, ~120 MB background download |
| A new model ships needing ≥ 2.1.280 | Works only if the user updated | Fails until a Cairn release ships | Works once Cairn's floor for that model is met; floor check downloads first | Works if either copy is new enough | The model picker asks for ≥ 2.1.280; if the installed copy is older, Cairn downloads `latest` before the task starts, task waits once for the download (Desktop logged 121.8 MB in 26 s on this Mac, 06:25:18→06:25:44 on 2026-11-21, observed); never the "does not support this model" error |
| User is not logged in | CLI prompts for login | Cairn asks for its own sign-in even if the terminal is signed in | Same as B if the home stays separate | Inconsistent: depends which copy runs | Unchanged by this choice; login sharing is a separate decision (section 7.3) |
| User has no CLI installed | Cairn cannot run Claude at all | Works | Works after first download | Works after first download | First Claude task downloads ~120 MB, "Preparing Claude Code…" for the download time; no install step for the user |
| Offline machine | Works if installed | Works | First run fails; later runs use the last good copy | Last good copy | First run without network: "Claude Code downloads on first use; connect to the internet" with retry; afterwards the last verified copy keeps working offline |
| Broken user install (bad PATH, half-upgraded, revoked cert) | Cairn breaks with the user's CLI | Unaffected | Unaffected | Must detect and fall back; error-prone | Unaffected by default; if the user chose "use my installed CLI" and it fails `--version` or the floor, Cairn says so and offers "switch back to Cairn's copy" |
| Vendor revokes or pulls a version | User's problem | Cairn ships a release | Next poll moves off it; blocklist in the manifest | Same as C | Cairn skips blocklisted versions and re-resolves `latest`; worst case falls back to the previous verified copy |

## 7. Recommendation

### 7.1 For every Cairn user: managed download, on the vendor's schedule (option C)

Move Claude Code to the shape Cairn already uses for Devin, Gemini and Antigravity, and that Anthropic ships in its own desktop app: a verified, per-version copy under `~/.cairn/tools/claude/versions/<v>/`, outside the signed bundle, resolved from the vendor's `latest` channel, not from Cairn's release. Concretely:

1. Resolve the target from `https://downloads.claude.ai/claude-code-releases/latest`, fetch `<v>/manifest.json`, accept it only if `sdkCompat.testedWrapperVersions` contains (or is within one minor of) the bundled `@anthropic-ai/claude-agent-sdk` version; otherwise stay on the newest compatible version.
2. Download `<platform>/claude` (or the signed `claude.app.tar.zst` bundle Desktop uses), check the manifest sha256 and `codesign`/notarization, write a `.verified` marker, flip `current.json`, keep the previous version until no session uses it (Desktop's "Keeping version … in use").
3. Per-model floor: each model Cairn offers names its minimum Claude Code version (Sculptor's range, in code); a task on a model whose floor the current copy misses waits for the download instead of failing.
4. Bundle nothing: the runner stops carrying the 208 MB platform binary, removing it from every one of the 6–17 daily extract-and-verify cycles (bundle-slim research), and the nightly SDK bump no longer has to cut an app release to fix skew.

Why C over the others for every user (derived from sections 4–6): it is the only option that is current without the user doing anything (unlike A and B), works for users with no CLI (unlike A), never runs an unknown binary by default (unlike A and D), and has one code path Cairn can support (unlike D). No product examined ships automatic D; every one picks a single source and lets an explicit setting override it.

### 7.2 Add one explicit choice: "use my installed Claude Code"

Almost every product examined lets the user point at their own binary (Conductor's "Use system Claude Code (from PATH)" button, Sculptor's `dependency_paths`, Vibe Kanban's `base_command_override`, the VS Code extension's `claudeProcessWrapper`, Zed's `CLAUDE_CODE_EXECUTABLE`, JetBrains' "Claude command"); only Claude Desktop and the Codex app limit it to a developer env var. Users who pin their own version, run a fork, or sit behind a proxy that blocks the CDN need it. It is opt-in, resolved once to an absolute path when the user turns it on, checked with `--version` against the same per-model floor before each task, and shown in Settings with the detected version. Cairn never scans PATH on its own.

### 7.3 Out of scope, flagged

Login and config sharing is a separate axis from binary sourcing. Every product examined except Cairn shares the user's `~/.claude`/`~/.codex` (Claude Desktop, Sculptor, Conductor, Vibe Kanban, Crystal, Paradev); Cairn's separate `~/.cairn/homes/claude` is why a newcomer signs in twice. The runtime-homes research gives the reasons Cairn isolated it (confinement, transcripts, per-dir Keychain entries). Worth its own design; not decided here.

### 7.4 This conflicts with "own runtime only"; recommend changing the rule

The current rule (decided 2026-11-20, commits `1e248e2e7`, `520cbd748`): Cairn runs only its bundled or managed binaries and never runs the user's installed CLI. 7.1 keeps the spirit (Cairn-managed by default, no PATH scan) and changes the Claude source from bundled to managed. 7.2 breaks the letter. Proposed rule: "Cairn runs its own managed runtime by default, kept current on the vendor's channel; the user's installed CLI runs only when the user picks it in Settings; Cairn never scans PATH."

Code and gates that would change (`git grep` at `846ebfc4b`):

| Path | Change |
|---|---|
| `apps/daemon/src/claude-code-bin.ts` (`bundledClaudeCodePath`, `probeClaudeBin`, `source: 'override' \| 'bundled'`) | Resolve from a new `claude-managed.ts` install; `source` becomes `'managed' \| 'user' \| 'override'` |
| new `apps/daemon/src/backend/claude-managed.ts` | Same shape as `devin-managed.ts` / `gemini-managed.ts`: manifest, sha256, lock, `.install-complete`, `current.json`, plus `sdkCompat` and codesign checks |
| `apps/daemon/src/claude-code-auth.ts`, `claude-code-models.ts`, `cli.ts:356`, `machine-loop.ts` | Call the managed resolver instead of `bundledClaudeCodePath()`; a task waits on `ensure()` when below the model floor |
| `apps/daemon/src/backend/claude-code.ts` | `pathToClaudeCodeExecutable` always set from the resolver |
| `apps/desktop/scripts/check-runner-claude.mjs`, `stage-runner.mjs`, `.github/workflows/desktop-release.yml:133` ("Runner resolves the Claude Code binary for its arch") | Retire the bundled-binary gate; replace with a release check that the managed resolver can fetch and verify the pinned-compatible version |
| `apps/desktop/electron-builder.yml` (`extraResources: runner`), `after-pack.cjs` | Exclude `@anthropic-ai/claude-agent-sdk-*` platform packages from the runner payload |
| `.github/workflows/agent-sdk-bump.yml`, `scripts/ops/bump-agent-sdk.mjs` | Still bumps the JS SDK; no longer the only way to get a newer CLI |
| `apps/daemon/src/backend/confine-seatbelt.ts`, `confine-session.ts` | Allow exec of `~/.cairn/tools/claude/versions/*` like the other managed tools; the user-chosen path, when enabled, gets the same treatment as `CAIRN_CLAUDE_BIN` |
| `apps/daemon/test/claude-code-bin.test.ts` and the desktop update tests | Rewrite for the managed and user sources |
| Owner memory `own-runtime-only` (personal config, not the repo) | Reword to the proposed rule |

`machineAndCommandBoundary` in `packages/shared/merge-gate-paths.json` covers `apps/daemon/src/backend/command-gate.ts` and `host-shell-confinement.ts`; if the exec allowance lands there, the change needs `/security-review`.
