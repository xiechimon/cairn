# R5 · Chief（总管）黑盒行为观察（票 #46）

> 目的：回填 `docs/spec/02-架构平价.md` §4.3/§4.4/§9.1 钉为黑盒逼近的 [推断] 项——Chief 策略层（plan 拆分/分派/措辞→spec）、驳回回路、双 Agent 分派、memory 写路径、通知实际弹出矩阵、总管设置齿轮——全部以 todos.dev 一手行为证据改判。
> 素材：Ego 浏览器 TaskSpace **1**（Profile 2「mon (2)」，free 档已登录 Xmon Dai's team `BoZYfvqKSGanlxsXVbXSa`）+ 本机 `@todos-dev/cli` 0.1.52 真机（`xmonsMac-3574.local` / `TlZ2sSD4EJCxjNJqVhdo_`）+ CDP Network 抓包 + 页内钩子（`window.__r5`：Notification/SW showNotification/XHR-SSE tee/visibility，源码见 `assets/r5/raw/r5-hooks.js`）+ CLI bundle 静态提取 + macOS screencapture。
> 观察时间：2026-09-22 17:00–18:40（本地 Asia/Shanghai；daemon.log 为 UTC，正文时间均标本地）。
> Setup: reuses the r3 session environment (BYOK gateway `r3-gw` with 12 live models at `http://<tailnet-host>:3000`; a keyless request returning `Invalid token` means it is up). The daemon was not running at session start; `tds start` brought it online (daemon.log `09:00:07Z Online`).
> 测试 Agent：`r3-builder`（claude-sonnet-5，职责「负责代码实现与工程修改…」）为 r3 遗留；本会话新建 `r5-scribe`（qwen3.8-max，职责「负责撰写与润色各类文档…」，`POST /api/teams/{id}/agents` → 201）——模型差异用于在 daemon.log `using model` 行区分两 Agent 的 step 痕迹。职责文本经 `PATCH /api/teams/{id}/agents/{aid}` 设置。
> 密钥卫生：沿用 r3 口径，凭证只记形态不记值；push subscription 的 endpoint/keys 仅记宿主域与字段形状。

## 0. 阅读约定

- 编号 `NN-屏名.png` 位于 `docs/research/assets/r5/`，续 r3 序列自 99 起（**124 为预留空号**：该轮点击失败未出图，沿用 r2 空号惯例）。原始抓包/载荷/提取件在 `assets/r5/raw/`（SSE 全量 `sse-capture-*.txt`、chief 记录 `chief-*.json`、SW 源码 `sw.js`、bundle 提取 `bundle-*.js/json`、钩子 `r5-hooks.js`）。
- 断言出处四类：**截图 NN**、**SSE**（raw 文件名+事件 type/seq）、**API**（本会话 CDP 抓包或 `page.fetch` 重放，方法+路径+body 原样）、**CLI**（`~/.tds/daemon.log` 时间戳行、bundle 静态提取）。无出处标 **[推断]**。
- 文案照抄原文（含标点）。

## 1. 环境与通道事实（含产品漂移）

- **路由漂移**：r2 时代看板路由 `/zh/board` 现 404「页面未找到」；应用入口迁至 **`/app/`**（`/zh` 变为营销首页，内嵌 Inkwell/Pulse 演示看板假数据，勿与真团队数据混淆 [观察]）。Agent 详情路由 `/app/resources/agents/<id>?name=<名>` 保持（r3 §4）。
- **`GET /api/teams/{id}/agents` → 405**；Agent 列表实际走 `GET /api/teams/{id}/members`（`memberType:"agent"` 行内嵌 actor 全记录，含 `activeTaskCount`）[API]。创建 Agent 端点 `POST /api/teams/{id}/agents` → 201 `{id}` [API]（r2/r3 未记）。
- **OS 通知权限**：`Notification.permission === "granted"`（r3 人工允许遗留），本票无需再请人工 [API evaluate]。
- **Web Push 注册被服务端拒绝**：页面加载即 `POST /api/push`，body 为 PushSubscription JSON（`endpoint: https://jmt17.google.com/fcm/send/…`（FCM 新宿主域）+ `keys:{p256dh,auth}`）→ **400 `{"error":"unrecognized push service endpoint"}`** [API 重放复现]。SW 已注册（scope `/`，active）且持有同一 subscription [evaluate]。即服务端当前**没有**本浏览器的有效推送订阅——§7 桌面通知矩阵的桌面列因此 blocked（见 §7）。
- **ego-lite 可见性特性**：`Target.activateTarget` 切换活动 tab、乃至 AppleScript 最小化窗口后，页内 `document.hidden` 恒 `false`、`visibilityState` 恒 `visible` [evaluate 实测]——该 Agent 浏览器禁用/覆写了页面可见性追踪（保后台页全速）。故「后台页签」条件在本通道不可构造；§7 矩阵改以协议层（SSE 事件+channels）+ 页内钩子 + sw.js 语义三源定案。
- 侧栏新增 `用量` 项（r2 路由表未记）[截图 99/112]；任务 composer 双按钮 `保存`/`保存并开始`（r3 仅 `保存任务`）[截图 118]；composer 与驳回框新增 `AI 审核` 钮 [截图 123/126 区]；任务面板改 `文档 / 聊天` 双 tab [截图 123]。

## 2. 项 6 · 总管设置齿轮（r2 §9-16 未复核项，改判）

- 齿轮点击**不弹 `role=dialog`**（r2 观测为「无 dialog」的原因）：它是**面板内视图切换**——标题 `总管设置` + 返回钮，下挂 **4 tab**：`Agent` / `章程` / `记忆` / `关注与提醒` [截图 101–104]。四 tab 与 chief 记录四字段一一对应（`agent`/`charter`/`watches`/`wakes`，见 §3.6）[API]。
- **Agent tab**：未绑定时显示 `未设置`；绑定后显示 Agent 头像+名 + 独立 `模型` 选择器（可覆盖 Agent 默认模型，选项=网关全 12 模型 `r3-gw · 128k` 徽标）[截图 107/108]；底部 `压缩模型` 选择器：「压缩上下文时用来生成摘要的模型，选更快的模型可缩短等待。需要 tds CLI 0.1.49 及以上版本。」默认 `默认（与 Chief 相同）` [截图 101]。
- 绑定流：`选择总管 Agent` dialog（搜索框+Agent 列）→ 选中后弹**二次确认**：「更换总管的 agent？总管的记忆保存在其运行所用的 Agent 上。切换至 r3-builder 后，记忆将变为 r3-builder 的记忆，当前记忆不会迁移。」[截图 106] → `PATCH /api/teams/{id}/chief` body `{"agent":{"agentId":"TVv0DxUu3jTIhYpeWh6mn","thinkingLevel":null}}` [API]。
- **章程 tab**：空态「尚无章程。点击编辑，为总管添加常设指示。」+ `编辑`；编辑器 textarea 占位「长期指令：模型路由规则（何种任务使用何种模型）、优先级、偏好…」+ `取消`/`保存章程` [截图 102/110]。chief 记录字段 `charter` [API]。
- **记忆 tab**：未绑定时「尚未选择 Agent。请先在「Agent」页选定 Agent，记忆将保存在该 Agent 上。」；绑定后「总管的记忆与其运行所用的 Agent 共用同一份存储。」+ `打开 r3-builder` 链接 + 内嵌该 Agent 记忆列表（空态文案与 Agent 详情页同）[截图 103/109]。**Chief 无独立记忆存储**（改判 02 §4.3「Chief=特例 Agent 实例」的存储语义：连记忆都共用）。
- **关注与提醒 tab**：空态「暂无跟进事项。总管关注某个任务，或约定到点回头核实时，会按主题列在这里。」[截图 104]；有 watch 时的列表态本会话仅 API 取证（§3.5），UI 列表态未拍到（watch 存续窗口内未开此 tab）[未覆盖]。
- 门控条漂移：r2 记「接入一台机器并配置模型…」；本会话机器+模型就位后门控条变为「请先为总管选择一个 Agent。」+ `设置`（直跳设置视图）[截图 100]；绑定后消失，面板头部模型槽由 `n/a` 变为 `claude-sonnet-5 · 默认`（= 绑定 Agent 的模型）[截图 100 vs 111]。

## 3. 项 1 · Chief 策略层（02 §4.3 [推断] 改判）

### 3.1 执行形态：Chief 回合 = 机器 step + pi 会话 + 服务端 relay 工具

- daemon.log 实测：发消息 17:26 → `claim step=LFnKO1KhDH4F1HylsEAfY` → `step … for conv chief-01a0c86f-c1fb-7171-9666-64a3db176b5b` → `using model r3-gw/claude-sonnet-5`（绑定 Agent 的模型）→ `new session chief-…`（pi session）→ 44s `finished`（与面板 `完成 44s` 徽标吻合）[CLI 2248–2263 行]。**conversation 名 = `chief-<threadId>`**（threadId 为 UUIDv7）。
- Chief 回合自带 workspace：`[workspace] Fetching BoZYfvqKSGanlxsXVbXSa/r3-lifecycle (branch: main)…` [CLI 2254 行]——Chief 在仓库基座上跑 git 只读探索（面板流式工具行 `调用工具: git show,HEAD:README.md` [截图 113]）。
- 工具面 = **step 载荷 `remoteTools[]`（服务端定义、服务端执行）**：bundle `src/lib/remoteTools.ts` 静态提取——`makeRemoteTools(serverUrl, token, step)` 将 `step.remoteTools` 映射为 pi 工具，`execute` → `POST /api/machine/tool/<stepId>` 回传服务端执行（`replaySafe` 读工具带重试预算 `RETRY_DELAYS_MS=[500,2000]`、超时 `remoteTool:10s`）[CLI bundle 提取 `raw/bundle-remoteTools-extract.js`]。同机制另见 `push_credential`（git 凭证 per-step 下发，r3 §1.6 由此坐实工具名）与 `open_repo` [同提取]。
- **Chief 工具词表 49 件**（thread 记录 `toolDefHashes` 全键，`raw/chief-threads-testA.json`）：读侧 `projects/todos/agents/machines/skills/secrets/mcp_servers/schedules/docs/usage/issues/pull_requests/workflow_runs/attachment/conversation`；组织侧 `create_todo/update_todo/delete_todos/close_todos/reopen_todos/complete_todos/message_todo/create_project/update_project/connect_repo/create_agent/update_agent/delete_agents/set_secret/delete_secrets/set_remote_shell/schedule_todo/unschedule_todo`；执行侧 `run_builds/run_review/confirm_builds/cancel_builds/merge_builds`；Chief 私有侧 `ask_user/notify_user/save_memory/delete_memory/memories/watch_todos/unwatch_todos/wakes/set_wake/clear_wake`。与 docs MCP server 面六能力组同构 + 私有侧九件（02 §4.3「最小 agent loop」假设的工具词表由此定案）。
- MCP 仍 per-turn 连接、失败降级（`[mcp] r3mcp: connect failed — its tools are unavailable this turn`，Chief 回合同样）[CLI 2253 行]。

### 3.2 措辞→spec 变换与自动建 todo

- 输入（口语一句）：「帮 r3-lifecycle 写一份 CONTRIBUTING.md 贡献指南，说明怎么给 Agent 提任务、怎么验收改动，写完放到项目根目录。」
- 产出 todo `#11`：**title** = 动词短语提炼「编写 CONTRIBUTING.md 贡献指南」；**spec** = 三段式——① 用户原文 blockquote 引用（`> 帮 r3-lifecycle …`）② `要求：`  bullet 展开（文件位置/内容要点/读者对象）③ `补充信息（探测得出，非用户确认）：` bullet（「当前仓库内容极简，仅有 README.md 和 index.html…」——Chief 先 `git show` 探测仓库再写事实进 spec，并显式标注非用户确认）[SSE sse-capture-testA.txt `{"type":"todo","seq":6}` doc 原样]。
- 溯源字段：`createdBy` = Chief 绑定 Agent id（`TVv0DxUu3jTIhYpeWh6mn`）、`ownerId` = 用户、`sourceBuildId` = chief id（`chief-6ItyfRe7Q7hru5xFmMu-u-…`）[同 SSE doc]。
- 面板回执为结构化卡片：`已创建并派工` chip + todo 引用 `#11` + 「由文档专职 Agent [r5-scribe] 承接，正在编写中。」+ 要求复述 + 「完成或需要确认时我会跟进汇报。」+ `完成 44s` 徽标 [截图 114]。

### 3.3 分派：职责文本权重 A/B 实测

- **A（纯文档任务）**：上句 → `assignment.build.agentId = SPn3bR8GalngsJm1ge-Sh`（**r5-scribe**，职责「负责撰写与润色各类文档…」）[SSE todo doc seq6]；面板回执点名「文档专职 Agent」。
- **B（混合任务：README 节+CHANGELOG+hello.js）**：→ `assignment.build.agentId = TVv0DxUu3jTIhYpeWh6mn`（**r3-builder**，代码职责）[SSE sse-capture-testA.txt 后续 todo seq]；title 三事合并「README 文档目录 + 新建 CHANGELOG.md + scripts/hello.js」。
- 结论：**职责文本参与分派且方向一致**（文档味→文档 Agent；含代码→代码 Agent）；分派说明文案直接引用职责语义（「文档专职」）[截图 114]。Chief 未就分派征询用户 [观察]。

### 3.4 拆分形状与启动方式

- 三子事项请求 → **1 个 todo**（标题 `+` 连接），不过度拆分 [SSE]；单事项 → 1 todo。本会话未诱发多 todo 拆分（未试「跨项目/跨阶段」级请求）[未覆盖]。
- Chief 派工默认 **`withPlan:false` 直接执行**（build doc `withPlan:false`，phase `todo→building` 跳过 confirm）[SSE build seq5]；人工启动则可在 dialog 选 `先做规划`/`立即执行`（§5）。
- `POST /api/projects/{id}/builds` body 形状（人工启动抓包）：`{"todoIds":[<todoId>],"assignment":{"build":{"agentId":…},"plan":{"agentId":…}},"withPlan":true}`——**todoIds 为数组（批量启动形状）**、**assignment 按阶段分 plan/build 两槽** [API]。

### 3.5 watch/wake 主动回路（「关注与提醒」机制实走）

- 派工即自动建 watch：chief 记录 `watches[0] = {todoId, projectId, seqNum, title, projectName, phase, reason:"Dispatched by the chief: report back when it parks at a gate or settles.", createdAt, threadId, threadTitle}` [API `raw/chief-record-testA.json`]。
- **gate wake**：worker build 停 review（17:29:40 finished）→ **1 秒后**机器领 Chief conv 新 step（`continue session chief-…`，31s）→ 线程内汇报卡：todo chip `#11` + 「已完成，停在 review 等待确认：」+ 质量核对 bullet（含「验收方式如实基于现状撰写，没有编造不存在的测试命令」）+ 任务分支文件深链 `files?ref=tds/conv-…&path=CONTRIBUTING.md` + 「确认没问题后，请告诉我"合并"，我会执行合并。」[CLI 2264–2266 行 + 截图 115]。
- **settle wake（合并完成）**：Chief 执行 `merge_builds`（用户指令「合并 #11」）后先回「合并已启动，尚未确认落地——等合并结果的 wake 到达后我会告知是否真正完成。」（15s 轮）→ merge step finished 后 **13ms 内**再领 wake step（5s 轮）→ 「「编写 CONTRIBUTING.md 贡献指南」已合并完成，状态为 done。CONTRIBUTING.md 已落地到 r3-lifecycle 项目根目录。」[CLI 2267–2275 行区间 + 截图 117]。**Chief 区分「委派已受理」与「结果已确认」两阶段汇报**。
- **failed wake**：#12 合并失败（§7/§8）→ Chief wake 轮先调 `machines` 工具（thread 消息载荷 `activeRun:{phase:"chief", tool:{toolName:"machines"}}`）→ 产出法证式汇报：失败原因（「你(Xmon Dai)在 10:18 直接点击了合并,但当时机器…短暂离线,merge 报错 "Machine offline"」）、定性（「这不是代码问题」）、工作保全位置（分支 `tds/conv-01a0c87a-…`「没有丢失」）、环境建议（「它的 tds 版本 v0.1.52 落后于最新 v0.1.53,建议你之后 npm install -g @todos-dev/cli@latest && tds restart 升级一下」——版本差来自 machines 工具数据）[截图 133 + `raw/chief-threadB-messages.json`]。
- watch 生命周期：settle/failed 后自动解除（`watches: []`）[API 18:20]。
- 归因怪癖（照录）：failed wake 汇报中 Chief 一度称「另外注意到 #11 也已到 review 阶段（这个我未曾创建/派工过…）」——#11 实为其自派 [截图 117 区]。

### 3.6 线程/消息记录形状（协议证据）

- `GET /api/teams/{id}/chief` → `{chief:{id:"chief-<userId>-<teamId>", userId, teamId, agent:{agentId}|null, charter, lastTurnAt, createdAt}, agentActor:<agent 全记录>|null, context:{tokens, contextWindow}|null, watches[], wakes[]}` [API]。`context.tokens` 随回合增长（27065→29866）[API 两次]。
- `GET /api/teams/{id}/chief/threads` → `[{id:"chief-<uuid>", chiefId, userId, teamId, title(首句截断+…), createdAt, updatedAt, lastTurnAt, session:{runtime:"pi", id, openedAt}, pendingSessionResumeAt, toolDefHashes{49}, toolResultHashes, activeRun}]` [API]。**runtime="pi" 坐实 Chief 会话跑在 pi 引擎**（与 executor 同源，02 §1.1 D3 同构事实的 Chief 侧延伸）。
- `GET /api/conversations/chief-<threadId>/messages` → `{messages[], chips, historyEpoch, steerPending[], activeRun, nextCursor}`；message role 含 `system`（content 为 JSON，实测 `{"kind":"machine_selected","machineId":…,"name":…}`）/`user`/`assistant`；assistant 正文内联实体引用为自定义 URI markdown：`[r3-builder](agent:<agentId>)`、`[#12](todo:<todoId>)`；消息载荷尾部内嵌实体上下文 map（todos 全 doc + projects/skills/machines）[API `raw/chief-threadB-messages.json`]。
- 面板 UI：主题芯片切换器列全部线程 [截图 116]；回合流式展示工具行与 `完成 Ns` 徽标；用户消息 hover `恢复到此处`（checkpoint 语义同任务 transcript）；输入框占位 `有什么可以帮你的？`，回合中变 `向 Agent 补充说明，执行过程中即可送达`（steer 语义）+ `停止` 钮 [截图 113]；草稿持久化 `tds.cache.chief-draft-v1:<team>:new`（跨会话恢复实测）[localStorage]。

## 4. 项 2 · 驳回回路（02 §4.2 [推断] 改判：v2 机制实走）

- 入口：confirm 态面板底部 textarea `请求修改…`（composer 行：语音输入/添加附件/`AI 审核`/提及/发送；发送钮被总管悬浮球遮挡，需 force/DOM click [观察]）。
- **API**：`POST /api/builds/{buildId}/steps` body `{"action":"revision","side":"plan","feedback":"<驳回文本>","clientMessageId":"<uuid>"}` [API 抓包]。对照：确认 = 同端点 `{"action":"confirm"}` [API]。
- **版本机制**：驳回触发重规划（daemon.log 新规划步，同 conv `continue session`）→ 文档头版本 chip `v1`→`v2`；下拉列 `v2 · 刚刚` / `v1 · 5 分钟前`（各带恢复图标）+ **`与其他版本对比…`** 入口 → 二级菜单（目标版本 + `上一版本` 快捷）→ **diff 视图**：chip 变 `v1 → v2` + `1 个文件改动` + `+5 −8` 统计 + 文件行 `plan.md`（带 `预览` 切换）+ `全部展开` → 展开为 unified diff（hunk 头 `@@ -1,17 +1,14 @@`、双侧行号、±行）[截图 125–129]。**plan 即文件（plan.md），版本 diff = 文件级 unified diff**（对应 `GET /api/documents/{id}/diff`，r3 §8.2 端点由此获得 UI 触点）。
- **时间线呈现**：v1 方案卡行（`方案 · v1` + `完成 24s`）→ 用户驳回消息行（全文+头像+`恢复到此处`）→ agent 调整摘要行（「已按反馈调整:后缀从「·r3-lifecycle」…改为「·静态演示页」,不再重复项目名;同时移除…中的 grep 期望值。」）→ v2 方案卡行（`方案 · v2` + `完成 22s`）[截图 126 全窗]。
- v2 内容忠实执行反馈（title 后缀改「 · 静态演示页」、Verification grep 期望同步）[截图 125]。
- 旁证：confirm 态卡片主按钮即确认动作——本会话一次卡片点击误触确认（#13 直接进 building），与 r3 §3.0「卡片主按钮随状态」一致 [观察+CLI 执行步起点 10:01:36]。

## 5. 项 3 · 双 Agent 分派（「规划与执行分用不同 Agent」实走）

- 开始 dialog：`Agent` 单 picker + 开关 `规划与执行分用不同 Agent` + `先做规划`/`立即执行` [截图 119]；开关 ON 后单 picker 替换为 **`规划` + `执行` 双 picker**（初均 `未指派`）[截图 120]。
- 镜像规则（实测序列）：规划 picker 首次选定后，`执行` 由「未指派」自动镜像为同 Agent；此后执行改选会连带改写规划（一次观测），再改规划则不再覆盖执行（一次观测）——规则不完全确定，**两槽最终可独立取值** [观察，截图 121/121b]。
- 指派 `规划=r3-builder(sonnet-5)`、`执行=r5-scribe(qwen3.8-max)`，`先做规划` → `POST builds` body 见 §3.4（`assignment.plan`/`assignment.build` 分槽）[API]。
- **机器侧痕迹**：规划步 `using model r3-gw/claude-sonnet-5`（09:58:19）→ 执行步同 conv `using model r3-gw/qwen3.8-max` 且 `continue session <convId>`（**执行轮复用规划轮 pi session**，同 r3 合并轮复用模式）→ 合并步再用执行 Agent 模型（qwen，10:14:39 为 #14 单 Agent 场景则 sonnet）[CLI 2349–2367、2410–2419 行]。**哪个 Agent 跑哪类步 = daemon.log `using model` 行可判定**；todo 记录 `assignment:{plan:{agentId},build:{agentId}}` 为声明侧 [API]。
- UI 侧痕迹：面板/卡片不显式标注规划/执行 Agent 归属；运行历史与 Token 用量未按 Agent 拆分观测 [未覆盖]。

## 6. 项 4 · memory 写路径（02 §4.4 [推断] 改判）

- **零自动写入**：r5-scribe 完成 #11 构建（167 行文档）、r3-builder 跑 2 个 Chief 回合后，`GET /api/teams/{id}/agents/{aid}/memories` 均 `[]`；daemon.log 全程无 memory/remember 字样 [API+CLI]。**「任务完成→自动蒸馏记忆」不成立**。
- **指令触发写入**：#13 spec 第五段嵌入「完成后请用你的记忆工具保存一条与本项目相关的一句话经验」→ 执行步期间写入 1 条：`{id, agentId, teamId, title:"r3-lifecycle README 只在末尾追加小节，文件引用用相对链接", content:"r3-lifecycle 的 README.md 约定：新增说明一律在文件末尾追加二级标题小节（如「## 项目结构」）…", projectId, sourceTodoId:<#13 todoId>, sourceBuildId:<#13 buildId>, createdAt:10:02:20Z, updatedAt}` [API]。**写入时点 = 执行步进行中**（10:02:20，早于 review park 10:02:37 约 17s），非任务结束钩子 [API createdAt vs SSE build_review createdAt]。
- **Agent 自主裁量**：#14（同含记忆指令，同一 scribe）执行后**未新增**条目（updatedAt 未变）——有指令也不保证写 [API]。
- **Chief 不写**：Test B 对 Chief 显式要求「把这次协作的经验一句话写入你的记忆」，Chief 回合（含 wake）结束后 r3-builder memories 仍 `[]`；Chief 回复中曾承诺「到时候也会补上记忆总结」但未兑现 [API+`raw/chief-threadB-messages.json`]。
- **工具名**：Chief 工具词表含 `save_memory/delete_memory/memories`（§3.1）；worker 侧同族工具经 remoteTools 下发（bundle 无本地记忆实现，`dist/index.js` 无 save_memory 串）[CLI bundle grep]。写路径 = **agent 工具 → 服务端 relay 执行**（02 §4.4 `remember` 内部名假设改判为 `save_memory` 品牌位候选）。
- **UI**：Agent 详情 `记忆` tab：头 `记忆 · 1 / 100`（**配额 100 条/Agent**）+ 搜索框 `搜索记忆…` + `排序` 钮；条目卡 = title + 编辑/删除图标 + content 截断 + 项目 chip `r3-lifecycle` + `添加 19 分钟前` + `来源任务` 溯源链接 [截图 134]。Chief 设置 `记忆` tab 内嵌同一存储（§2）。
- **读路径注入形仍 [推断]**：systemPrompt 注入未获一手证据（bundle/daemon.log 无注入点串）；保留 02 §4.4 读路径假设待实现期自证。

## 7. 项 5 · 通知实际弹出矩阵（02 §9.1 [推断] 改判）

### 7.1 架构定案（三源互证）

- **桌面通知唯一通道 = Web Push → SW**：页 bundle（entry-*.js，3.58MB）中 `new Notification(` 与 `showNotification(` **零命中**；`Notification.permission` 8 处全为注册门控/设置 UI（`registerForPush()`：permission granted → `pushManager.subscribe({userVisibleOnly:true, applicationServerKey:<bundle 内 VAPID 公钥>})` → `POST /api/push`；桌面壳 `isDesktopShell()` 走独立原生路径）[bundle 提取 `raw/bundle-notification-contexts.json`]。**02 §9.1「无 VAPID/Web Push、SSE→页内 new Notification()」假设整体改判**。
- **SW 语义**（`raw/sw.js` 全源 3483B）：声明式推送载荷 `{web_push:8030, notification:{title, body, navigate, tag}}`（Safari 18.4+ 原生消费）；Chrome/Firefox 走 `push` handler 回退：**前台抑制 = 存在 `visibilityState==='visible' && focused` 的 app 窗口**；`showNotification(title||'Todos', {body, tag, data:{href}})`，title = todo 标题（规避 iOS 归属行重复）；`notificationclick` 经 CacheStorage `/__pending-nav` + postMessage 深度链接路由；SW 刻意无 fetch handler（注释说明性能理由）。
- **页内通道** = SSE team stream `notification` 事件 → toast/未读徽标（侧栏红点、总管球徽标实测联动 [截图 132/134 区]）。

### 7.2 SSE 通知事件矩阵（实测，`raw/sse-capture-*.txt`）

| 业务事件 | notification.type | entityRef / agent | snippet | channels |
|---|---|---|---|---|
| 进入 confirm（plan 就绪） | `plan_ready` | todo title/projectId/seqNum | null | `["in_app"]` |
| 进入 review（含定时轮停 review） | `build_review` | 同上 | null | `["in_app"]` |
| Chief 线程消息（派工/wake 汇报） | `chief_message` | thread title | 消息全文 | `["in_app"]` |
| 进入 done（合并完成） | **无事件**（观测窗 #14 合并全程） | — | — | — |
| 进入 failed（机器离线合并败） | **无事件**（观测窗 #12 失败全程） | — | — | — |

- 事件公共形状：`{type:"notification", notification:{teamId, userId, type, entityId(todoId 或 chief-threadId), entityRef, agent:{name,avatarUrl}, snippet, id:"<userId>:<entityId>", readAt, createdAt, channels[]}}` [SSE 原样]。
- **02 §9.1 canonical 五事件枚举改判**：confirm/review 有 in-app 事件（名 `plan_ready`/`build_review`）；**定时轮结束无独立类型**（停 review 即 `build_review`，`triggerSource:"schedule"` 仅在 build doc 上）；**done/failed 无 in-app 通知事件**（是否仅走 push 通道无订阅可验 **[推断]**）。
- 非通知类 SSE 事件实测扩充（改判 02 §1.2「任务事件不入 team stream」推断）：`{"type":"todo",seq,v,doc}` / `{"type":"build",seq,v,doc}` 全文档推送 + `ping`/`machine_presence` [SSE]。build doc 新字段实测：`triggerSource`（`chief`/`user`/`schedule`）、`planDocId`、`diffHash`、`errorMessage`（定时重跑时旧 build 标 `"Cancelled"`）[SSE sse-capture-timer.txt]。

### 7.3 桌面弹出实测结论（blocked，如实记录）

- 页内钩子（`Notification` 构造器 + `ServiceWorkerRegistration.showNotification` 原型双层 patch）在**全部事件窗口**（含窗口最小化/不在活动 Space 期间触发的 plan_ready、build_review、chief_message、done、failed）记录 **0 次调用** [hooks 多次 dump]——与 7.1 静态结论一致：页层从不弹。
- 桌面横幅依赖服务端 push 投递；本浏览器 `POST /api/push` → 400 `unrecognized push service endpoint`（FCM 宿主 `jmt17.google.com` 不在服务端认可集 **[推断：allowlist]**）→ 服务端无有效订阅 → **桌面通知在本环境不可达**。screencapture 未在事件时刻捕到横幅（与上述因果一致）[raw 无横幅截图]。
- 结论：**矩阵协议层定案（7.2 表）；桌面弹出列 blocked**（环境因素，非权限——权限已 granted）。复刻侧验收口径：桌面通知验收需「服务端认可的 push 宿主 + 有效订阅」，ego-lite/FCM 新宿主组合不可用；02 §9.1 验收提示相应改写。

## 8. 附带观察（漂移与边角，供后续票）

- **看板列映射细粒度**（r2/r3 映射的补充，非推翻）：gate 态卡片**无代码改动**者留在 `执行中` 列（confirm 态主按钮 `方案`、review+无改动主按钮 `回复`，见 #13/#1）；**有改动**的 review 卡片在 `待验收`（#12/#14，主按钮 `完成`）[截图 112/132 区 + API hasChanges 对照]。02 §4.1 折叠映射据此加注。
- 定时：`单次` 触发后自动出队复核（`GET /api/schedules?team=` → `[]`）；触发时旧 build `errorMessage:"Cancelled"` + 新 build `triggerSource:"schedule"`；分钟档 `00/15/30/45` 复核 [截图 130/131 + SSE]。表单文案与 r3 §9 一致。
- failed 面板 canon 复核：红 chip `失败` + 主按钮 `重跑` + 红行「运行该任务的机器已离线 / 请将其重新上线，或重新运行任务以改派其他机器。」+ `查看原始错误`/`排查指南`；变更文档 pane `3 个文件改动 +15` 逐文件（CHANGELOG.md +9 / README.md +4 / scripts/hello.js +2）[截图 132]。
- 机器页数据含 `latestCliVersion:"0.1.53"`（本机 0.1.52 落后）[API]；Chief failed 汇报亦引用该差 [截图 133]。
- `POST /api/push`、`GET /api/teams/{id}/members`（Agent 列表）、`POST /api/teams/{id}/agents`、`GET /api/teams/{id}/agents/{aid}/memories`、`GET /api/conversations/chief-<threadId>/messages` 为 r3 §8.2 端点清单补项 [API]。

## 9. 02 册 §11 改判表回填（逐项）

| §11 项 | 改判 | 证据 |
|---|---|---|
| 驳回→plan v2 机制（§4.2） | **改判完成**：`POST builds/{id}/steps {action:"revision",side:"plan",feedback}` → 重规划 → 版本 chip v2 + 下拉 + `与其他版本对比` → plan.md unified diff；确认 = `{action:"confirm"}` | r5 §4 |
| Chief 策略层（§4.3） | **改判完成**：Chief 回合=机器 step+pi 会话；49 件 remoteTools 服务端 relay；措辞→spec 三段式；职责权重 A/B；单请求单 todo+withPlan:false 直派；watch/wake 三触发（gate/settle/failed）；设置=4 tab；charter=常设指示 | r5 §2–§3 |
| memory 写路径（§4.4） | **改判完成（写侧）**：工具名 `save_memory`（非 `remember`）；指令触发+Agent 裁量；执行步中写入；条目含 sourceTodo/sourceBuild 溯源；配额 100；Chief 共用绑定 Agent 存储。**读侧注入形仍 [推断]** | r5 §6 |
| 通知触发矩阵（§9.1） | **改判完成（协议层）**：Web Push(VAPID)+SW 前台抑制为桌面通道；页内 = SSE `notification` 事件 `plan_ready`/`build_review`/`chief_message`，channels 恒 `["in_app"]`（无订阅时）；done/failed 无 in-app 事件；定时轮无独立类型。桌面弹出列 blocked（push 400） | r5 §7 |
| 看板更新走查询失效重取（§1.2） | **部分改判**：team stream 实测承载 `todo`/`build` 全文档事件与 `notification`；是否仍有失效重取未分离观测 **[推断保留]** | r5 §7.2 |
| 步 journal recover / per-step 凭证 / schedule 枚举词 / DELETE 面 / 搜索 wire / 预览隧道 | 未触，维持原状 | — |

## 10. 未覆盖 / 遗留 [推断]

- 桌面通知实际横幅视觉（blocked：push 订阅被服务端拒；需认可宿主或服务端 allowlist 更新后复测）。
- Chief 多 todo 拆分诱因（跨项目/大粒度请求）；分派冲突时的征询行为。
- `关注与提醒` tab 有数据态 UI；`wakes[]` 非空形态（「约定到点回头核实」的 set_wake 实走）。
- memory 读路径注入形（systemPrompt 缝）；记忆编辑/删除 UI 细态；配额满行为。
- 运行历史/Token 用量按 Agent 拆分呈现；`AI 审核` 钮行为；`保存并开始` 按钮路径。
- charter 保存后对 Chief 行为的实际影响（本会话未存章程，保持自然行为基线）。

## 11. 截图索引（`docs/research/assets/r5/`，36 张）

99 看板初始（机器在线）· 100 总管面板（Agent 门控态）· 101 总管设置 Agent tab · 102 章程 tab · 103 记忆 tab（未绑定）· 104 关注与提醒 tab · 105 选择总管 Agent dialog · 106 更换确认 dialog · 107 绑定后设置态 · 108 模型覆盖 picker · 109 记忆 tab（绑定后共用存储）· 110 章程编辑器 · 111 面板就绪态 · 112 看板全列宽视口 · 113 Chief 回合流式（机器+工具行+steer 框）· 114 派工回执卡 · 115 gate wake 汇报 · 116 线程切换器 · 117 合并 wake 汇报 · 118 任务 composer（双保存钮）· 119 开始 dialog 默认 · 120 开关 ON 双 picker · 121/121b 双 Agent 指派态 · 122 看板 gate 列位 · 123 plan v1 卡（文档/聊天 tab）· 125 plan v2 卡 · 126 版本下拉+全窗时间线 · 127 对比二级菜单 · 128 diff 视图 · 129 diff 展开 hunks · 130 定时表单 · 131 定时卡 · 132 failed 面板 · 133 Chief failed wake 汇报 · 134 Agent 记忆条目 UI。
**124 预留空号**（驳回轮点击失败未出图）。
raw/：`sw.js`、`r5-hooks.js`、`bundle-remoteTools-extract.js`、`bundle-notification-contexts.json`、`chief-threads-testA.json`、`chief-record-testA.json`、`chief-threadB-messages.json`、`sse-capture-{testA,merge11,confirm13,exec14,done14,failed12,timer,full}.txt`。
