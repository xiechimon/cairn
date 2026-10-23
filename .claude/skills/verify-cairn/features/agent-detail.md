# Agent 详情编辑面

团队页的 Agent 卡是进 Agent 详情编辑面的入口。详情面三 tab：概览（头像、名称行内编辑、职责、默认 skill、模型、思考强度只读行）、记忆（条目列表 + 删除）、权限（工具 6 开关 + 团队密钥 + MCP 逐个勾选）。创建 Agent 弹窗按服务商是否就绪走两态：候选非空 = 弹窗内直接选 provider/modelId（不跳页）；候选空 = 「尚未配置模型服务商」告警行 + 配置外链。

## Sub-features

- `card-link` — 团队页 agent 卡（`[data-testid="team-agent-card"]`，#947 起类名钩退役）是 `<a>`，点击落 `/app/resources/agents/<id>`，`?scenario=` 随行。
- `overview-fields` — 名称（行内编辑）、职责、默认 skill、模型选择器，各自提交后 server 记录随之变。
- `overview-readonly` — 运行时 / 思考强度是只读值行（无按钮）：运行时 = provider 位派生（原版那档是选择器，本仓 wire 无独立 runtime 字段，语义裁决见 #499）；思考强度档位词表经能力读面 `GET /api/capabilities` 到 web（XMON-16 / #499 B3 裁决 A），只读行按该词表呈现档位——存值不在词表内落「默认」（B1 裁「保持只读」：读面 ≠ 写面，选择器仍不出）。**XMON-18 裁决（2026-10-01）撤掉 `状态` 行**（`agentStatusSchema` 只有 active 一个取值，零信息量；判据是「页面里不存在」，不是换文案）。同一裁决里 `创建于 …` 也不做——它**从来没渲染过**（此前缺口是「DB 无 createdAt 列」），所以是继续不做、不是撤行；`main` 上不会加这一列。
- `memory-tab` — 条目列表 + 删除；空态文案 = shared `MEMORY_EMPTY_COPY` canon。
- `permissions-tab` — 工具 6 开关（文案 = shared `AGENT_TOOL_SWITCHES`，**六档各带说明副文案** = shared `AGENT_TOOL_COPY`）、**团队密钥一行聚合总开关**（#510：粒度 = 原版的全有全无，副文案 = shared `AGENT_PERMISSION_COPY.secrets`；开 = `PATCH { secrets: 团队全部密钥 id }`、关 = `PATCH { secrets: [] }`，勾选态 = `agent.secrets` 非空；零密钥时只有空态 `暂无团队密钥。`、不出开关）、MCP 逐个勾选，落 `PATCH tools/secrets/mcpServers`。
- `create-model-slot` — 创建弹窗模型槽两态；选中后 `POST /api/teams/{id}/agents` body 带 `provider` 与 `modelId`。
- `delete-agent` — 概览页脚 `删除 Agent` 入口 → DeleteConfirm 家族二次确认（标题/正文 = 原版语料原文，`agent_modal.remove_title` / `remove_confirm`）→ 确认后 `DELETE /api/teams/{id}/agents/{aid}` → 落团队页。取消路径（取消 / X / Esc / backdrop）不删不跳。删除语义三件（memories 不级联 / `todo.assignment` 摘槽 / `chief.agentId` 摘绑定）见 `apps/server/src/services/agents.ts`。

## How to get to it (user POV)

- 团队页（`/app/team`）→ 点任意 Agent 卡 → 详情页。
- 详情页 tab 行 → 概览 / 记忆 / 权限。
- 团队页 dashed「创建 Agent」→ 弹窗（有服务商时内含模型下拉）。
- 无 DP 入口：Agent 不在侧栏资源行里（原版命令面板「前往」清单也无 Agents 行），只能从团队页卡进入。
- 驱动:本 feature 没有 current case;已登记的都判 stale,不带 `--force` 拒跑(拒跑时打印原因),`vp.mjs list agent-detail` 列出 usage:
  - `vp.mjs drive agent-detail edit-and-create`:建 agent 不带 machineId,ADR 0019 起 400。
  - `vp.mjs drive agent-detail identity-chip-link`:建 agent 不带 machineId,ADR 0019 起 400。
  - `vp.mjs drive agent-detail ui-cleanup-finale`:断言的选择子与几何已随后续改版变化。

## Driving it with drive-agent-detail.mjs

Preconditions:

- `launch.mjs` 起隔离栈（默认 api 8791 / web 5273，全新 scratch 库）。脚本自播种：一个 custom provider（`verify-485-gw` + `claude-sonnet-5`）与一个 Agent（`verify-485-builder`）。
- 从 worktree 路径跑脚本本体，并带 `VERIFY_REPO_ROOT=<worktree 绝对路径>`（用主仓旧脚本验 lane 新代码会得到迷惑症状）。

- 团队页卡是链接并落详情路由 → `node <worktree>/.claude/skills/verify-cairn/scripts/drive-agent-detail.mjs` → `team-card-is-link`（卡元素是 `a`）+ `card-opens-detail-route`（pathname = `/app/resources/agents/<id>`）。
- 概览回显 = server 真值 → 同命令 → `overview-name` / `overview-role-empty-canon` / `overview-model` / `overview-thinking-readonly`（这条在 XMON-18 之后兼作「思考强度行还在」的看门人）。
- 概览不再摆「状态」行（XMON-18）→ 同命令 → `overview-no-status-row`（`.agent-status` 元素计数为 0）。判据取「不存在」，比断言文本更能钉住「没长回来 + 撤行没留空壳」。
- 思考强度档位来自能力读面（XMON-16）→ 同命令 → `capabilities-seven-levels`（读面七档有序）/ `thinking-inside-vocabulary-rendered`（PATCH `high` → 行出 `high`）/ `thinking-outside-vocabulary-falls-back`（PATCH `ultra` → 行落「默认」且无按钮）。后两条是「读面接到 UI 上」的判据，只验端点不算数；跑完还原种子态 `thinkingLevel: null`。
- 改名称、改职责 → 同命令 → `name-persisted` / `role-persisted`（重取 `GET /api/teams/{id}/agents/{aid}` 对字段，不看 UI 回显）。
- 模型槽清空再选回 → 同命令 → `model-cleared`（provider/modelId 双 null）/ `model-persisted`（`verify-485-gw/claude-sonnet-5`）。
- 权限开关 → 同命令 → `perm-six-switches`（6 个）+ `tool-persisted`（server `tools` 数组）。
- 密钥区聚合总开关（#510）→ 同命令 → `secret-row-single`（`.agent-secret-row` 恰好 1 行）+ `secret-switch-single`（1 个开关）+ `secret-unchecked-when-empty`（未授权时 `aria-checked=false`）+ `secret-on-writes-full-id-set`（开 → server `secrets` = 点击时 `GET secrets` 的全 id 集）+ `secret-stays-checked-when-nonempty`（重取真值非空 → 勾选态保持）+ `secret-off-clears`（关 → `secrets` 空）。
- 记忆空态 → 同命令 → `memory-empty-canon`。
- 创建弹窗选模型建 Agent → 同命令 → `create-dialog-model-slot` / `create-dialog-no-warn` / `create-with-model-persisted`（重取 members 投影对 provider/modelId）。
- 删除 Agent → 同命令 → `delete-confirm-canon-title` / `delete-confirm-canon-body`（确认层文案逐字）+ `delete-cancel-keeps-row`（取消后 `GET agent` 仍 200）+ `delete-lands-on-team` / `delete-row-gone-404` / `delete-repeat-404`（复删 404）+ `delete-roster-drops-target` / `delete-roster-keeps-neighbor` / `delete-roster-count-matches-server`（名单与 server 对账）。

## Gotchas

- **fixture e2e 与 live probe 互不替代**：`apps/web/e2e/agent-detail.spec.ts` + `agent-create-model.spec.ts` 跑 fixture 面（无后端），证明的是交互与两态；落库只能由本 probe 证。本票之前 `patchAgent` 是零消费点的死代码，这条缝从没被 web 面走过。fixture 两个场景：`agent-detail`（零密钥 → 空态）与 `agent-detail-secrets`（两个密钥 → 恰好一行总开关）。
- **模型行首行恒是「未设置模型」清空行**：按 `hasText` 定位模型行，别用 `nth(0)`。
- **同一模型 id 可能出两行**：`toModelOptions` 是 custom providers ∪ model-sources 非 pi 段的并集，`claude-sonnet-5` 在 providers 与 claude-code 段各一行——断言要按 provider 位分。
- **浮层截图要等入场动画**：`anim-pop` 从 opacity 0 起，Playwright 的 visible 判定不看 opacity，抢拍会得到与上一张逐字节相同的假图。
- **PATCH 是 invalidateAll 重取（S8）**：点完给 ~400ms 落窗再读 server，或改读 server 而不依赖 UI 时序。
- **删除步在脚本末尾，改它要跟着改断言的 Agent 名**：第 9 步删的是第 3 步改名后的 `verify-485-renamed`（不是播种名），断言正文里 `{name}` 要跟 `RENAMED` 常量走；邻居 `verify-485-created` 由第 8 步建出，所以删除步必须在创建步之后。
- **密钥播种刻意播两个（#510）**：授权粒度是全有全无——写回的是团队全部密钥 id。只播一个时「全 id 集」与「首个 id」两种实现都过；两个才有牙。密钥 `POST` 无幂等键（每次新 id），故断言对「点击时 server 的现行 id 集」，重跑留下的旧密钥不会让断言失真。