# R11 · pacman ↔ Multica runtime 模型能力差距盘点

> 目的：票 #518——拿 runtime 研究票（#517 / `docs/research/r10-multica-runtime.md`）的结论，逐项对照 pacman 的现状，
> 出能力差距清单：缺什么、多什么、哪里形状不同。
> 对照基准：`docs/research/r10-multica-runtime.md`（467 行，源码级实测，含 14 条文档/源码不一致；Multica 克隆 HEAD
> `43b0571f992567a919c7f1f699ff160922594b94`，2026-09-29 23:27:27 -0700）。
> pacman 侧证据：`origin/main` = `c95ee5f`（本票独立 worktree，未动主检出）。
> 地图：#515。上位研究：#517（已关闭）。盘点时间：2026-09-30（本地 Asia/Shanghai）。

## 0. 阅读约定

- 出处两类，逐条标注：
  - **P**（pacman）= 本票在 `c95ee5f` 工作树上逐行读到的 `路径:行号`；
  - **M**（Multica）= 转引 r10 的 `路径:行号`。**本票未重新克隆 Multica 源码复核**，M 侧的精确性以 r10 为准
    （r10 §0 已声明其出处纪律：文档侧记 D、源码侧记 C，无出处不写）。
- 四栏格式（票面指定）：**现状（文件:行号）· Multica 的做法 · 差距性质 · 是否属本图要修的范围**。
- 「差距性质」三值：`缺` / `形状不同` / `pacman 有意不同`。
- 「属本图要修的范围」按地图 #515 已裁的边界判定，取值：
  - `属·阻塞#519`——#519（控制面搬上常开主机 + 跑通闭环）会直接撞上的；
  - `属·本图要定`——#515 `Not yet specified` 里明说等本图研究回收后再判的；
  - `不属·有意不同`——02 册 / 01 册已锁的 divergence，本图不重开；
  - `不属·本图 Out of scope`——#515 已明列排除的。
- 全篇无 emoji；命令、常量、数值原样照抄。
- 一处命名陷阱先钉死（r10 §0 同款）：Multica 的「permission」有三层，本票只谈**第三层**
  `agent_runtime.visibility`（谁能在谁的机器上起 agent）。pacman 侧没有对应层（§G20）。

---

## 1. 结论先行

1. **pacman 没有 runtime 这个对象。** server 侧只有 `machine` 一行 = 一台注册主机，
   runtime（一台电脑 × 一个 CLI 工具）在 pacman 里不存在行、不存在 id、不存在列表
   （`apps/server/src/db/schema.ts:398`）。**这不是遗漏，是形态差异**：pacman 的 daemon 自己就是 pi 运行时的宿主，
   「工具」不是被侦测出来的外部 CLI，而是 daemon 进程内嵌的引擎（`apps/daemon/src/machine-loop.ts:84`、
   `apps/daemon/src/backend/pi.ts:507`）。Multica 的 daemon 是「CLI 的调度器」，pacman 的 daemon 是「pi 的宿主」。
2. **第一条要改的不是能力，是「机器的能力」不被上报。** `presence` 只带 `cliVersion`
   （`packages/shared/src/protocol/machine-wire.ts:81`），而 claim 侧**完全不看机器能跑什么**
   （`apps/server/src/services/machines.ts:581`：只筛 `status='pending'` + team + pinnedMachine），
   于是任何机器都会领到任何步。多机一旦超过一台，这是第一个断点。
3. **在线判定比 Multica 脆一个量级。** pacman 的 `online` 只在机器 wake SSE 流 abort 时翻 false
   （`apps/server/src/routes-machine.ts:240`），**没有陈旧阈值、没有扫掠、没有心跳落库**
   （全仓穷举：`markOffline` 仅一处调用点；`step.lastHeartbeatAt` 写而不读）。于是活性完全等价于
   「这条 TCP 连接还在」：**没有 FIN 的断开**（网络分区、主机断电、拔网线）永久显示在线；
   而**有 FIN 的断开**（进程被 kill、daemon 自身重连）会立刻翻离线，且重连后要等下一拍 presence
   （最长 30s）才翻回来——同一个字段承载了两种语义，两头都不准。
4. **步与机器是硬绑定，且没有任何兜底。** claim 把 `step.status` 置 `claimed` + `machineId`
   （`apps/server/src/services/machines.ts:767`），此后只有该 machineId 能通过 `recover` 面看到它
   （`apps/server/src/services/machines.ts:553`），别的机器 claim 不到（`status='pending'` 已不成立），
   而 server 侧**没有任何超时把它放回去**。机器一去不回 = 这一步永久挂着。
   Multica 在这一点上有三层（150s 陈旧 + 3h 重连宽限 + 7 天回收，r10 §5.2–§5.4）。
5. **任务级凭据 pacman 有半边，缺的是「agent 拿什么回服务端说话」那一半。**
   `token/{stepId}` 发的是 provider 配置 + 团队密钥 env + git 凭证（`packages/shared/src/protocol/machine-wire.ts:339`），
   daemon 内存持有、步收尾清空（`apps/daemon/src/credentials.ts:22`）——形状与 Multica 的 per-run 下发同向。
   但 Multica 的 `mat_` 是**身份**（agent 用它调 Multica API，actor 记为 agent），pacman 没有对应物：
   agent 侧的工具全部经 `tool/{stepId}` relay 由 daemon 用机器 token 代发
   （`packages/shared/src/protocol/machine-wire.ts:314-334`）。
6. **下发的 `env` 槽在 daemon 侧无人消费。** `pushCredential` 收下 `provider/env/git` 三件
   （`apps/daemon/src/credentials.ts:22`），但全 daemon 只有 `creds.provider`（`apps/daemon/src/runner.ts:251`）与
   `creds.git`（`apps/daemon/src/runner.ts:286`、`:642`）有消费点，`creds.env` 仅被 `clearCredentials` 置空
   （`apps/daemon/src/credentials.ts:29`）。已有票 #508 在办，本票只登记它属 runtime 模型的哪一格。
7. **并发不是「比 Multica 低」，而是根本没有并发。** daemon 的 claim 循环 `await runStep(...)` 串行
   （`apps/daemon/src/machine-loop.ts:361`），server 侧 #503 已把上限概念整体摘除
   （`apps/server/src/services/machines.ts:744`）。Multica 是 daemon 20 / agent 6 的双层闸（r10 §5.4）。
   On the pacman side 02/A3 **deliberately** removed the cap (`docs/spec/02-architecture-parity.md:15`), but between the status quo and "deliberate" there is a missing step:
   what was removed is the **cap**, while the actual effect is **serial execution**.
8. **模型来源的读取机器，与执行机器不是同一台。** claude-code 段的模型清单由 **server 进程** fs 直读
   `~/.claude/settings.json`（`apps/server/src/services/providers.ts:141`；同文件 `:132` 与 `:179` 两处
   `hostname()` 取的都是 server 所在机器）。#519 一旦把控制面搬上常开主机、执行面留在另一台，这一页显示的就是**控制面主机的 Claude Code 配置**。
   Multica 的模型清单来自**对应 runtime**（r10 §4.2）。
9. **pacman 多出来的东西集中在「执行面本身」，不在「runtime 管理面」。** 每步 worktree + commit/push/merge
   （`apps/daemon/src/workspace.ts:66`）、per-step git 凭证、plan.md/transcript 产物上传、steer/stop/sync 三条
   拉取-确认指令（`packages/shared/src/protocol/machine-wire.ts:264`）、review 只读检出（`apps/daemon/src/runner.ts:593`）、
   supervisor 崩溃保活（`apps/daemon/src/supervisor.ts:58`）——这些 Multica 的 runtime 模型里没有对应物，
   most of these were **deliberately** locked per todos semantics by volumes 02/08 (`docs/spec/02-architecture-parity.md:18`, `:21`).
10. **`enabledRuntimes` 是形状先到、执行面没到。** machines 页的 per-runtime 开关存得下、读得出
    （`apps/server/src/db/schema.ts:416`、`apps/server/src/services/machines.ts:368`），但 claim 与执行两侧都不读它
    （穷举 grep：仓内消费点只有 schema 投影与测试）。Multica 对应的是 `agent_runtime.visibility`，
    它**是**绑定闸（`canUseRuntimeForAgent`，r10 §8.2）。

---

## 2. A 面 · runtime 身份与注册（G1–G4）

| # | 现状（文件:行号） | Multica 的做法 | 差距性质 | 是否属本图要修的范围 |
|---|---|---|---|---|
| **G1** | machine 表只有 `id/teamId/name/online/tokenHash/apiKeyId/latestCliVersion/kind/enabledRuntimes` 八列，无 provider / profile / owner / lastSeen 列（`apps/server/src/db/schema.ts:398-417`）；`kind` 只分 `local`/`remote`（`packages/shared/src/records/machine.ts:31`） | runtime 是 `agent_runtime` 表的一行 = (workspace, daemon, provider, profile)（r10 §2.2，`server/pkg/db/queries/runtime.sql:63`、`:95`） | 缺 | 属·本图要定（#515 `Not yet specified`「多 backend 先接哪个 CLI：等 runtime 研究拿到协议族与能力差异矩阵」） |
| **G2** | 无 profile 维：全仓无 `runtimeProfile` / `runtime_profile` / `customProfile` 任何标识（穷举 grep 零命中） | 两条部分唯一索引把 profile 抬成第四维，内置与自定义实例并存（r10 §2.2、D13，迁移 120/121） | 缺 | 不属·本图 Out of scope（自用单机场景无自定义 wrapper 诉求；未被 #515 任何一节要求） |
| **G3** | 注册幂等 = 应用层查 `(apiKeyId, teamId)` 命中即更新，否则 insert 新行（`apps/server/src/services/machines.ts:437-442`、`:461-474`） | DB 层 `ON CONFLICT ... DO UPDATE`，冲突键即两条唯一索引；重启幂等（r10 §2.2/D13） | 形状不同 | 属·本图要定（副作用具体：「换一把 apiKey 重注册同一台机器」在 pacman 会**多一行机器**，Multica 不会；#519 要用 api-key 路径注册另一台机，容易踩） |
| **G4** | daemon 只在 `machine.json` 缺席时才 enroll（`apps/daemon/src/machine-loop.ts:114-135`）；重启不重注册、不刷新 `latestCliVersion`（只有 presence 会刷，`:139`、`:310`） | 重启即重新注册并 reclaim 上次未干净结束的 run（r10 §5.1 一致项） | 形状不同 | 不属（比 Multica 更幂等，且 `presence` 已承担版本刷新；无缺口） |

---

## 3. B 面 · 侦测、协议族与多 backend（G5–G7）

| # | 现状（文件:行号） | Multica 的做法 | 差距性质 | 是否属本图要修的范围 |
|---|---|---|---|---|
| **G5** | 无任何 CLI 侦测：daemon 启动即 `Loading pi runtime…`，backend 恒为 `createPiBackend`（`apps/daemon/src/machine-loop.ts:84-101`）；全仓无 `lookPath` / `which` / PATH 扫描（穷举 grep 零命中）。机器对上只报 `cliVersion`（`packages/shared/src/protocol/machine-wire.ts:81-83`） | daemon 启动扫 PATH 侦测 26 个命令名，带登录-shell 兜底与 30 分钟缓存（r10 §3.2） | 缺 | 属·本图要定（这正是 wiki [[pacman 的编排器坐标与借鉴清单]] B1「machine 能力广告」；#519 单机形态不阻塞，但多机路由的前置） |
| **G6** | 单引擎内嵌：pi 是本仓依赖，`AgentBackend` 缝已存在但只有 pi 一个实现（`packages/shared/src/agent-backend.ts:190`、`apps/daemon/src/backend/pi.ts:507`、`docs/spec/01-stack-v2.md:126`） | 25 个协议族白名单 + 每族一个后端（r10 §4.2，`server/pkg/agent/agent.go:364-390`） | 缺 | 属·本图要定（#515 明列「多 backend 先接哪个 CLI」等本图） |
| **G7** | `enabledRuntimes` 存得下读得出但无执行面：写入 `apps/server/src/routes.ts:1203`（PATCH），schema 投影 `apps/server/src/services/machines.ts:368`；claim（`apps/server/src/services/machines.ts:581-597`）与 daemon 执行（`apps/daemon/src/machine-loop.ts:361`）两侧都不读 | `agent_runtime.visibility` 是绑定闸（`canUseRuntimeForAgent`，r10 §8.2） | 形状不同 | 属·本图要定（开关已在 UI 上承诺了「本机跑 pi 还是 Claude Code」，但两个位置都不生效） |

---

## 4. C 面 · 在线判定与心跳（G8–G10）

| # | 现状（文件:行号） | Multica 的做法 | 差距性质 | 是否属本图要修的范围 |
|---|---|---|---|---|
| **G8** | `online` 只在机器 wake SSE 流 abort 时翻 false（`apps/server/src/routes-machine.ts:240-246` → `markOffline`，`apps/server/src/services/machines.ts:543`，全仓唯一调用点）；`markPresence` 无条件置 true（`apps/server/src/services/machines.ts:521-541`）。**无陈旧阈值、无扫掠、无 `last_seen_at`**。两个可复现后果：①没有 FIN 的断开（网络分区 / 断电 / 拔网线）→ 永久在线；②daemon 自身重连（`apps/daemon/src/machine-loop.ts:278-306` 断线重连循环**不补发 presence**）→ 旧流 abort 先置离线，最长 30s 后靠下一拍 presence 翻回 | 150s 陈旧阈值 + 30s 扫掠 ≈ 180s 判离线；Redis TTL 热路径 + 最多 60s 落一次 `last_seen_at`（r10 §5.2/D11） | 缺 | **属·阻塞#519**（#519 要求的正是「笔记本可关机、控制面不掉链子」，而这两个后果一个把活机器判成死的、一个把死机器判成活的） |
| **G9** | `step.lastHeartbeatAt` 由 `heartbeat/{stepId}` 写（`apps/server/src/services/machines.ts:897-900`，daemon 每 30s 打一拍 `apps/daemon/src/runner.ts:416-419`），但**全仓无任何读点**（穷举 grep：只有写入与 schema 定义） | 心跳年龄是排队释放与失败回收的判据（r10 §5.3：`ExpireStaleQueuedTasks` 直接读心跳年龄） | 缺 | **属·阻塞#519**（步级活性数据已在线，缺的是判定与动作用它） |
| **G10** | presence 节奏 30s（`apps/daemon/src/machine-loop.ts:313`），server 侧无状态机、无落库节奏 | 心跳 15s（r10 §5.2） | 形状不同 | 不属（纯数值差异；真正的缺口是 G8） |

---

## 5. D 面 · claim、并发与派发（G11–G13）

| # | 现状（文件:行号） | Multica 的做法 | 差距性质 | 是否属本图要修的范围 |
|---|---|---|---|---|
| **G11** | Serial: the claim loop `await client.claim(...)` → `await runStep(...)` executes in order, one step per round (`apps/daemon/src/machine-loop.ts:342-362`, `running` always passed as 1, `:361`); no concurrency gate server-side (`apps/server/src/services/machines.ts:744-745`, #503 comment verbatim "machine claiming is not bound by the cap") | daemon 20 / agent 6 double gate; claims rejected when `running >= agent.MaxConcurrentTasks` (r10 §5.4) | pacman deliberately different | Not in scope · deliberate (`docs/spec/02-architecture-parity.md:15` A3 already ruled "the concurrency-cap concept is removed wholesale with #503"); but the status quo is **serial**, not "uncapped" — this layer of difference deserves its own row on the map, see §9 |
| **G12** | claim 候选只筛 `status='pending'` + team + `pinnedMachineId`（`apps/server/src/services/machines.ts:581-597`），**不看机器能不能跑这一步的模型** | runtime 与 agent 绑定，任务路由到匹配的 runtime（r10 §2.1/§8） | 缺 | 属·本图要定（= G5 的另一面；单机不阻塞，第二台机器一上就出问题） |
| **G13** | 步与机器硬绑定：claim 时写 `machineId`（`apps/server/src/services/machines.ts:767-772`），此后仅该机器经 `recover` 可见（`apps/server/src/services/machines.ts:553-561`），他机 claim 不到，**无重派、无超时释放**。失败后的唯一出路是人工重跑 = 新 build 新会话（`apps/server/src/services/builds.ts:7`） | `RecoverOrphanedTasksForRuntime` 绕开宽限 reclaim；`FailTasksForOfflineRuntimes` 按宽限判失败（r10 §5.3） | 缺 | **属·阻塞#519**（#519 要的是「真闭环」，机器半路掉线会把闭环永久卡死在这一步） |

---

## 6. E 面 · 宽限、回收与孤儿（G14–G16）

| # | 现状（文件:行号） | Multica 的做法 | 差距性质 | 是否属本图要修的范围 |
|---|---|---|---|---|
| **G14** | 无重连宽限、无排队过期：无对应常量、无对应 sweep（穷举 grep：`grace` / `stale` / `expire` 在 `apps/server/src` 无机器面命中） | 默认 3h 宽限（下界 150s 夹紧）；排队 run 需同时满足「runtime 证明不了自己活着」+「自己排满一个宽限」（r10 §5.3/D3） | 缺 | **属·阻塞#519**（G8+G13 的动作面） |
| **G15** | 无 offline runtime 的进行中任务失败与自动重试 | `FailTasksForOfflineRuntimes` 批量 500；重试宽限终局路径（r10 §5.3） | 缺 | 属·阻塞#519（同 G13；pacman 的答复是「人工重跑」，但机器掉线场景下人是看不到的——步永远停在 claimed） |
| **G16** | machine 行无回收；唯一的时间回收是**worktree** 孤儿 TTL 7×24h（`packages/shared/src/protocol/executor.ts:126`、`apps/daemon/src/workspace.ts:159-185`，上线一次 + 每 24h 一轮 `apps/daemon/src/machine-loop.ts:191-193`） | runtime 行 7 天 GC，判据三条（offline + 7 天 + 无未归档 user agent + 无非终态 task），每小时一轮（r10 §5.4/D4） | 缺 | 不属·本图 Out of scope（自用单团队，机器行不会堆积；worktree TTL 已覆盖真正会涨的那个面） |

---

## 7. F 面 · 任务级凭据与环境（G17–G19）

| # | 现状（文件:行号） | Multica 的做法 | 差距性质 | 是否属本图要修的范围 |
|---|---|---|---|---|
| **G17** | `token/{stepId}` 下发 `{provider, env, git}`（`packages/shared/src/protocol/machine-wire.ts:339-354`，服务端组装 `apps/server/src/services/machines.ts:1183-1215`）；daemon 内存持有、步收尾 `clearCredentials`（`apps/daemon/src/credentials.ts:22-31`）。**没有任务级 API 身份**：agent 侧工具全经 `tool/{stepId}` relay 由 daemon 持机器 token 代发（`packages/shared/src/protocol/machine-wire.ts:314-334`、`apps/daemon/src/machine-client.ts:254-300`、`apps/daemon/src/backend/pi.ts:566-594`） | `mat_` token 绑 `(task, agent, workspace, runtime owner)`，硬编 24h，注入 agent 进程；伪造 `X-Agent-ID` 改不了 actor（r10 §6.2/D12） | 缺 | 不属·本图 Out of scope（pacman 的 agent 不直接调自己的 API，没有可伪造的 actor 面；#515 未要求） |
| **G18** | `creds.env` 下发即丢弃：消费点只有 `creds.provider`（`apps/daemon/src/runner.ts:251`）与 `creds.git`（`apps/daemon/src/runner.ts:286`、`:642`），`creds.env` 仅被置空（`apps/daemon/src/credentials.ts:29`）。`SessionOpts` 亦无 env 字段（`packages/shared/src/agent-backend.ts:141-176`） | 13 个 `MULTICA_*` 变量注入 agent 进程，另有 `isBlockedEnvKey` 前缀封禁 + 精确名单（r10 §6.3） | 缺 | 属·本图要定（已有票 **#508** 在办，本票不重开；但 #519 若撞上「密钥没送到」的 UI 文案，处置已在 #508 定死为「对齐 git 的 per-step 纪律」，不得直接接 env 明文注入） |
| **G19** | 无环境变量命名空间与黑名单纪律（穷举 grep：无 `isBlockedEnvKey` 等价物、无 `MULTICA_` 式前缀封禁；daemon 侧只有 `PI_OFFLINE`/`PI_CODING_AGENT_DIR` 两处自设，`apps/daemon/src/backend/pi.ts:514-515`） | `MULTICA_` 整段封禁 + `HOME/PATH/CODEX_HOME/...` 精确名单，唯一例外 `HERMES_HOME`（r10 §6.3） | 缺 | 属·本图要定（G18 的同一条，落点在 #508） |

---

## 8. G 面 · 权限、profile、模型源、传输与发行（G20–G25）

| # | 现状（文件:行号） | Multica 的做法 | 差距性质 | 是否属本图要修的范围 |
|---|---|---|---|---|
| **G20** | Machines have no owner, no visibility: the schema's eight columns have no `ownerId`/`visibility`; single-user seed + auto login (`docs/spec/02-architecture-parity.md:14` A2) | `agent_runtime.owner_id` + `visibility`; owner-exclusive sharing, no admin bypass; ownerless runtimes can never be bound (r10 §8.2) | pacman deliberately different | Not in scope · deliberate (local-first single user, locked in 02/A2) |
| **G21** | 无自定义 runtime profile：无命令字段、无 `fixed_args`、无参数排序问题（全仓零命中） | `runtime_profile` + `fixed_args` 排在 Multica 参数**之前**，位置不可回退（r10 §7.3） | 缺 | 不属·本图 Out of scope（自用场景不接 wrapper CLI；若 G6 落地多 backend，此条须重判） |
| **G22** | 模型源读的是 **server 进程所在机器**：claude-code 段 fs 直读 `~/.claude/settings.json`（`apps/server/src/services/providers.ts:131-161`，`:132` 的 `hostname()` 取 server 主机名，`:141` 读文件）；pi 段 = 团队 custom provider 的 `models[]`（`:167-183`，`:179` 再用一次 `hostname()`） | 模型清单来自**对应 runtime**（部分工具暴露固定集，部分按本机配置/登录态算；r10 §4.2） | 形状不同 | **属·阻塞#519**（控制面与执行面分机后，这一页显示的是常开主机的 Claude Code 配置，不是执行机的） |
| **G23** | 版本门只有一个，且比的是 **daemon 自己的版本**：`meetsMcpVersionGate(latestCliVersion)` vs `MCP_MIN_CLI_VERSION`，未达则 claim 不携带 `mcpServers`（`apps/server/src/services/machines.ts:643-666`、`packages/shared/src/protocol/mcp.ts:164`） | 每族最低版本表 10 条（r10 §3.2/D7），低于则**不注册**该 runtime；另有 `capabilities`/`launched_by` 注册元数据（r10 §2.2） | 形状不同 | 属·本图要定（G6 的配套；单 backend 形态下现门够用） |
| **G24** | Transport = HTTP long-poll claim (server holds 75s, `packages/shared/src/protocol/machine-api.ts:30`, `apps/server/src/services/machines.ts:882-893`) + SSE wake (`apps/server/src/routes-machine.ts:227`). **The daemon side does not consume wake events** (`apps/daemon/src/machine-loop.ts:286-290` only dispatches shutdown/steer/stop/sync; `:227-234` comment records the #482 ruling: hold-expiry resend is the residual upper-bound backstop) | WebSocket `GET /api/daemon/ws` + 3-minute claim-poll backstop (r10 §5.2) | pacman deliberately different (implementation layer) | Not in scope · deliberate (`docs/spec/02-architecture-parity.md:13` A1 "real-time surface all SSE, no WS" is locked; the collaboration semantics (long poll + backstop) are identical on both sides) |
| **G25** | 发行 = 纯 JS npm 包（`docs/spec/01-stack-v2.md:123`）；supervisor 自建崩溃保活（`apps/daemon/src/supervisor.ts:28-92`，指数退避封顶 30s）；引擎 pin pi 0.86.0（`docs/spec/01-stack-v2.md:126`） | 6 平台二进制（275MB）；引擎 pi 0.84.3 构建（r10 §0 / `docs/spec/01-stack-v2.md:231-232`） | pacman 有意不同 | 不属·有意不同（`docs/spec/01-stack-v2.md:231-232` 差异表已登记；supervisor 是 pacman 独有增量，见 §9） |

---

## 9. pacman 多出来的（反向清单）

以下各项 Multica 的 runtime 模型里**没有对应物**（r10 全文未出现），是 pacman 侧的执行面增量。
多数是 02/08 册按 todos 语义有意锁定的，仅列事实与性质，不重复四栏。

| 项 | pacman 出处 | 性质 |
|---|---|---|
| Per-step worktree contract: base clone + `worktree add -b` + reuse/recover/stale three steps + `projectLock` serialization + anti-fork guardrails | `apps/daemon/src/workspace.ts:66-114`, `docs/spec/02-architecture-parity.md:183-195` | Deliberate (todos semantics); Multica's daemon hands no git credentials down and does no worktree |
| 每步 commit + push + merge 落地（hosted / github / local 三形态） | `apps/daemon/src/runner.ts:606-660`、`apps/daemon/src/workspace.ts:137-140` | 有意；见上 |
| per-step git 凭证（hosted 一次性 key 现签现 revoke / github connection token），不进 argv、不落盘 | `apps/server/src/services/machines.ts:1208-1213`、`apps/daemon/src/credentials.ts:16-18` | 有意；wiki A3 已判定 secrets 面应对齐这条纪律 |
| 产物上传：`upload-urls/{stepId}` 预签名 + `PUT /api/machine/upload/{uploadId}` 自出（self-host 无对象存储）；plan.md 即文件版本 | `packages/shared/src/protocol/machine-wire.ts:356-391`、`apps/daemon/src/runner.ts:666-696` | 有意 |
| steer / stop（含 discard rewind）/ sync 三条 server→daemon 拉取-确认指令 | `packages/shared/src/protocol/machine-wire.ts:264-297`、`apps/daemon/src/machine-loop.ts:236-271` | 有意 |
| review 步只读检出：工具面不下发 edit/write + 收尾 rewind 回步起点两层 | `apps/daemon/src/backend/pi.ts:63-71`、`apps/daemon/src/runner.ts:593-604` | 有意（#511，本仓独有的硬闸语义） |
| chief 步：服务端 relay 工具 49 词表 + 绑定 Agent 的 pi 会话 | `packages/shared/src/protocol/machine-wire.ts:189-200`、`apps/server/src/services/machines.ts:668-730` | 有意（02/A7）；#515 明列「Chief 存废」为 Not yet specified |
| Hard-gate phase model (nine phases, two manual gates) | `packages/shared/src/phase.ts:5-15` (nine-value vocabulary), `apps/server/src/services/phase.ts:17` (migration edge set), `docs/spec/02-architecture-parity.md:17-18` | Deliberate; #515 names it pacman's sole differentiation |
| MCP slug 化：服务端只下发 slug 列表，端点由执行机读本机 `~/.claude.json` 解析，凭证从不跨 wire | `packages/shared/src/protocol/machine-wire.ts:207-213`、`apps/daemon/src/backend/mcp-config.ts:60` | 有意（spec 13 断约） |
| 机器 per-runtime 开关 `enabledRuntimes` | `apps/server/src/db/schema.ts:416` | **形状先到、执行面没到**（见 G7） |
| supervisor 崩溃保活（detach spawn + daemon.json + 指数退避重启） | `apps/daemon/src/supervisor.ts:28-92` | 有意（02/A1「detached + supervisor 跨崩溃保活」） |
| 代理探测（`EnvHttpProxyAgent` honor `HTTP_PROXY` 族，代理死持续重试不退出） | `apps/daemon/src/proxy.ts`、`docs/spec/01-stack-v2.md:129` | 有意 |

---

## 10. 属本图要修的范围：判定汇总

25 条差距按四项取值归拢（判据见 §0）；每条的完整四栏在 §2–§8。

**属·阻塞 #519（控制面搬上常开主机 + 跑通闭环会直接撞上）——六条**

- **G8 / G9 / G14 / G15**：机器与步的活性判定整条链缺失。「在线」靠 SSE 连接状态定义，
  「步卡住」没有任何判据（`lastHeartbeatAt` 写而不读），也没有宽限与回收。
  #519 的场景正是「笔记本中途关机、控制面在常开主机上」，这条链是它的第一根承重墙。
- **G13**：步与机器硬绑定且无重派。机器掉线 = 该步永久 `claimed`，闭环卡死。
- **G22**：模型源读 server 主机而非执行主机。分机之后 providers 页直接指错机器。

**属·本图要定（#515 `Not yet specified` 明说等本图研究回收后再判）——九条**

- **G1**：runtime 不是对象，只有 machine 行。
- **G3**：注册幂等键在应用层，换 key 重注册会多一行机器。
- **G5 / G12**：机器能力不上报 + claim 不看能力。这是 wiki B1「machine 能力广告」的完整形态，
  也是 #515「多 backend 先接哪个 CLI」的前置。
- **G6**：单引擎内嵌、只有 `AgentBackend` 缝。
- **G7**：`enabledRuntimes` 开关无执行面。
- **G18 / G19**：env 注入与命名空间纪律——**已有票 #508**，本图不重开，只登记落点。
- **G23**：版本门只有一条且比的是 daemon 版本。

**不属·有意不同（02/01 册已锁）——五条**

- G11 (concurrency cap removal, `docs/spec/02-architecture-parity.md:15` A3), G20 (single user, no owner/visibility, A2),
  G24 (all SSE, no WS, A1), G25 (pure-JS npm distribution + pi 0.86.0, volume 01 §8), G4 (no re-registration on restart, better than Multica).

**不属·本图 Out of scope——四条**

- G2（自定义 profile）、G16（runtime 7 天 GC）、G17（任务级 `mat_` 身份）、G21（自定义 runtime profile）。

**单列：一条数值差异、两条「性质判定本身要地图拍板」**

- **G10**（presence 30s vs 15s）：纯数值差异，且 pacman 侧的 30s 是复刻期自设值而非上游观测值
  （`apps/daemon/src/machine-loop.ts:46-47` 注释自认「r3 未采具体值 [设计]」）——不算差异，无动作。
- **G11 的补充**：02/A3 摘除的是「并发**上限**」，现状是执行侧**串行**
  （`apps/daemon/src/machine-loop.ts:361` 一轮一步）。摘除上限的理由是「自用不需要限流」，
  但串行意味着**多台机器不并行、单台机器一次只能跑一步**。自用场景下这可能是可接受取舍，
  也可能正是 #519 会撞上的「闭环慢」——本票不下判，交地图。
- **G5 与 G7 是一件事的两面**：机器不上报能力（G5）与开关不生效（G7）合起来，
  使「本机跑 pi 还是 Claude Code」这个已在 UI 上承诺的设置**没有任何执行面**。

---

## 11. 未查到 / 未深挖

按票面纪律，这一节只写**没查实**的东西，不用想象补全：

1. **Multica 侧的行号未在本票复核**——全部转引 r10。r10 自身的出处纪律（§0）是「无出处不写」，
   但它是上一票的产物；本票未重新克隆比对。[转引]
2. **Multica 的 daemon 是否有 worktree/git 契约**——r10 只提到 `MULTICA_TASK_WORKSPACES_ROOT` 变量存在
   （§6.3），未展开 daemon 侧的工作区实现。§9「每步 worktree 是 pacman 独有」这一判断建立在
   **r10 未出现**之上，不是「已确认 Multica 没有」。[未查到]
3. **Multica 是否有 steer/stop/sync 的对应能力**——r10 七面无此主题，未查到。
   §9 把它记为 pacman 增量同样是「r10 未出现」口径。[未查到]
4. **pacman 侧 `creds.env` 的最终形态**——#508 已开票但未落地；本票只登记现状（下发即丢弃），
   不预判 #508 的裁决细节。[事实陈述]
5. **`machine.enabledRuntimes` 是否曾有执行面**——本票只读了 `c95ee5f` 的现状；
   git 历史未逐条回溯它是否曾参与 claim。[未深挖]
6. **presence 30s 的观测来源**——代码注释自称「r3 未采具体值 [设计]」（`apps/daemon/src/machine-loop.ts:46-47`），
   即它本身是复刻期自设值而非上游观测值。这与 Multica 的 15s 不构成「差异」，只构成两个自设值。
   [事实陈述]
7. **wiki 侧的口径冲突**：wiki 页 [[pacman 的编排器坐标与借鉴清单]] B1 段写
   「`presence` 已带 `maxConcurrent` + `cliVersion`」，但 #503 已把 `maxConcurrent` 连概念摘除
   （`apps/server/src/services/machines.ts:744-745`、`packages/shared/src/protocol/machine-wire.ts:96-98`
   「#503 起空体」）。**该 wiki 页此处已过时**：`presence` 现在只带 `cliVersion`
   （`packages/shared/src/protocol/machine-wire.ts:81-83`）。[已核实冲突]

---

## 附：一句话版（给地图用）

pacman 的 runtime 模型比 Multica 少一整层：**没有 runtime 对象**（只有 machine 行）、**没有机器能力广告**
（presence 只报 cliVersion，claim 不看能力）、**没有活性判定**（online 靠 SSE 连接状态，步的 `lastHeartbeatAt`
写而不读，无宽限、无回收）、**没有任务级身份**（`token/{stepId}` 只有 provider/env/git；agent 经 daemon relay 说话）；
多出来的是执行面本身（worktree 契约、per-step git 凭证、产物上传、steer/stop/sync、review 只读检出、chief、
supervisor 保活），其中多数是 02/08 册按 todos 语义有意锁的。分机（#519）会直接撞上的四条：
机器永久在线（G8/G9）、步永久挂着（G13）、无宽限与回收（G14/G15）、模型源读控制面主机而非执行主机（G22）。