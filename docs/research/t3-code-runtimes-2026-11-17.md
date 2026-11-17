# How T3 Code integrates several agent runtimes (2026-11-17)

Question from ian: how does "T3" (T3 Code) support Claude Code, Codex, Gemini, Cursor, OpenCode and the rest, and what does Cairn's daemon (`apps/daemon/src/backend/`) take from it? This note answers five sub-questions and ends with a recommendation. It does not repeat [1607-acp-execution-surface.md](1607-acp-execution-surface.md); section 6 says where T3 Code confirms or contradicts it.

Tag convention: **实测** = read first-hand in the source at the named commit, or read the vendor's own page; **推断** = derived from 实测, recheckable; **猜测** = the rest.

Sources and pins:

- T3 Code: `github.com/pingdotgg/t3code`, `main` at `2904c397ad4e247eb5b77857ab629e5d4fd19426` (committed 2026-11-16, "fork a running Claude thread natively"). Cloned shallow into a temp directory and read there. Links below use that SHA. (实测)
- Cairn: this worktree at `d1d3f27c40dd549aa2591be1f36e3262bcad3efa`.
- Zed: `zed-industries/zed` `main` read through the GitHub contents API at `482e76524bd33d8cbdfc352f1fef3eefbf2fad92`.
- Vibe Kanban: `BloopAI/vibe-kanban` `main` at `3f095f0186f6e68d67143d38b02da2238f6524d8`.

## 0. Conclusions

1. **The "T3" is T3 Code.** Repo `pingdotgg/t3code` is described as "The best way to control Claude Code, Codex and more from any computer or phone"; its own `AGENTS.md` lists the providers: Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity, Kiro, Pi, Muse Code, fx ([AGENTS.md](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/AGENTS.md)). The `.mount_T3 Cod` string in Cairn is a `mountinfo` line of `T3-Code.AppImage` in `apps/daemon/test/confinement-availability.test.ts:161`. (实测)
2. **Yes, every runtime is a local child process of the T3 server, and the protocol differs per runtime.** Claude: the Claude Agent SDK (which launches the `claude` binary). Codex: `codex app-server` JSON-RPC over stdio. Cursor: `@cursor/sdk`. OpenCode: `opencode serve` on 127.0.0.1 plus its HTTP SDK. Pi: `pi` in RPC mode over line-delimited JSON. Grok, Kiro, Antigravity, fx and every "ACP Registry" agent: ACP over stdio through one shared adapter. Muse: `@muse-code/sdk`. (实测, section 1)
3. **There is exactly one internal interface: `ProviderAdapterV2`** (package `provider-core`). Each adapter turns its native protocol into one event union (`ProviderAdapterV2Event`), which an orchestrator persists as an event-sourced graph and streams to web, desktop and mobile over an Effect RPC WebSocket. Differences are declared in a 12-group capability struct, not hidden. (实测, section 2)
4. **Auth is "use the CLI's own login" by default**, with two exceptions that store a credential: a managed "Connect with ChatGPT" for Codex (token broker, T3-owned secret store) and Cursor/Antigravity helpers. Each instance gets its own home or profile so two accounts never share state. (实测, section 3)
5. **ACP is the generic path.** An unknown agent starts as an ACP Registry entry with no per-agent code; a dedicated driver is only a thin "flavor" over the shared ACP adapter (Grok, Kiro, Antigravity, fx). Non-ACP protocols get a native adapter. This is written as policy in `docs/internals/adding-a-provider.md`. (实测, section 4)
6. **T3 Code confirms the 1607 conclusions** (Claude and Codex are best served by native bridges, not ACP adapters; ACP is the right generic surface for external CLIs; ACP cannot carry steering, usage or rollback) and **contradicts two assumptions**: it runs the ACP registry inside the product (agents installed into the app's own home, not only a hand-picked list), and it solves what ACP lacks by capability flags plus app-owned fallbacks (steer by interrupt and restart, rollback by fresh session plus context handoff) rather than by failing closed. (实测 + 推断, section 6)

## 1. How each runtime is launched (question 1)

The server wraps provider CLIs per instance; every driver exports a `ProviderDriver` (config schema, `create`, usage reader) and is listed in [`builtInDrivers.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/apps/server/src/provider/builtInDrivers.ts): Codex, Claude, Cursor, Grok, Fx, OpenCode, Antigravity, Kiro, Pi, Muse, AcpRegistry. (实测)

| Runtime | Protocol and process | Evidence |
|---|---|---|
| Claude Code | `@anthropic-ai/claude-agent-sdk` `query()` with `includePartialMessages`, `resume: nativeThreadId`, `pathToClaudeCodeExecutable` pointing at the user's `claude`; the SDK owns the child process | [`ClaudeAdapterV2.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts) lines 2226-2326; dependency `^0.3.321` in `apps/server/package.json` |
| Codex | `codex app-server` child process, JSON-RPC over stdio, typed client in `packages/effect-codex-app-server`; calls `thread/resume`, `turn/steer`, `turn/interrupt`, `thread/fork`, `thread/compact/start` | [`codexLaunchArgs.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/apps/server/src/provider/codexLaunchArgs.ts), `CodexAdapterV2.ts` lines 3507, 8108, 8824 |
| Cursor | `@cursor/sdk` (local agent) | [`CursorAgentSdk.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/packages/provider-cursor/src/server/CursorAgentSdk.ts) |
| OpenCode | spawns `opencode serve --hostname --port`, then `@opencode-ai/sdk` HTTP client; 1.x one server per thread, 2.x one server per instance | [`OpenCodeRuntime.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/packages/provider-opencode/src/server/OpenCodeRuntime.ts) line 608; [`docs/internals/providers.md`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/docs/internals/providers.md) |
| Pi | user's own `pi` in RPC mode, LF-delimited JSON frames over stdio | [`rpc.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/packages/provider-pi/src/server/rpc.ts) |
| Muse Code | `@muse-code/sdk` | [`sdk.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/packages/provider-muse/src/server/sdk.ts) |
| Grok, Kiro, fx, Antigravity | ACP over stdio through the shared adapter, plus a small vendor "flavor" | `packages/provider-grok`, `provider-kiro`, `provider-fx`, `apps/server/src/provider/acp/Antigravity*.ts` |
| Any ACP agent (Gemini CLI, Copilot, OpenCode-as-ACP, Cline, ...) | `AcpRegistryDriver`: fetch `cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, resolve a `binary`, `npx` or `uvx` distribution (exact versions only, SHA-256 verified when present), install under `tools/<agent-id>/<version>/` in T3 home, spawn, speak ACP | [`AcpRegistrySupport.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/packages/provider-acp-registry/src/server/AcpRegistrySupport.ts) lines 51, 429-460; [`docs/user/providers-acp.md`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/docs/user/providers-acp.md) |

Notes (实测):

- Gemini has no dedicated driver; it is reachable only as an ACP Registry or "Local ACP command" entry. Claude and Codex are not in the ACP Registry list on purpose: `providers-acp.md` says agents with their own providers "don't appear in the Registry list".
- ACP client implementation: own package `packages/effect-acp` (generated schema, agent and client), session runtime `packages/provider-acp/src/server/AcpSessionRuntime.ts` (3025 lines) and adapter `adapter.ts` (10002 lines). It prefers ACP v2 preview and falls back to v1 (`providers-acp.md`).
- The same Claude path also exists in ACP form: `packages/provider-acp-registry/src/server/claudeAcp.ts` handles `claude-agent-acp` as a registry entry, but the built-in Claude driver does not use it (推断 from driver list and the doc sentence above).

## 2. One internal interface and how events reach the UI (question 2)

**Interface.** [`ProviderAdapterV2`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/packages/provider-core/src/server/ProviderAdapter.ts) is an Effect service with `getCapabilities`, `planSelectionTransition` and `openSession`. `openSession` returns a `ProviderAdapterV2SessionRuntime` with: `events` (a `Stream`), `ensureThread`, `resumeThread`, `startTurn`, `steerTurn`, `interruptTurn`, `respondToRuntimeRequest`, `readThreadSnapshot`, `rollbackThread`, `forkThread`, and optional `compactThread`, `injectHistory`, `stopTask`, `stopSubagent`, `mcpApps`. (实测)

**Events.** One union, `ProviderAdapterV2Event`, whose members are entity upserts rather than text deltas: `provider_session.updated`, `provider_thread.updated`, `provider_turn.updated`, `node.updated`, `subagent.updated`, `message.updated`, `turn_item.updated`, `steer.updated`, `background_work.updated`, `command_output.delta` (unpersisted), `prompt_suggestion.updated`, `runtime_request.updated` (approvals and questions), `plan.updated`, and two `turn.terminal` shapes (completed/interrupted/cancelled with no failure; failed with a typed failure and optional retry). (实测)

**Rules that make it work** ([`docs/orchestration-v2/README.md`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/docs/orchestration-v2/README.md)), 实测:

- App ids are primary, provider ids are refs; adapters with weak ids get deterministic app-owned ids.
- "Provider events are never rewritten to look like another provider event"; raw provider frames go to a rotating diagnostic log (`nativeProtocolLogging.ts`, `EventNdjsonLogger.ts`).
- Layers: native protocol, diagnostics, adapter, event store, execution graph (AppThread, Run, ExecutionNode for tools, approvals, subagents), conversation projection, UI.
- "Capability-driven, not provider-name-driven": orchestration and clients "read capabilities, never the driver kind" (`adding-a-provider.md`).

**Transport to clients.** Effect RPC over a single WebSocket: `ServerWsRpcGroup` in [`ws.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/apps/server/src/ws.ts), with streaming subscriptions `subscribeOrchestrationV2Shell` and `subscribeOrchestrationV2Thread` (lines 906 and 1139). Web, Electron desktop and React Native mobile share a connection supervisor with jittered backoff and a liveness probe (`docs/internals/connection-runtime.md`). No SSE. (实测)

**Capability struct** (`OrchestrationV2ProviderCapabilities`, [`orchestrationV2.ts`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/packages/contracts/src/orchestrationV2.ts) line 400): `sessions`, `threads`, `turns` (`supportsInterrupt`, `supportsActiveSteering`, `supportsSteeringByInterruptRestart`, `supportsQueuedMessages`, `terminalStatusQuality: strong|weak|none`), `streaming`, `tools`, `approvals`, `planning`, `subagents`, `context` (accepts system or developer context, handoff support), `checkpointing`, `identity` (strength of native ids), `runtimePolicy.enforcement: native|client-boundary`. Adapters must "set every flag to what the provider really does"; "a capability left on that fails at runtime is a bug". (实测)

## 3. Auth, permissions, resume, steering, usage, gaps (question 3)

| Aspect | What T3 Code does | Evidence |
|---|---|---|
| Auth, default | Uses the CLI's own login on the server machine: `claude auth login`, `codex login`, `agent login`, `opencode auth login`, `grok login`, `kiro-cli login`, `pi` then `/login`, `muse login`, `fx login`. FAQ: "Log in on that machine first". Status probes read the Claude account through the SDK init (`email`, `subscriptionType`, `tokenSource`) | [`docs/user/install.md`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/docs/user/install.md) lines 194-209; `ClaudeProvider.ts` 585-599 (实测) |
| Auth, stored credentials | Codex "Connect with ChatGPT": T3 installs Codex, signs in on OpenAI, keeps tokens in its own secret store (`ProviderCredentialStore.ts`, `ServerSecretStore`) and feeds Codex through a local Unix-socket token broker with `model_provider="openai_token_sharing"`. Antigravity: per-instance profile with file-based credentials | `CodexManagedTokenBroker.ts`, `CodexManagedRuntime.ts`, `providers-codex.md`, `docs/internals/providers.md` (实测) |
| Auth, ACP agents | Generic sign-in UI driven by the agent's advertised `authMethods` (browser URL or in-app terminal); credentials stay in the agent's own store; "ACP does not describe account isolation" | `providers-acp.md`; `provider-acp-registry/src/server/auth.ts` (实测) |
| Account isolation | Session state, catalogs and credentials belong to an *instance*; ambient credentials the instance did not configure are removed so two instances cannot share an account | `adding-a-provider.md` "Instances" (实测) |
| Subscriptions and ToS | FAQ states use "within the TOS of Claude Code, Codex, and Google Antigravity" and that Claude through the Agent SDK drains the 5-hour limit at the same rate as Claude Code since v0.1.7 (after an earlier 1.7x charge). No auto-switching across accounts, by policy | `docs/user/faq.md` (实测 of the text; the rate claim itself 猜测, not measured) |
| Permission modes | Four user modes: Supervised, Auto-accept edits, Auto, Full access. Each adapter maps them to its native policy: Claude to `permissionMode` (`default`, `acceptEdits`, `auto`, `bypassPermissions`, `plan`, `dontAsk`), Codex to `approvalPolicy` plus `sandboxPolicy`. Capability `runtimePolicy.enforcement` is `native` for Claude and Codex and `client-boundary` for ACP | `ClaudeAdapterV2.ts` 3282-3330; `CodexAdapterV2.ts` 738-824; ACP adapter line 817 (实测) |
| Permission gaps | Rule: offer only modes the provider enforces natively; "do not imitate a missing mode by answering approvals in T3". Kiro and Muse offer only Supervised and Full access; fx none of the two middle ones; Grok no auto-accept-edits. An unoffered stored mode runs as Supervised. ACP registry agents run in their own default mode and T3 only answers their `request_permission` by thread mode (reads never wait); T3 does not run or stop their terminals, except Devin | `docs/user/permission-modes.md`; `providers-acp.md` (实测) |
| Sandbox | The agent's own sandbox, not T3's. T3 adds only a path-containment policy for ACP client calls (`clientPolicy.ts`, realpath-based) and an administrator ceiling (`maxRuntimeMode`) | `clientPolicy.ts`; `ProviderAdapterV2RuntimePolicy` (实测) |
| Resume | Claude: SDK `resume`. Codex: `thread/resume`. ACP: `session/load` if advertised, else `session/resume`, else error "does not advertise session/load or session/resume support"; replay quiet-gap timeout because some agents never reply to `load`. App thread keeps its own cursor, so a thread can outlive a process or switch provider via explicit context handoff | `AcpSessionRuntime.ts` 2252-2280; `ProviderSwitchService.ts`, `ContextHandoffService.ts` (实测) |
| Steering | Claude and Codex: `supportsActiveSteering: true` (Codex native `turn/steer`). ACP adapter: `supportsActiveSteering: false`, `supportsSteeringByInterruptRestart: true`, meaning T3 interrupts the turn and starts a replacement attempt. Claude steering aborts the current segment, and the usage code sums earlier segments | capability literals in the three adapters; `ClaudeTurnTokenUsage.ts` (实测) |
| Interrupt | Claude `query.interrupt()`; Codex `turn/interrupt`; ACP `session/cancel`, with a documented trap: a cancel sent before the turn registered can be ignored, so some adapters hold the cancel until the prompt starts. `ProviderAdapterInterruptTimeoutError` surfaces "provider did not confirm a stop" | `AcpSessionRuntime.ts` 2417-2460; `adding-a-provider.md` traps (实测) |
| Usage and cost | Two separate paths. Per turn: Claude from SDK result usage, ACP from `usage_update` (context window and cumulative cost metadata when the agent reports them), Muse its own usage object. Account level: usage readers parse the CLI's own transcripts (Claude `~/.claude/projects` JSONL, Codex logs) and rate-limit endpoints (Claude SDK `get_usage`). Quota errors are classified `usage_limit` with a reset time so a thread shows Limited | `provider-core/src/server/usage.ts`, `Drivers/claudeUsage.ts` 147, `claudeUsageLimits.ts`, `providers-acp.md` "Native sessions" (实测) |
| What is given up | Declared, not hidden. ACP: no native rewind (`providerCanRollbackConversation: false`), so rollback restores files and the next turn starts a fresh agent session fed the kept conversation; no portable subagent lineage ("richer delegation views remain agent-specific"); text generation (titles, commit messages) never runs on registry instances; Claude permission mode can still ask in Full access when the user's settings forbid bypass | `providers-acp.md` "Checkpoints"; `permission-modes.md` (实测) |
| Parity tests | Each adapter is proven by replay fixtures recorded from the real binary (`record-*-replay-fixture.ts`) run through the real orchestrator; shared scenarios `simple`, `multi_turn`, `queued_turn`, `turn_interrupt`, `message_steering`, `provider_thread_resume`, `tool_call_*`. Hand-written frames are called "a guess about the protocol" | `adding-a-provider.md` "Tests" (实测) |

## 4. How T3 Code decides what to support and how it adds one (question 4)

- **Rule** ([`docs/internals/adding-a-provider.md`](https://github.com/pingdotgg/t3code/blob/2904c397ad4e247eb5b77857ab629e5d4fd19426/docs/internals/adding-a-provider.md), 实测): ACP agents start as registry entries "with no per-agent handling"; an agent gets a dedicated driver only "when it needs behavior the spec does not cover", and then it is a small flavor over the shared ACP adapter. "Never add agent-id checks to the generic registry adapter." Other protocols get a native `ProviderAdapterV2`.
- **Ceremony for a native driver** (实测): a `packages/provider-<name>` package (`./settings`, `./client`, `./server`, `./testing`), a `builtInDrivers.ts` entry, a status-order entry, a compatibility row in `model-manifest.json`, client registration, a user guide, an install-table row, a permission-modes note. New providers are off by default.
- **Why those runtimes** (猜测, no first-hand statement): the FAQ says T3 "worked directly with" SpaceXAI on Grok Build and Cursor, and "Everything else uses official ACP bindings"; selection looks driven by demand and lab relationships. The code shows the engineering criterion (实测): richer protocol, native adapter; thin protocol, ACP.
- **Generic ACP is used in six places** (实测): Registry driver, Local ACP command (e.g. `dsh --profile acp`), Grok, Kiro, fx, Antigravity. Pi and OpenCode have an ACP entry in the registry too, yet get native adapters because their native protocols are richer.
- **Size of the bet** (实测): the shared ACP adapter is 10002 lines and the runtime 3025, which is the cost of making ACP agents behave honestly (config options appearing late, a "default" model sentinel, stop-before-start, background work after turn end).

## 5. Comparison

### 5.1 Table: T3 Code against Cairn

| Dimension | T3 Code | Cairn today | Link |
|---|---|---|---|
| Process model | Server and agent CLIs on the same machine; a client may connect to several full servers, a thread is pinned to one machine | Central server plus daemons that claim steps and spawn the runtime on the machine | `docs/research/t3code-devices-and-scope-2026-11-06.md`; section 1 |
| Claude Code | Agent SDK (spawns user's `claude`) | Agent SDK in `claude-code.ts` | `ClaudeAdapterV2.ts`; `apps/daemon/src/backend/claude-code.ts` |
| Codex | Native `codex app-server` JSON-RPC (not an ACP adapter) | `codex-acp` adapter through `acp.ts` (`adapter` option, steering false) | `CodexAdapterV2.ts`; `apps/daemon/src/backend/acp.ts:340-341` |
| Gemini | Only via generic ACP entry, no dedicated driver | Dedicated identity `gemini` over `acp.ts`, `gemini` already in `BACKEND_RUNTIME_IDS` | `packages/shared/src/agent-backend.ts:208` |
| Pi | Spawns the user's `pi` in RPC mode | In-repo library, now also a confined `pi-host` child on macOS | `rpc.ts`; `pi-host.ts` |
| Internal interface | `ProviderAdapterV2` plus 12-group capability struct, about 15 entity-upsert events | `AgentBackend` plus 5-field capabilities, 15-kind `StepEvent` stream | `ProviderAdapter.ts`; `agent-backend.ts:141-188` |
| Event persistence | Event-sourced graph (thread, run, node), projections, replay | Step events uploaded to the server, transcript rows and trajectory pack | `docs/orchestration-v2/README.md` |
| To the UI | One Effect RPC WebSocket, shell and thread subscriptions | HTTP upload from daemon, server to web | `ws.ts:906,1139` |
| Auth | CLI's own login, plus managed Codex ChatGPT token broker | CLI's own login; daemon never stores tokens (spec 17 A4) | `install.md`; 1607 section 4 |
| Permissions | 4 user modes mapped natively; offer only what the agent enforces | `command-gate` on Pi, `bypassPermissions` on Claude, ACP permission answered per gate | `permission-modes.md`; `command-gate.ts` |
| Steering | Capability flags: native, or interrupt and restart | `steer` on seam; ACP queues for next turn (spec 17 A8) | `ProviderAdapter.ts` turns block |
| Rollback and fork | Capability-gated; ACP falls back to fresh session plus context handoff | Not part of the seam | `providers-acp.md` "Checkpoints" |
| Usage and cost | Per-turn from native events; account usage from the CLI's own transcripts and limit endpoints | `ModelUsage` rows (4 tokens, 5-item cost) on `done`; empty array when ACP gives none | `usage.ts`; `agent-backend.ts:56-63` |
| New runtime | ACP registry entry (zero code) or a package with a native adapter plus replay fixtures | One `AcpIdentity` row (1607 section 4), or a new bridge file | `adding-a-provider.md` |

### 5.2 Table: two other multi-runtime products (first-hand source only)

| Product | How it supports several runtimes | Trade-off | Source |
|---|---|---|---|
| Zed (External Agents) | One `AgentServer` trait in `crates/agent_servers`; every external agent (Claude, Codex, Gemini, Cursor, Copilot, OpenCode, Pi) is an ACP connection, with custom agents as `CustomAgentServer`; installs come from the ACP Registry. Claude and Codex ids are `claude-acp` and `codex-acp` (adapters). Auth and billing stay with each agent; an API key set for Zed's own agent does not carry over. Docs: "Use Terminal Threads instead when you want to run a CLI or TUI directly" | Uniform, one protocol; only what ACP carries is available, no per-runtime rich features | [`agent_servers.rs`](https://github.com/zed-industries/zed/blob/482e76524bd33d8cbdfc352f1fef3eefbf2fad92/crates/agent_servers/src/agent_servers.rs), [`custom.rs`](https://github.com/zed-industries/zed/blob/482e76524bd33d8cbdfc352f1fef3eefbf2fad92/crates/agent_servers/src/custom.rs), [external-agents.md](https://github.com/zed-industries/zed/blob/482e76524bd33d8cbdfc352f1fef3eefbf2fad92/docs/src/ai/external-agents.md) (实测) |
| Vibe Kanban (BloopAI) | Rust enum `CodingAgent` dispatched with `enum_dispatch`: `ClaudeCode` runs the CLI with `--output-format=stream-json --input-format=stream-json`; `Codex` runs `codex app-server`; `Gemini` and `Qwen` use an `AcpAgentHarness`; `Opencode` runs `opencode serve` on 127.0.0.1; `CursorAgent` runs `-p --output-format=stream-json`; plus a generic `AcpServer` variant fed from the ACP registry. A small `BaseAgentCapability` set (`SESSION_FORK`, `SETUP_HELPER`, `CONTEXT_USAGE`) | Closest to Cairn's shape (one executor per CLI, protocol chosen per CLI); thin capability model, drives the CLI binary directly rather than the Claude Agent SDK | [`executors/mod.rs`](https://github.com/BloopAI/vibe-kanban/blob/3f095f0186f6e68d67143d38b02da2238f6524d8/crates/executors/src/executors/mod.rs), `claude.rs`, `codex.rs`, `opencode.rs`, `cursor.rs` in the same folder (实测) |

Not opened: Conductor (closed source, no first-hand source read). OpenCode's own multi-agent code was not read beyond how T3 and Vibe Kanban launch it.

## 6. Against Cairn's 1607 conclusions

| 1607 conclusion | What T3 Code shows | Verdict |
|---|---|---|
| Do not replace the Claude Agent SDK bridge or Pi with ACP; ACP is for the third family of external CLIs | T3 Code uses the Claude Agent SDK for Claude, native app-server for Codex, native RPC for Pi, and ACP for the rest | Confirms (实测) |
| Codex does not go through ACP first | T3 Code does not use `codex-acp` at all; native `codex app-server` is its Codex path (`turn/steer`, `thread/fork`, `thread/compact/start` have no ACP equivalent) | Confirms, and goes further: Cairn's `codex-acp` path costs steering (`steering: false`) and likely usage detail (推断) |
| Start with Gemini over `--acp` | T3 Code has no Gemini driver; Gemini rides the generic ACP path | Consistent (实测) |
| ACP cannot rebuild four-dimension tokens or five-item cost; leave rows empty, never fake zero | T3 Code takes ACP `usage_update` only for context size and cumulative cost metadata, and fills real token ledgers from the CLI's own transcripts instead | Confirms; adds a source Cairn does not use yet: transcripts (实测 for T3; 推断 for Cairn) |
| `readOnly` and gate are weaker on ACP; do not claim a gate that cannot see commands | T3 Code states the same limit (`client-boundary`, "T3's check is weaker than the agent's own enforcement") and hides modes it cannot enforce | Confirms (实测) |
| A bridge is tied to one machine's installed CLI; no registry | T3 Code installs ACP registry agents itself (exact versions, SHA-256, T3-owned prefix) | Contradicts the "no registry" scope for a product that wants arbitrary agents; not required for Cairn's three runtimes (推断) |
| ACP steer: queue after the current prompt returns | T3 Code interrupts the turn and starts a replacement attempt (`supportsSteeringByInterruptRestart`) and shows the pending state per message via `steer.updated` | Contradicts the choice, not the facts: both are valid, T3 Code's lets the user redirect now (实测) |
| Fail closed when a capability is missing (no session resume, no images, no host tools) | T3 Code falls back instead: rollback becomes fresh session plus handoff, fork becomes context handoff, steering becomes interrupt and restart | Contradicts for resume and rollback (实测) |
| Static `sessionResume: false` for ACP, decide by handshake | T3 Code reads the handshake each time and also keeps an app-level thread cursor | Confirms (实测) |

## 7. Pattern that fits Cairn, and recommendation

Cairn's shape (a hub with daemons that claim steps) differs from T3 Code's (a full server per machine), so T3 Code's event-sourced graph and its 12-group capability struct are not a fit to copy. What transfers is smaller:

1. **Declare, do not hide, capability differences.** Cairn's `AgentBackendCapabilities` has `steering?`, `sessionResume`, `compaction`. T3 Code's lesson is to make the list the single source for UI and server decisions, and to treat a flag left on that fails at runtime as a bug. Add flags only when a concrete UI or dispatch decision reads them (not the whole 12 groups). (推断)
2. **Keep the protocol per runtime, normalised at one seam.** This matches Cairn's current split and T3 Code and Vibe Kanban. Do not move Claude or Pi to ACP. (实测 for T3 and Vibe Kanban, 推断 for Cairn)
3. **Replace "fail closed" with "fall back" only where the fallback is honest and cheap.** For ACP identities with no `session/load` or `session/resume`, Cairn already falls to a cold session; keep it. Do not build rollback or fork handoff; Cairn has no such feature. (推断)
4. **Fix the Codex path rather than add more ACP.** Cairn runs Codex through `codex-acp`, which loses steering. T3 Code's Codex adapter talks `codex app-server` directly. If Codex steering or usage matters, a native `app-server` bridge behind `apps/daemon/src/backend/` (new file, with a biome seam rule, same as the SDK files) is the T3 Code and Vibe Kanban pattern. (推断; cost not measured)
5. **Read usage from the CLI's own transcripts when ACP gives none.** T3 Code parses `~/.claude/projects` JSONL and Codex logs for token ledgers. For Gemini and Codex through ACP, Cairn writes empty usage rows; a transcript reader on the daemon would fill four-dimension tokens without inventing prices. Needs a check of each CLI's log format and a privacy review before use. (推断)

Recommendation (in order):

- **Do now, small:** keep the 1607 identity-table design for Gemini and later identities; no registry, no 12-field descriptor. Add replay-style parity tests per backend recorded from real CLIs (T3 Code's one strongest practice), starting with the `acp.ts` Gemini path: `simple`, `multi_turn`, `turn_interrupt`, `resume`. Code areas: `apps/daemon/src/backend/acp.ts`, `apps/daemon/test/`, `scripts/` recorder.
- **Decide next, ian's call:** whether Codex should leave `codex-acp` for a native `codex app-server` bridge (gains steering and token detail; costs a new bridge file, `MACHINE_RUNTIMES` and `BACKEND_RUNTIME_IDS` entries, `biome.json` seam, ticket per the Design-first rule). Recommended: yes, as one ticket after the Gemini probe is green, because T3 Code and Vibe Kanban both chose it. Code areas: `apps/daemon/src/backend/`, `packages/shared/src/agent-backend.ts`, `packages/shared/src/records/machine.ts`, `apps/server/src/services/dispatch-eligibility.ts`, `packages/shared/src/brief-file.ts`.
- **Do not do:** adopt T3 Code's event-sourced orchestration graph; build a managed ACP registry installer; store provider tokens in the daemon (T3 Code does for Codex ChatGPT only, behind a purpose-built broker).

## 8. What could not be opened or verified

- **Not run.** T3 Code was not installed or started (no `pnpm install`, no desktop build); findings are from source and docs at the pinned SHA only. The claim that the Claude Agent SDK drains the 5-hour limit at Claude Code's rate is the FAQ's text, not measured here.
- **Not opened:** Conductor (closed source). T3 Code's `apps/web` rendering code and the mobile app were not read; the "how events reach the UI" answer stops at the RPC subscription layer. `ClaudeAdapterV2.ts` (about 3,400 lines) and `adapter.ts` (10,002 lines) were searched and read in the parts quoted, not in full.
- **Version drift.** T3 Code is at `0.1.10` with many commits a day, and its ACP docs describe an ACP v2 preview; the 1607 note pins SDK 2.0.2 and protocol v1 on 2026-10-24. Re-check before copying any field name.
- Vibe Kanban's `main` was read through the GitHub contents API (partial files), not cloned; Zed's likewise.
