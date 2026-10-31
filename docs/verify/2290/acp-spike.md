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

Measured: the only dependency change is `@agentclientprotocol/sdk` **2.0.2 → 2.1.0** in the daemon (2.2.0 was first used but is inside pnpm's `minimumReleaseAge` window, so CI rejects it; the daemon typechecks and the ACP suites pass on 2.1.0). Its lockfile importer, package record and snapshot changed; no other package or transitive dependency changed. The SDK's new optional `@modelcontextprotocol/server` peer is metadata only and was not installed. The adapters remain explicit configured executables. The install used `--ignore-scripts`; the installer's unrelated workspace age exclusion was removed.

## Capability comparison

Measured source baseline: `apps/daemon/src/backend/claude-code.ts`, `pi.ts`, the installed ACP SDK stable v1 types and implementation, and the tagged adapter sources linked below. Codex currently uses the pi/provider path in Cairn; there is no pre-existing native Codex backend to compare.

| Capability | Current Claude Code backend | Current pi backend | ACP spike |
| --- | --- | --- | --- |
| Text, thinking, tool calls | SDK events mapped to step events | Runtime events mapped to step events | Measured with a stdio child and real step reporting; merges tool updates and excludes other sessions/history |
| Steer | Queues input and acknowledges delivery | Runtime steer plus delivery event | Measured offline: advertises `steering: false`; daemon leaves the fake server queue untouched during preparation and execution, without fetching or acknowledging; direct session calls reject |
| Resume | Local SDK transcript ID/file | Local runtime session file | Negotiates `session/resume`, then `session/load`; rejects unsupported resume, never silently starts fresh; history is excluded from the new step |
| Stop | SDK interrupt and abort | Runtime abort | `session/cancel`, bounded fallback and process cleanup; cooperative and ignored cancellation tested |
| Usage | Per-model token/cache/cost rows | Per-model token/cache/cost rows | Empty usage rows; stable `usage_update` gives context-window occupancy and cumulative cost, not equivalent per-step usage |
| Images | SDK image blocks | Model-checked runtime images | Delivered only after negotiated image capability; rejection is explicit |
| Permissions | SDK bypass plus denied tools/read-only controls | Command/tool gate and selected built-ins | Reject by default; explicit per-agent allow-once policy; no permanent grants |
| Host tools | In-process MCP definitions | Runtime extensions | Authenticated per-session loopback MCP bridge to existing remote/local callbacks; discovery, calls, rejection and teardown tested |
| External MCP | Configured endpoints and managed-empty policy | Configured endpoints | Measured offline: any defined `mcpServers`, including `[]`, rejects before adapter spawn; daemon reports a failed step. Gemini still accepts empty and nonempty lists. Inferred limitation: absent policy can inherit ambient adapter MCP configuration; isolation is not enforced |
| Read-only / restricted built-ins | Supported | Supported | Rejected before spawn; not approximated through prompt text |
| Skills / thinking level | Supported through backend-specific integration | Supported through runtime integration | Skill allowlists, injected skills and non-off thinking levels rejected; team skill directory delivery is not implemented |
| System instructions | Workspace instructions channel | Workspace instructions channel | Prepended as prompt context; not a dedicated system role |
| Session artifact / telemetry | Native transcript and rate-limit handling | Native session artifact and telemetry | ACP session ID and Cairn transcript only; no native session file, rate-limit callback, compaction or dedicated telemetry mapping |

Measured review-gate follow-up: six focused regressions failed before the fixes (two queued-steer cases and four explicit-MCP cases); the two Gemini controls passed. A further failing regression covered steering before backend selection. The queue assertions exercise the real daemon and runner with a consuming fake machine client and a scripted stdio adapter. These checks establish queue preservation without a delivery acknowledgment; automatic delivery as a later prompt and post-fix real-provider behavior remain unverified. The real-run records below describe the earlier revision and are unchanged.

Measured follow-up validation with Node 24.14.0: `pnpm lint`, `pnpm typecheck` and `pnpm spec:parse` passed; the ACP, machine-backends, runner and machine-steer suites passed all 355 tests across 35 files with `--maxWorkers=2`; `pnpm prepush` passed all 20 checks. The affected-browser selector found no web surface for these seven changed files. `pnpm exec vitest run --changed --maxWorkers=2` finished with 5,751 passes, five failures and 20 skips across 427 files. All five failures reproduced in a separate checkout of baseline `64243423b`: one credential environment assertion in `local-executor.test.ts`, one missing hook PID file in `workspace-hooks.test.ts`, and three routing CLI assertions reporting unavailable boundary enforcement. The isolated baseline run had 32 passes and five failures; those files and their assertions are unchanged by this follow-up.

Measured (source, not provider execution): [Claude adapter 0.99.1](https://github.com/zed-industries/claude-agent-acp/blob/v0.99.1/src/acp-agent.ts) advertises image input, HTTP MCP, session load/resume and the `_session/steering` extension. This spike does not implement that extension. [Codex adapter 0.16.0](https://github.com/zed-industries/codex-acp/blob/v0.16.0/src/codex_agent.rs) advertises image input, HTTP MCP, session load/resume and session config options. The [SDK 2.1.0 package](https://www.npmjs.com/package/@agentclientprotocol/sdk/v/2.1.0) installed here exposes stable v1 `PromptResponse.stopReason` and `UsageUpdate.used/size/cost`; the implementation was checked against its installed types and source.

Measured (current upstream documentation): the [legacy Codex adapter repository](https://github.com/zed-industries/codex-acp) directs new installations to `@agentclientprotocol/codex-acp`. This spike retains the issue's approved explicit-command route and adds no successor adapter dependency. The orchestrator should record the exact executable/version used rather than assume interchangeability.

## Real run setup

Measured on 2026-10-31 on the Mac, by the orchestrator, against an isolated verify-cairn stack (server port 8791, web port 5273, scratch `CAIRN_HOME` under the worktree's `.claude/verify-run/`) and a separate daemon home under `/tmp/acp-run/`. The user's real Cairn instance and `~/.cairn` were not used.

- Daemon revision: `df065a5c65742c529c5112d23bffb0418c890341` (branch `B2/acp-spike`), run from source with `tsx src/cli.ts start --foreground --server http://127.0.0.1:8791`, Node 24.14.0.
- Project: a local throwaway git repository with a five-line `notes.txt`; builds started with `withPlan: false` through `POST /api/projects/:id/builds`.
- Adapters, installed with `--ignore-scripts` outside the repository: `@agentclientprotocol/claude-agent-acp@0.99.1` (bundles `@anthropic-ai/claude-agent-sdk@0.3.312` and its darwin-arm64 binary) in `/tmp/acp-adapters/`; `@zed-industries/codex-acp@0.16.0` with `@zed-industries/codex-acp-darwin-arm64@0.16.0` in the same directory; `@agentclientprotocol/codex-acp@2.5.0` (bundles `@openai/codex@0.165.0` darwin-arm64) in `/tmp/acp-adapters-codex2/`. Host CLIs: Claude Code 2.1.312, Codex CLI 0.165.0. Both adapters used the existing local CLI logins; no credential was passed through the flag.
- Flag for the passing runs (the first Codex attempt used `/tmp/acp-adapters/node_modules/.bin/codex-acp`):

```json
{"PCqsD7n_FMtLfSLzkmD9y":{"harness":"claude-code","command":"/tmp/acp-adapters/node_modules/.bin/claude-agent-acp","args":[],"permissions":"allow-once"},
 "Bjgh-DXr9Mzspr7OiMCcK":{"harness":"codex","command":"/tmp/acp-adapters-codex2/node_modules/.bin/codex-acp","args":[],"permissions":"allow-once"}}
```

- Evidence: [`real-runs/transcripts.json`](real-runs/transcripts.json) holds every step row and a conversation excerpt per build from `GET /api/conversations/:id/messages` and `GET /api/builds/:id/usage`; [`real-runs/daemon-log-excerpt.txt`](real-runs/daemon-log-excerpt.txt) holds the daemon's routing, session, steer and stop lines. The JSON quotes runtime text verbatim and truncated, including Cairn's Chinese agent-facing prompt suffixes and Codex's Chinese replies; host paths and the user name are scrubbed. Durations below are step `createdAt` to `finishedAt` from SQLite.

Measured setup deviation: `POST /api/teams/:id/agents` rejected `provider: "claude-code"` with every model, because the host `~/.claude/settings.json` declares no model and the server's model catalog was empty. The Claude agent was therefore created with provider `anthropic` and model `claude-sonnet-5`. ACP routing is keyed by agent ID, so the adapter still ran (log: `ACP adapter claude-code-acp selected`), but the runner's `claude-code` runtime auth probe did not run. The Codex agent used provider `openai-codex` and model `gpt-6.1-sol`.

## Claude Code real Thread

**PASS: one Thread, two turns, end to end through `claude-agent-acp` 0.99.1.**

- Thread (build/conversation) ID: `01a18e84-f851-7439-a4b3-a330e05d3631`; todo `EOLWNTB4IV_X6xWYGFryy`; ACP session `42adb3b4-47af-448c-9508-9b19b2036d45`.
- Turn 1: step `GUPB15obYyWq553iL6XZd`, `done`, **45.2 s**. Task: read `notes.txt`, report line 3, write it to `answer.txt`.
- Turn 2 (resume): step `ecTqbS-IvkyAHPoISAAu6`, `done`, **13.7 s**.
- Messages, tool calls and final status (measured, API): the transcript holds three assistant text messages, the injected user prompt and seven tool calls, all with `isError: false` and results: `ToolSearch`, host tool `mcp__cairn__set_task_meta` through the loopback MCP bridge, a shell `pwd && ls -la`, `Read`, `Write`. Both step rows are `done`; the conv branch commit `1b4b701` contains only `answer.txt` with the expected line; the todo moved to `review`.
- Tool names (measured): the transcript names Claude tools by their ACP `title` (for example the full shell command, or `Read <absolute path>`), not by a stable tool name.
- Resume (measured): turn 2 logged `continue session`, kept the same ACP session ID, and answered `PELICAN` from memory without reading a file; no turn 1 updates were replayed into step 2. A second message was accepted only after the todo was moved from `review` to `done` (`PATCH /api/todos/:id`, which also posts `标记为已完成`); in `review` the server answered 409 `conversation must have an active step or be the completed task thread`. That is existing server behavior, not ACP.
- Steer (measured, Thread `01a18e8e-f7a0-72ad-b9b1-d360d54b336a`, step `vzcmT8u1l65pOHa1lc3Jb`): the server answered `delivered: "steer"` and stored the message in the transcript; the daemon logged `steer delivery failed: ACP steer is unsupported during a step` and sent no ack; `steerPending` was empty afterwards. The agent never received the text. Whether the UI shows the failure was not checked.
- Stop (measured, same step): `POST /api/builds/:id/stop` with `discard: false` gave 202; the step was `stopped` within 34 ms of the request; the adapter process group (`claude-agent-acp` and its bundled `claude` child) was gone at the first one-second poll. Step duration 42.5 s.
- Usage (measured): `GET /api/builds/:id/usage` returned `[]` and the `token_usage` table had zero rows after every run.
- Permissions (measured): the adapter's session `mode` option started as `bypassPermissions`, inherited from the host's Claude Code settings, so Cairn's `allow-once` policy was never exercised. The host's own `PreToolUse` hooks also ran inside the step: both `sleep 90` calls were blocked by a host hook (`isError: true`). Cairn neither sets the adapter mode nor isolates host settings.
- Images: not tried (the adapter advertises `promptCapabilities.image: true`). Thinking: no thinking entries in the transcript; whether the adapter emitted thought chunks was not checked.

## Codex real Thread

**PASS with the successor adapter `@agentclientprotocol/codex-acp` 2.5.0. FAIL with the issue's `@zed-industries/codex-acp` 0.16.0.**

- Legacy adapter (measured): Thread `01a18e90-0018-76be-a1b4-d48c8125911c`, step `KFy6J4UoQxJi-OTkVtgak`, `failed` after 6.6 s; the server's automatic retry (Thread `01a18e90-33f1-7ef1-8fa8-627b51edd478`, step `cNfu0mOvDHvkvYr3RWIOu`) failed the same way in 7.9 s. The step error was only `Internal error`. Reproducing with a direct ACP client showed the JSON-RPC `-32603` error data: the model `gpt-6.1-sol` "is not supported when using Codex with a ChatGPT account" (HTTP 400 `model_not_found`) inside the legacy adapter's bundled Codex core. Cairn drops `error.data`, so the real cause never reaches the step.
- Thread (build/conversation) ID: `01a18e91-eb9a-71ab-ad86-8a537cb7e821`; todo `tvwOC6RCEr227JPmcwwpM`; ACP session `01a18e91-f0ff-7601-8877-934ccefe13c1`.
- Turn 1: step `Ox2KeayhwEQZBnY4XHpKT`, `done`, **19.9 s**. Task: read `notes.txt`, report line 4, write it to `codex-answer.txt`.
- Turn 2 (resume): step `bjT3ajo3vWx1gMcgHjFpm`, `done`, **6.8 s**; `continue session`, same session ID, answered `delta line` with no tool call.
- Messages, tool calls and final status (measured, API): two assistant text messages, two `exec_command` calls, host tools `mcp.cairn.set_task_meta` and `mcp.cairn.attach_file` (the attachment landed in the transcript), and two `Guardian Review` entries, all `isError: false`. Both step rows are `done`; the conv branch contains only `codex-answer.txt` with the expected line.
- Shell output (measured): each `exec_command` result is only `[{"type":"terminal","terminalId":…}]`. Cairn does not advertise the terminal client capability, so command output never reaches the transcript.
- Steer (measured, Thread `01a18e92-c516-7f74-8331-88a168265f35`, step `AhHwyNxC-5z9DMx1U3FQ6`): same as Claude: `delivered: "steer"` from the server, `steer delivery failed` in the daemon, no ack, text never delivered.
- Stop (measured, same step): `stopped` within 34 ms of the request. The running `sleep 120` was in its own process group, outside the adapter's group, and was still gone at the first one-second poll, together with the adapter and its `codex app-server` child. The in-flight `exec_command` stayed in the transcript with no result and no error flag. Step duration 20.2 s.
- Usage (measured): `[]` from the usage API and zero `token_usage` rows. A direct ACP client against the same adapter received `PromptResponse.usage` with per-turn input, cached and output tokens and a per-model breakdown in `_meta`; the spike does not read it.
- Permissions (measured): the 2.5.0 session `mode` started as `agent`; Codex's own reviewer approved both host-tool calls (`Guardian Review`, `decisionSource: "agent"`), and no stall indicated a Cairn permission request. The daemon does not log permission requests, so "none were sent" is an inference. The legacy adapter started in `full-access`, matching the host's Codex configuration. The assistant answered in Chinese although the task was English, which is consistent with host-level Codex instructions leaking into the step (inferred; source not checked).
- Images: not tried (the adapter advertises `promptCapabilities.image: true`). Thinking: no thinking entries in the transcript.

## Grok CLI probe

**Not installed on this Mac. ACP support: unknown (not established either way).**

- CLI version: none. `which grok` → `grok not found` (exit 1). `mise` is not installed here (`command -v mise` exit 1), and `/opt/homebrew/bin` and global npm packages contain no `grok`.
- Command (read-only registry metadata): `npm view @xai-official/grok --json`.
- Output: version `1.0.70`; `bin` is `{"grok": "bin/grok"}`; platform `optionalDependencies` for darwin, linux and win32; one dependency, `@iarna/toml`; license Apache-2.0; no readme, homepage, repository or keywords in the registry document. Nothing mentions ACP, Agent Client Protocol, Zed or a stdio agent mode.
- Conclusion: not determined. The package exposes one `grok` binary and no ACP-specific bin; whether `grok` has an ACP subcommand or flag needs `grok --help` on a host where it is installed. Nothing was installed for this probe.

## Recommendation

**Recommendation (measured on two real Threads per harness plus the offline tests): migrate some, through opt-in adapters. Keep the current backends as the default, and do not move Claude Code or Codex to ACP until the gaps below are closed.**

Measured: the same ACP client ran a real Claude Code Thread and a real Codex Thread end to end. Messages, tool calls with results, host tools over the loopback MCP bridge, final status, commit and push, resume of the same session, stop and process-group cleanup all worked through the normal step contract. Codex needed the successor adapter: the issue's `@zed-industries/codex-acp` 0.16.0 cannot run the host's current model.

Measured gaps found only in the real runs:

1. The recorded revision silently lost steers after the server reported `delivered: "steer"`. Measured offline after the review-gate fix: the daemon preserves the queue and sends no acknowledgment for ACP adapters. Later delivery and the server's initial delivery label remain unverified; active ACP steering is still unsupported.
2. Permissions and host configuration leak in: the adapters take their mode (`bypassPermissions`, `agent`, `full-access`), hooks and instructions from the host CLI configuration, so the per-agent `permissions` policy was not exercised. Cairn must set the adapter mode and isolate host settings before ACP can carry policy.
3. Usage stays empty even though Codex 2.5.0 returns per-turn token counts in `PromptResponse.usage`.
4. Diagnostics are lost: JSON-RPC error data is dropped, so the legacy Codex failure surfaced as `Internal error`.
5. Transcript fidelity: Codex shell output is a terminal reference only; Claude tool names are display titles; a stopped in-flight Codex tool call stays open.
6. Server fit: a `claude-code` agent cannot be created unless the host Claude settings declare a model, so the real Claude run used a pi provider identity and skipped the runtime auth probe.

Not established: images, thinking output, explicit `allow-once` or reject permission flows, adapter crash and init-timeout behavior with real adapters, latency compared with the current backends on the same task, and Grok. Still applicable from the offline work: restricted execution, skills and external MCP policies are rejected rather than mapped.

Inferred: ACP is a viable seam for adding new harnesses where Cairn has no hand-written backend, provided the agent accepts the gaps above. For Claude Code and Codex, which already have richer paths (steer, usage, policy), migrating now would regress steer, usage and permission control.
