# 17 · Dual-Runtime Execution Surface (claude-code second engine)

> Scope: the daemon execution surface introduces claude-code as the second runtime — a step with `agent.provider='claude-code'` changes from "must blow up on the first step after claim" to really executable. Answers three questions: how Multica does dual runtime (mechanism verification draft); what pacman is missing (item-by-item list); whether claim/dispatch/reclaim can be shared (yes, the fork point is unique). This ticket only produces the design + execution-ticket drafts, **does not change product code** (repo rule: research the real implementation before building a mechanism).
>
> References: r10 (Multica runtime research, docs/research/r10-multica-runtime.md), r11 (pacman↔Multica gap list G1-G25, docs/research/r11-runtime-gap.md), r13 (r10's fresh-clone verification draft, HEAD `2ea01ae`, 2026-10-02, docs/research/r13-multica-runtime-verify.md, line numbers per that clone), the Agent SDK doc research draft (code.claude.com/docs/en/agent-sdk/*, fetched 2026-10-02).

## Problem Statement

1. **claude-code models are selectable, execution must die.** A 5-hop failure chain (each hop has a current code location):
   - the web two-level selector (PR #617, branch state) feeds model-sources' claude-code segment into the picker, the user can select `claude-code/<model>` (`apps/web/src/api/mappers.ts:812` RUNTIME_LABELS already includes claude-code);
   - the agent stores `provider='claude-code'`, no custom provider row;
   - server `stepToken`'s `toProviderConfig` fallback: `return agentProviderId ? { kind: 'api_key', providerId: agentProviderId } : null` (`apps/server/src/services/machines.ts:1405`) — fabricates an `api_key`-shaped provider config out of nothing;
   - the runner has the same fallback: `creds.provider ?? (agent?.provider ? { kind: 'api_key', providerId: agent.provider } : null)` (`apps/daemon/src/runner.ts:261-262`);
   - the daemon's only backend is PiBackend: `runtime.getModel('claude-code', modelId)` throws `model claude-code/<x> not found` (`apps/daemon/src/backend/pi.ts:562-564`), and the step fails.
   Namely "claude-code" in pacman only has the vocabulary surface (MODEL_SOURCE_RUNTIMES, MACHINE_RUNTIMES, RUNTIME_LABELS, the providers-page tab), no execution surface.
2. **The seam was reserved for this long ago.** The `AgentBackend` seam is exactly for the second engine (spec 00/D1: the seam stays engine-agnostic; "the Claude Agent SDK can only serve as a second-engine backfill, not the sole engine" — `docs/spec/00-foundation-decisions.md:27`); `MachineLoopOpts.backend?: AgentBackend` was always an injection surface (`apps/daemon/src/machine-loop.ts:41`). What is missing is the second implementation and the per-step backend-selection resolution point.
3. **The machine-surface vocabulary is decoration.** `machine.enabledRuntimes` is stored and writable (spec 11 A9), but the claim/execution chain never consumes it (r11 G7) — "this machine can run claude-code" is neither true nor false, a bit nobody reads.
4. **The model-source direction is already skewed.** The providers-page claude-code segment = the server process fs-reads `~/.claude/settings.json` directly (`apps/server/src/services/providers.ts:131-161`) — after control-surface and execution-surface separation it reads the server host's config, not the execution machine's (r11 G22).

## Upstream Mechanism: Multica Two-Layer Model (verification draft summary)

The following is entirely fresh-clone verified (HEAD `2ea01ae`, verification draft = r13); two departures from r10 corrected (the BuiltinRuntime descriptor is 12 fields not 9; the family count that does not consume `opts.McpConfig` is 6 not 4).

**Identity layer = registry descriptor.** The runtime identity is the provider key registered by the daemon, **not** a protocol family (does not appear in `SupportedTypes` and the `protocol_family` CHECK constraint). The `BuiltinRuntime` descriptor has 12 fields (`builtin_runtimes.go:18-70`): ID (identity key), ProtocolFamily (dispatch target), DefaultCommand (PATH probe), EnvPrefix (`MULTICA_<ID>_*` override), DisplayName, SkillsDir/UserSkillsDir, LaunchHeader, DefaultExecutable/ProviderLabel (the family backend's identity override), ModelDiscovery (the strategy function replacing the whole family discovery). The registry table has only one entry: `omp` (family=pi). The structural argument is stated fully in the struct doc: "Adding a new compatible fork of an existing runtime is a descriptor entry, not a cross-stack change".

**Family layer = execution backend.** 25 protocol families (`agent.go:364-390`), each family backend implements **the same single-method interface**:

```go
type Backend interface {
    Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error)
}
```

(`agent.go:17-23`). The differences all live in each `*Backend` private implementation; the rich capability surfaces (Supplement, ToolActivity, InterruptBackgroundTools etc.) are optionally exposed through the returned `Session` struct (nil = not provided). `New(agentType, cfg)` is a pure family switch (`agent.go:432-498`).

**The resolution entry is unique.** `ResolveBackend(provider, cfg)` (`builtin_runtimes.go:147-158`): identity key → `NewRuntime` (builds the family backend + applies descriptor overrides, **fail-closed** error when the family backend does not support identity carrying, `builtin_runtimes.go:160-186`); otherwise → `New`. The daemon never calls New/NewRuntime directly. Backend instances are **built once per task**: inside `runTask` resolve once, the local variable discarded after use (`daemon.go:8588-8599`), no process-level cache.

**claude family protocol** (`claude.go`): `claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --disallowedTools AskUserQuestion` + conditional `--model`/`--effort`/`--resume`/`--max-turns` (`claude.go:1078-1136`); the prompt written as a single stream-json `user` frame to stdin and **kept open** (mid-stream `control_request`/`control_response` go through the same pipe); stdout parsed line by line; `session_id` scraped from the system/result frame and returned; the transcript stays in the CLI's own `~/.claude/projects/<slug>/<id>.jsonl` (`claude.go:936-972`). Model discovery has no CLI flag — it starts a dedicated discovery-only session and sends a `list_models` control_request, 20s timeout, failure falls back to a static catalog (`claude_models.go:215-240,274-295`). systemPrompt does **not** go through `--append-system-prompt`; instead the per-task CLAUDE.md is written into the workdir (`claude.go:1112-1115`).

**pi family protocol** (`pi.go`): `pi -p --mode json --session <path> --model <selector> --thinking <level>`, prompt written to stdin then EOF; event stream = stdout JSONL. Session ID = the local session file path itself (`pi.go:376-386`). Discovery is two-stage: `--mode rpc` JSON-RPC first, `--list-models` table fallback.

**claim/dispatch/reclaim all-family shared.** claim = WS-RPC `tasks.claim`, **keyed only by runtime ids** (`daemon.go:5457`); heartbeat one goroutine per runtime id (`daemon.go:4435-4476`); reclaim (RecoverOrphans) per runtime id; dispatch (handleTask) provider-blind up to the runtimeIndex lookup (`daemon.go:5721-5745`). **The family fork all happens after claim**: the execenv/skills injection, MCP merge, `ResolveBackend` inside runTask, and the backend package internals. Both skills and MCP enter the pipeline **before backend resolution** (execenv Prepare/Reuse + `skillsDirPath` written per identity into each family's native directory, `execenv/context.go:328+`).

**Credentials are locally held.** The daemon never reads/uploads each CLI's login token — claude's subscription login and pi's own config stay local on each machine (r10 §8.2). The daemon side has no credential surface.

## Solution

| ID | Decision | Landing shape |
|---|---|---|
| **A1** | Adopt Multica's **fractal**, not its **institution** | Fractal = "identity (vocabulary/record layer) separated from family (execution backend) + fork uniqueness + local credentials". Institution = the 12-field descriptor registry, the 26-CLI probe matrix, the EnvPrefix/LaunchHeader machinery — pacman only has 2 runtimes, pi is in-library consumption not CLI spawn, these institutions have no corresponding problem to solve. The identity layer in pacman = the existing vocabulary constants + the model-source record (MODEL_SOURCE_RUNTIMES / MACHINE_RUNTIMES / agent.provider values), zero new registry |
| **A2** | claude-code backend bridge shape = `@anthropic-ai/claude-agent-sdk` | new `apps/daemon/src/backend/claude-code.ts`, biome noRestrictedImports adds an entry to lock the seam (same rule as `@earendil-works/*` → `backend/pi.ts`). Reasons see the "adoption list" below |
| **A3** | per-step backend resolution, the unique fork point | `MachineLoopOpts.backend` (currently the single-backend injection surface) expands to register/resolve: `agent.provider` hits a runtime-identity vocabulary → the corresponding backend, **everything else (custom provider id / null) always goes to pi** — the default branch unchanged means zero regression. Aligned with Multica's "the fork only inside runTask, claim all-family shared" topology |
| **A4** | claude-code credential semantics = machine-local, zero provider | server `toProviderConfig` returns null for a runtime identity (blocks the `machines.ts:1405` fallback); the runner does not failStep a runtime-identity step over provider null (blocks the `runner.ts:261-266` fallback+intercept); the daemon never reads/passes claude login state (auth = the machine's existing claude login or ANTHROPIC_API_KEY, same rule as Multica §8.2). pi's per-step key channel untouched |
| **A5** | StepEvent vocabulary locked unchanged (01 §5 realized) | claude SDKMessage **maps into** the existing 16-type vocabulary (mapping table sees Implementation Decisions); no add/remove/rename; the STEP_EVENT_TYPES cross-check test maintained |
| **A6** | usage mapping | the SDKResultMessage's `usage`/`modelUsage` → the `ModelUsage` row set (model/input/output/cacheRead/cacheWrite); `total_cost_usd` does not enter the seam (the seam has no cost dimension, no new axis introduced) |
| **A7** | session persistence goes through the existing sessionId channel | handle.sessionId = SDK `session_id`; done echoes step.sessionId (the existing channel); continueSession → SDK `resume`; resume rejection → one cold-session retry (aligned with the existing SessionNotResumableError fallback and Multica's ResumeRejected one-cold-retry). The daemon does not build its own session file (the transcript lives in the CLI's own store, isomorphic to `claude.go:936-972`) |
| **A8** | steer semantics = queue + interrupt (deliberate difference) | the Agent SDK has no mid-stream injection (research-draft conclusion f); `steer(text)` → streamInput queue (consumed next round) + `interrupt()` when needed. pi's steer is mid-stream text injection — the two backends' steer semantics have a known difference, the first ticket documents it without flattening it |
| **A9** | ~~skills injection = catalog append to systemPrompt (same rule as pi)~~ **superseded by spec 24** | original kept: reuse buildSkillsCatalog → append channel, carried by the SDK systemPrompt append shape. **Not adopting** Multica's workdir CLAUDE.md write method (pollutes the worktree git status, pacman worktree discipline forbids it). Native `.claude/skills` discovery goes to a later ticket.<br>**The overturn basis sees `docs/spec/24-run-brief-written-to-worktree-file.md`**: this line's two premises are both void — the two backends **already natively read** the worktree's context file (including a user-repo-carried CLAUDE.md), and git cleanliness has a solution under pacman's mirror-clone layout (Multica's exclude is unusable because its common dir is the user repo). The change lands in `#958` |
| **A10** | MCP / remoteTools / localTools excluded in the first ticket | the landing shape is already fixed: SDK `mcpServers` per query + `createSdkMcpServer` in-process tool callbacks (corresponding to pi's customTool mode). The first ticket does not implement, but the backend **fail-closed** on these opts (explicit "unsupported" rather than silent drop) |
| **A11** | model-discovery direction (G22) untouched in the first ticket | server fs direct-read holds under the "single machine = control surface is execution surface" reality; the daemon reporting the model source (Multica's ListModels identity-layer-first direction) goes to T3. The first ticket's model surface = the current picker select-and-run, SDK `model` verbatim passthrough (same rule as Multica `claude.go:1099-1101`) |
| **A12** | enabledRuntimes not consumed in the first ticket | r11 G7 stays decorative; the claim-eligibility gate + web "runnable/listed-only" distinction goes to T5 |
| **A13** | permission surface = bypassPermissions + readOnly mapping | the daemon non-interactive semantics + worktree isolation are already carried by the host git guardrails (same alignment as Multica's hard pin, `claude.go:1079-1092`). readOnly (review step) → SDK `disallowedTools` collects Edit/Write; thinkingLevel → SDK `effort` (in-domain passthrough, `off`/`minimal` not sent when absent). Out-of-domain values fail-closed, no guessing |

### The adoption list vs Multica

**Adopted (with reasons):**

| Mechanism | Multica evidence | pacman landing spot | Why adopted |
|---|---|---|---|
| the identity/family separation fractal | builtin_runtimes.go:8-17 struct doc | vocabulary constants + AgentBackend implementation | fork uniqueness is the core of maintainability — the argument "adding a runtime is a descriptor/implementation entry, not a whole-stack change" directly holds |
| claim/heartbeat/reclaim all-family shared, fork only at the execution entry | daemon.go:5457/4435/5721/8588 | machine-loop/runner mechanism zero change, fork = backendFor | pacman's machine mechanism (journal/recover/steer/stop/presence) all work above SessionOpts/handle, runtime-agnostic by nature — proves this sharing is structure, not coincidence |
| credentials locally held | r10 §8.2 | A4 zero provider | same direction as pacman's "per-step key in-memory, never on disk" philosophy, and eliminates the whole class of cross-machine token transfer |
| session pointer carried by server-side record | daemon.go:5940/:6265 + types.go:297 | the existing step.sessionId channel | pacman already has an isomorphic channel (sessionRefSchema), zero new contract |
| model verbatim passthrough | claude.go:1099-1101 | SDK `model` direct | no model translation layer introduced, discovery/resolution belong to the CLI |

**Not adopted (with reasons):**

| Mechanism | Why not adopted |
|---|---|
| the 12-field BuiltinRuntime registry | pacman's identity-layer data is already scattered in the existing single sources (MODEL_SOURCE_RUNTIMES / MACHINE_RUNTIMES / the model-source record); re-building a registry = a second vocabulary single source, violating the repo single-source discipline. Re-evaluate when runtime ≥3 or a "same-family multiple identities" (omp shape) appears |
| raw CLI spawn protocol adaptation | Multica's 25 families are engine-agnostic, one argv/stream adapter per family beats one SDK dependency per engine — that is its correct solution. pacman has only 2 runtimes and pi is already **in-library consumption** (the AgentBackend seam's reason to exist), the SDK is the isomorphic extension of pi's consumption mode; and the SDK is a strict superset of the CLI (research-draft capability table a-k fully covered + typed events + in-process tool callbacks), version pinned into the lockfile (spec 01 D6 same rule) rather than depending on the machine's CLI version |
| ~~workdir CLAUDE.md systemPrompt channel~~ **flipped back to adopted by spec 24** | original reason: pollutes the task worktree's git status; the pi backend's systemPromptOverride already validated the channel, the SDK append shape is isomorphic. **That reason's premise is "no solution" — spec 24 gave the solution** (marker block + pre-commit erase + content-based rather than filename-based commit gate), and switching gets the CLI's native memory mechanism and the byte-stable cache prefix (the latter is exactly what staying in systemPrompt cannot do: it recomputes every round) |
| EnvPrefix/LaunchHeader/probe matrix | no 26-CLI management problem; the probe becomes a single SDK liveness check at daemon startup (in passing with T3's model-source report) |
| `mat_` task token / reconnect grace / GC | pacman has its own per-step token/journal/recover (r11 lists them as pacman's own increments, spec 02/08 locked) |

**The SDK shape's boundary conditions (explicit):** ① the SDK carries platform binaries (optional deps, `npm ci --omit=optional` will lack them — CI/install surface note); ② ToS boundary — Anthropic forbids third-party resale of claude.ai login/quota, pacman is self-use single-user self-hosted (the positioning ruling "self-use first"), does not touch this boundary, but if it goes multi-tenant later it must be re-assessed; ③ the closed-source dependency surface widens by one (spec 00 §S3.2 then rejected only the "sole engine", the second-engine backfill is exactly the D1 reserved slot).

## User Stories

1. As a user, I select a Claude Code model in the model selector (e.g. the opus slot), and the task step really executes and produces transcript, token count and session ID — no longer blowing up on the first step with `model claude-code/<x> not found`.
2. As a user, my claude auth (the machine's login or API key) stays local to the machine; pacman's server/daemon neither read, pass nor store it.
3. As a user, on the same machine pi-agent and claude-code-agent tasks run mixed: claim, heartbeat, recovery, steer/stop machine behavior completely identical, the difference only in who executes.
4. As a user, a continued-round task resumes the previous session (claude resume), the session breakpoint carried by the server-recorded sessionId, behavior consistent with pi session continuation.
5. As a reviewer, I see the claude-code review step gets no write-file tool (readOnly effective), the worker step full tools — the two backends' capability surfaces readable on the seam.
6. As a regression tester, I see all existing pi probes fully green after introducing the second backend (zero regression is proven, not claimed).

## Implementation Decisions

### Module change list (T1 minimal closed loop allowlist)

**shared**
- `packages/shared/src/agent-backend.ts`
  - adds `BACKEND_RUNTIME_IDS = ['claude-code'] as const` (the runtime-identity vocabulary for backend selection; note ≠ MODEL_SOURCE_RUNTIMES — pi is also a model source but not a backend identity, a pi agent's provider value is a custom provider id)
- StepEvent / SessionOpts / AgentBackend / handle interfaces **zero change** (A5: vocabulary locked)

**daemon**
- new `apps/daemon/src/backend/claude-code.ts`
  - the sole `@anthropic-ai/claude-agent-sdk` import point; implements `AgentBackend`; capabilities `{name:'claude-code', thinkingLevels:['low','medium','high','xhigh','max'], oauthProviders:[], compaction:true, sessionResume:true}`
  - SDKMessage → StepEvent mapping (the table below); usage mapping (A6); resume (A7); effort/disallowedTools mapping (A13); unsupported opts fail-closed (A10)
- `apps/daemon/src/machine-loop.ts`
  - backend registration and resolution: pi built at startup as before (`:84-101` unchanged), the claude-code backend lazily built (triggered by the first claude-code step, avoiding machines without claude auth carrying an SDK start for nothing); the canon line aligned with the `Loading pi runtime…` convention
- `apps/daemon/src/runner.ts`
  - deps' `backend: AgentBackend` (`:61`) → a resolution function (backendFor(agent.provider)); `:261-266` the credentials section adds a runtime-identity branch: a claude-code step's provider=null is legal, no failStep
- `apps/daemon/package.json` + `pnpm-lock.yaml`
  - the `@anthropic-ai/claude-agent-sdk` dependency (legitimate lockfile diff, goes through the lockfile-gate authorization flow; do not `--omit=optional` — the platform binaries are optional deps)
- `biome.json`
  - noRestrictedImports adds `@anthropic-ai/claude-agent-sdk` → `apps/daemon/src/backend/claude-code.ts` (seam discipline 01 §5/§7.3 same rule)

**server**
- `apps/server/src/services/machines.ts`
  - `toProviderConfig` (the `:1405` fallback) returns null for a runtime identity — no longer fabricating an api_key config out of nothing

**web**
- the first ticket **zero change** (claude-code models already selectable in the picker; from "selectable-means-blow-up" to "selectable-means-runs"). The machine-level runnable/listed distinction goes to T5

### Data contracts

- ClaimedStep / machineTokenResponse **zero new fields**: a claude-code step's `provider` slot = null (A4), the `agent.provider` string itself carries the identity ('claude-code' ∈ BACKEND_RUNTIME_IDS)
- Session: `session.sessionId` carries the SDK session_id (A7, the existing channel)
- Model: `agent.modelId` verbatim → SDK `model` (A11)
- Todo list (#1524 [designed]): each runtime maps its own todo shape into pacman's unified format (`packages/shared/src/agent-todo.ts` single source, three-state todo/doing/done + whole-table replacement semantics) — claude-code = `TodoWrite` tool_use argument (content + status pending/in_progress/completed) mapping, the projection hangs on the call line's `todo` bit; pi = body text `- [ ]` line-grammar parsing (the line grammar and the web TaskCard share the same regex single source). The daemon reports the whole table through the `tool/{stepId}` seventh shape, the server gavels {stepId, at} then enters the conversation-stream agent_todo event (transient, not stored).

### Event mapping table (SDKMessage → StepEvent, vocabulary 01 §5 locked)

| SDK surface | StepEvent | Note |
|---|---|---|
| `stream_event` content_block_delta (text_delta) | `text_delta` | needs `includePartialMessages: true` |
| thinking block (delta / block end) | `thinking_delta` / `thinking` | the thinking full text at block end (aligned with the vocabulary semantics) |
| the assistant frame's tool_use block | `toolcall_end` (call) | result field: backfilled by the later user frame tool_result, must exist in the final draft; the `TodoWrite` call line also carries the pacman todo projection `todo` bit (#1524) |
| assistant frame end | `message_end` (message) | messageRecord projection (message_update synthesized from the incremental surface) |
| `SDKCompactBoundaryMessage` | `compaction` / `compaction_start` / `compaction_end` | |
| `SDKAPIRetryMessage` | `auto_retry_start` / `auto_retry_end` | |
| `SDKResultMessage` (subtype=success) | `done` (usage) | usage → the AgentTokenUsage row set |
| `SDKResultMessage` (subtype=error_*) / `interrupt` | `error` (retryable judgment) / `message_stop` | |
| `SDKSystemMessage` (init) | does not enter the event surface | session_id into handle (A7) |
| other SDKMessage members | do not enter the event surface | status/hook/log classes have no vocabulary counterpart, silently uncounted |

### Ticket draft table

| Ticket | Content | blocking |
|---|---|---|
| T1 | claude-code backend minimal closed loop (the full text of the next section) | — |
| T2 | capability-surface closure: thinkingLevels declared per backend (web tier validation per runtime), readOnly mapping, steer queue+interrupt implementation, fail-closed surface fold-in | T1 |
| T3 | model-discovery direction fix (G22): the daemon reports the claude-code model source (liveness + settings slots), the model-sources contract switches from server-fs to machine-reported | T1 |
| T4 | MCP + remoteTools/localTools: SDK mcpServers + createSdkMcpServer in-process callbacks (corresponding to the pi customTool channel) | T1 |
| T5 | enabledRuntimes real gate: claim eligibility (server filters by machine) + web "runnable/listed-only" distinction | T1, T3 |

T2-T5 mutually non-blocking, parallel schedulable.

### First execution-ticket draft (T1, full text)

**Ticket name**: `daemon(claude-code): second runtime minimal closed loop — SDK bridge, per-step resolution, zero-credential channel`

**Verifiable closed-loop target**: on the verify stack, an agent with `provider='claude-code'` runs through one worker step: claim → claude backend execution → transcript emits text/toolcall rows → done carries usage → the step completed, sessionId echoed; the second step resumes the session by that sessionId (resume effective). On the same stack all existing pi probes green (zero regression).

**Whitelist change territory** (out of bounds means split the ticket):
- new `apps/daemon/src/backend/claude-code.ts`
- `biome.json` (one noRestrictedImports entry)
- `apps/daemon/src/machine-loop.ts`, `apps/daemon/src/runner.ts` (the A3/A4 resolution and credentials branches)
- `apps/server/src/services/machines.ts` (the toProviderConfig runtime-identity branch)
- `packages/shared/src/agent-backend.ts` (the BACKEND_RUNTIME_IDS constant)
- `apps/daemon/package.json` + `pnpm-lock.yaml` (the SDK dependency)
- `.claude/skills/verify-pacman/` (features + probe scripts expand the claude-code surface)
- **explicitly not changed**: any web file, the StepEvent vocabulary, `backend/pi.ts` internals, spec 02 event surface, the chief chain (the remoteTools surface fail-closed unsupported)

**List failure modes before implementation** (repo test rule 3):
1. SDK platform binary missing (`--omit=optional` install / platform mismatch) → backend construction reports "Native CLI binary not found" → the probe pre-asserts the backend is constructible
2. claude auth missing (the verify stack's synthetic HOME switched away the login state) → the first query fails → probe environment contract: the claude-code surface runs under a real HOME (or ANTHROPIC_API_KEY), the script states it (the t-0024 measured trap)
3. the resolver's default branch broken → the pi agent step goes to the wrong backend → the branch test pins "non-runtime identity always pi" + pi probe regression
4. the server/runner credentials fallback missed one side → the claude-code step still blows up `no agent/model` → both branches land in the same ticket + the failure message carries the runtime wording
5. the event mapping drips outside the vocabulary → the vocabulary cross-check test red → the mapping table goes into the test
6. resume rejected (CLI session store empty / machine change) → one cold-session retry, then still failing = step fails with reason (aligned with the SessionNotResumableError current behavior)
7. steer typed into a claude session → first-ticket semantics = queued next round (no interrupt implementation before T2 closure), observable in the transcript

**Acceptance** (verify-pacman probe caliber, evidence into `docs/verify/<ticket>/`):
- claude-code worker-step full-chain probe: transcript JSON (text + done.usage) + step status completed + sessionId non-empty; resume probe: second-step transcript continuation evidence
- pi regression: the existing feature-map related probes all green
- the local three gates (lint/format/typecheck) + the relevant e2e entries (never the full set during development)
- evidence committed to the task branch `docs/verify/<ticket>/`, the PR body cites the raw SHA links

## Blast Radius

**What the change is**: a design ticket — product code zero change; at T1 landing the daemon adds the second backend + two credentials branches + one seam lint entry.

**The one fact the whole case's safety depends on**: **the backend resolution's default branch unchanged** — when `agent.provider` does not hit `BACKEND_RUNTIME_IDS` (i.e. all existing pi agents: custom provider id or null), the backend taken, the provider config obtained, and the failStep judgment entered are byte-for-byte identical to today. The design phase proves it to tier 3 (code walk-through): the runner's credentials branch only short-circuits runtime identities (`runner.ts:261-266` current behavior for a pi agent is `creds.provider ?? {kind:'api_key', providerId}`, and after the change the non-runtime-identity expression stays verbatim); server `machines.ts:1405` fallback only excludes runtime-identity values; machine-loop `:84-101` pi backend construction untouched. Tier 4/5 proof (run real code) = T1's pi regression probe — which is exactly why the ticket lists it as acceptance.

**Risks** (confirmed kept):
- **fail-open rather than fail-closed**: the backend silently dropping unsupported opts (remoteTools/MCP) would quietly degrade the chief chain. Mitigation: A10 fail-closed error from the first ticket. Low probability (new code new branch), medium cost (silent behavior drift).
- **SDK dependency surface**: platform binaries optional deps + closed source + version follows the CLI (the SDK version number pins the bundle's CLI version). Mitigation: lockfile pin (D6 same rule) + the upgrade-window discipline continues pi's experience. Medium probability, low cost (missing binary = report at start, no silence).
- **steer semantic fork** (A8): pi mid-stream injection vs claude queue-next-round, the user sees no difference explanation in the UI. Mitigation: T2 closure + doc made explicit. High probability (inevitable), low cost (behavior still correct, only the timing differs).
- **verify-stack auth trap**: the synthetic HOME switching away claude login → probe false red. Mitigation: T1 failure-mode 2's environment contract. High probability (t-0024 measured the same kind), low cost (surfaces during probe, never enters the product).

**Checked and cleared**:
- claim/journal/recover/steer/stop/heartbeat/transcript/git wrap-up — all consume SessionOpts/AgentSessionHandle/StepEvent, the backend implementation replacement does not affect them (the seam's reason to exist, `agent-backend.ts:220-227`); machine-loop `:41` is already an injection surface
- the Multica-side comparison (claim all-family shared, fork unique) fresh-clone verified, not r10 relay
- the vocabulary surface adds no second single source: BACKEND_RUNTIME_IDS only collects backend identities ('claude-code'), semantically separate from MODEL_SOURCE_RUNTIMES (incl. pi), each its own single source

**The cheapest catch before merge**: T1's two probes — the claude-code step closed loop (red = the new backend broken) + the existing pi probes (red = the default branch broken).

## Verification

- The design ticket itself: each of the three questions has a line-by-line evidence chain (the verification draft + this repo's file:line), each adoption-list row carries its reason
- T1 onward each ticket: verify-pacman probe evidence into `docs/verify/<ticket>/` (transcript JSON + probe logs + screenshots), the PR body cites the raw SHA links; the local three gates + the relevant e2e (never the full set); no new i18n copy (web zero change) so the CI dictionary gate not triggered
- pi zero regression as each ticket's fixed acceptance item (the blast radius's runtime proof)