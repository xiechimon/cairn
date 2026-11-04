# 1607 · Using ACP as a generic execution surface

> Purpose: answer #1607. Every time Cairn adds an execution surface it writes a bridge (`pi.ts`, `claude-code.ts`). Can we instead build one ACP client bridge and mount codex / gemini cli / copilot cli / hermes etc. as agents on the board.
> This ticket only researches; it does not change product code.
> Repo baseline: `e5d0639b` (2026-10-24; `lane/1607-acp-research` and `origin/main` are the same commit). All `path:line` references below anchor to this commit.
> External reading date: 2026-10-24. The protocol page's HTTP publish time is also this day (Mintlify `Published Time: Sat, 24 Oct 2026`). The registry JSON was taken from `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` (`version` field `1.0.0`, 43 agents).
> Two source kinds: this repo = the `path:line` read; external = the official page, registry, or tag-resolved source file opened that day. Entries written `no first-hand source found` are ones whose original text was not opened this round.

## 0. Conclusions

1. **Do it, but do not use ACP to replace the two existing bridges.** pi is an in-process library, claude-code is an Agent SDK bridge; both have already wired streams, tools, usage, sessions, the command gate, or strict MCP onto `AgentBackend`. ACP suits the third family: externally installed CLIs that hold their own login state locally.
2. **Start with Gemini CLI.** The official binary ships `--acp` (registry `@google/gemini-cli@0.65.0`, released `2026-10-20`). The TypeScript SDK docs list it as a reference implementation. No extra adapter process needed.
3. **Codex and Claude Code do not go through ACP first.** The official agents page shows adapters, not the CLIs' own ACP subcommands. On the Claude side this repo already has a denser SDK bridge; switching to an adapter would drop the already-wired usage accounting, skill-denial rules, and strict MCP.
4. **Copilot CLI is a native `--acp`, but the agents page still marks it public preview at reading date.** Hermes is a native `hermes acp` (`v0.22.5`, `2026-10-23`) but is not among the 43 entries in the authentication registry. These two come after the Gemini probe goes green.
5. **A trajectory pack cannot be fully reconstructed from ACP events.** What the stable protocol can reconstruct is the text stream, tool calls, stop reason, and optional context usage and cumulative cost. Four-dimensional tokens, cache writes, five-item cost, plan-document versions, gate decisions, and merge results are not in the stable events.

## 1. The protocol and SDK (the layer the bridge consumes)

ACP is JSON-RPC between an editor (client) and a coding agent (server). Locally it defaults to child-process stdio. Remote HTTP / WebSocket are stated on the intro page as still in progress.

- Intro: https://agentclientprotocol.com/get-started/introduction (read 2026-10-24)
- Protocol v1 overview and methods: https://agentclientprotocol.com/protocol/v1/overview (same day)
- Schema canonical: `agentclientprotocol/agent-client-protocol` `schema/v1/schema.json`, `main` commit `a0c3d83e5277a5b419dcd083742c0a14dc298d21`, commit time `2026-10-24T05:54:14Z`
- Unstable additions: same repo `schema/v1/schema.unstable.json` (same fetch)
- TypeScript library: https://agentclientprotocol.com/libraries/typescript (same day). npm `@agentclientprotocol/sdk` latest `2.0.2` (`registry.npmjs.org` same day; GitHub release `v2.0.2` published `2026-10-23T19:37:11Z`, repo `agentclientprotocol/typescript-sdk`)
- Registry description: https://github.com/agentclientprotocol/registry `README.md`. The index URL is in that README. The registry only admits agents whose `handshake can return valid `authMethods``, and CI verifies this.

Client baseline methods (v1 initialization, read 2026-10-24): every agent must support `session/new`, `session/prompt`, `session/cancel`, `session/update`. `session/load`, `session/resume`, and HTTP/SSE MCP are capability bits; missing them means the client must not call them.

https://agentclientprotocol.com/protocol/v1/initialization

## 2. Who provides an ACP server on 2026-10-24

The determination has three tiers.

- **Native**: the official CLI's own argument or subcommand speaks ACP JSON-RPC; the registry launches exactly that binary.
- **Adapter**: another process translates ACP into that CLI's private protocol. The official agents page marks them with "via".
- **Docs have it, registry does not**: upstream docs write a server, but that day's authentication registry has no entry.

Official list page (with "via" wording): https://agentclientprotocol.com/get-started/agents (`Published Time: Sat, 24 Oct 2026 13:15:48 GMT`)

### 2.1 The ones the ticket names

**Gemini CLI, native, start here.**

- Registry id `gemini`, version `0.65.0`, launch `npx @google/gemini-cli@0.65.0 --acp`
- Release: `google-gemini/gemini-cli` release `v0.65.0`, `2026-10-20T21:17:57Z`, title `Release v0.65.0`
- Docs exist on tag `v0.65.0`: `docs/cli/acp-mode.md` (blob sha `a5f9b6a63a3aa539cf35c5b58e3135a1540c19d4`, 4684 bytes). The body writes `gemini --acp`, stdio JSON-RPC, and lists `initialize` / `authenticate` / `newSession` / `loadSession` / `prompt` / `cancel` / `setSessionMode`. The doc's method names are the old spellings; the current protocol names are the `session/new` group; the schema prevails, and the doc only proves `this binary has an ACP mode`.
- Source on the same tag: `packages/cli/src/acp/`. `package.json` pins `@agentclientprotocol/sdk` at `0.16.1`. If the bridge uses SDK `2.0.2`, it relies on protocol version negotiation, not the same type package.
- The agents page links directly to `google-gemini/gemini-cli`, no "via".
- The SDK docs' "Users" section treats Gemini CLI's `packages/cli/src/acp` as a copyable agent implementation.

**GitHub Copilot CLI, native, still marked public preview by the official list.**

- Registry id `github-copilot-cli`, version `1.0.103`, launch `npx @github/copilot@1.0.103 --acp`
- Release: `github/copilot-cli` release `v1.0.103`, `2026-10-22T16:21:56Z`. That tag's `changelog.md` first section is `## 1.0.103 - 2026-10-22`, and the first ACP-related entry is "ACP sessions now honor saved sandbox settings and --sandbox/--no-sandbox flags, including on resume."
- `--acp` first appears in changelog `## 0.0.397 - 2026-01-28`: "Add --acp flag to start as Agent Client Protocol server".
- Announcement: https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/ (page time `2026-01-28T07:00:30-08:00`). The body writes `copilot --acp` (stdio) and `copilot --acp --port 8080` (TCP).
- The agents page still says "in public preview" at reading date, linking to the post above. No later GA announcement was found this round.
- Changelog sentences relevant to capability comparison (version in the relevant file section headers): `1.0.78` (2026-08-03) "Expose token usage in ACP prompt results and live usage_update notifications"; earlier entries state that MCP (stdio, HTTP, SSE) can be provided by the client at session start or load, that skills appear as slash commands in the ACP client, plus `load` for existing sessions, permission flags, and `closeSession`.

**Codex, adapter, not an ACP server of the `codex` binary.**

- Agents page verbatim: "Codex CLI (via ACP's adapter)", link `https://github.com/agentclientprotocol/codex-acp`
- Registry id `codex-acp`, version `2.2.2`, launch `npx @agentclientprotocol/codex-acp@2.2.2` (no `--acp`; the package itself is the server)
- Adapter release `v2.2.2`, `2026-10-10T03:15:52Z`
- README (read same day): `codex-acp` is a stdio ACP server that in turn launches the Codex App Server. The npm package bundles a compatible `@openai/codex`; `CODEX_PATH` switches to another binary. Mappings listed in the README include shell, file changes, permission, MCP, terminal, reasoning, plan, token usage. These are adapter behaviors, not protocol guarantees.
- `openai/codex` latest release is `rust-v0.164.0`, `2026-10-23T04:48:10Z`. This round used `gh search code` in that repo for `agentclientprotocol`, `--acp`, `codex acp`, finding no docs or source (one lock-file hash coincidentally containing the letters `acp` does not count). No first-hand source for Codex CLI itself implementing an ACP server was found.

**Claude Code, adapter. This repo must not switch to it.**

- Agents page verbatim: "Claude Agent (via Zed's SDK adapter)", link `https://github.com/zed-industries/claude-agent-acp`
- Registry id `claude-acp`, version `0.95.0`, repo now `agentclientprotocol/claude-agent-acp`, launch `npx @agentclientprotocol/claude-agent-acp@0.95.0`. Authors listed as Anthropic, Zed Industries, JetBrains. License `proprietary`
- Adapter release `v0.95.0`, `2026-10-23T19:59:08Z`
- README: implements an ACP agent with the Claude Agent SDK. Lists tool permissions, client MCP, slash commands, sub-sessions. No field isomorphic to Cairn's `ModelUsage` four-dimensional counting plus five-item cost was seen in this round's README feature list.
- `gh search code` in `anthropics/claude-code` for `agentclientprotocol`, `--acp`, `acp server` found nothing. No first-hand source for Claude Code CLI itself providing an ACP server was found.
- This repo's `apps/daemon/src/backend/claude-code.ts` directly consumes `@anthropic-ai/claude-agent-sdk` (`biome.json` locks that package to that file). Adding an ACP adapter layer on top adds one more hop and forces redoing the mappings already landed.

**Hermes, docs and source are a native server, not in the authentication registry.**

- The agents page has an entry: "Hermes Agent", link https://hermes-agent.nousresearch.com/docs/user-guide/features/acp
- That page (read 2026-10-24) writes: three launch forms `hermes acp`, `hermes-acp`, `python -m acp_adapter`; stdout runs only ACP JSON-RPC. The `session/new` MCP sent by the editor is separate from the MCP in Hermes's own config, and the former is always added. Skills, memory, and credentials keep using `~/.hermes/skills/`, `~/.hermes/config.yaml`, `~/.hermes/.env`.
- Tag check: `NousResearch/hermes-agent` release `v0.22.5` (`Hermes Agent v0.22.5`, `2026-10-23T05:28:45Z`). On that tag, `website/docs/user-guide/features/acp.md` exists (blob sha `4c235539e838d7d5d219d0c84d61e79fa43616af`). `hermes_cli/subcommands/acp.py`'s help text is "Run Hermes Agent as an ACP (Agent Client Protocol) server".
- The 43 registry ids that day do not include `hermes`. The registry README states it only admits entries that pass auth validation. So Hermes can be used as a server, but must not be written as `entered the official registry`.

**pi, already embedded in this repo, do not go around through ACP again.**

- Agents page: "Pi (via pi-acp adapter)", link `https://github.com/svkozak/pi-acp`
- Registry id `pi-acp`, version `0.0.34`, launch `npx pi-acp@0.0.34`
- This repo's pi execution surface is the in-library `PiBackend`, not spawning the `pi` CLI.

**Raven, mentioned by the ticket.**

- The cited source is a Claude artifact `https://claude.ai/artifact/Hm8AZ2JEGjebVu6KzbMTSe`. That URL requires login; this round did not open it, and no public first-hand page for this artifact was found.
- The agents page has a separate public entry: "Raven (`raven acp`)", link https://evermind-ai.github.io/Raven/agent-protocols/ . From the list context, Raven is a host that drives other ACP agents, not a server Cairn would spawn. The doc body was not opened item by item this round to verify the `13 agents` number, so the ticket's sentence is not treated as verified fact.

### 2.2 Entries in the same-day registry whose upstream docs this round did not open one by one

Below only transcribes the registry JSON's id, version, launch args. For those whose README was not opened, no extra `native` or `adapter` claim is made. `grok-build`'s arg is `agent stdio`, not `acp`, and https://x.ai/cli was not opened this round to check whether it is ACP JSON-RPC, so it is not counted among confirmed ACP servers.

Official product binaries or official npm packages whose args contain `acp` (registry verbatim):

- `auggie` `0.36.0`, `npx @augmentcode/auggie@0.36.0 --acp`
- `bob` `2.0.9`, `npx @ibm/bob@2.0.9 acp`
- `cline` `3.0.73`, `npx cline@3.0.73 --acp`
- `codebuddy-code` `2.174.0`, `npx @tencent-ai/codebuddy-code@2.174.0 --acp`
- `cortex-code` `1.0.73`, `cortex acp serve`
- `cursor` `2026.10.22`, `cursor-agent acp` (registry website: https://cursor.com/docs/cli/acp ; this round opened the page; the title is ACP)
- `devin` `3000.11.205`, `devin acp`
- `dirac` `0.5.23`, `npx dirac-cli@0.5.23 --acp`
- `factory-droid` `0.249.0`, `npx droid@0.249.0 exec --output-format acp-daemon` (the output-format name contains acp, not an `--acp` subcommand)
- `goose` `1.56.0`, `goose acp`
- `junie` `3813.9.0`, `junie --acp=true`
- `kilo` `7.8.17`, `npx @kilocode/cli@7.8.17 acp`
- `kimi` `1.52.0`, `kimi acp`
- `minimax-code` `0.2.7`, `npx @minimax-ai/code@0.2.7 acp`
- `nova` `1.1.59`, `npx @compass-ai/nova@1.1.59 acp`
- `opencode` `1.19.4` and `opencode-v2` `2.1.4`, both `opencode acp`
- `poolside` `1.0.16`, `pool acp`
- `qoder` `0.2.14`, `npx @qoder-ai/qodercli@0.2.14 --acp`
- `qwen-code` `0.26.0`, `npx @qwen-code/qwen-code@0.26.0 --acp --experimental-skills`
- `stakpak` `0.3.88`, `stakpak acp`
- `vtcode` `0.96.14`, `vtcode acp`
- `crow-cli` `0.1.24`, `crow-cli acp`
- `dimcode` `0.5.21`, `npx dimcode@0.5.21 acp`
- `harn` `0.10.177`, `harn serve acp`
- `kimchi` `1.21.0`, `kimchi --mode acp`

Standalone wrapper processes (package name itself `*-acp`, or registry description writing wrapper / adapter): this round only checked the registry fields for claude, codex, pi, amp: `amp-acp` `0.10.0` described as "ACP wrapper for Amp". The rest — `agoragentic-acp`, `antigravity-acp`, `autohand`, `corust-agent`, `deepagents`, `glm-acp-agent`, `mistral-vibe` (launch `./vibe-acp`) — were not opened one by one.

`fast-agent` `0.10.1` and `minion-code` `0.1.44` have distribution `uvx`; their args are not expanded in the table above.

## 3. Capability comparison

The comparison surface is the eight things this repo asks of upstream. The pi column reads `apps/daemon/src/backend/pi.ts`, the claude-code column reads `apps/daemon/src/backend/claude-code.ts`. The ACP column is judged against the v1 stable protocol; anything a particular CLI does beyond it is written under `gap and fill-in`, not counted as protocol coverage.

The seam's vocabulary has no ACP name. `AgentBackendCapabilities` only has `name`, `thinkingLevels`, `oauthProviders`, `compaction`, `sessionResume` (`packages/shared/src/agent-backend.ts:180-188`). The 15 `StepEvent` kinds (same file `:141-158`) are locked by spec 17 A5; ACP events are mapped into them, no new vocabulary.

### 3.1 Streaming messages

- **pi**: `text_delta` / `thinking_delta` on `message_update` map to the same-named `StepEvent`s, the block ends `thinking`, `message_end` carries `messageRecord` (`pi.ts:636-668`, `:670-721`). `messageRecordSchema` is loose (`packages/shared/src/records/message.ts:23-28`), so `stopReason` and per-message `usage` can be attached to the row (`pi.ts:612-626`).
- **claude-code**: text/thinking deltas from `stream_event`; an `message_end` is emitted at the end of the assistant frame (`claude-code.ts:206-267`). The SDK's stop reason is not written into the row.
- **ACP**: covers streaming body and reasoning. `agent_message_chunk`, `agent_thought_chunk` in `session/update` (https://agentclientprotocol.com/protocol/v1/prompt-turn , read 2026-10-24). Content blocks contain text; image/audio/resource depend on the agent's advertised `promptCapabilities` (https://agentclientprotocol.com/protocol/v1/content and the initialization page).
- **Gap and fill-in**: chunks have no Cairn `message_end`. The bridge appends one `message_end` when `session/prompt` returns, the body being the already-assembled chunks. `agent_thought_chunk` maps to `thinking_delta`; if the prompt return has no separate full-text block, do not invent a `thinking`. Images: if `promptCapabilities.image` is false, a `SessionOpts.promptImages` with images fails outright, not silently dropping them.

### 3.2 Tool-call records

- **pi**: `toolcall_end` first records id/name/arguments, `tool_execution_end` then appends result, `isError`, `endedAt` (`pi.ts:659-667`, `:723-736`). The record shape is `toolCallRecordSchema` (`agent-backend.ts:27-37`): `id`, `name`, `arguments`, optional `result` / `isError` / times / `todo`.
- **claude-code**: assistant `tool_use` emits pending, user `tool_result` backfills (`claude-code.ts:245-290`). `TodoWrite` is separately projected into `todo`.
- **ACP**: covers the two-stage form. `tool_call` creates, `tool_call_update` changes state (`pending` / `in_progress` / `completed` / `failed`) and content (https://agentclientprotocol.com/protocol/v1/tool-calls , read 2026-10-24). Content can be a normal content block, a diff, or a terminal; it is not guaranteed to be a model-visible result string.
- **Gap and fill-in**: map `failed` → `isError: true`, `completed` → `isError: false`. Store ACP's content as `result` verbatim (schema is `unknown`). Do not compress a diff into fake bash stdout. Fill `todo` only when the tool name and arguments match the existing `agent-todo` projection; leave empty otherwise. On cancellation the protocol requires the client to mark unfinished tool calls `cancelled` (the pronot-turn page's Cancellation section); the bridge emits a final draft with `isError: true` to avoid a record forever stuck at pending.

### 3.3 stopReason / usage

- **pi**: message-level `stopReason`. `aborted` → `message_stop`; assistant and `error` → `error` (`pi.ts:707-719`). Usage is accumulated on `message_end` by `provider/model` into input/output/cacheRead/cacheWrite, and the five-item cost only when `cost` exists (`pi.ts:673-705`). `agent_settled` emits `done` carrying this row set (`:752-754`). The seam's row shape is `modelUsageSchema` (`agent-backend.ts:56-63`).
- **claude-code**: the finale is on the `result` frame. `subtype === success` and `is_error` false → `done` plus a usage row; interruption → `message_stop`; otherwise → `error` (`claude-code.ts:308-347`). Usage comes from the SDK result, and the cost key may be absent (`modelUsageSchema` comment states a claude-code row may carry no cost).
- **ACP stable protocol**: `session/prompt`'s response must carry `stopReason`, five values `end_turn` / `max_tokens` / `max_turn_requests` / `refusal` / `cancelled` (prompt-turn page Stop Reasons; `schema/v1/schema.json`'s `StopReason` and `PromptResponse`. Stable `PromptResponse` only has `stopReason` and `_meta`). There is also optional `usage_update`: `used`, `size` required, `cost` optional with only `amount` + ISO currency (prompt-turn page Session Usage Updates; schema's `UsageUpdate`). This is session context usage and cumulative cost, not one call's input/output/cache four-item.
- **Unstable, not a contract**: `schema/v1/schema.unstable.json`'s `PromptResponse.usage` is marked "UNSTABLE / not part of the spec yet". Fields are `totalTokens`, `inputTokens`, `outputTokens`, optional `thoughtTokens`, `cachedReadTokens`, `cachedWriteTokens`. The description writes "across all turns / across session", and whether it is the same thing as `this turn` is still open in the RFD: https://agentclientprotocol.com/rfds/end-turn-token-usage (read 2026-10-24, status still Draft; the revision log writes it was split from another RFD on 2026-06-02). `_meta` the protocol states implementations must not depend on its keys (the schema's description of `_meta`).
- **Gemini actually sends extra unstable usage, and the cancellation path drops it.** `v0.65.0` `packages/cli/src/acp/acpSession.ts:381-409` accumulates this turn's multiple model calls' input/output/cached/thought into `usage`, per-model counts in `_meta.quota`. `:421-422`, `:440-442`, `:534-538` return an object with only `stopReason: cancelled` and no `usage` on cancellation. `:483-489`'s `usage_update` sends only `used` (input+output) and `size`, no `cost` in that block. cached comes from `cachedContentTokenCount`, no separate cache write.
- **Copilot** changelog `1.0.78` writes it exposes token usage in ACP prompt results and `usage_update`. The shape is bounded by that changelog sentence; Copilot's schema was not opened this round.
- **Gap and fill-in**: the stop reason maps stably, usage does not. `end_turn` → `done` (usage below); `cancelled` → `message_stop` (the protocol states cancellation is not an error and the agent must not throw it as a normal error); `max_tokens` / `max_turn_requests` / `refusal` → `error`, with `retryable` true only when the wording hits an existing transient regex, false otherwise. `done.usage`: the stable path can at best get one context-usage number from `usage_update`, which cannot fill four dimensions, so send an empty array and let the server record 0 under `no price source` (`packages/shared/src/records/token-usage.ts:21-24` already has this caliber). Unstable `usage` is copied into input/output/cacheRead (`cachedReadTokens`)/cacheWrite (`cachedWriteTokens`) only when the bridge explicitly enables the SDK unstable types AND the field actually appears; cacheWrite defaulting to 0 must be marked on the row, not faked as a measured 0. `thoughtTokens` has no column, do not merge it into output. Do not read `_meta.quota`. Cost five-item has no protocol source, so no price table is fabricated, same as pi's `host does not fabricate prices`.

### 3.4 Session resume

- **pi**: `sessionResume: true` (`pi.ts:75-81`). `continueSession` uses a session file.
- **claude-code**: `sessionResume: true` (`claude-code.ts:80-86`). SDK `resume`, failure falls back to a cold session retry (spec 17 A7).
- **ACP**: two mechanisms, neither baseline. `loadSession` true permits `session/load`, and the agent must replay history via `session/update` before responding. `sessionCapabilities.resume` true permits `session/resume`, which the spec requires not to replay history (https://agentclientprotocol.com/protocol/v1/session-setup , read 2026-10-24). Gemini's `acp-mode.md` writes `loadSession` but not `session/resume`.
- **Gap and fill-in**: `continueSession` first looks at the initialize advertisement. resume if available; otherwise load if available; if neither, fail and let the existing cold-session retry take over, without pretending a continuation succeeded. Load's replay re-emits chunks. The bridge marks these updates as replay during load and does not write them as new transcript rows, otherwise the same session doubles. Whether Gemini docs' `loadSession` equals the protocol's `session/load` is checked in the first ticket with one real handshake; the docs' old method name must not be taken as the schema directly.

### 3.5 Cancellation

- **pi**: `stop()` calls `session.abort()` (`pi.ts:892` vicinity). abort's finale goes through `message_stop`.
- **claude-code**: `AbortController.abort()`, the result maps to `message_stop` on `interrupted` (`claude-code.ts:337-346`).
- **ACP**: covered. After `session/cancel`, the agent must end the original `session/prompt` with `stopReason: cancelled`; the client must answer still-pending `session/request_permission` with `cancelled` (prompt-turn page; https://agentclientprotocol.com/protocol/v1/cancellation also defines the generic `$/cancel_request`).
- **Gap and fill-in**: `stop()` only sends `session/cancel` and immediately answers unfinished permissions with `cancelled`. If the agent violates the protocol and throws the cancellation as an error, the bridge folds this `cancel already sent` error into `message_stop`, avoiding the step being recorded as failed. This is the protocol's own warning, not an extra invention.

### 3.6 The command-gate permission gate

- **pi**: yes. `tool_call` extension hooks `gateToolCallHandler` (`pi.ts:1040-1056`). The rule table adds default dangerous bash shapes; a hit blocks and turns the reason into a model-visible error tool result (`apps/daemon/src/backend/command-gate.ts:1-27`). In unattended operation `ask`'s execution semantics is refusal.
- **claude-code**: this bridge does not hook command-gate. `command-gate.ts:26-27` states claude-code still runs `bypassPermissions`, and whether the hook fires under bypass is unverified. The execution surface is `bypassPermissions` plus `disallowedTools` removing `AskUserQuestion`, and read-only steps additionally removing `Edit`/`Write` (`claude-code.ts:1107-1115`).
- **ACP**: does not cover this gate. The protocol is that the agent **may** call `session/request_permission` before executing (tool-calls page Requesting Permission). Option kinds are `allow_once` / `allow_always` / `reject_once` / `reject_always`. The example `toolCall` may carry only `toolCallId`. The client may auto-allow or reject per settings. Nothing requires `must ask before every shell`.
- **Gemini asks, but where the command text lives needs a probe.** `v0.65.0` `acpSession.ts:746-765` calls `requestPermission` on the confirm path, `toolCall` carrying `toolCallId`, `status: pending`, `title`, `content`, `locations`, `kind`. This round did not trace how the shell tool puts the command string into title or content. `acp-mode.md` writes `setSessionMode` can change the approval level (the example is `auto-approve`).
- **The filesystem is not a gate.** Same tag `acpFileSystemService.ts:51-53`: when the client does not advertise `readTextFile`, or the path is outside the session root, or the path falls under `~/.gemini`, it falls back to the local filesystem. So when the ACP file proxy is not implemented, Gemini still modifies the worktree directly. This matches how pi / claude-code work today.
- **Gap and fill-in**: the bridge implements `session/request_permission`. When the command string can be extracted from title/content, run the existing `command-gate`: approve selects `allow_once`, reject selects `reject_once`; the reason cannot be returned to the model through the ACP options (the protocol options have no reason field), so the next round after a rejection can only rely on the tool-failure state to make the model change course. No extractable command, or the agent never sends a permission: the gate sees nothing. The first-ticket probe must list which tools Gemini's default mode sends permissions for and which field holds the shell original text. If default is auto-approve, the probe switches to a mode that sends requests, then runs the gate. Do not advertise the auto-selection of `allow_always`, to avoid recording one approval as permanent. `readOnly` steps: prefer the agent's advertised read-only mode; without one, answer `reject_once` to all write-class permissions. This is weaker than claude-code's `disallowedTools` because a write that sends no request cannot be stopped.

### 3.7 MCP injection

- **pi**: `registerMcpServer`, endpoints from `SessionOpts.mcpServers`, failure degrades without blowing up the session (`pi.ts:1057-1062`). Tool names `mcp__<server>__<tool>`. Also an allowlist `mcp__*`.
- **claude-code**: `mcpServers` plus an in-process host server (remote/local tools). The managed set sends `strictMcpConfig`, sending even an empty array (`buildClaudeSdkOptions` and `mapMcpEndpoint` in `claude-code.ts`, around `:941-996`, `:1076-1096`). Malformed fields fail-closed.
- **ACP**: covers `the client handing MCP servers to the agent`. `session/new`, `session/load`, `session/resume` all carry `mcpServers`. stdio is baseline; `mcpCapabilities.http` / `sse` permit the corresponding transport (session-setup page MCP Servers, read 2026-10-24). SSE is noted on the initialization page as deprecated by the MCP spec.
- **Host tools (remoteTools / localTools) are unstable.** The draft https://agentclientprotocol.com/rfds/mcp-over-acp (read 2026-10-24) wants `"type": "acp"` to route tools through the existing ACP connection without another process. The draft is not v1 baseline.
- **Gap and fill-in**: `McpEndpoint` is already stdio or http (`agent-backend.ts:125-134`). stdio goes straight into `session/new`. http only when initialize advertised `mcpCapabilities.http`, else fail-closed, not silently rewriting http into another transport. Managed empty set: the protocol has no stable field for Copilot/Claude's strict switch. No protocol sentence `sending empty `mcpServers` forbids the agent's own MCP` was found this round. Gemini docs only say the client may hand over its own MCP. Hermes docs write the opposite direction: servers given by the editor are always added, and servers in Hermes's config remain unless the user turns them off in Hermes's own config. So an empty array must not be written as `strictly blank`. First-ticket behavior: send endpoints when present; send an empty array even when empty, and write in the diagnostic line `does not guarantee turning off the CLI's own MCP`. remoteTools / localTools fail-closed in the first ticket (same shape as spec 17 A10's original treatment of claude). To wire them later, use a small local stdio MCP process forwarding to `executeRemoteTool`, not that draft.

### 3.8 skills injection

- **pi**: the brief-file channel. The directory body is produced by `composeBody`, and the runner writes it into the worktree's `AGENTS.md` family that pi reads (`packages/shared/src/brief-file.ts:27-47`). Also an allowlist, team skill directories, and a Read gate for unauthorized skills. `systemPrompt` is reserved for backends without a brief channel (`pi.ts:1027-1030`).
- **claude-code**: the same brief channel, landing at `CLAUDE.md` (`brief-file.ts:40`, `claude-code.ts:1101-1105`). Unauthorized skills go through settings deny. The plugin channel has a version floor `MIN_CLAUDE_PLUGIN_VERSION = '2.1.74'` (`claude-code.ts:849`).
- **ACP**: the stable protocol has no system prompt and no skills method. `session/new`'s stable fields are cwd, mcpServers, optional additional directories. User content only goes through `session/prompt`. The draft https://agentclientprotocol.com/rfds/client-system-prompt (read 2026-10-24) states there is no `systemPrompt` field today, and gives examples of others using `_meta` or stuffing the description into the user message. `_meta` cannot be a contract.
- **Gemini's own files, not ACP.** Tag `v0.65.0` `docs/cli/gemini-md.md`: the workspace `GEMINI.md` is assembled into every turn's context. `docs/cli/skills.md`: skills are `SKILL.md` directories; user-level `~/.gemini/skills/` or `~/.agents/skills/`, workspace `.gemini/skills/` or `.agents/skills/` (the same-level `.agents/skills/` wins). After discovery the name and description go into the system prompt, invocation requires `activate_skill`, with confirmation.
- **Hermes**: the ACP page writes skills remain at `~/.hermes/skills/`, not reading Cairn's brief file.
- **Qwen**: the registry launch args carry `--experimental-skills`, only showing this vendor uses a CLI flag, not the protocol.
- **Copilot**: the changelog writes skills become slash commands in the ACP client. Those are Copilot's own skills, not the directory Cairn ships down.
- **Gap and fill-in**: do not wait for the draft. The Gemini first ticket, if it does skills, only adds the brief identity `gemini`, with the only candidate file `GEMINI.md` (`BRIEF_CANDIDATES` in `brief-file.ts`). This sends the directory body into every turn's context but does not match pi's Read gate nor `activate_skill`'s directory scan. For team skills to be seen by `activate_skill`, they must be materialized into the worktree's `.gemini/skills/` or `.agents/skills/` and erased per spec 24 to stay out of git. That is a later ticket. Hermes's skill root is in the user home directory, not the worktree, so the first ticket does not take it. For an ACP identity without a brief channel, `brief` is absent and the runner keeps the inline systemPrompt; but ACP cannot consume a system prompt, so today this text can only be a `session/prompt` user-message prefix. The draft itself treats such a prefix as not-good-enough. Therefore, apart from CLIs that have been verified to read some context file, skills injection is marked unsupported and fails closed with a diagnostic, not silently dropped.

### 3.9 Comparison summary table

| Capability | pi | claude-code | ACP stable protocol | Gap and fill-in | Source |
|---|---|---|---|---|---|
| Streaming messages | text/thinking delta, `message_end` | same, no inline stopReason | `agent_message_chunk` / `agent_thought_chunk` | append `message_end` on prompt return; images fail without the image capability | `pi.ts:636-668`; `claude-code.ts:206-267`; prompt-turn, content pages |
| Tool-call records | two-stage `toolcall_end`, with result | `tool_use` / `tool_result`, may carry todo | `tool_call` + `tool_call_update`, content may be diff/terminal | `failed`→`isError`; result stores raw content; todo left empty on mismatch | `pi.ts:659-736`; `claude-code.ts:245-290`; tool-calls page |
| stopReason / usage | inline stopReason; four-dim + optional five-item cost; `done` carries row set | result → done/error/message_stop; usage row may omit cost | stable stopReason five values; `usage_update` only used/size/optional cumulative cost | reason maps; four-dim and five-item cannot be filled from stable events. Unstable `usage` copied only when an implementation like Gemini really sends it; cancellation path may omit it | `pi.ts:673-754`; `claude-code.ts:308-347`; schema `PromptResponse`; unstable `Usage`; `acpSession.ts:381-538` |
| Session resume | `sessionResume: true`, session file | `sessionResume: true`, SDK resume | `session/load` replays, or `session/resume` does not; both must be advertised | choose by advertisement; load's replay is not persisted; neither → cold session | `pi.ts:80`; `claude-code.ts:85`; session-setup page |
| Cancellation | `abort` → `message_stop` | abort → `message_stop` | `session/cancel` → `cancelled` | map to `message_stop`; pending permissions answered cancelled | `pi.ts` stop/abort; `claude-code.ts:337-346`; prompt-turn Cancellation |
| command-gate | blocks on tool_call | not hooked; bypassPermissions | optional `request_permission`, no reason field | use the existing gate only when the command is extractable; none extractable or no request = gate not in effect, pinned by probe | `pi.ts:1040-1056`; `command-gate.ts:26-27`; tool-calls page; `acpSession.ts:746-765` |
| MCP injection | `registerMcpServer`, degrades on failure | mcpServers + strict + in-process host | stdio MCP in the session params; http/sse by capability bit | empty array does not guarantee turning off the CLI's own MCP; host tools fail-closed in the first ticket | `pi.ts:1057-1062`; `claude-code.ts` MCP section; session-setup page; Hermes ACP page |
| skills injection | brief into AGENTS.md family + allowlist gate | brief into CLAUDE.md + deny | no such method (system prompt still a draft) | Gemini can write `GEMINI.md`; directory-style skills and Hermes home-directory skills are separate tickets | `brief-file.ts:38-41`; client-system-prompt RFD; `gemini-md.md`, `skills.md` `v0.65.0` |

Mid-turn `steer` is not among the ticket's eight items, but the seam has this method (`agent-backend.ts:286-288`). v1 baseline has no `append more user text before the current prompt returns`. The claude-agent-acp README writes steering as that adapter's v1 extension, not protocol baseline. The bridge's `steer` has the same semantics as spec 17 A8's claude: queue it after this turn's `session/prompt` returns, sent as the next `session/prompt`.

## 4. `acp.ts` interface sketch

One bridge, many identities. It meets the trigger condition spec 17 wrote down: more than two runtimes, plus "same family, multiple identities" (the row where spec 17 declines the 12-field registry, `docs/spec/17-dual-runtime-execution-surface.md:80`). Do not copy Multica's 12-field descriptor. The identity table keeps only the launch argv, the brief filename, and "credentials stay on this machine".

Seam discipline: `biome.json`'s `noRestrictedImports` adds `@agentclientprotocol/sdk`, the only landing point `apps/daemon/src/backend/acp.ts`. Same law as `@earendil-works/*` → `pi.ts`, `@anthropic-ai/claude-agent-sdk` → `claude-code.ts`. The dependency goes into `apps/daemon/package.json`, the lockfile is authorized by the repo gate, and none of this is added in this research ticket.

`AgentBackend` keeps its method signatures. `createSession` / `continueSession` / `steer` / `stop` / `usage` stay at `agent-backend.ts:279-328`.

```ts
type AcpIdentity = {
  providerId: 'gemini';
  argv: readonly string[];
  briefFile: 'GEMINI.md' | null;
};

const GEMINI: AcpIdentity = {
  providerId: 'gemini',
  argv: ['gemini', '--acp'],
  briefFile: 'GEMINI.md',
};

function createAcpBackend(identity: AcpIdentity, opts: {
  onMcpLog?: (line: string) => void;
  onSkillsLog?: (line: string) => void;
  gateRules?: PermissionRule[];
}): AgentBackend;
```

What the bridge does when opening a session, in protocol order:

1. spawn `identity.argv`, stdin/stdout onto the SDK `client()`. stderr goes into the existing diagnostic line, never mixed into JSON-RPC.
2. `initialize`. Read `loadSession`, `sessionCapabilities.resume`, `promptCapabilities`, `mcpCapabilities`, modes.
3. If the agent requires `authenticate` and no completed login exists locally, the session fails, the wording pointing to that CLI's own login command. Never read, pass, or store tokens (spec 17 A4's direction).
4. `session/new` (or resume/load) with `cwd` and the §3.7 `mcpServers`.
5. For an identity with a brief channel, the runner has written the body into `briefFile`. The bridge does not stuff the system prompt into the user message.
6. `session/prompt` sends `opts.prompt` as a text block. Then map `session/update` into `StepEvent`.
7. `usage()` returns the rows §3.3 permits; empty array when none.

`capabilities` must not copy pi's seven thinking levels. `thinkingLevels` stays empty unless the agent advertises ids identical to `THINKING_LEVELS` in its session config. Out-of-domain tiers fail-closed, same as claude-code's effort. `oauthProviders` empty: login lives in the CLI's own home. `compaction` is judged by whether a compaction-class `session/update` is received; the sketch writes `false` first to avoid declaring support before a probe. `sessionResume` is only known after the handshake; a static `true` would make the UI lie. The first ticket writes the static value `false`, continuation decided by the handshake result and failing to a cold start. This is a deliberate difference from pi/claude declaring `true`.

The parse point is still `backendFor` (`apps/daemon/src/machine-loop.ts:230`, `apps/daemon/src/runner.ts:724`). Today `BACKEND_RUNTIME_IDS` only has `'claude-code'` (`agent-backend.ts:335`), and `stepRuntimeFor` treats every other provider as `pi` (`apps/server/src/services/dispatch-eligibility.ts:33-34`). Adding only the bridge without changing this vocabulary means a step with `provider = gemini` gets claimed by a pi machine and then finds no model in pi.

Do not advertise client-side filesystem and terminal capabilities. Gemini uses the local filesystem to modify the worktree when `readTextFile` is missing (`acpFileSystemService.ts:51-53`). Cairn keeps using its own worktree and git wrap-up rather than reimplementing file read/write.

## 5. Impact on spec 17, ADR 0018, ADR 0020

### spec 17

spec 17's fork shape keeps applying: identity is vocabulary, family is an `AgentBackend` implementation, claim stays shared, and the fork lives only in `backendFor`. No registry was set up back then because there were only two runtimes and pi was not a CLI (`docs/spec/17-dual-runtime-execution-surface.md:50`, `:80`). ACP is exactly "a third family + multiple identities in one family". The landing spot is the small table in section 4, not a second model-source vocabulary and not a 12-field descriptor.

Existing vocabulary that must change together — missing one mis-claims the step:

- `BACKEND_RUNTIME_IDS` adds `'gemini'`. `isBackendRuntimeId` true goes through the zero-credential branch (runner and server `toProviderConfig` already fork on this guard).
- `MACHINE_RUNTIMES` is `['pi', 'claude-code']` today (`packages/shared/src/records/machine.ts:14`). PATCH `enabledRuntimes` uses this enum. Without adding `'gemini'`, the machine switch cannot write this runtime.
- `stepRuntimeFor`'s return type is `'pi' | 'claude-code'` today. Gemini must map to `'gemini'`, otherwise #682's gate (`dispatch-eligibility.ts:39-43`, the real `enabledRuntimes` gate in `machines.ts`) would release it via pi's switch.
- `briefBackendForProvider` (`brief-file.ts:70-71`) and `backendFor` must share the same judgment. Gemini writes `GEMINI.md`, not `AGENTS.md` or `CLAUDE.md`.
- The `StepEvent` vocabulary stays.
- `pi.ts` and `claude-code.ts` stay. The default branch remains: providers outside the new vocabulary still go to pi.

spec 17 A12 wrote enabledRuntimes is not consumed in the first ticket. That was overturned by #682: claim now reads the switch. A new runtime enters the switch from day one, otherwise any pi-enabled machine claims Gemini steps.

### ADR 0018

The orchestration model needs no rewrite. Agents still do not bind to machines; dispatch reads the machine-reported capability snapshot (`docs/adr/0018-multi-agent-team-three-layers-machine-capability-gate.md` decision 4).

The existing snapshot does not cover `does this machine have the gemini binary`:

- `machineCapabilitiesSchema` is MCP slugs, local skill directory names, optional hardware (`packages/shared/src/records/machine-capabilities.ts:45-52`).
- `requiredCapabilitiesSchema`'s `models` only judges `claudeCodeReport` (same file `:82-84`). With no Gemini model report, this dimension passes as unknown.
- The runtime dimension is deliberately not in `requiredCapabilities`, because `enabledRuntimes` is already the gate (same file `:75-76`). Gemini going through this gate suffices; there is no need to stuff the `binary presence` into the MCP/skill list. The binary-missing failure point sits at bridge spawn: the process fails to start, the step fails, the wording states the command to install. This is the same class as `claude auth missing fails on the first query`, not a 400 on the heartbeat (ADR 0018's field-level tolerance).

Model discovery must not reuse `claudeCodeReport`. Gemini's model list is a separate fact. The first ticket passes the model id verbatim from `agent.modelId` into the session config; when the agent has no model config item, ignore modelId and log a diagnostic, not calling Gemini with pi's provider config. Discovery and reporting are follow-up tickets, shape aligned to spec 17 T3, not squeezing Gemini models into the `~/.claude/settings.json` read path.

### ADR 0020

The recommended-concurrency formula is unchanged. Inputs stay `cpuCores` and `memoryTotalMb`, 2 GiB per slot, clamped to 1..16 (`docs/adr/0020-machine-recommended-concurrency-capability-fingerprint-formula-coverage-priority.md:15-18`). The fingerprint is machine configuration, not an agent-protocol item. One extra process for external CLIs does not change the already-written-down "use totals, not availability" rationale.

This ticket does not change the slot size to `external CLIs eat more memory`. That needs measurement, and would overturn `the recommendation is decided by machine config alone and does not jitter between adjacent beats`. To change it later, open a separate ADR 0020 revision, not squeezed into the ACP bridge.

## 6. How much the trajectory pack (#1511) can reconstruct

Most fields in `trajectoryPackSchema` (`packages/shared/src/trajectory-pack.ts:10-78`) are Cairn's own ledger, not agent events.

**Fillable from Cairn's existing ledger, unrelated to ACP:**

- `input.spec`, `sourceRef`, `baseSha`, `persona`, `agentId`, `harnessHash`: claim / build / persona records.
- `input.skillInjection`: `skillInjectionSchema` is the hit list at dispatch time (`packages/shared/src/skill-inject.ts:44-46`), not agent-side return.
- `input.model`: the model string this repo selected. ACP does not guarantee echo. Gemini puts per-model names in `_meta.quota`, and `_meta` must not be relied on. The model string keeps using Cairn's existing `agent.modelId`.
- `process.steps[].stepId`, `kind`: step kinds are `plan/build/merge/chief/review/verify` (`packages/shared/src/records/step.ts:21`), ACP has no such enum.
- `process.steps[].checkpointCommit`: git, not ACP.
- all of `judgments`: confirmation, revision, diff approval, gate decisions. These are written by humans and Cairn's gates.
- `outcome.merged`, `revertedWithin7d`, `fixedByLaterPr`: merge and rollback, in GitHub / git.

**Projectable into transcript from stable ACP events:**

- `process.steps[].transcript` rows are `transcriptRowSchema`: role, content, plus id, createdAt, optional actor (`message.ts:36-40`). content is `unknown`. `agent_message_chunk` can assemble assistant text rows; tool calls can assemble content in the `toolcall` shape. The user prompt is a user row.
- Cannot assemble pi-style inline `stopReason` + per-message `usage` + `cost`, unless going through §3.3's unstable fields, and cancellation responses often lack them.
- Load replay, if persisted, would write old turns again. §3.4 requires replay not be persisted.

**Cannot be fully reconstructed:**

- `process.plans`: `planRowSchema` is a plan.md version row (id, buildId, version, createdAt, content string, `packages/shared/src/records/plan.ts:31-34`). ACP's agent plan is the in-session step-list update (https://agentclientprotocol.com/protocol/v1/agent-plan ), not this four-section document, and has no v1/v2 version number. One can store `ACP plan text` separately into transcript, but not as `plans[]`.
- `process.token_usage`: `tokenUsageSchema` needs model, input, output, cacheRead, cacheWrite, and five-item cost (`token-usage.ts:12-29`). Stable `usage_update` does not match. Unstable `Usage` lacks cost, Gemini's implementation lacks cache write, and the description mixes in `cross-session accumulation`. Not a full reconstruction.
- `outcome.costTotal`: only when `usage_update.cost.amount` exists and the currency is USD can it be a candidate cumulative-cost number. It is optional, and the Gemini `usage_update` block read this round sends no cost. Keep null when absent; do not treat the `used` token count as money.

Conclusion: the trajectory pack's process text and tool trajectory can gain one more ACP projection; token, cost, plan versions, decisions, and outcome still take Cairn's own records as canonical. Missing events mean missing fields — never use 0 to fake `measured zero`.

## 7. Implementation ticket draft

Recommended. Split into two; the second does not block the first's conclusion, but must not be merged into the first.

### Ticket A · one bridge minimum closed loop for Gemini

**Title**: `daemon(acp): Gemini CLI as the third execution surface — stdio ACP bridge, vocabulary, and zero credentials`

**Verifiable closed loop**: on a machine with `gemini` installed and already logged in locally, a worker step with provider gemini can claim, run to completion, have text and at least one tool call in the transcript, `done` usage may be an empty array, and sessionId is returned. A second step uses that sessionId through `session/load` or `session/resume` (per the handshake advertisement). The existing pi and claude-code probes on the same machine stay green. A machine without gemini installed: the step fails, the wording contains an install hint, and the heartbeat is not 400'd.

**Boundaries**:

- New `apps/daemon/src/backend/acp.ts` (the only `@agentclientprotocol/sdk` import)
- `biome.json` adds this restriction
- `apps/daemon/package.json` and `pnpm-lock.yaml` (lockfile gate authorized)
- `BACKEND_RUNTIME_IDS` in `packages/shared/src/agent-backend.ts`
- `MACHINE_RUNTIMES` in `packages/shared/src/records/machine.ts`
- `stepRuntimeFor` in `apps/server/src/services/dispatch-eligibility.ts`
- `packages/shared/src/brief-file.ts`: gemini → `GEMINI.md`
- `backendFor` and the zero-credential branch in runner / machine-loop, short-circuit only for the new id
- probes and `docs/verify/<ticket>/`

**Explicitly unchanged**: the internals of `pi.ts`, `claude-code.ts`; the `StepEvent` vocabulary; selectors other than web wording (if the vocabulary is a selector's data source, only add this id); the ADR 0020 formula; the judgment scope of `requiredCapabilities.models`; remoteTools / localTools (absent or empty = do not build; non-empty = fail-closed); Hermes / Copilot / Codex.

**List failure modes first**:

1. Machine lacks a `gemini` executable → spawn fails → step error contains `gemini not found`, not recorded as pi's `model not found`.
2. Not logged in → `authenticate` or first prompt fails → wording points to Gemini's own login, the daemon does not read the token.
3. Forgetting to add gemini to `BACKEND_RUNTIME_IDS` → the step is treated as pi by `stepRuntimeFor` → branch test pins `provider gemini has runtime gemini, other unknown providers remain pi`.
4. A machine without gemini in `enabledRuntimes` claims the step → claim test pins the gate.
5. Brief written into `AGENTS.md` → Gemini does not read it → test pins `briefBackendForProvider('gemini')` file name is `GEMINI.md`.
6. `session/load`'s replay treated as new uploads → transcript row count doubles → probe compares row counts before/after load.
7. `promptImages` present but handshake has no image capability → session creation fails, not silently dropping images.
8. Non-empty `remoteTools` or `localTools` → fail-closed, error contains fail-closed.
9. After cancellation the agent throws a normal error → bridge folds it into `message_stop`, step not failed.
10. SDK `2.0.2` and Gemini's pinned `0.16.1` handshake disagree → initialize failure must carry both parties' `protocolVersion`, not swallowed into an empty transcript.

**Acceptance**: probe transcripts (text + one tool call + done), sessionId, continuation without double write, pi and claude-code regression, lint / typecheck, affected unit tests. Evidence into `docs/verify/<ticket>/`.

### Ticket B · permission probe and command gate (depends on ticket A's real Gemini session)

**Title**: `daemon(acp): wire Gemini's request_permission into command-gate`

Ticket A does not claim the command gate is in effect. Ticket B first prints the title/content/kind of shell-class permissions in a real session. Only when the command original text appears in some field does it map `gateToolCallHandler`'s ruling into `allow_once` / `reject_once`. If it cannot map, keep ticket A's behavior (client treats it as `no gate`: no automatic `allow_always`), and write the field down in the research note, not guessing.

Read-only steps: switch to a read-only mode when available; without one answer `reject_once` to write-class permissions. The probe must have one dangerous command rejected by the gate (using command-gate's existing default shapes) and one ordinary command approved.

### Not doing yet

- Replacing `claude-code.ts` with `claude-agent-acp`.
- Using `codex-acp` or `pi-acp` as an execution surface. One more hop, and pi is already in-process.
- Copilot and Hermes as second and third identities. Wait until ticket A's handshake, continuation, and cancellation are green on Gemini, then open one ticket each that only adds an `AcpIdentity`. Copilot is still public preview on the agents page. Hermes is not in the registry, and its skill root sits under `~/.hermes`, which the brief channel cannot match.
- Writing unstable `usage` into the trajectory pack's `token_usage` as a complete account. At most it appears optionally on the done row; the trajectory pack keeps allowing cost 0 and missing-where-missing.
- Changing ADR 0020's 2 GiB slot.