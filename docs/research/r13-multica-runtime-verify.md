# r13 · Multica dual-runtime mechanism verification (fresh clone, 2026-10-02)

> Purpose: provide spec 17 (dual-runtime execution surface) with a fresh-clone re-review of r10's conclusions (docs/research/r10-multica-runtime.md) — the two-layer model, the claude/pi family backends, and the dispatch path, item by item with path:line evidence; two of r10's older conclusions were corrected (BuiltinRuntime has 12 fields, not 9; the families that do not consume opts.McpConfig are 6, not 4). Verification method: shallow clone, read the source in full, no secondhand paraphrasing.

Cloned HEAD: `2ea01ae4ef55de4310b99af192d2dbd367832883` (2026-10-01 18:18:24 +0800, "docs(changelog): add v0.6.1 release entry"), shallow clone of github.com/multica-ai/multica at /tmp/multica-src-t0028.
Drift vs prior verification (43b0571f992567a919c7f1f699ff160922594b94, 2026-09-29): two days of commits; the structures verified below (BuiltinRuntime, BuiltinRuntimes registry, Backend interface, claude/pi backends, dispatch path) are all still present and the registry still holds exactly one entry. File/line references below are to the 2ea01ae clone.

## A. Two-layer model — server/pkg/agent/builtin_runtimes.go

### BuiltinRuntime struct — full field set (builtin_runtimes.go:18-70)

Fields, each with its doc-comment meaning (path:builtin_runtimes.go):

- `ID string` (:22-24) — "the provider key the daemon registers under (e.g. "omp"). It is NOT a protocol_family — it does not appear in SupportedTypes or the runtime_profile.protocol_family CHECK constraint." → **identity layer key**.
- `ProtocolFamily string` (:26-28) — "the execution backend this runtime dispatches to. It MUST be in SupportedTypes. NewRuntime builds that family's backend via New(), then applies this descriptor's ID-specific defaults (executable, label) to it." → **family layer key**.
- `DefaultCommand string` (:30-32) — "the bare CLI name the probe looks up on PATH when MULTICA_<ID>_PATH is not set".
- `EnvPrefix string` (:34-35) — "the MULTICA_ prefix for *_PATH and *_MODEL env overrides".
- `DisplayName string` (:37-39) — "human-facing runtime name. The daemon and frontend both use this so they never drift apart."
- `SkillsDir string` (:41-43) — "project-level skills directory relative to the workdir (e.g. ".omp/skills")".
- `UserSkillsDir string` (:46-48) — "user-level skills directory relative to $HOME (e.g. ".omp/agent/skills")".
- `LaunchHeader string` (:50-52) — "user-visible launch skeleton shown in the UI".
- `DefaultExecutable string` (:54-56) — "binary name the backend falls back to when cfg.ExecutablePath is empty (passed to piBackend.defaultExecutable)". **Note: this field was NOT in the task's candidate list — the exact set is the 12 fields here, not 9.**
- `ProviderLabel string` (:58-60) — "label used in log/error messages (passed to piBackend.providerLabel)". **Also not in the candidate list.**
- `ModelDiscovery ModelDiscoveryFunc` (:62-69) — "strategy for discovering available models. When set, it replaces the protocol family's discovery entirely… When nil, ListModels returns an empty catalog rather than falling back to the family's command."

The struct doc (:8-17) states the two-layer thesis directly: "Multiple runtime identities can share one protocol family (e.g. both "pi" and "omp" use the "pi" protocol backend)" and "The descriptor is the single declaration site for a runtime identity: agents_probe.go, config.go, daemon.go display-name overrides, execenv skill/config paths, local_skills.go, ListModels, and the frontend display maps all derive from this. Adding a new compatible fork of an existing runtime is a descriptor entry, not a cross-stack change."

`ModelDiscoveryFunc` = `func(ctx context.Context, runtimeCmd Command) ([]Model, error)` (:72-76).

### BuiltinRuntimes registry — exactly one entry: `omp` (builtin_runtimes.go:86-100)

Prior report said "only omp" — **confirmed unchanged**: the single entry is ID "omp", ProtocolFamily "pi", DefaultCommand "omp", EnvPrefix "MULTICA_OMP", DisplayName "Oh-My-Pi", SkillsDir ".omp/skills", UserSkillsDir ".omp/agent/skills", LaunchHeader "omp (json mode)", DefaultExecutable "omp", ProviderLabel "omp", ModelDiscovery discoverOmpModels. The registry doc (:78-85) explains membership: entries are "protocol-family derivatives, not families themselves", probed independently and dispatched to their family's backend.

Helpers: `BuiltinRuntimeByID(id)` (:104-111), `IsBuiltinRuntime(id)` (:115-118), `BuiltinRuntimeCommands()` (:122-128), plus `backendOverrideApplicator` interface (:135-137) and the `piBackend` implementation `applyBuiltinRuntimeOverrides` (:142-145) which sets `b.defaultExecutable = desc.DefaultExecutable; b.providerLabel = desc.ProviderLabel`.

### ResolveBackend — dispatches on identity vs family (builtin_runtimes.go:147-158)

```go
func ResolveBackend(provider string, cfg Config) (Backend, error) {
	if IsBuiltinRuntime(provider) {
		return NewRuntime(provider, cfg)
	}
	return New(provider, cfg)
}
```
Doc: "the single production entry point the daemon uses to construct a backend from a provider key… New() is family-only, NewRuntime() is runtime-identity-only, and the daemon never has to know which is which."

### NewRuntime (builtin_runtimes.go:160-186)

Looks up the descriptor; sets `cfg.provider = runtimeID` (so the backend logs under the identity, not the family); calls `New(desc.ProtocolFamily, cfg)`; then requires the returned Backend to implement `backendOverrideApplicator` — **fails closed** with an error if the family backend cannot host runtime identities (:180-183) rather than "handing back a backend with the overrides silently dropped"; finally applies the overrides (:184).

### ProfileRuntimeType / RuntimeProtocolFamily (builtin_runtimes.go:188-203)

- `ProfileRuntimeType(runtimeType, protocolFamily string)` — "preserves profiles authored before runtime identity was stored": returns runtimeType if non-empty, else protocolFamily (:189-194). Used by the runtime-profile API and daemon registration to derive the effective provider (handler/runtime_profile.go:64,157; handler/daemon.go:515,545,706; daemon/daemon.go:3083,3213).
- `RuntimeProtocolFamily(runtimeType string) (string, bool)` — "resolves the compatibility target using the same registry as backend construction and model discovery": a builtin runtime resolves to its descriptor's ProtocolFamily; anything else returns `(runtimeType, IsSupportedType(runtimeType))` (:198-203). Used to validate a profile's protocol family (cmd/multica/cmd_runtime_profile.go:176; handler/runtime_profile.go:158; daemon/daemon.go:3089).

## B. Family backend abstraction

### What family backends implement — the `Backend` interface (agent/agent.go:17-23)

```go
type Backend interface {
	// Execute runs a prompt and returns a Session for streaming results.
	// The caller should read from Session.Messages (optional) and wait on
	// Session.Result for the final outcome.
	Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error)
}
```
**The interface has exactly ONE method: `Execute`.** It is not a family-specific interface — every backend (claude, pi, codex, …) implements this same one-method contract; the family difference lives entirely in each `*Backend` struct's private implementation. `New(agentType string, cfg Config) (Backend, error)` (agent.go:432-498) is the constructor: a plain switch over the family key returning `&claudeBackend{cfg: cfg}` (:447-448), `&piBackend{cfg: cfg}` (:465-466), etc., for all 25 SupportedTypes (agent.go:364-390). New also defaults `cfg.provider = agentType` and filters `cfg.LaunchPrefix` once at the boundary (:436-444).

The richer per-backend surface is opt-in via the `Session` struct (agent.go:152-197): `Supplement`, `SupplementReady`, `ToolActivity`, `InterruptBackgroundTools`, `TerminalObserved` (all function fields, nil = not offered), `Messages <-chan Message`, `Result <-ch Result`. Unified `Message` types: text/thinking/tool-use/tool-result/status/error/log (agent.go:202-210). `Result` (agent.go:253-306) carries Status/Output/Error/DurationMs/SessionID/Usage + resume-rejection booleans. `ExecOptions` (agent.go:26-136) is the whole per-run contract (Cwd, Model, SystemPrompt, timeouts, ResumeSessionID, ExtraArgs/CustomArgs, McpConfig, ThinkingLevel, ServiceTier, OpenclawMode, ClaudeSettingsPath, …).

### How the daemon holds backend instances: **per run**

`agent.ResolveBackend(provider, agent.Config{...})` is called exactly once in the daemon, inside `runTask` (server/internal/daemon/daemon.go:8588-8599, comment at :8583-8587: "the daemon never calls agent.New or agent.NewRuntime directly"). The `backend` value is a local variable of `runTask`, used for the first `executeAndDrain` (:8775) and reused for the in-run fresh-session retry (:8831); it dies when the task returns. There is no backend cache on the Daemon struct (grep for a backend map finds none; the only other `agent.Backend` reference is executeAndDrain's parameter, daemon.go:9286). So: constructed **per claimed task/run**, never per-runtime-cached, never a process-wide singleton.

## C. claude family backend — server/pkg/agent/claude.go

### Exact launch command line (claude.go:1078-1136, `buildClaudeArgs`)

Base argv (:1079-1092): `claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --disallowedTools AskUserQuestion`. Conditional flags: `--strict-mcp-config` when a managed MCP config exists (:1093-1098); `--model <opts.Model>` when non-empty (:1099-1101); `--effort <opts.ThinkingLevel>` when set, "slotted right after --model" (:1102-1108); `--max-turns <n>` when MaxTurns > 0 (:1109-1111); `--resume <opts.ResumeSessionID>` when resuming (:1116-1118); filtered ExtraArgs then CustomArgs (:1130-1131); `--settings <opts.ClaudeSettingsPath>` last when set (:1132-1134). Blocked-args guard `claudeBlockedArgs` (:1063-1076) hard-pins `-p`, `--output-format`, `--input-format`, `--permission-mode`, `--mcp-config`, `--effort` so user custom_args cannot break the protocol. SystemPrompt is deliberately NOT forwarded as `--append-system-prompt` — Claude Code loads the per-task CLAUDE.md the daemon writes in the workdir (:1112-1115).

**Prompt delivery: stdin, not argv.** `writeClaudeInput`/`buildClaudeInput` (claude.go:1138-1167) writes one JSON line — `{"type":"user","message":{"role":"user","content":[{"type":"text","text":<prompt>}]}}` + `\n` — to the child's stdin pipe and keeps stdin open afterwards (comment :164-168: the stream-json protocol emits `control_request` mid-run and expects `control_response` frames on the same stream). The write runs in its own goroutine to avoid the stdout/stdin pipe deadlock (:155-185). Binary: `b.cfg.ExecutablePath`, falling back to `"claude"` (:43-46); exec via `b.cfg.commandAt(execPath).exec(runCtx, args...)` (:78) with `cmd.Dir = opts.Cwd` (:88-90).

### Communication protocol — stream-json frames on stdin/stdout

Stdout carries newline-delimited JSON `claudeSDKMessage` events parsed in the scanner loop (claude.go:248-328). Event types handled: `"assistant"` (text/tool_use content, usage, → handleAssistant), `"user"` (tool_result / async-launch detection), `"system"` (init subtype carries `session_id`; → MessageStatus "running" + SessionID pinning, :274-278), `"result"` (terminal: `result` text, `is_error`, `terminal_reason`, `usage`/`modelUsage`, `session_id`, :279-294), `"log"` (:295-302), `"control_request"` (mid-run control protocol — answered on stdin, possibly by the supplement session, :303-322), `"control_response"` (:323-326). Wire struct fields at :646-673 (type, message, subtype, session_id, model, result, is_error, terminal_reason, duration_ms, num_turns, usage, modelUsage, log, request_id, request, response). The `result` event's `terminal_reason` `prompt_too_long` is turned into a context-overflow failure (claudeTerminalReasonFailure, :722-732). Cancellation: SIGTERM→grace→SIGKILL of the whole process group with stdin EOF first (:214-244).

### Session resume — session id flag, transcript in the CLI's own store

- **Flag**: `--resume <id>` (claude.go:1116-1118) from `opts.ResumeSessionID`.
- **Where the session lives**: Claude Code's own transcript store — `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<project-slug>/<sessionID>.jsonl` (`findClaudeSessionFile`, claude.go:936-972; config-dir resolution `claudeConfigDir`, :883-899). The daemon-side reader exists to snapshot usage baselines on resume (`captureClaudeUsageSnapshot`, :834-862, invoked at :97-105) and to reconcile final usage (:364-372).
- **Pointer lifecycle (daemon side)**: the backend scrapes `session_id` from `system`/`result` events (:275-284) and returns it in `Result.SessionID` (:443-451); `runTask` copies it into `TaskResult.SessionID` (daemon.go:8914/8934/8944/8969/8988/9003); `handleTask` reports it via `reportTaskResult` → CompleteTask/FailTask (daemon.go:5940, :6246-6303, sessionID at :6265/:6303) and the server stores it on the task row (`TaskResult.SessionID` doc, types.go:297 "Claude session ID for future resumption"). Mid-run, `executeAndDrain` pins the session as soon as a Status message reveals it (`PinTaskSession`, daemon.go:9558-9583) so a daemon crash keeps the resume pointer. On the next task for the same (agent, issue), the claim handler resolves the prior session with `GetLastTaskSession` and sets `resp.PriorSessionID` (server/internal/handler/daemon.go:2953-2967), which arrives as `task.PriorSessionID` (daemon/types.go:111) and flows to `execOpts.ResumeSessionID` (daemon.go:8681).
- **Resume rejection**: `resumeWasRejected` + `resolveSessionID` (claude.go:427-441) — stderr/result-text phrase match ("no conversation found", account-binding 400; phrases at :1178-1189); a rejected resume drops the id and sets `Result.ResumeRejected` so the daemon's `shouldRetryWithFreshSession` (daemon.go:9129) retries cold once (:8789-8847).

### Model selection

`opts.Model` → `--model <model>` verbatim (claude.go:1099-1101). On the daemon side the value is `task.Agent.Model` else `entry.Model` (the `MULTICA_<PROVIDER>_MODEL` tier) else "" — deliberately passed through empty so the CLI picks its own default (daemon.go:8604-8624); `resolveTaskModelSelection` (daemon.go:7530, called at :8661-8663) then validates thinking-level against the discovered catalog. Multica persists the **resolved** model id (`claudeModelID`, claude_models.go:410-417: ResolvedModel, falling back to the picker token).

### Model discovery — claude_models.go, end to end

Claude Code has **no `--list-models` flag**; discovery rides the stream-json control protocol (header comment, claude_models.go:13-52):

1. `ListModels("claude", …)` (models.go:212-215, cached via `cachedDiscovery`) → `discoverClaudeCatalog` (claude_models.go:215-240): detect CLI version (`DetectVersion`, :222), build capability key {command, cliVersion} (:120-123), skip the probe if the binary is memoised as unsupported (TTL 10 min, :125-157); otherwise call `discoverClaudeModels` (:252-272).
2. `runClaudeListModels` (:274-295): spawn `claude --print --verbose --input-format stream-json --output-format stream-json --strict-mcp-config` (argv pinned as package var `claudeListModelsArgs`, :69-75; `--strict-mcp-config` with no `--mcp-config` = no MCP servers booted, :60-64), write ONE control request on stdin — `{"type":"control_request","request_id":"multica-list-models","request":{"subtype":"list_models"}}` + `\n` (:278-292), stdin from a strings.Reader so EOF ends the session and the CLI exits on its own; 20s timeout (`claudeListModelsTimeout`, :82-91).
3. `parseClaudeModelCatalog` (:303-334): scan stdout lines for a `control_response` with matching `request_id`; `subtype != "success"` → error; the "Unsupported control request subtype" marker (verified on 2.1.223/2.1.258, :104-113) yields `errClaudeListModelsUnsupported` so the negative memo engages.
4. Rows (`claudeModelInfo`: value/resolvedModel/displayName/description/supportsEffort/supportedEffortLevels/disabled, :174-182) are projected by `claudeModelsFromInfos` (:345-408): keyed by **ResolvedModel** (two tokens can resolve to one model, e.g. `default` and `opus[1m]`), disabled rows become `UnavailableModel` with the CLI's remedy as Reason, the `default` row is folded into a `Default` flag rather than a pick, and per-model effort levels come from the row itself (:434-456).
5. Fallback: any failure → `claudeStaticCatalog` (:242-246) — the hand-maintained static list flagged `Fallback: true` so the server does not cache it (MUL-5549).

## D. pi family backend — server/pkg/agent/pi.go

### Exact launch command — plain CLI args + JSON event stream (NOT ACP)

`buildPiArgs` (pi.go:993-1029): `pi -p --mode json [--session <path>] [--model <selector>] [--thinking <level>] …filtered custom args`. The file header is explicit: "piBackend implements Backend by spawning the Pi CLI in non-interactive JSON mode (`pi -p --mode json --session <path>`) and parsing its event stream on stdout" (pi.go:19-21). **The command is built in `buildPiArgs` (pi.go:993) and invoked via `b.cfg.commandAt(execName).execVia(processCtx, choosePiInvocation, lookedUp, args, b.cfg.Logger)` at pi.go:405.** No ACP, no JSON-RPC for task runs. Blocked args pin `-p`, `--print`, `--mode`, `--session`, `--thinking` (piBlockedArgs, pi.go:914-920). The prompt is **stdin to EOF** (pi.go:421-435 write + close, comment :490-496) — deliberately off argv to dodge the Windows npm PowerShell shim re-tokenisation (#6457) and the systemd EOF wait (#2188). The same `piBackend` also backs omp via `defaultExecutable`/`providerLabel` overrides (pi.go:23-40).

### Sessions and resume — local session file paths

`piSessionDir()` = `$HOME/.multica/pi-sessions` (pi.go:1094-1100); new sessions get `<UTC-timestamp>.jsonl` names (newPiSessionPath, :1102-1109). "Pi's --session flag expects a file path where events are appended. The path doubles as our opaque session identifier: we return it as SessionID and expect it back as ResumeSessionID on the next turn" (pi.go:376-386). The file is created upfront (`ensurePiSessionFile`, :1111-1123 — Pi refuses a missing path) and guarded by an exclusive file lock (`tryLockPiSessionFile`, :390-399): a busy resume returns `ResumeRejectedTransient` (piSessionBusyResult, :753-764). Resume refusal detection is a stderr phrase match: "Stored session working directory does not exist" (piResumeRefusedMarker, :766-822) — Pi re-anchors a resumed run to the cwd recorded in the session header and exits 1 before any JSON event when it is gone. The daemon additionally pre-gates pi resumes before launch: `providerUsesPiSessionFile`/`piSessionResumable`/`piSessionCwdPresent` (daemon.go:6605-6630, 6680-6720) mirror Pi's own startup check. **r10's "pi stores local session file paths" — confirmed: the SessionID persisted server-side IS the absolute file path, not an opaque id (Result.SessionID = sessionPath, pi.go:736).**

### Model discovery for pi — two-phase, RPC first (models.go:1020-1248)

`ListModels("pi", …)` (models.go:278-281) → `discoverPiModels` (models.go:1025-1027): phase 1 `discoverPiModelsRPC` (:1056-1146) spawns `pi --mode rpc --no-session --no-skills --no-prompt-templates --no-context-files` (argv :1057-1066; extensions stay enabled because they can register providers, :1060-1063), writes two JSON requests on stdin — `{"id":"multica-state","type":"get_state"}` and `{"id":"multica-models","type":"get_available_models"}` (:1088-1098) — and reads `{"type":"response","id":…,"success":…,"data":…}` frames back (:1107-1132); RPC budget 7s, table budget 8s (split of the 15s discovery window, :995-996, :1037-1049). Rows carry per-model reasoning metadata (`piModelsFromRPC`, :1148-1181; thinking levels :1183-1206). Phase 2 fallback `discoverPiModelsTable` (:1224-1248): runs plain `pi --list-models` (models.go:1233) and parses the human-readable table from stdout-or-stderr (`parsePiModels`, :1255+). So `--list-models` still exists but is the **legacy fallback**, not the primary channel. omp's discovery is its own command: `omp models --json` (`discoverOmpModels`, models.go:1360-1378) because omp rejects `--list-models`.

### Does pi consume opts.McpConfig? — **No**

`pi.go` contains zero references to `McpConfig` (grep over the file returns nothing; `buildPiArgs` takes only sessionPath/opts/logger, pi.go:993). Pi gets its MCP servers the way it gets everything else — its own config/extensions — and the daemon does not write a managed MCP config into the pi run. (For contrast, backends that DO read `opts.McpConfig` today: claude, codebuddy, codex, codearts, dim, dsh, grok, hermes, kimi, kiro, mcode, opencode (v1+v2), qoder, qwen, qwenpaw, reasonix, traecli, zeroclaw — grep hit list over server/pkg/agent/*.go. Families with no `McpConfig` reference: **pi**, cursor, antigravity, copilot, openclaw, deveco — six at this HEAD, not four as r10 said; cursor/openclaw receive MCP via workdir files written by execenv instead, e.g. `.cursor/mcp.json` daemon.go:8517-8523, openclaw config wrapper daemon.go:8524-8531.)

## E. Run dispatch path — claim/dispatch is shared across families

### The hop-by-hop trace

1. **Claim (family-agnostic)**: `pollLoop` (daemon.go:5348) supervises `runBatchPoller` (:5406) — one machine-level batch poller across ALL runtimes; each cycle acquires free task slots, then `claimTasksWSFirst(pollerCtx, daemonID, runtimeIDs, len(slots))` (:5457). That claim (wsrpc.go:320-380) is WS-RPC `tasks.claim` with `{daemon_id, runtime_ids, max_tasks}` — keyed by **runtime ids, never by provider/family** — with HTTP batch and legacy per-runtime claim as fallbacks.
2. **Dispatch**: each claimed task is dispatched `go d.handleTask(parentCtx, t, slot)` (daemon.go:5495-5508). `handleTask` (:5721) looks up the runtime in `d.runtimeIndex[task.RuntimeID]` and takes `provider := rt.Provider` (:5723-5745) — the only place provider identity enters, and it is a lookup, not a fork. It sets up cancellation polling and calls `d.runner.run(runCtx, task, provider, slot, taskLog)` (:5845); `d.runner` is `taskRunnerFunc(d.runTask)` (daemon.go:666, 764).
3. **Backend resolution**: inside `runTask` (:7663) — validate identity (:7670), resolve executable (built-in entry or custom profile, :7707-7752), `ensureTaskSkillBundles` (:7757), build taskCtx (:7772), reuse or prepare the execution environment (:8088 reuse / :8223-8235 prepare), StartTask server transition (:8400), then **`agent.ResolveBackend(provider, agent.Config{...})`** (daemon.go:8588-8599) — the single production boundary, with the comment that the daemon never calls agent.New/NewRuntime directly (:8583-8587).
4. **Process launch**: runTask builds `agent.ExecOptions` (:8669-8703, McpConfig at :8697, ResumeSessionID at :8681) and calls `d.executeAndDrain(ctx, backend, prompt, execOpts, …)` (:8775); executeAndDrain (daemon.go:9286+) calls **`backend.Execute(agentCtx, prompt, opts)`** (:9296) — from here the family backend owns the process (claude.go:78 / pi.go:405).
5. **Event stream**: executeAndDrain's drain goroutine reads the unified `session.Messages` channel and forwards batches to the server (`ReportTaskMessages`, :9448-9475, 500ms ticker), counting tools, pinning the session id on the first Status message with one (`PinTaskSession`, :9558-9583), running the idle watchdog and terminal-observed hand-off (:9404-9411, 9705-9780).
6. **Run end**: executeAndDrain returns on `session.Result` (:9755-9766); runTask maps `result.Status` to `TaskResult` (completed/blocked/timeout/…, :8900-9003, SessionID at :8934 etc.), optionally performs the single fresh-session retry (:8789-8847); handleTask reports the terminal state (`reportTaskResult` → CompleteTask/FailTask, :5940; reportTerminalTask for errors, :5901-5908), reports usage (:5858-5861), and writes GC metadata (:5961-5980).

### Is claim/heartbeat/reclaim/dispatch family-agnostic?

**Yes, structurally.** Claim: `tasks.claim` keyed by runtime_ids only (wsrpc.go:349-354). Heartbeat: `heartbeatLoop` supervises one goroutine per **runtime id** (`d.allRuntimeIDs()`, daemon.go:4435-4476) — no provider branch. Reclaim: `RecoverOrphans(ctx, rid)` per runtime id on re-register and offline sweep (daemon.go:1977, 4385). Dispatch: `handleTask` is provider-blind until the runtimeIndex lookup. **The forking by family/provider happens only downstream of the claim**, inside runTask and the backend package: environment preparation and skills dirs are per-provider (execenv/context.go:328+ `skillsDirPath` switch; openclaw/codex/hermes/reasonix/dsh env vars, daemon.go:8504-8567), the MCP merge `mergeRuntimeAndAgentMcpConfig(provider, …)` forks by provider (daemon.go:7928), the supplement capability `agent.SupportsTaskSupplement(provider, resolvedVersion)` (daemon.go:8395), the opencode/codearts idle-watchdog override (daemon.go:8666-8668), `shouldRetryWithFreshSession` consults the provider (daemon.go:9129), and of course `New`'s family switch (agent.go:446-497). Nothing in claim/heartbeat/reclaim itself reads the provider.

### Where skills injection and MCP config enter — **before backend resolution**

Skills: `ensureTaskSkillBundles` (daemon.go:7757-760) and the whole execenv Prepare/Reuse phase (:8088-8235) — which writes skills into the provider-native directory via `skillsDirPath(workDir, provider)` (execenv/context.go:316-321, 328+) and injects the runtime brief `execenv.InjectRuntimeConfig(env.WorkDir, provider, taskCtx)` (:8435-8438) — all run BEFORE `agent.ResolveBackend` at :8588. MCP: `effectiveMcpConfig` is assembled in runTask from the agent's saved config + runtime-level merge + remote-MCP brokers + plugin hooks (daemon.go:7879-7946), then consumed in two places, both around-but-before/at the backend: passed into execenv Prepare/Reuse params so file-based runtimes get workdir config files (:8099, :8149), and handed to the backend afterwards as `execOpts.McpConfig` (:8697) — backends that speak `--mcp-config` (claude: claude.go:61-70) write it to a temp file; pi ignores it entirely (see D).

## F. Model discovery dispatch overall — models.go ListModels

`ListModels(ctx, providerType, runtimeCmd)` (models.go:195-335) forks in exactly two layers, mirroring the backend's two layers:

1. **Identity layer first** (models.go:203-210): if `BuiltinRuntimeByID(providerType)` hits, the descriptor's `ModelDiscovery` func is used (via `cachedDiscovery`); if the descriptor has none, an **empty catalog** is returned — deliberately NOT the family's command, because "running a semantically incompatible discovery command (e.g. omp rejecting --list-models) is worse than degrading to manual entry" (models.go:196-202).
2. **Family layer second** (models.go:211-334): a switch over the protocol family — claude → `discoverClaudeCatalog` (with static fallback), codex → `discoverCodexCatalog`, pi → `discoverPiModels` (RPC + `--list-models` table), plus antigravity/traecli/cursor/copilot/hermes/kimi/reasonix/dsh/kiro/qoder/opencode/codearts/deveco/openclaw/codebuddy/grok/dim with their own discoverers, and qwen/qwenpaw/mcode/zeroclaw returning intentionally empty catalogs (:293-331). Every dynamic path is memoised by `cachedDiscovery` with a 60s TTL (models.go:163-176) and a cache key including the runtime command (`discoveryCacheKey`), so a custom profile's fixed_args are carried into discovery subprocesses (doc :189-194, GH #7046).

`ModelSelectionSupported(providerType)` (models.go:433-452): returns **false only for "qwenpaw", "mcode", "zeroclaw"** (:434-448, with per-provider rationale comments); **default branch returns true — so both claude and pi return true**. The doc (:421-427) lists the flag/session mechanisms per provider, including "Pi" among the flag-routed ones.

Related dispatch helpers, for completeness: `ModelSelectorMustBeProviderQualified` (models.go:357-367) is true only for opencode/deveco — pi is deliberately absent because its resolver accepts bare, canonical, and slash-containing ids (buildPiArgs comment, pi.go:1001-1010); `QualifyModelID` (models.go:390-419) rewrites a persisted model to the catalog's qualified id only when exactly one provider claims it.

## Not found / ambiguous

- **Everything requested was found; nothing is "not found".** Two deliberate corrections to the prior reports baked into the task:
  1. The BuiltinRuntime field set is **12 fields** (adds `DefaultExecutable` and `ProviderLabel` to the 9 listed in the task).
  2. "pi is one of four that do NOT consume opts.McpConfig" is stale at this HEAD: **six** families have no `McpConfig` reference in their backend (pi, cursor, antigravity, copilot, openclaw, deveco) — though cursor and openclaw receive MCP configuration through execenv-written workdir files rather than the ExecOptions field, so "consume MCP config" depends on the channel counted.
- Minor ambiguity: claude's `--verbose` is hardcoded in `buildClaudeArgs` (claude.go:1083) and also in the discovery argv (claude_models.go:71); the task's candidate list of protocol flags did not mention it, but it is part of the exact launch line.
- The launch skeleton strings shown in the UI (`launchHeaders`, agent.go:516-556) confirm the two protocols at a glance: `claude (stream-json)` vs `pi (json mode)`; omp derives its own from the descriptor (builtin_runtimes.go:551-556 of agent.go — LaunchHeader fallback).
