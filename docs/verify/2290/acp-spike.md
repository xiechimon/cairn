# ACP spike (#2290)

## Plan and failure modes

Keep the existing backends as the default. Select an explicitly configured ACP adapter by agent ID on the Mac daemon. Verify the protocol and normal step reporting with an offline scripted stdio agent before implementing the bridge. Real provider runs and the Grok probe belong to the orchestrator.

Failure modes to cover before implementation:

1. An absent flag changes default routing or an ACP flag leaks to another agent.
2. Stream chunks, thinking, tool inputs, results or final status disappear or duplicate.
3. A failed tool loses its error flag; an incomplete tool remains running forever.
4. Refusal, token limits, malformed protocol, process exit or RPC errors become success.
5. Initialization hangs, cancellation is ignored, or child cleanup leaves a running process.
6. Resume silently creates a fresh session or replays historical updates into this step.
7. A requested model or image is silently dropped.
8. Permissions are granted implicitly or unsupported host tools, skill restrictions and read-only policies are ignored.
9. Steering starts a competing prompt or acknowledges undelivered text.
10. Context-window occupancy is incorrectly reported as billable step usage.

## Offline verification

Measured: the initial `pnpm exec vitest run apps/daemon/test/acp-spike.test.ts` run produced **25 failures and 1 pass** before the ACP factory and routing existed. The two step-level tests failed because the unimplemented flag still selected the existing backend's session ID.

Measured: a real Node stdio child in `apps/daemon/test/fixtures/acp-agent.mjs` implements scripted JSON-RPC. The tests exercise the actual ACP SDK transport, initialize/model negotiation, daemon claim loop, runner, transcript upload, tool relay and final report. Both harness configurations are compared against the same existing-backend event contract; only generated timestamps are removed for comparison. This is offline protocol evidence with a fake provider, not evidence of real Claude Code or Codex behavior.

Measured: incremental tool output and unsolicited cancellation each exposed a failing regression test before their fixes. A tool result delivered before its completion status is retained; cancellation without a daemon stop request fails the step. Explicit stop uses `session/cancel`, closes a nonresponsive connection after two seconds, and terminates the adapter process group on macOS. A failing descendant-process regression was fixed; the fake now proves that descendants ignoring termination are reaped by the one-second kill escalation.

The final source was checked with fnm Node 24.14.0 (except the browser run, which completed under the shell's Node 26.8.1). Tests ran against the working tree committed with this document, before commit; no real provider was called.

| Command | Measured result |
| --- | --- |
| `pnpm lint` | Pass, 1,308 files checked; one existing informational `useFlatMap` diagnostic in `apps/server/test/feishu-config.test.ts` |
| `pnpm typecheck` | Pass across shared, daemon, server, web and integration packages |
| `pnpm spec:parse` | Pass: 1,407 browser tests in 204 files and 67 integration test files parsed |
| `pnpm exec vitest run apps/daemon/test/{acp-spike,acp-tools,acp-stdio,acp,machine-backends,runner-runtime,runner-local}.test.ts --maxWorkers=2` | Pass: 101 tests across seven files, including 38 new ACP cases; 9.74 seconds |
| `pnpm --filter @cairn/web e2e:affected` | Pass: lockfile change selected all 204 specs; 1,407 tests passed in 8.6 minutes |
| `pnpm exec vitest run --changed --maxWorkers=2` | Pass: 514 tests across 78 files; 409.41 seconds |
| `pnpm prepush` | Pass: 20 checks |

Measured: the initial unrestricted `vitest run --changed`, concurrent with the browser suite, completed with 512 passes and one five-second timeout in the existing structured local-merge test. That case passed alone, and all 19 cases in its file passed in the final seven-file run. Resource contention is an inference, not a proven cause; the complete affected set subsequently passed with two workers and unchanged timeouts.

Measured: three temporary lint probes importing the SDK, Claude adapter and Codex adapter outside `apps/daemon/src/backend/` were each rejected by `noRestrictedImports`. The probe file was removed; no source exemption was added.

## Configuration

The daemon reads `CAIRN_ACP_AGENTS` once at startup. It is a JSON object keyed by exact agent ID; an absent or empty flag selects the existing backends. Unknown option keys, unsupported harnesses and empty commands fail validation before daemon enrollment. `command` is an executable and `args` is an argument array, passed directly to `spawn` without a shell. No adapters are installed by this change.

Example for the orchestrator, replacing both agent IDs and executable paths:

```sh
export CAIRN_ACP_AGENTS='{"claude-agent-id":{"harness":"claude-code","command":"/absolute/path/claude-agent-acp","args":[],"permissions":"allow-once"},"codex-agent-id":{"harness":"codex","command":"/absolute/path/codex-acp","args":[],"permissions":"allow-once"}}'
pnpm --filter @xiechimon/cairn-cli dev
```

Use the Claude Code agent's existing `claude-code` provider identity. A Codex agent can retain its configured provider identity; the flag selects the local Codex adapter for that agent only. The adapter uses its local CLI authentication. The spike does not translate server provider keys, URLs or provider compatibility options into adapter configuration. Do not put credentials in the flag or command arguments.

Permission requests default to rejection. Explicit `permissions: "allow-once"` selects only an advertised `allow_once` choice for the active session, never `allow_always`. When no matching choice exists the request is cancelled. Local filesystem and terminal client capabilities are not advertised; tools execute within the adapter or through its MCP client.

Measured: the only dependency change is `@agentclientprotocol/sdk` **2.0.2 → 2.2.0** in the daemon. Its lockfile importer, package record and snapshot changed; no other package or transitive dependency changed. The SDK's new optional `@modelcontextprotocol/server` peer is metadata only and was not installed. The adapters remain explicit configured executables. The install used `--ignore-scripts`; the installer's unrelated workspace age exclusion was removed.

## Capability comparison

Measured source baseline: `apps/daemon/src/backend/claude-code.ts`, `pi.ts`, the installed ACP SDK 2.2.0 stable v1 types and implementation, and the tagged adapter sources linked below. Codex currently uses the pi/provider path in Cairn; there is no pre-existing native Codex backend to compare.

| Capability | Current Claude Code backend | Current pi backend | ACP spike |
| --- | --- | --- | --- |
| Text, thinking, tool calls | SDK events mapped to step events | Runtime events mapped to step events | Measured with a stdio child and real step reporting; merges tool updates and excludes other sessions/history |
| Steer | Queues input and acknowledges delivery | Runtime steer plus delivery event | Explicitly rejected; no competing `session/prompt` and no false acknowledgment |
| Resume | Local SDK transcript ID/file | Local runtime session file | Negotiates `session/resume`, then `session/load`; rejects unsupported resume, never silently starts fresh; history is excluded from the new step |
| Stop | SDK interrupt and abort | Runtime abort | `session/cancel`, bounded fallback and process cleanup; cooperative and ignored cancellation tested |
| Usage | Per-model token/cache/cost rows | Per-model token/cache/cost rows | Empty usage rows; stable `usage_update` gives context-window occupancy and cumulative cost, not equivalent per-step usage |
| Images | SDK image blocks | Model-checked runtime images | Delivered only after negotiated image capability; rejection is explicit |
| Permissions | SDK bypass plus denied tools/read-only controls | Command/tool gate and selected built-ins | Reject by default; explicit per-agent allow-once policy; no permanent grants |
| Host tools | In-process MCP definitions | Runtime extensions | Authenticated per-session loopback MCP bridge to existing remote/local callbacks; discovery, calls, rejection and teardown tested |
| External MCP | Configured endpoints and managed-empty policy | Configured endpoints | Nonempty external MCP sets rejected; ambient adapter configuration is not centrally reconciled |
| Read-only / restricted built-ins | Supported | Supported | Rejected before spawn; not approximated through prompt text |
| Skills / thinking level | Supported through backend-specific integration | Supported through runtime integration | Skill allowlists, injected skills and non-off thinking levels rejected; team skill directory delivery is not implemented |
| System instructions | Workspace instructions channel | Workspace instructions channel | Prepended as prompt context; not a dedicated system role |
| Session artifact / telemetry | Native transcript and rate-limit handling | Native session artifact and telemetry | ACP session ID and Cairn transcript only; no native session file, rate-limit callback, compaction or dedicated telemetry mapping |

Measured (source, not provider execution): [Claude adapter 0.99.1](https://github.com/zed-industries/claude-agent-acp/blob/v0.99.1/src/acp-agent.ts) advertises image input, HTTP MCP, session load/resume and the `_session/steering` extension. This spike does not implement that extension. [Codex adapter 0.16.0](https://github.com/zed-industries/codex-acp/blob/v0.16.0/src/codex_agent.rs) advertises image input, HTTP MCP, session load/resume and session config options. The [SDK 2.2.0 package](https://www.npmjs.com/package/@agentclientprotocol/sdk/v/2.2.0) installed here exposes stable v1 `PromptResponse.stopReason` and `UsageUpdate.used/size/cost`; the implementation was checked against its installed types and source.

Measured (current upstream documentation): the [legacy Codex adapter repository](https://github.com/zed-industries/codex-acp) directs new installations to `@agentclientprotocol/codex-acp`. This spike retains the issue's approved explicit-command route and adds no successor adapter dependency. The orchestrator should record the exact executable/version used rather than assume interchangeability.

## Claude Code real Thread

**NOT RUN: orchestrator-owned placeholder.**

- Thread ID: pending
- Adapter version and explicit command: pending
- Mac daemon revision and agent flag: pending
- Duration: pending
- Messages, tool calls and final status evidence: pending
- Steer, resume, stop, usage, images and permissions observations: pending

## Codex real Thread

**NOT RUN: orchestrator-owned placeholder.**

- Thread ID: pending
- Adapter version and explicit command: pending
- Mac daemon revision and agent flag: pending
- Duration: pending
- Messages, tool calls and final status evidence: pending
- Steer, resume, stop, usage, images and permissions observations: pending

## Grok CLI probe

**NOT RUN: orchestrator-owned placeholder. Support is unknown.**

- CLI version: pending
- Command: pending
- Output: pending
- Conclusion (supported / not supported): pending

## Recommendation

**Recommendation (inferred from the offline tests and source comparison): migrate some, through opt-in adapters, after the orchestrator completes both real Thread runs. Keep the current backends as the default.**

Inferred from the measured offline tests: ACP can share transport, session negotiation, event mapping and host-tool relay between Claude Code and Codex without adding a second handwritten backend. The normal step transcript/tool/status contract survives this seam.

Measured gaps prevent a blanket migration: steer is unavailable on this path; usage cannot be represented faithfully by the stable v1 fields consumed here; restricted execution and skills policies are rejected; dedicated system-role delivery, external MCP policy reconciliation, native session artifacts, compaction and provider-specific telemetry/auth mapping are absent. Real resume durability, adapter descendant cleanup, latency and provider-specific permission behavior must be checked in the real runs. These are not established by reading capability declarations.

The implementation portion is ready for orchestrator verification once the final automated checks are complete. The issue's real-provider and Grok acceptance items remain open until the marked placeholders are filled.
