# Unified ACP Surfaces and Stdio MCP Design

## Goals

1. Unify all ACP host-tool bridges (`devin`, `antigravity`, `gemini`) onto `stdio` MCP so Cairn never requires ACP agents to declare `mcpCapabilities.http`.
2. Preserve support for user-configured external HTTP MCP connectors by bridging them over `stdio` whenever an ACP agent lacks `mcpCapabilities.http`.
3. Unlock all step kinds and conversations (`chief`, `review`, `digest`, `mail`, `info-cards`, and worker steps) across all ACP runtimes cleanly instead of failing closed on policy flags, `thinkingLevel`, or `skills`.

## 1. Host Tools and External MCP over Stdio (`openAcpTools` & `bridgeHttpMcpToStdio`)

### Architecture

Previously `openAcpTools` started an HTTP server with `StreamableHTTPServerTransport` and returned `{ type: 'http', url, headers }`, which forced ACP backends to fail when `caps.mcpCapabilities?.http` was absent (e.g. `agy acp`).

The unified design replaces HTTP with loopback TCP + `StdioServerTransport`:

- **Host tools (`openAcpTools`)**:
  - Daemon binds `net.createServer` on `127.0.0.1:0` with a per-session random 32-byte hex secret token.
  - Each accepted TCP socket exchanges a newline-delimited token authentication line (`<token>\n`); unauthenticated sockets are destroyed immediately and bad tokens receive `{ error: 'unauthorized' }` before destroy.
  - Once authenticated, the socket attaches an MCP `Server` via `@modelcontextprotocol/sdk/server/stdio.js` (`StdioServerTransport(socket, socket)`).
  - The backend receives an ACP stdio `McpServer` descriptor:
    `{ name: opts.name, command: process.execPath, args: ['-e', relayScript, String(port), token], env: [] }`.
  - The short inline Node relay script inside the agent's child process opens `net.createConnection(port, '127.0.0.1')`, writes `<token>\n`, and pipes `process.stdin <-> socket <-> process.stdout`.
  - Under macOS Seatbelt and Linux bubblewrap, loopback TCP (`127.0.0.1`) is already reachable (`(allow network-outbound (remote ip "localhost:*"))` / host netns) when `remoteTools` is enabled, so child processes connect cleanly with zero Unix socket path issues.
  - `close()` destroys all active client sockets, closes all attached MCP server instances, and closes the TCP server.

- **External HTTP MCP (`bridgeHttpMcpToStdio`)**:
  - User-configured MCP connectors that use HTTP transport (`type: 'http'`) pass through directly only when `caps.mcpCapabilities?.http === true`.
  - When `!caps.mcpCapabilities?.http`, `bridgeHttpMcpToStdio` wraps each external HTTP connector behind a lightweight stdio Node relay (`process.execPath -e`) that creates an MCP stdio `Server` (handling `tools/list` and `tools/call`) backed by an HTTP MCP `Client` (`StreamableHTTPClientTransport`) carrying the configured headers and URL.
  - If an external HTTP MCP fails to connect during session setup, the backend logs or surfaces the structured startup failure cleanly and tears down any already-started stdio bridges in `finally` / `dispose()`.
  - When `opts.remoteToolsOnly` is enabled (e.g. `info-cards`), external MCP servers from `opts.mcpServers` are omitted so only the scoped Cairn host tools remain attached.

### States and Failure Handling

| Path / State | Trigger | Behavior |
| --- | --- | --- |
| Token valid on TCP socket | Child relay writes `<token>\n` | Socket attaches to `StdioServerTransport`, serves `tools/call` against `executeRemoteTool`. |
| Bad or missing token | Rogue local process connects | Server rejects and destroys socket; never exposes `executeRemoteTool`. |
| First line timeout / oversized header | Stalled local connection | Socket destroyed without creating MCP server instance. |
| `!caps.mcpCapabilities?.http` with HTTP connector | Connector present in `opts.mcpServers` | Bridged to `{ name, command: process.execPath, args: [...] }` via `bridgeHttpMcpToStdio`. |
| `caps.mcpCapabilities?.http === true` | Agent supports HTTP MCP | External HTTP connectors passed natively; Cairn host tools still use `stdio` unconditionally. |
| Session close or startup abort | Normal finish or thrown error | Destroys TCP sockets, closes host MCP servers, closes TCP listener. |

## 2. ACP Policy Modes & `requestPermission` Enforcement

Previously `acp.ts` threw when `opts.restricted`, `opts.readOnly`, `opts.remoteToolsOnly`, `opts.thinkingLevel`, or `opts.skills` were set. This prevented `review`, `digest`, `mail`, `chief`, and `info-cards` from running on ACP backends.

### Policy State Mapping

- `policyMode`:
  - `'worker'` (`!restricted`): edits and command execution are permitted; `requestPermission` approves all options with `allow_always ?? allow_once`.
  - `'readOnly'` (`restricted && !remoteToolsOnly`, e.g. `review`):
    - Host tools in Cairn's bridge (`mcp__cairn__*`, or unqualified tool names registered by `openAcpTools`) are allowed.
    - Read-only / exploration ACP tool kinds (`'read'`, `'search'`, `'think'`, `'fetch'`) are allowed.
    - Mutating or execution tool kinds (`'edit'`, `'delete'`, `'move'`, `'execute'`, `'switch_mode'`, or untyped tools outside the allowed Cairn host tool set) are rejected via `reject_once ?? reject_always` (or `{ outcome: { outcome: 'cancelled' } }` if no reject option exists).
  - `'remoteToolsOnly'` (`remoteToolsOnly === true`, e.g. `info-cards` and locked-down summaries):
    - Only Cairn's registered host tools (`mcp__<bridgeName>__*`) are allowed in `requestPermission`; workspace file/shell tool kinds (`read`, `search`, `edit`, `delete`, `move`, `execute`, `fetch`, etc.) are rejected.
    - External `opts.mcpServers` are stripped from `session/new`.
    - Process/OS confinement remains active via `launchConfined` in `runner.ts`.

### Mode Selection on `session/new`

When `modeOptions` are advertised by the ACP agent:
- Prefer a plan/read-only mode (e.g. `'plan'` or `'default'`) when `restricted || readOnly || remoteToolsOnly`, avoiding `'auto'` / `'accept-edits'` / `'bypassPermissions'`.
- Prefer an unrestricted/auto mode (`'auto'`, `'bypassPermissions'`, `'default'`) only when `!restricted`.

## 3. Uniform `thinkingLevel` and `skills` Handling

- **`thinkingLevel`**:
  - After `session/new` (or `session/load`), inspect `configOptions` for `category === 'thought_level'`, `id === 'thought_level'`, or `id === 'effort'`.
  - If found and a matching option value exists for `opts.thinkingLevel` (or closest supported fallback when mapped), invoke `setSessionConfigOption`.
  - If the agent exposes no thinking config option or does not support the exact level, continue gracefully without throwing (`unsupported` config option is ignored).
- **`skills`**:
  - `apps/daemon/src/machine-loop.ts` passes selected skills (`buildRunSkillPrompt` or structured skill instructions) on `opts.skills` into ACP backends just like `claude-code` and `pi`.
  - `acp.ts` composes `opts.skills` into the prompt brief body so every ACP runtime (`devin`, `antigravity`, `gemini`) receives active workflow/domain skills instead of throwing.

## 4. Non-`pi` Coordinator (`chief`) Claim & Ephemeral Token Delivery

Previously `machine-claim.ts`, `coordinator-steps.ts`, `claude-account-hold.ts`, `credentials.ts`, and `machine-step-token.ts` restricted Coordinator `chief` claim and `chiefStepToken` delivery to `claude-code` / `codex` / `pi`, omitting `devin` (and new ACP runtimes).

### Changes across Server Claim & Credential Delivery

1. `apps/server/src/services/coordinator-steps.ts`:
   - `parseChiefHarness` / accepted Coordinator harnesses accept `'claude-code' | 'codex' | 'pi' | 'devin'` (and subsequently `'antigravity' | 'gemini'` as supported).
   - `chiefNeedsClaudeHold` checks only `harness === 'claude-code'`.
2. `apps/server/src/services/machine-claim.ts`:
   - Coordinator claim path accepts `devin` (and later `antigravity`) along with account subscription hold checks on `subscriptionIds` (mirroring `devinSubscriptionId` checks from worker claim).
   - `agent-model-select.tsx` (`runtimeOfProvider`) maps `devin` providers directly instead of forcing everything non-`claude`/`codex` to `pi`.
3. `apps/server/src/services/credentials.ts` & `apps/server/src/services/machine-step-token.ts`:
   - `chiefStepToken` checks credentials and mints encrypted credential envelopes for `devin` (and `antigravity`) Coordinator steps identically to worker steps, using the subscription attached to the step.
4. `apps/daemon/src/step-preflight.ts`:
   - Remove the restriction rejecting non-worker `stepKind` for `devin` so Coordinator, review, digest, mail, and info-card steps pass Runner preflight.

## 5. `infoCardPlan` Runner Dispatch Unification

Previously `apps/server/src/services/info-card.ts` only enqueued Runner steps when the resolved runtime was `'pi'` (`harness === 'pi'`), blocking all non-`pi` runtimes (`claude-code`, `codex`, `devin`, `antigravity`, `gemini`) or forcing fallback paths.

### Target Behavior

- Any resolved runtime configured in Model Routing for `info_cards` can be claimed and executed on the Runner (`remoteToolsOnly: true`, stdio Cairn host tools attached for card/proposal creation).
- If no online Runner can handle the chosen runtime, dispatch surfaces the same explicit unavailable reason as other Runner-backed steps.

## 6. Test Matrix (One Test per Path)

1. `acp-tools`: stdio MCP server binds loopback TCP, rejects invalid/missing token sockets, authenticates valid token, executes remote tool call, and cleanly shuts down sockets/servers.
2. `acp-tools`: `bridgeHttpMcpToStdio` wraps HTTP MCP server config into an ACP stdio descriptor when `!caps.mcpCapabilities?.http`.
3. `acp`: `GeminiBackend` opens `openAcpTools` stdio bridge without throwing when `remoteTools` is set; non-`http` `mcpCapabilities` succeeds without `StreamableHTTPServerTransport`.
4. `acp`: `requestPermission` enforces `worker` (allows mutating tools), `readOnly` (allows `read`/`search`/`think`/Cairn tools, rejects `edit`/`execute`), and `remoteToolsOnly` (allows only Cairn host tools, rejects `read`/`execute`, strips external MCP servers).
5. `acp`: `thinkingLevel` maps to `configOptions` when present and is ignored gracefully when absent; `skills` composes into brief body cleanly.
6. `step-preflight`: `devin` accepts Coordinator (`chief`), `review`, `digest`, `mail`, and `info_card` steps without `unsupported_step_kind`.
7. `server`: Coordinator `chief` claim claims a `devin` step with valid subscription/credentials and mints `chiefStepToken`; rejects hold conflicts only for `claude-code`.
8. `server`: `info-card` service schedules Runner step for non-`pi` runtimes (`claude-code`, `devin`) rather than rejecting non-`pi`.
