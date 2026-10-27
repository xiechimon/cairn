# r4-foundation — foundation comparison: craft-agents-oss / pi SDK / Claude Agent SDK / full self-build baseline

- Ticket: xiechimon/pacman #38 (research). Destination = decision evidence for "Locked: foundation selection final ruling" (#39); the "library-ization" route (no direct forking) and "exclude the three paid options, keep OAuth for connecting your own ChatGPT/Codex/Copilot/XAI subscriptions" are already locked in #34 Notes and not re-litigated here.
- Pinned versions (all measured 2026-09-19):
  - `craft-ai-agents/craft-agents-oss` @ `e8963854c3679edcceb105a42537a06749e6cb64` (tag info "v0.13.3", 2026-09-07; cloned with `git clone --depth 1` to `/tmp/craft-agents-oss` and read directly).
  - `@earendil-works/pi-*`: npm dist-tag `latest = 0.85.1` (published 2026-09-05; registry measured 2026-09-19, **identical to the r9 pin, so all r9 line-number conclusions remain valid**); `legacy-node20 = 0.74.2`.
  - `@anthropic-ai/claude-agent-sdk`: npm dist-tag `latest = next = 0.3.277` (2026-09-18; tarball unpacked to `/tmp/casdk-npm/package/` and `sdk.d.ts`/`manifest.json` read directly; GitHub repo `anthropics/claude-agent-sdk-typescript` @ main read directly for `LICENSE.md`/`CHANGELOG.md`).
- Citation convention: craft paths are relative to its repository root; SDK paths are relative to the npm tarball `package/` root; pi conclusions cite chapter/line numbers of `docs/research/r9-pi-sdk.md` (hereafter r9). Interpretations without a source are marked **[inference]**. The todos.dev feature list cites #34 Notes (the research ticket does not depend on the unfinished #36 screen inventory; screen-level same-shape scoring awaits #36's artifacts).

---

## S0 Quick conclusions (one sentence per route)

1. **craft-agents-oss**: the most same-shaped runnable implementation of todos.dev's architecture (task-DAG orchestration, dual-SDK backend abstraction, and BYOK multi-provider all ready-made), but **npm has no published artifacts (`@craft-agent/*` registry 404 measured) → for craft, "consume as a library" collapses to only two tiers: vendoring the source / reference-only**. Apache-2.0 permits vendoring, at the cost of TRADEMARK renaming (name, logo, bundle ID) plus adapting the bun/Electron form to this stack (Node24/pnpm/Web).
2. **pi SDK**: r9's pinned-version check passes (0.85.1 unchanged); the boundary between the "directly usable" surface (provider/OAuth/compaction/session tree) and the "gaps" surface (multi-session orchestration/MCP/cron/memory) is crisp, with **zero hard gaps and no fork needed** (r9 S9.1) — the only foundation of the three whose capability is fully open-source and version-pinnable.
3. **Claude Agent SDK**: the **thickest native feature surface** for todos.dev-shaped scenarios (parallel worktrees, multi-agent, per-agent memory, transcript/cost accounting) (worktree isolation and the `SessionStore` abstraction are ready-made, S3.1), but **the agent itself is a 217–234 MB per-platform closed-source signed `claude` binary**, the license is "All rights reserved + Commercial ToS", it tracks Claude Code daily (302 releases), and **the model surface covers only the Claude family — it does not cover the ChatGPT/Copilot/XAI subscription connections locked in by this plan**.
4. **Full self-build baseline**: the scale sense of the must-keep semantics from r2–r4 plus all 35 judgments of r9 S8 = upstream nanobot's 629 py files / 4,443 commits / 7.5 months / 2–3 core developers (r1 table header); whichever library foundation is chosen, todos.dev's Chief/board/orchestration layer must still be written in-house, and **the increment of full self-build is exactly "rewrite the r9 E list (pi free gains) from scratch"**, of which the provider wire-quirk table + the OAuth full suite (r9 S9.8) is the largest single block.

---

## S1 craft-agents-oss (measured)

### S1.1 Repository structure and scale

- Layout (measured with `ls`): `apps/{cli,electron,viewer,webui}` + `packages/{core,messaging-gateway,messaging-whatsapp-worker,pi-agent-server,server,server-core,session-mcp-server,session-tools-core,shared,ui}`; bun workspaces (root `package.json` `"workspaces":["packages/*","apps/*"]`, `bun.lock`/`bunfig.toml`, tests via `bun test`). The whole repo version-locked at `0.13.3`, license `Apache-2.0` (consistent across the root package.json + the 161-line LICENSE + gh api spdx).
- src TS/TSX scale (`wc -l` aggregated 2026-09-19, test files included):

| Package | LOC | One-sentence role (README "Architecture" + directory read) |
|---|---:|---|
| `apps/electron` | 135,725 | Desktop GUI main process + renderer (React 18.3.1 + Radix subset + cmdk; renderer components 258 .tsx files) |
| `packages/shared` | 119,627 | Business core: `agent/` (dual backends + permissions + modes), `config/` (LLM connections), `credentials/` (AES-256-GCM, README architecture section), `sources/` (MCP/REST API), `automations/` (cron-matcher+event-bus), `tasks/` (task.yaml schema), `mcp/mcp-pool.ts` (`McpClientPool` :102), `auth/chatgpt-oauth.ts` (261 lines, PKCE, Codex app-server endpoints, idToken→API key exchange) |
| `packages/ui` | 29,980 | Cross-app React components (chat/TurnCard 3,284 lines, terminal, code-viewer, markdown, annotations) |
| `packages/server-core` | 29,411 | Headless server: `sessions/SessionManager.ts` (**single file 9,023 lines**), `tasks/TaskRunner.ts` (926 lines, in-process "Conductor"), `handlers/rpc`, `transport`, `webui/http-server.ts` (static surface for web clients) |
| `packages/pi-agent-server` | 6,444 | Pi backend subprocess: self-built stdio JSONL protocol (not pi RPC mode), nearly read in r9 S7 |
| `packages/session-tools-core` | 9,399 | Shared handlers for session tools (common implementation of Claude-side session-scoped tools and Codex-side stdio MCP) |
| `packages/core` | 1,310 | Shared types (`AgentEvent` etc.) |
| `packages/server` | 542 | Thin server entry shell (`@craft-agent/server`, author field Craft Docs Ltd.) |
| `apps/{webui,cli,viewer}` | 5,157 (three combined) | webui reuses `@craft-agent/{ui,shared}` with Vite+React+jotai + an electron shim; cli is a WS client to a remote server (README "CLI Client") |

- Repo popularity (gh api measured 2026-09-19): 7,187 stars / 1,064 forks / created 2026-01-19 / pushed 2026-09-07.

### S1.2 How it uses the Claude Agent SDK and the Pi SDK "side by side"

README:21 verbatim: "It uses the Claude Agent SDK and the Pi SDK side by side—building on what we found great and improving areas where we've desired improvements." (Mechanisms measured below.)

- **Unified interface**: `packages/shared/src/agent/backend/types.ts` (688 lines) `export interface AgentBackend` (:337) — `chat()/abort/forceAbort/interruptForHandoff/redirect/runMiniCompletion/postInit/applyBridgeUpdates/ensureBranchReady/setModel/setThinkingLevel/setPermissionMode/setSourceServers/respondToPermission…` (member list read directly); provider-agnostic events (file-header comment: All backends emit the same AgentEvent types / Capabilities-driven UI).
- **Factory and drivers**: `backend/factory.ts` (857 lines) `DRIVER_REGISTRY: Record<AgentProvider, ProviderDriver> = { anthropic: anthropicDriver, pi: piDriver }` (:66-69); `backend/internal/drivers/{anthropic,pi}.ts` + `runtime-resolver.ts` (263 lines, resolving platform binary paths).
- **Claude route (in-process SDK)**: `shared/src/agent/claude-agent.ts` 3,175 lines, directly `import { query, createSdkMcpServer, tool, … } from '@anthropic-ai/claude-agent-sdk'` (:1); pinned to exactly **0.3.258** (`packages/shared/package.json:93`, `packages/core/package.json:15`); `options.ts` handles the optional platform binary packages `@anthropic-ai/claude-agent-sdk-{platform}-{arch}` (:158,:248 comments). Session-scoped tools are injected via `createSdkMcpServer` (`session-scoped-tools.ts`, `sources/server-builder.ts:18`).
- **Pi route (out-of-process)**: `shared/src/agent/pi-agent.ts` 2,719 lines = "Thin subprocess client…Spawns a pi-agent-server subprocess and communicates via JSONL over stdin/stdout" (header comment :1-13); `packages/pi-agent-server` runs the pi SDK in-process at the exact pin `@earendil-works/pi-{coding-agent,agent-core,ai}: 0.85.1` (r9 S7 nearly read its assembly and pitfalls).
- **Adapter-layer volume**: `claude-agent.ts + pi-agent.ts + base-agent.ts(1,286) + backend/(6,128) + pi-agent-server(6,444)` ≈ **22.8k lines** — this is the engineering cost craft actually paid for "two SDKs mounted on one product event surface", and it is the reference for pacman's retrofit surface if it goes dual-backend.
- **Multi-provider subscription connections**: the pi backend + `auth/chatgpt-oauth.ts` (self-implemented ChatGPT PKCE) + `config/models-pi.ts` (214 lines, pi model table); CLI `run --provider openai|google|openrouter|groq|mistral|xai` (README CLI table). That is, craft's non-Anthropic subscription surface **goes through the pi channel + host-self-installed OAuth**, unrelated to the Claude SDK.
- **Multi-agent parallelism**: the `spawn_session` tool (`spawn-session-tool.ts`, "Create a new session that runs independently…delegate tasks to parallel sessions", overridable model/llmConnection/permissionMode/thinkingLevel/workingDirectory) + the Tasks subsystem (S1.4).

### S1.3 "Consume as an npm dependency" does not hold (measured)

- `curl registry.npmjs.org/@craft-agent%2F{core,pi-agent-server}` both return **404 "Not found"** (measured 2026-09-19); npm search "@craft-agent" returns nothing in that scope. `@craft-agent/*` are only cross-referenced as `workspace:*` inside the repo.
- Implication (for the three tiers in #39): **npm dependency = this option does not exist** (unless you build and publish packages to a private registry yourself); **vendor source = allowed by Apache-2.0** (obligations: keep LICENSE/NOTICE, mark modifications, §4(a)-(c); NOTICE itself carries the clause "this product's use of the Claude Agent SDK is under Anthropic Commercial ToS" which must be passed along); **reference-only = zero license constraints**. Direct forking is already excluded by #34.
- Practical friction of vendoring: bun workspaces/`bun test` (this stack is Node24+pnpm+vitest, 01-stack §3/§4); Electron renderer components deeply coupled with main-process IPC (`apps/electron/src/main`); no semver stability promise (0.13.x, whole-repo lockstep); upstream untouched for a week (pushed 9/7) but the issue/PR flow is active — **vendoring means owning the divergence yourself**. [inference] The friction level is based on reading directories and build scripts; no porting PoC was done.

### S1.4 LICENSE / TRADEMARK boundary (which names/logos are off-limits)

- `TRADEMARK.md` (read in full): Craft Docs Ltd. trademarks, four items — **the word marks "Craft" and "Craft Agents" + the Craft logo/icon + the Craft Agents logo/icon**.
  - Allowed: use/modify/distribute the code, commercial use; factual statements ("Based on Craft Agents"/"Fork of Craft Agents").
  - Forks/derivatives must: pick a name not containing "Craft", remove/replace all logos and icons, change the bundle identifier (e.g. `com.lukilabs.craft-agent`), drop `craft.do` domain references (except when pointing at the official Craft service).
  - Not allowed: naming a product "Craft"/"Craft Agents", using the Craft logo as the app icon, implying official endorsement.
  - Files named for renaming: `apps/electron/electron-builder.yml`, `apps/electron/resources/`, `packages/shared/src/branding.ts`.
- No conflict for pacman: the product name = pacman/todos.dev replication, nothing carries the Craft word; if its components are vendored, keeping the Apache headers + NOTICE in the source suffices, and UI copy/logos would be redone per todos.dev anyway (material ticket #44).

### S1.5 Architecture same-shape points with todos.dev (item by item; README/docs/source as evidence; screen-level scoring awaits #36)

| todos.dev feature (#34 Notes) | craft counterpart | Evidence | Same-shape degree |
|---|---|---|---|
| Chief decomposes goals → assigns agents | Tasks: goal → `task.yaml` subtask DAG ("Each node becomes a child AI session", `depends_on` passes `${nodes.<id>.output}`, acceptance_criteria scoring loop, `max_iterations` repair loop 3/10) | `shared/src/tasks/generator-prompt.ts` (header comment :1-8 + prompt body), `schema.ts` (`NODE_KINDS` 14 kinds: session/orchestrator/route/parallel/map/loop/approval/synthesize/verify/judge/filter/aggregate/finally), `server-core/tasks/TaskRunner.ts` (926 lines, in-process Conductor) | High (mechanism same-shaped; prompt strategy is a black box, compared separately) |
| Agent team role/model | `spawn_session` (independent session can override model/connection/permissionMode/thinkingLevel/workingDirectory); node-level `permissionMode` | `spawn-session-tool.ts:43-52`, `tasks/schema.ts` | Medium-high |
| Agent memory (per-agent) | workspace/project-level memory (`loadProjectMemory` enters the system prompt) + the agents concept on the Claude SDK side | `shared/src/agent/pi-agent.ts:47` import; SDK surface see S3.1 `AgentDefinition.memory` | Medium (no evidence of a per-agent independent memory directory) [inference] |
| Parallel git worktrees | **None** — across the whole repo, TS source contains exactly 1 hit for "worktree" (`claude-agent.ts:1239` comment, which is about the pitfall of Claude session resume hitting "No conversation found" between worktree↔main repo) | grep measured 2026-09-19 | **Zero** (craft cannot help pacman here) |
| Board / status flow | Inbox/Archive + dynamic status system (Todo→In Progress→Needs Review→Done, customizable) + labels | README Features "Dynamic Status System""Multi-Session Inbox"; `shared/src/labels/`, `shared/src/statuses/` | High |
| Scheduling | Automations: cron-matcher + event-bus + conditions (label changes/timers/tool-use triggers create sessions) | `shared/src/automations/` (cron-matcher.ts, event-bus.ts, conditions.ts) + README "Automations" | High |
| Projects | `shared/src/projects/` (project inheritance rule: explicit project > calling session's project) | `server-core/tasks/create-task.ts:28-33` | High |
| Resources {skills} | Skills per-workspace, `@` mention takes effect instantly | README "Skills""Do I need to restart" | High |
| Resources {MCP} | Sources: MCP servers (local stdio subprocesses + remote) + REST API (Google/Slack/Microsoft OAuth) + local filesystem; `McpClientPool` | README "Things that just work" all + `shared/src/mcp/mcp-pool.ts:102`, `shared/src/sources/` | High |
| Resources {secrets} | `shared/src/credentials/` (AES-256-GCM encrypted storage, README architecture diagram) | same as above | High |
| Resources {machines} | Remote headless server (WS+token+TLS+Docker) + thin client; `apps/cli` connects to the remote | README "Remote Server (Headless)" full section | High |
| Resources {model services} | Multiple LLM connections (Anthropic API/Claude Max, Google AI Studio, ChatGPT Plus Codex OAuth, Copilot OAuth, openai-compat custom endpoints) | README "Connection" + `chatgpt-oauth.ts` + the LLM Connection comment in `backend/factory.ts` | High |
| Search ⌘K | cmdk command palette (`@radix`/`cmdk` deps read in `apps/electron/package.json`; `renderer/components/ui/command.tsx`, `slash-command-menu.tsx`) | grep/ls measured | Medium (component-level; needs rearranging to todos.dev screens) |
| App installation | Electron desktop app (+one-line install script) | README Installation | Medium (todos.dev is PWA/app form, pending #35 inventory) [inference] |
| Browser notifications | `apps/electron/src/main/notifications.ts` (desktop notifications) | ls measured | Low-medium (not Web Push) [inference] |
| `tds start` executor | `craft-cli run` (self-contained: start server → create session → stream → exit) + server daemon | README "CLI Client" | High (shape-wise a CLI executor closed loop) |
| Platform-hosted repo / GitHub merge | No native feature seen; GitHub goes through the MCP source | README "Connect to Linear, Gmail…" | Low |
| Transcript + token accounting | Full session persistence to disk + Claude result `total_cost_usd`/usage (SDK event surface) | `shared/src/agent/claude-agent.ts` (usage/cost field consumption); SDK S3.1 | Medium-high |

- Form mismatch summary (qualitative, pre-vendoring): craft = **Electron desktop + single-user + local process model**; todos.dev = **Web SaaS + server-side orchestration**. What is same-shaped is the "product concept layer", not the "process topology layer". [inference] Based on the README architecture diagram and reading the `server-core/transport` and `apps/electron/src/main` directories.

### S1.6 Input questions for #39 (craft)

1. Which tier does craft take: **reference-only** (zero license obligations, zero porting cost; the high-same-shape rows of S1.5 serve as the blueprint) / **component-level vendoring** (UI pieces + tasks schema/generator prompt + mcp-pool and other discrete pieces, carrying Apache obligations and divergence debt) / **build private npm packages** (republishing the monorepo packages into a private registry — the bun→pnpm toolchain still has to be solved first). The three tiers can be **mixed per package**, requiring a "package × tier" list.
2. UI foundation (#39 question 3): craft's UI is coupled with the Electron renderer and its style is Craft's own (not todos.dev's look) — should it be demoted to "component-granularity/interaction-pattern reference", with pixel replication built from scratch in React based on the #36 inventory?
3. The Tasks DAG (task.yaml schema + generator prompt + Conductor/TaskRunner) is the most todos.dev-Chief-same-shaped piece of craft: vendor, reference, or rewrite per todos.dev black-box observation (#37/#41)?
4. If the Claude Agent SDK backend is ultimately chosen, craft's `claude-agent.ts` (3,175 lines) and the backend abstraction are a ready reference implementation; if pi-only is chosen, r9 S7's pi-agent-server has already been dissected. Both need not be kept.

---

## S2 pi SDK — three tables of directly-usable / seams / gaps (r9 re-check + registry verification)

Version check (2026-09-19): `pi-coding-agent`/`pi-agent-core` `latest = 0.85.1`, `legacy-node20 = 0.74.2` (npm registry measured) — **the v0.85.1 pinned by r9 (research of 09-18) is still the current latest; none of r9's line numbers or judgments have expired**; breaking history see r9 S6 (weekly minor updates, 0.85.0 ships with a Breaking section: harness promoted to a default export / legacy repo API removed / `ModelsStreamTransforms` renamed; Node ≥22.19.0; MIT).

### S2.1 Directly usable (native; r9 S8 judged "use pi" items)

| Capability | pi current state | Basis (r9) |
|---|---|---|
| Provider transport / wire-quirk table | pi-ai ~40 providers + generative catalog + pi.dev remote catalog refreshed every 4h | S4.1, S9.8 (the "biggest dividend" = the whole self-build cost of r4 §1.3/§2 deleted) |
| **OAuth subscription connections** | `ai/src/auth/oauth/` actually contains: `anthropic.ts` (Claude subscription), `openai-codex.ts` (ChatGPT/Codex), `github-copilot.ts`, `xai.ts`, kimi/openrouter/radius/device-code/pkce | S4.1; **directly hits the "keep OAuth for connecting your own ChatGPT/Codex/Copilot/XAI subscriptions" locked in #34** |
| Retries | pi-ai retry vocabulary classification + AgentSession double-layer retries | S4.1 |
| Agent loop callback surface | AgentRunSpec counterparts all present (injection/continuation/consolidation/stop) | S1.5, S1.6#5 |
| Compaction | threshold/overflow+retry/manual + independent retry budget + `session_before_compact` hook | S1.4 (except idle-TTL → S2.3) |
| Session persistence / branching | JSONL tree (v3): branch/fork/label/abandoned-branch summary/inMemory | S3.1 |
| Tool contract | TypeBox schema + `promptSnippet/promptGuidelines` + `executionMode` + `terminate` + `addedToolNames` | S2.1 |
| Durable runtime (optional) | harness: transactional operation state, recovery replay (`replay:"safe"`), interruption materialization, deferred/suspend | S1.4, S3.2 (just promoted in 0.85.0, consumed while experimental) |
| Observability | before/after_provider_request + pi-telemetry (OTel) | S8 C7 |
| Event stream / embedding | RPC-mode JSON event stream + extension system (30 events) | S1.1, E list |

### S2.2 Seams (official injection points exist, but the author must implement/work around)

| Seam | Current state and workaround | Basis |
|---|---|---|
| Sandbox / command guardrails | Built-in bash runs bare (no deny patterns/paths/SSRF); `BashOperations`/`BashSpawnHook`/per-file-tool Operations interfaces are official seams; the r3 bwrap/seatbelt matrix can be ported over | S2.2, S9.3 |
| Per-turn systemPrompt | No public API; workaround = inline extension returning via `before_agent_start`, or craft-style pinning of three internal fields (same-period issue `craft-agents-oss#782`) | S7 pitfall 1, S8 D2 |
| tool_call orphan repair | sequential abort leaves unanswered toolCalls; SessionManager replay does not patch; the public `transformContext` is a clean external point | S1.6#2, S8 A5/A6 |
| message_end fires before persistence | craft workaround: `queueMicrotask` to read the leaf (craft#782); harness events carry entryId so no such seam | S7 pitfall 2, S8 D3 |
| Compaction race | wrapper-side concurrent compaction fights the SDK's own compaction (craft#464) → serialize with `waitForCompaction` | S7 pitfall 3 |
| Tool hot-swap | changing tools = dispose + `continueRecent()` full session rebuild (craft); `refreshTools` is public but `_buildRuntime` is private | S7 pitfall 5, S1.5 |
| Session storage backend | SessionManager concrete class has no storage abstraction; `inMemory()` + self-saving via events / re-implementing the public surface / **the harness layer has the official `SessionRepo` contract (the right road)** | S3.1, S8 D1 |
| Multi-session concurrent orchestration | "cross-session orchestration is the host's job wholesale" — pi is a single-active-session model, no lock table / semaphore | S1.6#1, S8 A2 |

### S2.3 Gaps (pi has no counterpart; all sit on the author layer)

| Gap | Judgment | Basis |
|---|---|---|
| MessageBus / channel distribution | external - host | S8 A1 |
| cron/heartbeat subsystem | pure author (host scheduling + injecting `session.prompt()/steer()` is equivalent) | S8 B5, S9.5 |
| Memory/Dream subsystem | drop or pure author (zero coupling points) | S8 A8 |
| **per-agent memory** | gap (pi has no per-agent memory surface at all; compare SDK `AgentDefinition.memory` S3.1) | S1.6#6 messages-as-state, S8 A8 |
| MCP | zero core MCP (grep measured + zero official-doc mentions); community `pi-mcp-adapter@2.34.0` or a self-built bridge | S5, S8 B4 |
| subagent primitive | none (craft demonstrates an external ephemeral `createAgentSession`) | S8 A7, S7 |
| web tools / exec_session / apply_patch / FallbackProvider / provider_state / idle-TTL compaction | each judged external / drop | S8 B2/B3/B9/C2/A11/A9 |

### S2.4 Input questions for #39 (pi)

1. Route-level decision: **AgentSession (stable surface, craft-validated, seam list ready-made) vs harness (more durable counterparts, product wiring self-todo)** (r9 S9.2) — this decides which workaround each S2.2 seam takes.
2. Pin discipline: continue 01-stack §3 (patch-pin + explicit upgrade window reading the Breaking section); budget the Breaking-window cost of 0.85.1 → next minor per r9 S6.
3. MCP ownership: depend on the community pi-mcp-adapter (fast but third-party debt) vs self-build a defineTool bridge on `@modelcontextprotocol/sdk` (r3 S3 semantics all self-owned) — 01-stack already chose "external to pacman"; this ticket only needs to confirm who maintains the bridge.
4. Whether to also introduce a second SDK (Claude Agent SDK or a Codex-side executor): if introduced, craft's `AgentBackend` dual-driver abstraction (S1.2) is the only first-hand reference.

---

## S3 Claude Agent SDK (@anthropic-ai/claude-agent-sdk @0.3.277 measured)

### S3.1 Applicability to todos.dev-shaped scenarios (multi-agent parallel, worktrees, memory, accounting)

**The highest feature hit-rate of the four routes — but all these semantics run inside a closed-source binary** (see S3.2). Evidence is all in `sdk.d.ts` (9,451 lines) / `manifest.json` / `CHANGELOG.md`:

| Scenario | Native surface | Source |
|---|---|---|
| **Parallel git worktrees** | `Options.projectConfigRoot`: "The trusted checkout `cwd` is a **worktree** of…Project settings (hooks, permissions), `.mcp.json`, `.claude` config trees…come from here instead of cwd" — worktree session trust config decoupled from branch content | sdk.d.ts:1461-1469 |
| Worktree lifecycle | settings `worktree.{symlinkDirectories, sparsePaths, baseRef:'fresh'|'head', bgIsolation:'worktree'|'none', location}`; `bgIsolation` defaults to "blocks Edit/Write in the main checkout until EnterWorktree is called" (background sessions auto-isolated into a worktree) | sdk.d.ts:6798-6816 |
| Worktree session retrieval / resume | `listSessions({dir, includeWorktrees:true by default})` "include sessions from all git worktree paths"; startup failure reasons include `worktree_resume_refused`/`worktree_unverified` | sdk.d.ts:1014-1054, 5559-5561 |
| Worktree hooks | `HOOK_EVENTS` includes `WorktreeCreate`/`WorktreeRemove` (33-event full set :891) | sdk.d.ts:891,910,912 |
| **Multi-agent** | `agents: Record<string, AgentDefinition>` subagents (tools/disallowed/model/maxTurns/permissionMode/skills/mcpServers/background); the main thread can switch the whole agent (`agent:'name'`) | sdk.d.ts:38-107,1488,1504 |
| Agent teams / background tasks | `teammateMode:'auto'|'tmux'|'iterm2'|'in-process'` (teammate execution surface) + `TeammateIdle`/`TaskCreated`/`TaskCompleted` hooks + background-task completion aggregation (changelog 0.3.274) | sdk.d.ts:8856-8858,910; CHANGELOG |
| **Per-agent memory** | `AgentDefinition.memory: 'user'|'project'|'local'` → `.claude/agent-memory/<agentType>/` etc. directories auto-loaded; `omitClaudeMd` directive-file trimming | sdk.d.ts:87 |
| Bystander / review | `observer`/`observerMessage`: automatically spawn a read-only observer at agent runtime, reporting back via `ObserverReport` | sdk.d.ts:99-105 |
| Transcript / accounting | `getSessionMessages`/`getSubagentMessages`/`listSubagents`/`forkSession`/`resume`; result message `total_cost_usd`/`modelUsage`/`usage_report` | sdk.d.ts:770-1084; CHANGELOG 0.3.273/0.3.277 |
| Pluggable session storage | `SessionStore` interface + `InMemorySessionStore` + `importSessionToStore`/`foldSessionSummary` (WORM/append-only friendly) — **the D1 seam craft could not get on the pi side is an official contract here** | sdk.d.ts:820,935-977; cf. r9 S3.1/S8 D1 |
| MCP | `createSdkMcpServer` in-process server + stdio/HTTP external servers + background-connection semantics (`status:"pending"`, `alwaysLoad`, `CLAUDE_CODE_MCP_STARTUP_WAIT_MS`) + per-agent `mcpServers` | sdk.d.ts:543; CHANGELOG 0.3.142/0.3.274 |
| Permissions / BYOH | `canUseTool` callback (including the `mcpServer.source==="sdk"` trust key), `permissionMode`, allowed/disallowedTools, `toolAliases` (redirect the built-in Bash into your own sandbox) | sdk.d.ts:1517, :1558 |
| OS sandbox | settings `sandbox.{filesystem,network,credentials}` — network egress domain allowlists, denyRead, env variable masking; `WorktreeCreate/Remove` hooks | sdk.d.ts:8324, 8447 section |

**Not applicable**: models cover only the Claude family (the `AgentDefinition.model` comment examples are the 'fable/opus/sonnet/haiku' aliases + `claude-*` IDs, :56) — ChatGPT/Codex/Copilot/XAI subscription connections are **not in this SDK's surface** (#34 locked keep-item → choosing this SDK requires a second engine or accepting a shrunken subscription surface); orchestration/board/Chief logic all live in the host (same as pi).

### S3.2 Lock-in risks (protocol change history + license + data terms)

- **The body is a closed-source binary**: the npm package is only a wrapper (`sdk.mjs` + types) + 8 platform packages as `optionalDependencies`; `manifest.json` declares per-platform `binary: "claude"`, darwin-arm64 217,662,576 B / linux-x64 234,082,616 B, `manifestSignatureEnforcement: "flag"`, version = Claude Code **v2.1.277** with commit and checksum. → the agent loop, tool implementations, and worktree semantics' **actual behavior evolves unilaterally at Anthropic's side**; pacman gets no source, cannot vendor, cannot fork.
- **License**: `LICENSE.md` is one line: "© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service."; README "License and terms" restates it (including the "use it to serve your own customers" scenario). **Not OSI-open-source, cannot redistribute the binary**.
- **Data terms**: README "Data collection…": SDK sessions collect feedback (including code accept/reject and associated conversation data) under its data-usage policy — self-hosted/BYOC local runs are still bound by these terms, and pacman's spec must state so (against #34's zero-hallucination bar: this affects the compliance surface beyond "indistinguishable from the user's perspective").
- **Parity cadence**: 302 releases; 0.3.270→0.3.277 spans 9 days (registry time measured), each release's last line "Updated to parity with Claude Code v2.1.x" — **the version surface = the Claude Code release surface; behavior cannot be pinned independently**.
- **Breaking history** (CHANGELOG.md full 1,607-line scan): 5 entries marked `**Breaking**`, clustered in two windows — 0.2.113 (2026-04-17, `options.env` changed from overlay back to replace) and **0.3.142 (2026-05-14, a triple: v2 session API removed / MCP default background connections / TodoWrite→Task tools track switch)**; no new Breaking marks in the 4 months since, but there are **compile-level removals without a Breaking mark** (0.3.271 removes `MonitorInput.persistent`, CHANGELOG:56; 0.3.234 removes `bypass_permissions_disabled` from `ExitReason`, CHANGELOG:264, explicitly stating "TypeScript consumers with an explicit case branch get a compile error on upgrade"). → pinning preserves the interface but not binary behavior; craft pinning it at `0.3.258` (19 releases behind) is exactly this strategy's live sample.
- **Practical constraint on multi-route parallelism**: each `query()` spawns one CLI subprocess; N parallel worktree sessions = N Node subprocesses sharing the ~220MB binary. [inference] Process count / memory ceiling not measured (this plan writes no code).

### S3.3 Input questions for #39 (Claude Agent SDK)

1. Positioning question: **one of the engines, or the only one**? If the only → the ChatGPT/Codex/Copilot/XAI subscription surface kept by #34 is directly missing (Claude-only model surface), unless the subscription connections are assigned to a dual pi backend (the craft pattern) or cut from scope.
2. Are the closed-source binary + all-rights-reserved + data terms acceptable against the mirror relationship of "replicating a closed-source SaaS" (legal line; related to the #44 DMCA assessment ticket).
3. If introduced: pin a specific `0.3.x` patch + an upgrade window (the craft sample = surviving 17 releases behind, registry count measured); write the worktree/memory/session-store surface of S3.1 into the 04+ architecture volumes as the requirements baseline.
4. The relationship between the "exclude the three paid options" ruling and the Commercial ToS (the built-in models gateway is excluded anyway) — whether the ToS allows embedding the SDK into a future distributed self-hosted product is left for #39's final ruling.

---

## S4 Full self-build baseline (scale sense of the must-keep semantics list → increment estimate)

### S4.1 Must-keep semantics list scale (old r2–r4 measured anchors; [inference] serves as the proxy for todos.dev self-build scale — #34 Notes: old research "citable, not inherited")

- **r2 (agent core)**: 6 named must-keeps (per-session serial lock / tool_call pairing / interruption materialization without replay / concurrency_safe batching / AgentRunSpec callback surface / contextvars isolation, per the r9 S1.6 table) + the appendix trio (no message loss, double-layer persistence cadence, pending-queue lock invariants, r2 §5/appendix 4). Carrier scale: `loop.py` 2,388 lines, `runner.py` 1,374 lines (r1 appendix wc anchors + r2 §4 pipeline of 7 stages).
- **r3 (tools/MCP/cron)**: 24 static tools + 3 MCP dynamic wrapper forms (r3 S2 summary-table count row); the full `_guard_command` guardrail semantics (allow/deny segment fullmatch, SSRF marking, path traversal, multi-source absolute-path extraction — r3 S1 command-guard section, referenced 10+ times from shell.py); the MCP subsystem (three wrapper kinds / OAuth / two-level reconnect / webui presets, r3 S3); the cron subsystem (jobs.json/action.jsonl/runs audit/defer-until-idle, r3 S4).
- **r4 (providers/config/security)**: provider selection algorithm + 7 backend classes + `ProviderSpec` ~35-provider wire switches (registry.py:146-786); the FallbackProvider trigger-condition set; config layering + `${VAR}` interpolation + watchfiles hot-reload; SSRF/DNS pinning + workspace fencing; the 11-command CLI surface (r4 §0 ten-point summary).
- **r9 S8 aggregate**: 35 must-keep semantics judged item by item (A1–A15, B1–B9, C1–C8, D1–D3) + the E list (13 pi free-gain items, r9:326) — **this table itself is the diff set of "full self-build vs pi foundation"**.

### S4.2 Increment estimate (relative to the "pi foundation + host orchestration" route)

- The self-build surface no library route can avoid (**decision invariant**): todos.dev's Chief decomposition strategy, board/state machine, project/resource model, `tds start` executor, machine management, and the Web-SaaS server-side multi-user form — craft proves the "concept layer is replicable", but its product code is deeply coupled to Electron at this layer (end of S1.5), and #34 has already locked the black-box approximation bar (Chief prompt strategy marked [inference] where there is no source evidence). **The real differences between routes concentrate at the execution-engine layer**: agent loop, provider transport, session persistence, MCP, sandbox.
- The full-self-build increment ≈ rewriting the whole r9 "use pi" surface: the ~40-provider wire-quirk table and catalog maintenance (r9 S9.8, the r4 §1.3 counterpart), the OAuth six-piece suite (anthropic/codex/copilot/xai/pkce/device-code, r9 S4.1), session tree + compaction + retry vocabulary (S3/S1.4), the event surface (30+ extension events, S1.1). **craft's comparison figure**: to reuse the pi+Claude engines and mount its own semantics on top, the adapter layer alone cost 22.8k LOC (S1.2) — full self-build means also self-producing pi's ~30k-LOC-scale coding-agent package. [inference]: order-of-magnitude analogy, not a line-by-line estimate.
- Upstream manpower reference: nanobot (Python, with the full 17-channel/CLI/webui/TUI family) 629 py files / 4,443 commits / 2026-02-01→09-16 / peak 3 core developers (r1 header and §0.5); craft (TS, Electron full-stack product) src TS ≈ 338k lines / 8 months (created 2026-01-19). Under the single-person + AI agents route (#34 Notes), all three anchors point to: **the self-built engine layer is the net additional cost of the three library routes, and there is no external evidence that it buys back any todos.dev parity points**.

### S4.3 Input questions for #39 (self-build baseline)

1. Is the legitimate role of full self-build in #39 reduced to "fallback / comparison" — activated if and only if both pi and the Claude SDK are unacceptable?
2. If the pi route hits a wall later (e.g. the harness surface stays experimental long-term), which moves first: "rewrite the pi layer" or "switch to harness" (the continuation-in-self-build-context of the route question in r9 S9.2)?
3. Should the maintenance commitment for the provider wire-quirk table (40 providers kept current vs the upstream pi.dev catalog) be written into the 04+ volumes' operational obligations?

---

## S5 Four-route comparison table (reusable surface / retrofit surface / new surface / license and lock-in)

| Axis | craft-agents-oss | pi SDK | Claude Agent SDK | Full self-build baseline |
|---|---|---|---|---|
| **Reusable surface (ready to take)** | The whole product-concept layer (Chief-DAG/board/automations/sources/credentials/machines/CLI executor, S1.5) + the dual-backend `AgentBackend` abstraction + tasks schema/generator prompt + ChatGPT OAuth implementation + event adapters (pi 1,071 lines / Claude 545 lines) | The full provider-transport family (~40 providers + catalog updates + OAuth six-piece + retry vocabulary) + AgentSession loop primitives + session tree/compaction + RPC mode + extension surface (S2.1) | Native worktrees (isolation/hooks/cross-worktree session retrieval), subagents+teammates+observer, per-agent memory, SessionStore contract, OS sandbox, embedded MCP, transcript/cost APIs (S3.1) | None (all self-produced); the only "reuse" = the semantics lists already pinned by the old plan's r1–r9 |
| **Retrofit surface (must move after taking)** | Monorepo toolchain (bun→pnpm/Node24), Electron↔Web form split, brand/domain/bundle-ID cleanup (TRADEMARK), selecting pieces out of 338k LOC, divergence debt with no semver promise | The workaround layer for the eight S2.2 seams (craft's S7 list is the ready-made answer) + harness-vs-AgentSession route choice + patch-pin upgrade windows | Model surface shrinks to Claude-only → subscription connections need another engine to fill in; behavior is a black box (closed-source binary), cannot cross-check/fix bugs; version strategy = "pin old + survive behind" (craft sample: pin 0.3.258, with 17 releases after current 0.3.277) | All r2–r4 must-keeps + the r9 "use pi" surface + E-list rewrite; engineering reference at the nanobot/craft 8-month magnitude (S4.2) |
| **New surface (unavoidable whichever route)** | todos.dev pixel-level Web UI (craft's look is irrelevant), tds executor parity protocol (#37 observation), platform-hosted repo / GitHub merge parity, server-side multi-user-ization | Host orchestration layer (multi-session registry/lock table/bus), cron, memory, MCP bridge, web tools, sandbox policy (S2.2/S2.3 external items) | Same as pi (orchestration/board still host) + Claude-specific protocol cross-checking | Chief/board/orchestration/executor (same as all routes) + the entire engine layer |
| **License and lock-in risk** | Code: Apache-2.0 (permissive, vendorable, NOTICE must carry its Claude-SDK-ToS clause); trademark: four hard boundaries (S1.4); lock-in = **organizational** (craft.do upstream direction + no published artifacts), not technical | MIT; lock-in = **version surface** (0.x weekly releases with Breaking; patch-pin + upgrade windows keep it controllable; r9 S6); behavior auditable (fully open-source) | **© Anthropic PBC All rights reserved + Commercial ToS**; 217–234MB per-platform closed-source signed binary + daily parity; data-collection terms; breaking history in two windows + unmarked compile-level removals (S3.2); lock-in = **deepest** (both behavior and terms uncontrollable) | Zero third-party lock-in; lock-in = **own maintenance cost** (the 40-provider table + wire compatibility drifting with the model market must be self-sustained) |

---

## S6 Summary: questions #39 must answer before the final ruling (in dependency order)

1. **Number of engines**: single engine (pi) or dual engine (pi + Claude SDK, the craft pattern S1.2)? — decides whether the ChatGPT/Codex/Copilot/XAI subscription connections kept by #34 go through pi's native OAuth (S2.1) or accept a Claude-only shrink, and whether an `AgentBackend` abstraction layer is needed.
2. **Pricing the Claude Agent SDK's closed-source + ToS risk**: is the native worktree/memory surface of S3.1 worth the lock-in of S3.2? If not → pi single engine + host-side worktree orchestration (r9 has no native worktree surface; purely external).
3. **Walk the craft tier choice package by package** (S1.6.1): no npm artifacts is a settled fact; "consume as a library" only holds for pi/SDK; craft's accurate identity in #39's semantics = **first-hand evidence of a same-shaped architecture + vendorable component source + reference implementation of a dual-backend abstraction**, take N of the three.
4. **UI foundation**: craft's UI (Electron React/Radix/cmdk, S1.1/S1.5) helps pixel-replicating todos.dev at most as an interaction reference; if the #36 inventory shows building Web components from scratch is cheaper, the UI row chooses "reference only".
5. **Self-build fallback clause**: the three S4.3 questions, especially the trigger condition for "rewrite vs switch harness when pi hits a wall".
6. Items all routes share (not differentiated in the comparison table): Chief/board/executor/hosted-repo parity, the Web server-side form, asset replacement (#44) — orthogonal to the foundation choice.
