# 机器执行面：「同一份代码放任意机器跑」是怎么实现的

> 目的：回答用户 2026-10-02 的提问「这个项目可以任意放到任意机器上运行。我想知道这个功能到底是怎么实现的」。
> 来源：herdr 线程 t-0047 只读调研（2026-10-02 取数：仓内逐链路读源 + crabbox / Multica 一手拉取对拍 + 本机与 mea 进程/端口实测）。
> 基线：入库时全部 `路径:行号` 已重锚到 `origin/main = 37edab2a`（2026-10-03）并逐条抽验；行号随代码漂移，以基线 SHA 为准。
> 时效：crabbox / Multica 侧为 2026-10-02 快照（crabbox HEAD pushedAt 2026-10-02T10:39Z，1440 星；multica HEAD pushedAt 2026-10-02T14:25Z，51848 星，经 `gh` CLI 直接拉 README / 架构文档 / 源码抽查）。Multica 机制细节转引仓内 r10 / r13（fresh-clone 源码逐行）与 r3（worktree 契约实测），本文未重爬其源码；mea 上的 Multica 部署已于 2026-10-02 停用，不影响其作为对照样本的效力。
> 引用约定：无标注的 `路径:行号` = 本仓一手证据；`[推断]` = 无直接出处的推断，不写无出处的断言。
> 关联：工程票 #682（机器派发闭环）引用本文；r10 / r11 / r13 为 Multica runtime 模型的正本研究。

## 0. 结论先行

1. **「任意机器」的执行面已经完整存在**：enroll / claim / worktree / 回传全链路在位，本机（macOS）与 mea（WSL2 Linux）同码各跑一套 server + daemon 是活证据（§3）。
2. **机制本质四句话**：代码不随任务搬运，git 是单源；执行机是主动出网认领任务的 daemon，server 不需要反向连机器；认证与步级 git 凭证全部由 server 下发、按步短命；控制面走 HTTP/SSE，数据面走 git（§1）。
3. **「没闭环」缺的不是执行面，是入口到派发的接线**：钉选机器列（`build.pinnedMachineId`）在库里、claim 过滤在服务里，但三条任务入口（新建任务 UI / REST body / chief 编排链）都写不到它——目前唯一写入方是定时器。另有五处治理缺口（§4，全部收进 #682）。
4. **派发模型的谱系**：pacman ≈ Multica 的派发骨架（daemon 出网 + claim 长轮询 + per-conversation worktree + 任务级凭证），但把 Multica 的「agent 绑 runtime」解耦成「assignment 选 agent、机器另行钉选」；crabbox 则代表另一极端——机器选择就是调用时的一个显式 flag，没有队列也没有绑定（§5）。

## 1. 机制四支柱

**支柱一：git 是代码单源，代码从不随任务搬运。**
任务执行前，执行机从 claim 载荷里的 `cloneUrl` 现场 clone 基座仓并开 per-conversation worktree（`apps/daemon/src/workspace.ts:66-114`）。`cloneUrl` 三形态由 server 侧 `projectRepoRef` 单点派生（`apps/server/src/services/git.ts:115-130`）：

- hosted = `<origin>/git/<teamId>/<repoName>`（server 上的 bare repo + `git http-backend` CGI，`git.ts:100-102`）；
- github = `https://github.com/<repo>.git`（`git.ts:132-135`）；
- local = 用户仓库绝对路径（`git.ts:125-127`）。

所以「任意机器」不需要预装项目，只需要 daemon + git + 网络可达。

**支柱二：执行机 = 主动出网的 daemon，不需要公网入站。**
机器上跑同一个 npm 包（`@xiechimon/pacman-cli`），`pacman start --server <url>` 指向任意 server（`apps/daemon/src/cli.ts:101`；config 优先级 = 显式入参 > env > 默认，`apps/daemon/src/config.ts:1-3`）。所有工作都走 daemon → server 的 HTTP 长轮询 + SSE 出网连接；server 从不反向连机器。

**支柱三：认证与凭证全部由 server 下发、按步短命。**
机器注册换 64hex token，服务端只存哈希（`packages/shared/src/protocol/machine-wire.ts:41-45`）；每步执行前 daemon 再调 `GET /api/machine/token/{stepId}` 取**步级** git 凭证（托管 repo key / GitHub x-access-token），内存持有不落盘（`apps/daemon/src/runner.ts:267-268`、`apps/server/src/routes-machine.ts:313-315`）。机器上没有长期凭据。

**支柱四：控制面在 HTTP/SSE，数据面在 git。**
指令、心跳、事件走 server；代码产出靠每步收尾 `commitAll + push` conv 分支回到 git 远端（`runner.ts:803-838`）。任意机器都能从 origin 恢复代码上下文——这是「任意机器可接力」的底层原因（会话上下文的例外见 §4-7）。

## 2. 全链路逐环（新建任务 → 远端机器执行 → 回传）

### 环 0 · 机器上线（enroll，三路径）

- Web「添加机器」弹窗给 CLI 命令：`npm install -g @xiechimon/pacman-cli@latest` + `pacman start`（浏览器授权）或 `pacman start --api-key <key> --team <teamId>`（无头路径），`apps/web/src/resources/create-machine-dialog.tsx:35-37`。
- 目标机器上 daemon 启动：无 `machine.json` 即注册——POST `/api/machine/enroll`（Bearer apiKey，`apps/daemon/src/machine-client.ts:178-190`、`apps/daemon/src/machine-loop.ts:141-173`）；浏览器授权流 = enroll/start + poll + 授权页确认（`machine-client.ts:192-214`、`apps/server/src/routes-machine.ts:136-204`）。
- server 落 `machine` 行：`enrollMachine` upsert，token 存哈希（`apps/server/src/services/machines.ts:449-490`）；按 hostname 判 local/remote（本机律 seed，`machines.ts:400-405`）；server 启动时 seed 本机行 kind='local'（`machines.ts:422-447`、`apps/server/src/index.ts:39`）。
- 之后 daemon 进入三段常驻：presence 心跳 30s（`machine-loop.ts:347-351`）→ wake SSE 订阅（断线持续重连，`machine-loop.ts:265-345`、`routes-machine.ts:235-256`；断流即 markOffline，`machines.ts:571-577`）→ claim 长轮询主循环（`machine-loop.ts:380-401`）。

### 环 1 · 新建任务（web）

- 新建任务 dialog 只提交**正文 + 项目 id** 两个字段（`apps/web/src/overlay/new-task-dialog.tsx:273`）——无机器、无 agent、无标题。
- 「保存」= `POST /api/projects/:id/todos`（`apps/web/src/overlay/use-new-task-surface.ts:112-136` → `apps/server/src/routes.ts:1079-1092`）；「保存并开始」= 创建后**直发总管编排回合** `POST /api/todos/:id/orchestrate`（`use-new-task-surface.ts:139-172` → `routes.ts:586-603` → `sendChiefMessage`，#640 裁决后这是唯一默认路径）。手工启动面在任务详情页：`POST /api/projects/:id/builds`（`apps/web/src/routes/todo-detail-page.tsx:486-497` → `routes.ts:1094-1110`）。

### 环 2 · 入队（todo → build → step）

- `startBuilds`（`apps/server/src/services/builds.ts:342-394`）：每 todo 落一条 `build` 行（buildId ≡ conversationId，UUIDv7）+ 入队首步（plan 或 build），todo 相位 → queued。**build 行带 `pinnedMachineId` 列**（`apps/server/src/db/schema.ts:132`、`packages/shared/src/records/build.ts:21-22` 注释原文「钉选机器；null = 自动」），服务层参数已支持（`builds.ts:351`、`373`）——但当前唯一写入方是定时器（`apps/server/src/services/scheduler.ts:60-66`，`schedule.machineId` 透传；schedule 侧写入面 = chief 的 `schedule_todo` 工具，`packages/shared/src/protocol/chief-tools.ts:450-465`）。
- orchestrate 路径：chief 线程 + chief 步入队（`chief-<threadId>` 为会话键，`routes.ts:599`），无 build、无机器语义。

### 环 3 · 认领（claim，多机派发的核心）

- daemon 主循环长轮询 `POST /api/machine/tasks/claim`（server hold ~75s + wake 即时唤醒；`machine-loop.ts:380-401` → `machine-client.ts:239-250` → `routes-machine.ts:227-232`）。
- server `claimStep / tryClaim`（`machines.ts:949`、`793-830`）选步：
  - **worker 步候选**（`claimCandidates`，`machines.ts:609-625`）：`step.status='pending'` 且 **`build.pinnedMachineId IS NULL OR = 本机`**（`machines.ts:619`）——钉选过滤已经实现；未钉选的步全团队任何在线机器都能抢，FIFO 按 createdAt。
  - **chief 步候选**（`claimChiefCandidates`，`machines.ts:629-637`）：无 build/todo 行，**没有任何机器过滤**。
  - 原子领取：`UPDATE step SET status='claimed', machineId, ... WHERE status='pending'`（`machines.ts:826-830`）；worker 步还要求 todo 已指派带模型的 agent（`machines.ts:822`），chief 步要求 chief 绑定了带模型的 agent（`machines.ts:730-738`）。
- claim 载荷组装：worker 侧（`machines.ts:860-944`）携带 conversationId、会话 new/continue 判定（continue 读 server 侧 prior sessionId，`machines.ts:835-855`）、todo（title/spec）、**project + repo（cloneUrl 由 `projectRepoRef` 派生）**、agent（模型/记忆/技能白名单/权限开关）、remoteTools、localTools（双闸判定 `machines.ts:696-718`）、mcpServers（CLI 版本门 `machines.ts:669-690`）；chief 侧对应组装在 `machines.ts:750-790`。

### 环 4 · 执行（在认领机器上）

`runStep`（`apps/daemon/src/runner.ts:217` 起）：

1. 步级凭证：`client.token(stepId)` → `pushCredential`（内存，`runner.ts:267-268`）。runtime 步（claude-code）零凭据注入——认证靠执行机本地登录 / `ANTHROPIC_API_KEY`（`runner.ts:258-277` 注释）。
2. worktree：`workspace.prepare({projectId, conversationId, cloneUrl, credentials})`（`runner.ts:334-340`）→ 基座 clone/fetch 到 `<workspacesRoot>/<projectId>/repo`，任务 worktree `<workspacesRoot>/<conversationId>`、分支 `pacman/conv-<conversationId>`、base 二择 origin/conv 或 origin/default（`workspace.ts:66-114`）；projectLock 串行化同项目操作（`workspace.ts:50-64`）。
3. 后端解析：`backendFor(agent.provider)`——pi 默认，claude-code 惰性构造（spec 17 A3，`machine-loop.ts:109-130`）；MCP slug 在执行机本地 `~/.claude.json` 解析端点，凭证不跨 wire（`runner.ts:376-384`）。
4. 会话：`backend.createSession`（`runner.ts:586-591`），systemPrompt = chief 合成 / worker 职责+记忆（`runner.ts:361-368`）。运行中：heartbeat 与工具行/流式回传（`routes-machine.ts:278-309`）、steer/stop 经 wake SSE 拉取-确认（`machine-loop.ts:274-309`）。
5. 崩溃恢复：daemon 侧 StepJournal（`apps/daemon/src/journal.ts:32-107`）+ 重启时 `client.recover()` 对账续跑（`machine-loop.ts:234-263`）。

### 环 5 · 回传与闭环

- 收尾：`commitAll`（`runner.ts:803`）→（合并步）merge `origin/<default>` → `push` conv 分支（带步级凭证，`runner.ts:838`）→ transcript/plan 上传（`runner.ts:860-895`）→ `done`（status/sessionId/usage/hasChanges/checkpoint commit，`runner.ts:900-910`）→ server `finishStep` 推进 todo 相位。local 形态合并落地 = conv 分支 push 回用户仓库（#1211：用户主检出的分支永不被推进）。
- 停止/丢弃 = rewind 到步起点 checkpoint；审核步只读检出 + 收尾强制回退——两条路共用同一处回退护栏（`runner.ts:743-765`）。

## 3. 「任意机器」的实测证据

2026-10-02 取证（ps / lsof / systemctl 实测）：

- 本机 macOS：server 监听 :8787 + daemon 在跑，完成全部环。
- mea（WSL2）：`pacman-dev-server.service`（active，node 跑 `/home/measure/pacman/apps/server/src/index.ts`）与 `pacman-daemon.service`（active，enrolled to local server :8787）。

同一份代码在 macOS 与 Linux（WSL2）两套部署各自完成 server + daemon 全环——「任意机器部署」本身没有缺口；「没闭环」特指**任务的机器定向**（§4）。

## 4. 缺口清单（对照 §2 逐环点名）

执行面（环 0/3/4/5）全在，缺口集中在**入口与治理**。1-6 与 9 已收进工程票 #682；7、8 是多机成型后的已知边界。

| # | 缺口 | 现状证据 | 定性 |
|---|---|---|---|
| 1 | 新建任务无机器入口 | dialog 只提交 spec+projectId（`new-task-dialog.tsx:273`）；`use-new-task-surface.ts:112-172` 无机器参数 | 入口环 |
| 2 | REST 面无机器参数 | `startBuildsBodySchema` 仅 todoIds/assignment/withPlan（`records/build.ts:38-43`）；orchestrate 路由无 body 面（`routes.ts:586-603`） | 入口环 |
| 3 | chief 编排链无机器语义 | chief 步 claim 无 pin 过滤（`machines.ts:629-637`）；chief 的 `machines` 工具只能读；`run_builds` 工具无 machineId 参数（`protocol/chief-tools.ts:472-493`，handler `services/chief-tools.ts:671-700` 调 startBuilds 不传 pin） | 编排环 |
| 4 | pin 已建但成孤岛 | 列（`schema.ts:132`）+ claim 过滤（`machines.ts:619`）+ 服务参数（`builds.ts:351,373`）都在，唯一写入方 = 定时器（`scheduler.ts:66`）；连 schedule 的 web 创建面也没暴露 machineId（web 全树仅 branch-dialog 有机器选择，`apps/web/src/detail/branch-dialog.tsx:200-206`） | 接线环 |
| 5 | per-runtime 开关写而不读 | `enabledRuntimes` 只有 PATCH 写（`routes.ts:1272-1284`）和 web 映射，claim/dispatch 无任何消费（全树 grep 证实）——machines 页「决定本机跑 pi 还是 Claude Code 任务」的 A8 承诺未兑现 | 治理环 |
| 6 | pin 机器离线 = 步无限等待 | `claimCandidates` 只过滤归属，无 liveness 条件；pending 步无超时/无 sweeper（并发门已摘除，`machines.ts:802-803`，#503）——与 Multica 的 reconnect-grace / queued-expiry 体系对照是空缺（§5） | 治理环 |
| 7 | 多机轮换丢会话 | conv 会话文件存执行机本地（pi sessionDir；continue 判定读 server 侧 prior sessionId，`machines.ts:835-855`）；换机器认领同 build 下一步 = SessionNotResumable 降级 new session。worktree 经 git 无碍，**丢的是对话上下文**——机器亲和是正确性项不是优化项 | 执行环约束 |
| 8 | local 形态项目锁机器 | `projectRepoRef` local = server 侧绝对路径（`git.ts:125-127`）——只有路径可达的机器能执行；远程机器 prepare 失败即 failStep | 执行环约束 |
| 9 | claude-code 运行时凭据不跨机 | runtime 步零凭据注入（`runner.ts:258-277`）；远程机器需各自登录 claude / 配 `ANTHROPIC_API_KEY`，且无预检暴露这个缺口 | 凭据环 |
| 10 | 并发/负载面 | 机器领活无上限（#503 摘除，`machines.ts:802-803`）；无能力匹配（除 MCP 版本门与 shell 双闸） | 派发环（多机后才显形） |

## 5. 三方对照：crabbox / Multica / pacman

### crabbox（github.com/openclaw/crabbox，Go，MIT）

模型 =「warm a box, sync the diff, run the suite」，纯远程命令执行器：

- 一条命令的完整生命周期（README + docs/how-it-works.md）：`crabbox run --provider docker -- <cmd>` = 租一个 box（lease，`cbx_` + 12hex，一次性 per-lease SSH key）→ **rsync 同步脏工作树**（git seed + 指纹跳过无变化；不要求先 commit）→ SSH 执行命令流式回传 → 拿退出码 → 释放。
- **机器选择 = 调用时 flag**：`--provider <docker|ssh|aws|hetzner|...>`，复用 warm box 用 `--id <box>` / `--slug`。16+ provider 矩阵。没有队列、没有认领循环、没有任务概念——每次调用无状态（warm lease 除外）。
- 四种执行模式（docs/architecture.md、`internal/cli/provider_backend.go:1959` `loadBackend`）：brokered（coordinator 管租约）/ direct SSH / registered direct / delegated（沙箱服务自管执行）。
- **coordinator（可选）只管控制面**：持有 provider 凭证、租约状态、用量、花费上限；**数据面 = CLI ↔ runner 直连 SSH+rsync，文件与命令输出不经 coordinator**（how-it-works.md 原文 "your files, commands, and output never traverse it"）。无 coordinator 也能全功能用本机容器/自有主机。
- 无 agent/编排概念：谁来选机器、跑什么命令，完全是调用方（人或 agent skill）的事。

### Multica（github.com/multica-ai/multica，Go；机制细节转引 r10 / r13，2026-10-02 在 HEAD 抽查对拍仍成立：`server/internal/daemon/wsrpc.go:346-349` tasks.claim RPC 与 `daemon.go` runtimeIndex 均在位）

模型 = agent 绑 runtime 的排队执行：

- **runtime = 一台电脑 + 一个 AI 工具**（r10 引 concepts.txt:33 "The agent is the identity; the runtime is the computer that executes it"）。机器上的 daemon 主动出网（WS `GET /api/daemon/ws`）注册：`agent_runtime` 表 upsert，唯一键 `(workspace_id, daemon_id, provider)`，`ON CONFLICT DO UPDATE` 幂等重注册（r10 引 runtime.sql:63-116）。daemon 用 `exec.LookPath` 探针自动发现本机 26 个 CLI（r10，agents_probe.go）。
- **机器选择发生在 agent 创建/绑定时刻**：agent 表带 `runtime_id` 外键（r10 引 agents-create.txt:7）。任务触发产生 run，run 进队，**由 agent 绑定的 runtime 认领**；复制 agent 可 `--runtime-id` 迁机。
- 派发（r13 逐跳实证）：`pollLoop` → 批量 `tasks.claim` WS-RPC `{daemon_id, runtime_ids, max_tasks}` → `handleTask` 查 `runtimeIndex[task.RuntimeID]` → `agent.ResolveBackend` 起进程 → 事件流回传。会话连续性是显式设计：conversation "routes subsequent runs to a runtime that can access that session"（r10 引 chat.txt:41-43）。
- 配套机器治理（r10 §5 全数字实证）：心跳 15s → Redis TTL 键 + 60s 落库，150s 陈旧 + 30s 扫掠 ≈ 3 分钟判离线；重连宽限 3h；`dispatched` 5 分钟超时；并发 = daemon 20 ∩ agent 6；离线 7 天 + 无未归档 agent + 无非终态 task 才 GC。
- 凭据：daemon token `mdt_`；**任务级 token `mat_`**（认领时铸造，绑 (task, agent, workspace, owner)，24h，注进 agent 进程代替 PAT——r10 §6）。代码面：per-conversation worktree + `tds/conv-*` 分支 + 每步收尾 push（r3 §1.4 实测；pacman 的 worktree 契约即由此复刻）。

### 对照结论

- **pacman ≈ Multica 的派发骨架**（daemon 出网 + claim 长轮询 + per-conv worktree + 步级凭证），但把「agent↔runtime 绑定」解耦成「assignment 选 agent、机器另行钉选」——machine record 注释明言「一个机器可承载多个 Agent 的步，不是 Agent 的属性」（`packages/shared/src/records/machine.ts:5`）。钉选面只做了数据层（build 列），没做入口层（§4-1~4）。
- **治理厚度差一档**：Multica 有完整的活性/宽限/超时/回收体系（上节数字），pacman 的 pending 步无超时无 sweeper（§4-6）——单机无感，多机后是第一风险。
- **crabbox 的启示是另一个方向**：机器选择可以就是调用时的一个显式参数，不必有绑定关系——这正是「新建任务里直接选机器」的形态，也是 #682 采用的粒度（任务级 pin，不做 agent 绑定）。
- **同构哲学**：crabbox「coordinator 只管控制面，数据面 CLI↔runner 直连，files/commands/output never traverse it」与 pacman「控制面 HTTP/SSE、数据面 git」是同一个设计判断——中央服务只管账本与凭证，字节流走点对点通道。

## 6. 工程含义（已收进 #682）

t-0047 对「新建任务里直接选机器」的可行性判定：**高**——钉选的执行语义已全在库里（列 + claim 过滤 + 服务参数 + restart 已按「不继承 pin」处理，`builds.ts:437`）；web 侧机器数据在新建任务面已加载（mention picker 用，`use-new-task-surface.ts:90`）；UI 有现成先例（项目 chip 弹层、`branch-dialog.tsx:200-206` 机器下拉）。方案要点（正本在 #682 票面）：`todo.machineId` 单源 → startBuilds 缺省继承 → chief 线程加机器亲和 → `enabledRuntimes` 变真闸 → pin 离线 = 标注等待、**不做自动 fallback**（pin 的语义就是确定性）。

被否掉的替代方案（记录判断，防重议）：

- **Multica 式 agent 绑机器**：与 pacman 的正交设计相悖（`records/machine.ts:5` 注释），且与 assignment 双槽叠加后组合爆炸。
- **纯 chief prompt 遵嘱（不改数据面）**：脆弱——LLM 可能不执行注入指令，无回读校验面；钉选必须落库走 claim 过滤才算数。
- **claim 时全自动调度（标签/负载匹配）**：用户要的是确定性选择不是调度器；自动匹配留给 `enabledRuntimes` 闸与后续。

## 附录 · 取证方法与野外经验

取证方式（可复用于同类机制调研）：

- 仓内侧：逐链路读源，file:line 均为基线工作区现行代码；进程/端口在本机与 mea 实测。
- 对照侧：crabbox / Multica 经 `gh` CLI 当日直接拉 README、架构文档与源码抽查，并与仓内 r3 / r10 / r13 一手研究交叉对拍，不转抄二手文档。Multica 证据地基优先读 r10 / r13（fresh-clone 源码逐行）与 r3（worktree 契约实测），不必重新爬源码。

mea（WSL2）侧侦察的三条野外经验：

- **WSL2 探 Windows 宿主侧要用全路径**：从 WSL2 内调 Windows 二进制（如 `powershell.exe`）探宿主环境时按全路径（`/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`）调用——非交互 ssh 会话里 WSL interop 的 PATH 追加不一定在位，裸命令名会找不到。
- **scp 多源会吞文件**：一条 scp 命令带多个远端源路径时会静默丢文件；关键证据分条传，传完在接收端点数核对。
- **shim 类服务的流量正本在 `/tmp` 而非 journal**：转发 shim（如 pi-relay-shim）常覆写日志钩子，journal 里只剩一行启动记录；真实流量账在它自己写的 `/tmp/*.log`（逐请求一行）。侦察这类服务先找它的文件日志，别拿 journal 判「无流量」。
