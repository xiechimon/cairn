# 1607 · 用 ACP 做通用执行面

> 目的：回答 #1607。Cairn 每接一个执行面就写一座桥（`pi.ts`、`claude-code.ts`）。能不能改成一座 ACP 客户端桥，把 codex / gemini cli / copilot cli / hermes 等挂成看板上的 agent。
> 本票只调研，不改产品代码。
> 本仓基线：`e5d0639b`（2026-10-24，`lane/1607-acp-research` 与 `origin/main` 同提交）。下文 `路径:行号` 都锚在这一提交。
> 外部查阅日：2026-10-24。协议页的 HTTP 发布时间也是这一天（Mintlify `Published Time: Sat, 24 Oct 2026`）。登记册 JSON 取自 `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`（`version` 字段为 `1.0.0`，43 个 agent）。
> 出处两类：本仓 = 读到的 `路径:行号`；外部 = 该日打开的官方页、登记册或标签上的源文件。写「未找到一手出处」的条目，本轮没有打开到对应原文。

## 0. 结论

1. **做，但不要用 ACP 换掉现有两座桥。** pi 是进程内库，claude-code 是 Agent SDK 桥，两边已经把流、工具、用量、会话、命令闸或严格 MCP 接到 `AgentBackend` 上。ACP 适合第三族：本机已安装、自己持有登录态的外部 CLI。
2. **先接 Gemini CLI。** 官方二进制自带 `--acp`（登记册 `@google/gemini-cli@0.65.0`，发布 `2026-10-20`）。TypeScript SDK 文档把它列为参照实现。不需要再套一层适配器进程。
3. **Codex 与 Claude Code 先不走 ACP。** 官方 agents 页写的是适配器，不是 CLI 自己的 ACP 子命令。Claude 这边本仓已有更密的 SDK 桥，换适配器会把已经接上的用量、技能拒绝规则和严格 MCP 丢掉。
4. **Copilot CLI 是原生 `--acp`，但 agents 页到查阅日仍标 public preview。** Hermes 是原生 `hermes acp`（`v0.22.5`，`2026-10-23`），但不在鉴权登记册的 43 个条目里。这两家排在 Gemini 探针绿了之后。
5. **轨迹包不能从 ACP 事件完整还原。** 稳定协议能还原的是文本流、工具调用、停止原因，以及可选的上下文占用和累计费用。四维 token、缓存写、五分项费用、计划文档版本、闸判定、合并结果都不在稳定事件里。

## 1. 协议与 SDK（桥要消费的那一层）

ACP 是编辑器（客户端）和编码 agent（服务端）之间的 JSON-RPC。本地默认走子进程 stdio。远程 HTTP / WebSocket 在介绍页写明仍在做。

- 介绍：https://agentclientprotocol.com/get-started/introduction （查阅 2026-10-24）
- 协议 v1 总览与方法：https://agentclientprotocol.com/protocol/v1/overview （同日）
- schema 正本：`agentclientprotocol/agent-client-protocol` `schema/v1/schema.json`，`main` 提交 `a0c3d83e5277a5b419dcd083742c0a14dc298d21`，提交时间 `2026-10-24T05:54:14Z`
- 不稳定增补：同仓 `schema/v1/schema.unstable.json`（同一次抓取）
- TypeScript 库：https://agentclientprotocol.com/libraries/typescript （同日）。npm `@agentclientprotocol/sdk` 最新版 `2.0.2`（`registry.npmjs.org` 同日；GitHub release `v2.0.2` 发布于 `2026-10-23T19:37:11Z`，仓 `agentclientprotocol/typescript-sdk`）
- 登记册说明：https://github.com/agentclientprotocol/registry `README.md`。索引 URL 见该 README。登记册只收「握手能返回有效 `authMethods`」的 agent，CI 会核。

客户端基线方法（v1 initialization，查阅 2026-10-24）：每个 agent 都必须支持 `session/new`、`session/prompt`、`session/cancel`、`session/update`。`session/load`、`session/resume`、HTTP/SSE MCP 是能力位，缺了就不能调用。

https://agentclientprotocol.com/protocol/v1/initialization

## 2. 2026-10-24 谁在提供 ACP server

判定分三档。

- **原生**：官方 CLI 自己的参数或子命令说 ACP JSON-RPC，登记册启动的就是这个二进制。
- **适配器**：另一个进程把 ACP 翻译成该 CLI 的私有协议。官方 agents 页用 “via” 标出来。
- **文档有、登记册无**：上游文档写了 server，但当天的鉴权登记册没有这条。

官方名单页（含 “via” 字样）：https://agentclientprotocol.com/get-started/agents （`Published Time: Sat, 24 Oct 2026 13:15:48 GMT`）

### 2.1 票面点名的几家

**Gemini CLI，原生，先接这一家。**

- 登记册 id `gemini`，版本 `0.65.0`，启动 `npx @google/gemini-cli@0.65.0 --acp`
- 发布：`google-gemini/gemini-cli` release `v0.65.0`，`2026-10-20T21:17:57Z`，标题 `Release v0.65.0`
- 文档在标签 `v0.65.0` 上存在：`docs/cli/acp-mode.md`（blob sha `a5f9b6a63a3aa539cf35c5b58e3135a1540c19d4`，4684 字节）。正文写 `gemini --acp`，stdio JSON-RPC，并列出 `initialize` / `authenticate` / `newSession` / `loadSession` / `prompt` / `cancel` / `setSessionMode`。文档用的方法名是旧拼写，协议现行名是 `session/new` 这一组；以 schema 为准，文档只证明「这个二进制有 ACP 模式」。
- 源码同标签：`packages/cli/src/acp/`。`package.json` 把 `@agentclientprotocol/sdk` 钉在 `0.16.1`。桥若改用 SDK `2.0.2`，靠的是协议版本协商，不是同一份类型包。
- agents 页直接链到 `google-gemini/gemini-cli`，没有 “via”。
- SDK 文档 “Users” 节把 Gemini CLI 的 `packages/cli/src/acp` 当作可抄的 agent 实现。

**GitHub Copilot CLI，原生，仍被官方名单标成 public preview。**

- 登记册 id `github-copilot-cli`，版本 `1.0.103`，启动 `npx @github/copilot@1.0.103 --acp`
- 发布：`github/copilot-cli` release `v1.0.103`，`2026-10-22T16:21:56Z`。该标签的 `changelog.md` 首节就是 `## 1.0.103 - 2026-10-22`，第一条 ACP 相关是 “ACP sessions now honor saved sandbox settings and --sandbox/--no-sandbox flags, including on resume.”
- `--acp` 首次出现在 changelog `## 0.0.397 - 2026-01-28`：“Add --acp flag to start as Agent Client Protocol server”。
- 公告：https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/ （页面时间 `2026-01-28T07:00:30-08:00`）。正文写 `copilot --acp`（stdio）以及 `copilot --acp --port 8080`（TCP）。
- agents 页查阅日仍写 “in public preview”，链接就是上面那篇。本轮没有找到把 ACP 从 preview 改成 GA 的后续公告。
- changelog 里和能力对照有关的原句（版本见该文件小节标题）：`1.0.78`（2026-08-03）“Expose token usage in ACP prompt results and live usage_update notifications”；更早条目写 MCP（stdio、HTTP、SSE）可在 session 开始或 load 时由客户端提供，skills 在 ACP 客户端里作为 slash command，以及 `load` 已有会话、permission flags、`closeSession`。

**Codex，适配器，不是 `codex` 二进制的 ACP server。**

- agents 页原文：“Codex CLI (via ACP's adapter)”，链接 `https://github.com/agentclientprotocol/codex-acp`
- 登记册 id `codex-acp`，版本 `2.2.2`，启动 `npx @agentclientprotocol/codex-acp@2.2.2`（没有 `--acp`，这个包自己就是 server）
- 适配器 release `v2.2.2`，`2026-10-10T03:15:52Z`
- README（同日读）：`codex-acp` 是 stdio ACP server，它再拉起 Codex App Server。npm 包自带兼容的 `@openai/codex`；`CODEX_PATH` 才改用别的二进制。README 列出的映射包括 shell、文件变更、permission、MCP、终端、reasoning、plan、token usage。这些是适配器行为，不是协议保证。
- `openai/codex` 最新 release 是 `rust-v0.164.0`，`2026-10-23T04:48:10Z`。本轮用 `gh search code` 在该仓搜 `agentclientprotocol`、`--acp`、`codex acp`，没有命中文档或源文件（一次锁文件哈希里碰巧含有字母 `acp`，不算）。未找到 Codex CLI 自身实现 ACP server 的一手出处。

**Claude Code，适配器。本仓不要改走这条。**

- agents 页原文：“Claude Agent (via Zed's SDK adapter)”，链接 `https://github.com/zed-industries/claude-agent-acp`
- 登记册 id `claude-acp`，版本 `0.95.0`，仓已是 `agentclientprotocol/claude-agent-acp`，启动 `npx @agentclientprotocol/claude-agent-acp@0.95.0`。作者栏写 Anthropic、Zed Industries、JetBrains。许可 `proprietary`
- 适配器 release `v0.95.0`，`2026-10-23T19:59:08Z`
- README：用 Claude Agent SDK 实现 ACP agent。列出工具权限、客户端 MCP、slash commands、子会话。本轮在 README 特性列表里没有看到与 Cairn `ModelUsage` 四维计数加五分项费用同形的字段。
- `gh search code` 在 `anthropics/claude-code` 搜 `agentclientprotocol`、`--acp`、`acp server`，没有命中。未找到 Claude Code CLI 自身提供 ACP server 的一手出处。
- 本仓 `apps/daemon/src/backend/claude-code.ts` 直接消费 `@anthropic-ai/claude-agent-sdk`（`biome.json` 把这个包锁在该文件）。再套一层 ACP 适配器，中间多一跳，并且要重做已经落地的映射。

**Hermes，文档与源码是原生 server，不在鉴权登记册。**

- agents 页有一条：“Hermes Agent”，链接 https://hermes-agent.nousresearch.com/docs/user-guide/features/acp
- 该页（查阅 2026-10-24）写：`hermes acp`、`hermes-acp`、`python -m acp_adapter` 三种启动；stdout 只跑 ACP JSON-RPC。编辑器下发的 `session/new` MCP 与 Hermes 自己配置里的 MCP 分开，前者总会加上。技能、记忆、凭据沿用 `~/.hermes/skills/`、`~/.hermes/config.yaml`、`~/.hermes/.env`。
- 标签核对：`NousResearch/hermes-agent` release `v0.22.5`（`Hermes Agent v0.22.5`，`2026-10-23T05:28:45Z`）。该标签上 `website/docs/user-guide/features/acp.md` 存在（blob sha `4c235539e838d7d5d219d0c84d61e79fa43616af`）。`hermes_cli/subcommands/acp.py` 的帮助文案是 “Run Hermes Agent as an ACP (Agent Client Protocol) server”。
- 当天登记册 43 个 id 里没有 `hermes`。登记册 README 写明只收通过 auth 校验的条目。所以 Hermes 能当 server 用，但不能把它写成「已进官方登记册」。

**pi，本仓已内嵌，不要再经 ACP 绕一圈。**

- agents 页：“Pi (via pi-acp adapter)”，链接 `https://github.com/svkozak/pi-acp`
- 登记册 id `pi-acp`，版本 `0.0.34`，启动 `npx pi-acp@0.0.34`
- 本仓 pi 执行面是库内 `PiBackend`，不是 spawn `pi` CLI。

**票面提到的 Raven。**

- 来源写的是 Claude artifact `https://claude.ai/artifact/Hm8AZ2JEGjebVu6KzbMTSe`。该 URL 要登录，本轮没有打开，未找到这份 artifact 的公开一手页。
- agents 页另有公开条目：“Raven (`raven acp`)”，链接 https://evermind-ai.github.io/Raven/agent-protocols/ 。从名单上下文看，Raven 是驱动别的 ACP agent 的宿主，不是 Cairn 要去 spawn 的 server。本轮没有打开该文档正文逐项核对「13 个 agent」这个数字，不把票面这句当成已核实事实。

### 2.2 同日登记册里、本轮没有逐份打开上游文档的条目

下面只转述登记册 JSON 的 id、版本、启动参数。没有打开对应 README 的，不额外声称「原生」或「适配器」。`grok-build` 的参数是 `agent stdio`，不是 `acp`，本轮未打开 https://x.ai/cli 核对它是不是 ACP JSON-RPC，所以不把它算进已证实的 ACP server。

官方产品二进制或官方 npm 包、参数里带 `acp` 的（登记册原文）：

- `auggie` `0.36.0`，`npx @augmentcode/auggie@0.36.0 --acp`
- `bob` `2.0.9`，`npx @ibm/bob@2.0.9 acp`
- `cline` `3.0.73`，`npx cline@3.0.73 --acp`
- `codebuddy-code` `2.174.0`，`npx @tencent-ai/codebuddy-code@2.174.0 --acp`
- `cortex-code` `1.0.73`，`cortex acp serve`
- `cursor` `2026.10.22`，`cursor-agent acp`（登记册 website：https://cursor.com/docs/cli/acp ；本轮打开了该页，标题即 ACP）
- `devin` `3000.11.205`，`devin acp`
- `dirac` `0.5.23`，`npx dirac-cli@0.5.23 --acp`
- `factory-droid` `0.249.0`，`npx droid@0.249.0 exec --output-format acp-daemon`（输出格式名带 acp，不是 `--acp` 子命令）
- `goose` `1.56.0`，`goose acp`
- `junie` `3813.9.0`，`junie --acp=true`
- `kilo` `7.8.17`，`npx @kilocode/cli@7.8.17 acp`
- `kimi` `1.52.0`，`kimi acp`
- `minimax-code` `0.2.7`，`npx @minimax-ai/code@0.2.7 acp`
- `nova` `1.1.59`，`npx @compass-ai/nova@1.1.59 acp`
- `opencode` `1.19.4` 与 `opencode-v2` `2.1.4`，都是 `opencode acp`
- `poolside` `1.0.16`，`pool acp`
- `qoder` `0.2.14`，`npx @qoder-ai/qodercli@0.2.14 --acp`
- `qwen-code` `0.26.0`，`npx @qwen-code/qwen-code@0.26.0 --acp --experimental-skills`
- `stakpak` `0.3.88`，`stakpak acp`
- `vtcode` `0.96.14`，`vtcode acp`
- `crow-cli` `0.1.24`，`crow-cli acp`
- `dimcode` `0.5.21`，`npx dimcode@0.5.21 acp`
- `harn` `0.10.177`，`harn serve acp`
- `kimchi` `1.21.0`，`kimchi --mode acp`

独立包装进程（包名本身就是 `*-acp`，或登记册描述写 wrapper / adapter）本轮只核对了 claude、codex、pi、amp 的登记字段：`amp-acp` `0.10.0` 描述为 “ACP wrapper for Amp”。其余 `agoragentic-acp`、`antigravity-acp`、`autohand`、`corust-agent`、`deepagents`、`glm-acp-agent`、`mistral-vibe`（启动 `./vibe-acp`）未逐份打开。

`fast-agent` `0.10.1` 与 `minion-code` `0.1.44` 的 distribution 是 `uvx`，上表没有展开参数。

## 3. 能力对照

对照面是本仓现在向上游要的八件事。pi 列读 `apps/daemon/src/backend/pi.ts`，claude-code 列读 `apps/daemon/src/backend/claude-code.ts`。ACP 列以 v1 稳定协议为准；某家 CLI 多做的，写在「缺口与补法」，不算协议覆盖。

缝上的词表没有 ACP 这个名字。`AgentBackendCapabilities` 只有 `name`、`thinkingLevels`、`oauthProviders`、`compaction`、`sessionResume`（`packages/shared/src/agent-backend.ts:180-188`）。`StepEvent` 15 种（同文件 `:141-158`）按 spec 17 A5 锁定，ACP 事件要映射进去，不新开词。

### 3.1 流式消息

- **pi**：`message_update` 上的 `text_delta` / `thinking_delta` 映射成同名 `StepEvent`，块终 `thinking`，`message_end` 带 `messageRecord`（`pi.ts:636-668`、`:670-721`）。`messageRecordSchema` 是 loose 的（`packages/shared/src/records/message.ts:23-28`），`stopReason` 与 per-message `usage` 能附在行上（`pi.ts:612-626`）。
- **claude-code**：`stream_event` 的 text/thinking delta，assistant 帧终了发 `message_end`（`claude-code.ts:206-267`）。没有把 SDK 的 stop reason 写进行内。
- **ACP**：覆盖流式正文与推理。`session/update` 的 `agent_message_chunk`、`agent_thought_chunk`（https://agentclientprotocol.com/protocol/v1/prompt-turn ，查阅 2026-10-24）。内容块含 text，image/audio/resource 要看 agent 广告的 `promptCapabilities`（https://agentclientprotocol.com/protocol/v1/content 与 initialization 页）。
- **缺口与补法**：chunk 没有 Cairn 的 `message_end`。桥在 `session/prompt` 返回时补一条 `message_end`，正文用已拼好的 chunk。`agent_thought_chunk` 映射 `thinking_delta`，prompt 返回时若没有单独的全文块，就不发明一条 `thinking`。图片：`promptCapabilities.image` 不为真时，带图的 `SessionOpts.promptImages` 直接失败，不对齐成静默丢图。

### 3.2 工具调用记录

- **pi**：`toolcall_end` 先记 id/name/arguments，`tool_execution_end` 再补 result、`isError`、`endedAt`（`pi.ts:659-667`、`:723-736`）。记录形是 `toolCallRecordSchema`（`agent-backend.ts:27-37`）：`id`、`name`、`arguments`、可选 `result` / `isError` / 时间 / `todo`。
- **claude-code**：assistant `tool_use` 发 pending，user `tool_result` 回填（`claude-code.ts:245-290`）。`TodoWrite` 另投影 `todo`。
- **ACP**：覆盖两段式。`tool_call` 创建，`tool_call_update` 改状态（`pending` / `in_progress` / `completed` / `failed`）和内容（https://agentclientprotocol.com/protocol/v1/tool-calls ，查阅 2026-10-24）。内容可以是普通 content block，也可以是 diff 或 terminal，不保证是一段模型可见的 result 字符串。
- **缺口与补法**：映射时 `failed` → `isError: true`，`completed` → `isError: false`。`result` 原样存 ACP 的 content（schema 是 `unknown`）。diff 不要压成假的 bash stdout。`todo` 只在工具名和入参能对上现有 `agent-todo` 投影时才填，对不上就留空。取消时协议要求客户端把未完成的 tool call 标成 cancelled（prompt-turn 页 Cancellation 节）；桥发一条 `isError: true` 的终稿，避免记录永远停在 pending。

### 3.3 stopReason / usage

- **pi**：消息级 `stopReason`。`aborted` → `message_stop`；assistant 且 `error` → `error`（`pi.ts:707-719`）。用量在 `message_end` 按 `provider/model` 累加 input/output/cacheRead/cacheWrite，有 `cost` 才累五分项（`pi.ts:673-705`）。`agent_settled` 发 `done` 并带上这组行（`:752-754`）。缝上的行形是 `modelUsageSchema`（`agent-backend.ts:56-63`）。
- **claude-code**：终局看 `result` 帧。`subtype === success` 且 `is_error` 不为真 → `done` 加用量行；中断 → `message_stop`；其余 → `error`（`claude-code.ts:308-347`）。用量来自 SDK result，成本键可以不出现（`modelUsageSchema` 注释写明 claude-code 行可以不带 cost）。
- **ACP 稳定协议**：`session/prompt` 的响应必须带 `stopReason`，五值 `end_turn` / `max_tokens` / `max_turn_requests` / `refusal` / `cancelled`（prompt-turn 页 Stop Reasons；`schema/v1/schema.json` 的 `StopReason` 与 `PromptResponse`。稳定 `PromptResponse` 只有 `stopReason` 与 `_meta`）。另有可选 `usage_update`：`used`、`size` 必填，`cost` 可选且只有 `amount` + ISO 货币（prompt-turn 页 Session Usage Updates；schema 的 `UsageUpdate`）。这是会话上下文占用和累计费用，不是一次调用的 input/output/cache 四分项。
- **不稳定、不能当契约**：`schema/v1/schema.unstable.json` 的 `PromptResponse.usage` 标了 “UNSTABLE / not part of the spec yet”。字段是 `totalTokens`、`inputTokens`、`outputTokens`，可选 `thoughtTokens`、`cachedReadTokens`、`cachedWriteTokens`。描述写 “across all turns / across session”，和「这一轮」是否同一件事，RFD 仍开着：https://agentclientprotocol.com/rfds/end-turn-token-usage （查阅 2026-10-24，状态仍是 Draft；修订记录写 2026-06-02 从另一份 RFD 拆出）。`_meta` 协议写明实现不得依赖其中的键（schema 对 `_meta` 的描述）。
- **Gemini 实际多送了不稳定用量，而且取消路径会丢掉它。** `v0.65.0` `packages/cli/src/acp/acpSession.ts:381-409` 把本轮内多次模型调用的 input/output/cached/thought 累加进 `usage`，per-model 计数放在 `_meta.quota`。`:421-422`、`:440-442`、`:534-538` 遇到取消时返回的对象只有 `stopReason: cancelled`，没有 `usage`。`:483-489` 的 `usage_update` 只送 `used`（input+output）和 `size`，这段没有 `cost`。cached 来自 `cachedContentTokenCount`，没有单独的 cache write。
- **Copilot** changelog `1.0.78` 写它会在 ACP prompt result 和 `usage_update` 里暴露 token usage。形状以那条 changelog 原句为限，本轮没有打开 Copilot 的 schema。
- **缺口与补法**：停止原因可以稳地映射，用量不行。`end_turn` → `done`（usage 见下）；`cancelled` → `message_stop`（协议写明取消不是错误，agent 不得把取消抛成普通 error）；`max_tokens` / `max_turn_requests` / `refusal` → `error`，`retryable` 只对文案命中现有瞬态正则的情况为真，其余 false。`done.usage`：稳定路径只可能从 `usage_update` 得到一个上下文占用数，填不满四维，就发空数组，让 server 按「无价格来源」记 0（`packages/shared/src/records/token-usage.ts:21-24` 已有这个口径）。不稳定 `usage` 只在桥显式打开 SDK unstable 类型、且字段真的出现时，才填 input/output/cacheRead（`cachedReadTokens`）/cacheWrite（`cachedWriteTokens`，缺省 0 要在行上标得出来，不能假装测到了 0）。`thoughtTokens` 没有对应列，不并进 output。不读 `_meta.quota`。费用五分项没有协议来源，不造价格表，与 pi「宿主不自造价格」同一条。

### 3.4 会话 resume

- **pi**：`sessionResume: true`（`pi.ts:75-81`）。`continueSession` 用 session 文件。
- **claude-code**：`sessionResume: true`（`claude-code.ts:80-86`）。SDK `resume`，失败走冷会话重试（spec 17 A7）。
- **ACP**：两套，都不是基线。`loadSession` 为真才能 `session/load`，agent 必须用 `session/update` 把历史重放完再响应。`sessionCapabilities.resume` 为真才能 `session/resume`，规定不重放历史（https://agentclientprotocol.com/protocol/v1/session-setup ，查阅 2026-10-24）。Gemini 的 `acp-mode.md` 写了 `loadSession`，没有写 `session/resume`。
- **缺口与补法**：`continueSession` 先看 initialize 广告。有 resume 用 resume；否则有 load 用 load；两个都没有则失败，让现有冷会话重试接上，不要假装续上了。load 的重放会再吐一遍 chunk。桥在 load 期间把这些 update 标成重放，不写成新的 transcript 行，否则同一会话会双倍。Gemini 文档的 `loadSession` 是否等于协议的 `session/load`，首票用一条真实握手核对，文档旧方法名不能直接当 schema。

### 3.5 取消

- **pi**：`stop()` 调 `session.abort()`（`pi.ts:892` 一带）。abort 的终局走 `message_stop`。
- **claude-code**：`AbortController.abort()`，result 在 `interrupted` 时映射 `message_stop`（`claude-code.ts:337-346`）。
- **ACP**：覆盖。`session/cancel` 之后，agent 必须用 `stopReason: cancelled` 结束原来的 `session/prompt`；客户端必须用 `cancelled` 回应还挂着的 `session/request_permission`（prompt-turn 页；https://agentclientprotocol.com/protocol/v1/cancellation 还定义了通用 `$/cancel_request`）。
- **缺口与补法**：`stop()` 只发 `session/cancel`，并立刻对未完成的 permission 回 `cancelled`。若 agent 违反协议把取消抛成 error，桥把「已经发过 cancel」的这条 error 收成 `message_stop`，避免一步被记成失败。这是协议自己的警告，不是额外发明。

### 3.6 权限闸 command-gate

- **pi**：有。`tool_call` 扩展挂 `gateToolCallHandler`（`pi.ts:1040-1056`）。规则表加默认危险 bash 形态，命中则阻断并把理由变成模型可见的 error tool result（`apps/daemon/src/backend/command-gate.ts:1-27`）。无人值守时 `ask` 的执行语义是拒绝。
- **claude-code**：这座桥不挂 command-gate。`command-gate.ts:26-27` 写明 claude-code 仍跑 `bypassPermissions`，钩子在 bypass 下是否触发未验证。执行面是 `bypassPermissions` 加 `disallowedTools` 收掉 `AskUserQuestion`，只读步再收 `Edit`/`Write`（`claude-code.ts:1107-1115`）。
- **ACP**：不覆盖这座闸。协议是 agent **可以**在执行前调 `session/request_permission`（tool-calls 页 Requesting Permission）。选项种类是 `allow_once` / `allow_always` / `reject_once` / `reject_always`。示例里的 `toolCall` 可以只带 `toolCallId`。客户端可以按设置自动允许或拒绝。没有任何一条要求「每次 shell 之前都必须问」。
- **Gemini 会问，但命令文本在哪要探针。** `v0.65.0` `acpSession.ts:746-765` 在确认路径上调用 `requestPermission`，`toolCall` 带 `toolCallId`、`status: pending`、`title`、`content`、`locations`、`kind`。本轮没有追到 shell 工具如何把命令字符串放进 title 或 content。`acp-mode.md` 写 `setSessionMode` 能改审批级别（例子是 `auto-approve`）。
- **文件系统不是闸。** 同标签 `acpFileSystemService.ts:51-53`：客户端没广告 `readTextFile`，或路径在会话根之外，或路径落在 `~/.gemini`，就改用本机文件系统。所以「不实现 ACP 文件代理」时，Gemini 仍会直接改 worktree。这和 pi / claude-code 今天的工作方式一致。
- **缺口与补法**：桥实现 `session/request_permission`。能从 title/content 抽出命令字符串时跑现有 `command-gate`：放行选 `allow_once`，拒绝选 `reject_once`，理由无法经 ACP 选项回给模型（协议选项没有 reason 字段），拒绝后的下一轮只能靠工具失败状态让模型改道。抽不出命令、或 agent 根本不发 permission：闸看不见。首票探针要列出 Gemini 默认模式下哪些工具会发 permission、shell 原文在哪个字段。若默认是 auto-approve，探针改用会发请求的 mode，再跑闸。不广告 `allow_always` 的自动选择，避免把一次放行记成永久。`readOnly` 步：优先选 agent 广告的只读 mode；没有这种 mode 则对写文件类 permission 一律 `reject_once`。这比 claude-code 的 `disallowedTools` 弱，因为不发请求的写入拦不住。

### 3.7 MCP 注入

- **pi**：`registerMcpServer`，端点来自 `SessionOpts.mcpServers`，失败降级不炸会话（`pi.ts:1057-1062`）。工具名 `mcp__<server>__<tool>`。另有 allowlist `mcp__*`。
- **claude-code**：`mcpServers` 加 in-process host server（remote/local 工具）。受管集合发 `strictMcpConfig`，空数组也发（`claude-code.ts` 里 `buildClaudeSdkOptions` 与 `mapMcpEndpoint`，约 `:941-996`、`:1076-1096`）。字段残缺 fail-closed。
- **ACP**：覆盖「客户端把 MCP server 交给 agent」。`session/new`、`session/load`、`session/resume` 都带 `mcpServers`。stdio 是基线；`mcpCapabilities.http` / `sse` 才允许对应传输（session-setup 页 MCP Servers，查阅 2026-10-24）。SSE 在 initialization 页注明已被 MCP spec 弃用。
- **宿主工具（remoteTools / localTools）不稳定。** 草案 https://agentclientprotocol.com/rfds/mcp-over-acp （查阅 2026-10-24）想用 `"type": "acp"` 让工具走现有 ACP 连接，不另开进程。草案不是 v1 基线。
- **缺口与补法**：`McpEndpoint` 已经是 stdio 或 http（`agent-backend.ts:125-134`）。stdio 直接放进 `session/new`。http 仅当 initialize 广告了 `mcpCapabilities.http`，否则 fail-closed，不把 http 偷偷改成别的传输。受管空表：协议没有 Copilot/Claude 那种 strict 开关的稳定字段。本轮未找到「传空 `mcpServers` 就禁止 agent 自带 MCP」的协议句。Gemini 文档只说客户端可以把自己的 MCP 交出去。Hermes 文档写相反的方向：编辑器给的 server 总会加上，Hermes 配置里的 server 仍在，除非用户在 Hermes 自己的配置里关掉。所以空数组不能写成「严格空白」。首票行为：有端点就传；空数组也传空数组，并在诊断行写明「不保证关掉 CLI 自带 MCP」。remoteTools / localTools 首票 fail-closed（与 spec 17 A10 当时对 claude 的做法同形）。以后若要接，用一个本机 stdio MCP 小进程转发到 `executeRemoteTool`，不依赖那份草案。

### 3.8 skills 注入

- **pi**：简报文件通道。目录正文由 `composeBody` 产出，runner 写进 worktree 里 pi 会读的 `AGENTS.md` 系（`packages/shared/src/brief-file.ts:27-47`）。另有 allowlist、团队技能目录、未授权技能的 Read 闸。`systemPrompt` 只留给没有简报通道的后端（`pi.ts:1027-1030`）。
- **claude-code**：同一简报通道，落点 `CLAUDE.md`（`brief-file.ts:40`，`claude-code.ts:1101-1105`）。未授权技能走 settings deny。插件通道有版本下限 `MIN_CLAUDE_PLUGIN_VERSION = '2.1.74'`（`claude-code.ts:849`）。
- **ACP**：稳定协议没有 system prompt，也没有 skills 方法。`session/new` 的稳定字段是 cwd、mcpServers、可选的 additional directories。用户内容只能走 `session/prompt`。草案 https://agentclientprotocol.com/rfds/client-system-prompt （查阅 2026-10-24）写明今天没有 `systemPrompt` 字段，并举例各家用 `_meta` 或把说明塞进用户消息。`_meta` 不能当契约。
- **Gemini 自己的文件，不是 ACP。** 标签 `v0.65.0` `docs/cli/gemini-md.md`：工作区 `GEMINI.md` 会拼进每轮上下文。`docs/cli/skills.md`：技能是 `SKILL.md` 目录；用户级 `~/.gemini/skills/` 或 `~/.agents/skills/`，工作区 `.gemini/skills/` 或 `.agents/skills/`（同层 `.agents/skills/` 优先）。发现后把名字和描述放进系统提示，调用要 `activate_skill`，并且有确认。
- **Hermes**：ACP 页写技能仍在 `~/.hermes/skills/`，不读 Cairn 的简报文件。
- **Qwen**：登记册启动参数带 `--experimental-skills`，只说明这家用 CLI 旗，不是协议。
- **Copilot**：changelog 写 ACP 客户端里 skills 变成 slash command。那是 Copilot 自己的技能，不是 Cairn 下发的目录。
- **缺口与补法**：不要等草案。Gemini 首票若做技能，只加简报身份 `gemini`，候选文件只写 `GEMINI.md`（`brief-file.ts` 的 `BRIEF_CANDIDATES`）。这能把目录正文送进每轮上下文，对不上 pi 的 Read 闸，也对不上 `activate_skill` 的目录扫描。团队技能若要被 `activate_skill` 看见，得物化进 worktree 的 `.gemini/skills/` 或 `.agents/skills/`，并走 spec 24 的擦除，避免进 git。那是后续票。Hermes 的技能根在用户主目录，不在 worktree，首票不接。没有简报通道的 ACP 身份，`brief` 缺席，runner 保留 inline systemPrompt；而 ACP 又吃不掉 system prompt，所以这段文字今天只能作为 `session/prompt` 的用户消息前缀。草案自己把这种前缀当成不够格的做法。因此除了已核对会读某个上下文文件的 CLI，技能注入标成不支持，fail-closed 打诊断，不静默丢。

### 3.9 对照总表

| 能力 | pi | claude-code | ACP 稳定协议 | 缺口与补法 | 出处 |
|---|---|---|---|---|---|
| 流式消息 | text/thinking delta，`message_end` | 同左，无行内 stopReason | `agent_message_chunk` / `agent_thought_chunk` | prompt 返回时补 `message_end`；无 image 能力则带图失败 | `pi.ts:636-668`；`claude-code.ts:206-267`；prompt-turn、content 页 |
| 工具调用记录 | 两段 `toolcall_end`，含 result | `tool_use` / `tool_result`，可带 todo | `tool_call` + `tool_call_update`，内容可是 diff/terminal | `failed`→`isError`；result 存原始 content；todo 对不上就不填 | `pi.ts:659-736`；`claude-code.ts:245-290`；tool-calls 页 |
| stopReason / usage | 行内 stopReason；四维 + 可选五分项 cost；`done` 带行集 | result → done/error/message_stop；用量行可无 cost | 稳定 stopReason 五值；`usage_update` 只有 used/size/可选累计 cost | 原因可映射；四维与五分项不能从稳定事件填满。不稳 `usage` 仅 Gemini 这类实现真的发送时才抄，取消路径可能没有 | `pi.ts:673-754`；`claude-code.ts:308-347`；schema `PromptResponse`；unstable `Usage`；`acpSession.ts:381-538` |
| 会话 resume | `sessionResume: true`，会话文件 | `sessionResume: true`，SDK resume | `session/load` 重放，或 `session/resume` 不重放；都要广告 | 按广告选择；load 的重放不入库；都没有则走冷会话 | `pi.ts:80`；`claude-code.ts:85`；session-setup 页 |
| 取消 | `abort` → `message_stop` | abort → `message_stop` | `session/cancel` → `cancelled` | 映射 `message_stop`；挂起的 permission 回 cancelled | `pi.ts` stop/abort；`claude-code.ts:337-346`；prompt-turn Cancellation |
| command-gate | tool_call 上阻断 | 不挂；bypassPermissions | 可选 `request_permission`，无 reason 字段 | 能抽出命令才用现有闸；抽不出或对方不问 = 闸未生效，探针钉死 | `pi.ts:1040-1056`；`command-gate.ts:26-27`；tool-calls 页；`acpSession.ts:746-765` |
| MCP 注入 | `registerMcpServer`，失败降级 | mcpServers + strict + in-process host | session 参数里的 stdio MCP；http/sse 看能力位 | 空数组不保证关掉 CLI 自带 MCP；host 工具首票失败退出 | `pi.ts:1057-1062`；`claude-code.ts` MCP 段；session-setup 页；Hermes ACP 页 |
| skills 注入 | 简报写入 AGENTS.md 系 + 白名单闸 | 简报写入 CLAUDE.md + deny | 无此方法（system prompt 仍是草案） | Gemini 可写 `GEMINI.md`；目录型技能与 Hermes 主目录技能另票 | `brief-file.ts:38-41`；client-system-prompt RFD；`gemini-md.md`、`skills.md` `v0.65.0` |

中途 `steer` 不在票面八项里，但缝上有这个方法（`agent-backend.ts:286-288`）。v1 基线没有「当前 prompt 还没返回就再塞一段用户文本」的方法。claude-agent-acp README 把 steering 写成该适配器的 v1 扩展，不是协议基线。桥的 `steer` 与 spec 17 A8 的 claude 语义相同：排到本轮 `session/prompt` 返回之后，作为下一次 `session/prompt` 发出。

## 4. `acp.ts` 接口草图

One bridge, many identities. It meets the trigger condition spec 17 wrote down: more than two runtimes, plus "same family, multiple identities" (the row where spec 17 declines the 12-field registry, `docs/spec/17-dual-runtime-execution-surface.md:80`). Do not copy Multica's 12-field descriptor. The identity table keeps only the launch argv, the brief filename, and "credentials stay on this machine".

缝纪律：`biome.json` 的 `noRestrictedImports` 增加 `@agentclientprotocol/sdk`，唯一落点 `apps/daemon/src/backend/acp.ts`。与 `@earendil-works/*` → `pi.ts`、`@anthropic-ai/claude-agent-sdk` → `claude-code.ts` 同律。依赖进 `apps/daemon/package.json`，锁文件按仓库闸授权，不在本调研票里加。

`AgentBackend` 不改方法签名。`createSession` / `continueSession` / `steer` / `stop` / `usage` 保持 `agent-backend.ts:279-328`。

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

会话打开时桥做的事，按协议顺序：

1. spawn `identity.argv`，stdin/stdout 接 SDK `client()`。stderr 进现有诊断行，不混进 JSON-RPC。
2. `initialize`。读 `loadSession`、`sessionCapabilities.resume`、`promptCapabilities`、`mcpCapabilities`、modes。
3. 若 agent 要求 `authenticate` 且本机没有已完成的登录，会话失败，文案指向该 CLI 自己的登录命令。不读、不传、不存 token（spec 17 A4 的方向）。
4. `session/new`（或 resume/load）带 `cwd` 与第 3.7 节的 `mcpServers`。
5. 有简报通道的身份，runner 已把正文写入 `briefFile`。桥不再把 system prompt 塞进用户消息。
6. `session/prompt` 把 `opts.prompt` 作为 text block。之后把 `session/update` 映射成 `StepEvent`。
7. `usage()` 返回第 3.3 节允许填写的行；没有就空数组。

`capabilities` 不能抄 pi 的七档思考。`thinkingLevels` 留空，除非该 agent 在 session config 里广告了与 `THINKING_LEVELS` 相同的 id。域外档位 fail-closed，与 claude-code 的 effort 相同。`oauthProviders` 为空：登录在 CLI 自己的主目录。`compaction` 以是否收到 compaction 类 `session/update` 为准，草图里先写 `false`，避免在没探针之前声明支持。`sessionResume` 在握手之后才知道；静态声明写 `true` 会让 UI 撒谎。首票把静态值写成 `false`，续会话能力由握手结果决定，失败走冷开。这是和 pi/claude 声明 `true` 的有意差别。

解析点仍是 `backendFor`（`apps/daemon/src/machine-loop.ts:230`，`apps/daemon/src/runner.ts:724`）。今天 `BACKEND_RUNTIME_IDS` 只有 `'claude-code'`（`agent-backend.ts:335`），`stepRuntimeFor` 把其余 provider 全部当成 `pi`（`apps/server/src/services/dispatch-eligibility.ts:33-34`）。只加桥、不改这个词表的话，`provider = gemini` 的步会被 pi 机器领走，然后在 pi 里找不到模型。

不广告客户端文件系统和终端能力。Gemini 在缺少 `readTextFile` 时用本机文件系统改 worktree（`acpFileSystemService.ts:51-53`）。Cairn 继续用自己的 worktree 与 git 收尾，不把文件读写再实现一遍。

## 5. 对 spec 17、ADR 0018、ADR 0020 的影响

### spec 17

spec 17's fork shape keeps applying: identity is vocabulary, family is an `AgentBackend` implementation, claim stays shared, and the fork lives only in `backendFor`. No registry was set up back then because there were only two runtimes and pi was not a CLI (`docs/spec/17-dual-runtime-execution-surface.md:50`, `:80`). ACP is exactly "a third family + multiple identities in one family". The landing spot is the small table in section 4, not a second model-source vocabulary and not a 12-field descriptor.

要一起改的现有词，漏一个就会把步领错：

- `BACKEND_RUNTIME_IDS` 增加 `'gemini'`。`isBackendRuntimeId` 为真时走零凭据分支（runner 与 server `toProviderConfig` 已按这个守卫分流）。
- `MACHINE_RUNTIMES` 今天是 `['pi', 'claude-code']`（`packages/shared/src/records/machine.ts:14`）。PATCH `enabledRuntimes` 用这个 enum。不加 `'gemini'`，机器开关写不进这个 runtime。
- `stepRuntimeFor` 的返回类型今天是 `'pi' | 'claude-code'`。Gemini 必须映射到 `'gemini'`，否则 #682 的闸（`dispatch-eligibility.ts:39-43`，`machines.ts` 里 `enabledRuntimes` 真闸）会用 pi 的开关放行。
- `briefBackendForProvider`（`brief-file.ts:70-71`）与 `backendFor` 必须同一判定。Gemini 写 `GEMINI.md`，不能落进 `AGENTS.md` 或 `CLAUDE.md`。
- `StepEvent` 词表不动。
- `pi.ts` 与 `claude-code.ts` 不动。默认支保持：provider 不是新词表里的值时仍走 pi。

spec 17 A12 写过 enabledRuntimes 首票不消费。那条已被后来的 #682 推翻：claim 现在读这个开关。新 runtime 从第一天就要进开关，否则任何开了 pi 的机器都会领 Gemini 步。

### ADR 0018

The orchestration model needs no rewrite. Agents still do not bind to machines; dispatch reads the machine-reported capability snapshot (`docs/adr/0018-multi-agent-team-three-layers-machine-capability-gate.md` decision 4).

现有快照盖不住「这台机器有没有 gemini 二进制」：

- `machineCapabilitiesSchema` 是 MCP slug、本机技能目录名、可选硬件（`packages/shared/src/records/machine-capabilities.ts:45-52`）。
- `requiredCapabilitiesSchema` 的 `models` 只对 `claudeCodeReport` 判定（同文件 `:82-84`）。没有 Gemini 模型报告时，这一维按未知放行。
- runtime 维故意不在 `requiredCapabilities` 里，因为 `enabledRuntimes` 已经是闸（同文件 `:75-76`）。Gemini 走这道闸就够用，不必把「二进制在不在」再塞进 MCP/技能清单。二进制缺失的失败点放在桥 spawn：进程起不来，步失败，文案写明要安装的命令。这和「claude 认证缺失则首个 query 失败」同一类，不把心跳打 400（ADR 0018 沿用的字段级容错）。

模型发现不要复用 `claudeCodeReport`。Gemini 的模型列表是另一份事实。首票模型 id 照 `agent.modelId` 原样交给会话配置；该 agent 没有模型配置项时，忽略 modelId 并打诊断，不用 pi 的 provider 配置去调 Gemini。发现与上报是后续票，形状对齐 spec 17 T3，而不是把 Gemini 模型塞进 `~/.claude/settings.json` 那条读路径。

### ADR 0020

The recommended-concurrency formula is unchanged. Inputs stay `cpuCores` and `memoryTotalMb`, 2 GiB per slot, clamped to 1..16 (`docs/adr/0020-machine-recommended-concurrency-capability-fingerprint-formula-coverage-priority.md:15-18`). The fingerprint is machine configuration, not an agent-protocol item. One extra process for external CLIs does not change the already-written-down "use totals, not availability" rationale.

不在本票把槽大小改成「外部 CLI 更吃内存」。那需要实测，而且会推翻「推荐值只由机器配置决定、相邻两拍不抖动」。若以后要改，另开 ADR 0020 的修订，不夹在 ACP 桥里。

## 6. 轨迹包（#1511）能还原多少

`trajectoryPackSchema`（`packages/shared/src/trajectory-pack.ts:10-78`）大部分字段是 Cairn 自己的账，不是 agent 事件。

**能从 Cairn 现有账本填、与 ACP 无关的：**

- `input.spec`、`sourceRef`、`baseSha`、`persona`、`agentId`、`harnessHash`：claim / build / persona 记录。
- `input.skillInjection`：`skillInjectionSchema` 是派发时的命中列表（`packages/shared/src/skill-inject.ts:44-46`），不是 agent 回传。
- `input.model`：本仓选出的模型字符串。ACP 不保证回显。Gemini 把 per-model 名字放在 `_meta.quota`，而 `_meta` 不能依赖。模型字符串继续用 Cairn 已有的 `agent.modelId`。
- `process.steps[].stepId`、`kind`：步种是 `plan/build/merge/chief/review/verify`（`packages/shared/src/records/step.ts:21`），ACP 没有这组枚举。
- `process.steps[].checkpointCommit`：git，不是 ACP。
- `judgments` 全部：确认、修订、diff 批准、闸判定。这些是人和 Cairn 闸写下的。
- `outcome.merged`、`revertedWithin7d`、`fixedByLaterPr`：合并与回滚，在 GitHub / git。

**能从稳定 ACP 事件投影进 transcript 的：**

- `process.steps[].transcript` 的行是 `transcriptRowSchema`：role、content，加 id、createdAt、可选 actor（`message.ts:36-40`）。content 是 `unknown`。`agent_message_chunk` 可拼成 assistant 文本行；工具调用可拼成带 `toolcall` 形的 content。用户 prompt 是 user 行。
- 拼不出 pi 那种行内 `stopReason` + per-message `usage` + `cost`，除非走第 3.3 节的不稳定字段，而且取消响应常常没有它。
- load 重放若入库，会把旧回合再写一遍。第 3.4 节要求重放不入库。

**不能完整还原的：**

- `process.plans`：`planRowSchema` 是 plan.md 的版本行（id、buildId、version、createdAt、content 字符串，`packages/shared/src/records/plan.ts:31-34`）。ACP 的 agent plan 是会话里的步骤清单更新（https://agentclientprotocol.com/protocol/v1/agent-plan ），不是这份四段文档，也没有 v1/v2 版本号。可以另存一份「ACP plan 文本」进 transcript，不能拿来充当 `plans[]`。
- `process.token_usage`：`tokenUsageSchema` 要 model、input、output、cacheRead、cacheWrite 和五分项 cost（`token-usage.ts:12-29`）。稳定 `usage_update` 对不上。不稳定 `Usage` 缺费用，Gemini 实现缺 cache write，描述还和「跨会话累计」搅在一起。不能写成完整还原。
- `outcome.costTotal`：只有 `usage_update.cost.amount` 且货币为 USD 时，才能当作累计费用的一个候选数。它是可选的，Gemini 查阅到的那段 `usage_update` 没送 cost。没有就保持 null，不把 `used` token 数当成钱。

结论：轨迹包的过程文本和工具轨迹可以多一条 ACP 投影；token、费用、plan 版本、判定、结局仍以 Cairn 自己的记录为准。缺事件就缺字段，不用 0 冒充「测到了零」。

## 7. 施工票草稿

推荐做。拆成两张，第二张不阻塞第一张的结论，但不要并进第一张。

### 票 A · Gemini 一座桥的最小闭环

**票名**：`daemon(acp): Gemini CLI 作为第三执行面——stdio ACP 桥、词表与零凭据`

**可验证闭环**：一台装了 `gemini`、且本机已登录的机器上，`provider` 为 gemini 的 worker 步能 claim、跑完、transcript 里有文本和至少一条工具调用、`done` 的 usage 允许为空数组、sessionId 回传。第二步用该 sessionId 走 `session/load` 或 `session/resume`（以握手广告为准）。同一机器上 pi 与 claude-code 的既有探针仍绿。未安装 gemini 的机器：步失败，文案含安装提示，心跳不被 400。

**地界**：

- 新增 `apps/daemon/src/backend/acp.ts`（唯一 `@agentclientprotocol/sdk` import）
- `biome.json` 增加这条限制
- `apps/daemon/package.json` 与 `pnpm-lock.yaml`（锁文件闸授权）
- `packages/shared/src/agent-backend.ts` 的 `BACKEND_RUNTIME_IDS`
- `packages/shared/src/records/machine.ts` 的 `MACHINE_RUNTIMES`
- `apps/server/src/services/dispatch-eligibility.ts` 的 `stepRuntimeFor`
- `packages/shared/src/brief-file.ts`：gemini → `GEMINI.md`
- runner / machine-loop 的 `backendFor` 与零凭据分支，只对新 id 短路
- 探针与 `docs/verify/<票号>/`

**明确不改**：`pi.ts`、`claude-code.ts` 内部，`StepEvent` 词表，web 文案以外的选择器若已能显示新 runtime 则不动（若词表是选择器的数据源，只加这个 id），ADR 0020 公式，`requiredCapabilities.models` 的判定范围，remoteTools / localTools（缺席或空 = 不建；非空 = 失败退出），Hermes / Copilot / Codex。

**先列失败方式**：

1. 机器没有 `gemini` 可执行文件 → spawn 失败 → 步错误含「未找到 gemini」，不落成 pi 的 `model not found`。
2. 未登录 → `authenticate` 或首个 prompt 失败 → 文案指向 Gemini 自己的登录，daemon 不读取 token。
3. `BACKEND_RUNTIME_IDS` 忘了加 gemini → 步被 `stepRuntimeFor` 当成 pi → 分支测试钉「provider gemini 的 runtime 是 gemini，其它未知 provider 仍是 pi」。
4. `enabledRuntimes` 不含 gemini 的机器领走了步 → claim 测试钉闸。
5. 简报写进 `AGENTS.md` → Gemini 不读 → 测试钉 `briefBackendForProvider('gemini')` 的文件名是 `GEMINI.md`。
6. `session/load` 的重放被当成新消息上传 → transcript 行数加倍 → 探针对比 load 前后行数。
7. 带 `promptImages` 但握手没有 image 能力 → 会话创建失败，不静默丢图。
8. 非空 `remoteTools` 或 `localTools` → 失败退出，错误含 fail-closed。
9. 取消后 agent 抛普通 error → 桥收成 `message_stop`，步不是 failed。
10. SDK `2.0.2` 与 Gemini 钉的 `0.16.1` 握手不一致 → initialize 失败要带双方 `protocolVersion`，不要吞成空 transcript。

**验收**：探针 transcript（文本 + 一条 tool call + done）、sessionId、续会话不双写、pi 与 claude-code 回归、lint / typecheck、受影响的单测。证据进 `docs/verify/<票号>/`。

### 票 B · 权限探针与命令闸（依赖票 A 的真实 Gemini 会话）

**票名**：`daemon(acp): Gemini 的 request_permission 接上 command-gate`

票 A 不宣称命令闸已生效。票 B 先在真实会话里打印 shell 类 permission 的 title/content/kind。只有当命令原文出现在某个字段里，才把 `gateToolCallHandler` 的裁决映射成 `allow_once` / `reject_once`。映射不上就维持票 A 的行为（客户端按「没有闸」处理：不自动 `allow_always`），并在研究注记里写明字段，不猜。

只读步：有只读 mode 就切过去；没有则对写类 permission 回 `reject_once`。探针要有一条被闸拒绝的危险命令（用 command-gate 已有的默认形态），以及一条普通命令被放行。

### 先不做的

- 用 `claude-agent-acp` 替换 `claude-code.ts`。
- 用 `codex-acp` 或 `pi-acp` 当执行面。多一跳，且 pi 已在进程内。
- Copilot 与 Hermes 作为第二、第三身份。等票 A 的握手、续会话、取消三件在 Gemini 上是绿的，再各开一张只加 `AcpIdentity` 的票。Copilot 在 agents 页仍是 public preview。Hermes 不在登记册，技能根在 `~/.hermes`，简报通道对不上。
- 把不稳定 `usage` 写进轨迹包的 `token_usage` 当完整账。最多在 done 行上可选出现，轨迹包继续允许 cost 为 0、缺字段就缺。
- 改 ADR 0020 的 2 GiB 槽。
