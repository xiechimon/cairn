# 用 cairn 自己编排 cairn：可行性核查、试点与缺口收尾（活文档，2026-11-06 起）

> **现状（2026-11-07 09:05Z）**：第 3 次试点（#123，协调者已内置在服务里，路由按能力选）**通过**，见 §2d：聊天 → 协调者 → 按能力路由 → Codex 实现 → PR #3377 → Mergify 合并 → 线程 done，每一步在 Langfuse 里都有 span，并带 `cairn.route.*`。中途卡在 G13（已记录的路由钉在超额度的 Claude 上），修复 #3355 合并部署后，卡住的 step 自己改走 Codex。新缺口 G14：#3377 带着没处理的 Codex P2 被合并，补修任务 #124 → PR #3383 已合并，全程没有人插手。合并守卫 PR #3330 已合并（`749f36b74`），#3292 已合并。
>
> 更早（03:05Z）：ian 已换好 Claude 订阅 token。`session` 路由改回 claude-code 优先（Codex 回退），`review` 仍是 Codex gpt-6.1-sol。用一个真实的只读任务（#122，见 §2c）验证过：claude-code step 认证通过并交了报告。此前：第 2 次试点从聊天一路到合并、到线程收尾都由 cairn 自己完成（#121 → PR #3283，经 Mergify 合并），只请协调者重试过一次。缺口修复已合并 7 个 PR：#3260 #3261 #3262 #3270 #3276 #3283，加上 cairn 自己开的 #3263。（当时还开着的 #3292 和合并守卫分支，后来都已合并。）

标注：**实测** = 本次亲手跑出的输出或读到的原文；**推断** = 由实测推出、可复核；**猜测** = 其余。
所有调用都打 omarchy 上的线上服务 `http://127.0.0.1:8787`，部署目录是 `~/Code/AgentProjects/cairn-exec`。全程没有打印或解密任何密钥、token；调用脚本只在内存里把 token 放进请求头。

## 0. 怎么以 owner 身份调线上 API（实测）

- 鉴权在 `apps/server/src/lib/token-auth.ts:66-78`：只认 `Authorization: Bearer <token>`，比较的是 token 的 sha256。
- `~/.cairn/token` 的内容是一行 `CAIRN_TOKEN=<值>`（`apps/server/src/config.ts` 的 `parseAccessTokenFile` 解析）。之前「plain Bearer 返回 Unauthorized」，原因是把整行（含 `CAIRN_TOKEN=`）当成了 token（推断：整行 60 字符，去掉前缀后再请求，`/api/teams` 返回 200）。
- 正确做法：`T=$(sed -n 's/^CAIRN_TOKEN=//p' ~/.cairn/token)`，然后带 `-H "Authorization: Bearer $T"`。`/healthz` 不需要鉴权；`/api/health` 不存在，返回 401 是因为先过了鉴权中间件。

## 1. 能力 × 状态

| # | 能力 | 状态 | 证据 |
|---|---|---|---|
| 1.1 | 线上服务健康、部署版本 | 可用 | 实测：`cairn-server.service` active；21:53:10Z 自部署到 `02eeb8b79`（#3233），本次开始时是 `cea821020`（#3172），比 main 落后 2 个提交。#3189 与 #3236 都已在部署内（`git merge-base --is-ancestor`） |
| 1.2 | 团队 | 可用 | 实测：1 个团队 `Owner's team`（`lIH2x-…`），`claudeUsage=subscription-only`，`autonomyPaused=false`；项目 `cairn` = `_L-wtSVW5r2DDd_H2KLV8` → `xiechimon/cairn`，`mergePolicy=autonomous`，`shipRoute=merge-gate` |
| 1.3 | 机器在线 | 可用 | 实测：`omarchy` 在线，`enabledRuntimes=[pi, claude-code]`，`claudeLogin=ok`，`codexLogin=ok`，并发上限 16，运行中 0。`omarchy-enroll-probe` 离线（测试用，可删）。Mac 没有注册成机器 |
| 1.4 | Harness 登录 | 部分可用 | 实测：claude-code、pi 可用，Codex OAuth 已登录。没有单独的 `codex` runtime：`openai-codex` 这个 provider 跑在 `pi` 上（`dispatch-eligibility.ts:19-24`）；另有 ACP 适配器需守护进程配置 `CAIRN_ACP_AGENTS`，服务端的 runtime 闸门不认识它 |
| 1.5 | 协调者模型 | 部分可用 | 实测：协调者实际跑 `openai-codex / gpt-6-luna`，在 pi 上（Langfuse 里 `chat gpt-6-luna` 和协调者轮次时间一一对应）。设置页「模型路由」显示的 coordinator=claude-opus-5-5 只是展示，派发从不读它（`coordinator-route.ts:94-120`：没设 `CAIRN_COORDINATOR_*` 环境变量时直接用 chief agent 行） |
| 1.6 | 工作线程路由 | 可用 | 实测：routing rule `session` = claude-code / claude-sonnet-5-5 / thinking low，钉在 omarchy，额度或故障时回退到 openai-codex / gpt-6.1-sol（22:09Z 一度改成 Codex 优先，02:53Z 改回）。`review` = openai-codex / gpt-6.1-sol / high。线上还没有「按能力选 harness」：规则只有固定的主模型加回退列表，按任务类型和难度选 harness 要等 #3259 |
| 2.1 | 聊天 → 任务 → 线程 | 可用（#3260 已部署；第一次调用可能超时，见 G1b） | 实测：协调者有 `create_todo` 和 `open_thread{todoId}` 两个工具（`chief-tools.ts:352-366, 806-810`）。但它的提示词带 `GITHUB_OVERLAP_RULE`，要求跑 `scripts/github-overlap.mjs` 或做关键词搜索，查不全就停止创建；而协调者没有 shell，`issues`/`pull_requests` 工具只能按状态翻页、只返回标题。试点第 1 轮因此拒绝建卡（见 §2） |
| 2.2 | 按任务指定 harness 或机器 | 缺失 | 实测（代码）：`open_thread` 只收 `todoId`，`update_todo` 没有路由字段；只能靠团队路由规则，或者人工 `PATCH todo.routeOverride` |
| 2.3 | 线程自己开 PR | 可用（代码） | 实测（代码）：守护进程在 step 结束后自动推分支（`推送分支` 工具默认开启，`runner.ts:1849-1870`）；PR 由 agent 自己 `gh pr create`（`prompts.ts:286-296`）；服务端随后探测 PR 并记下 `build.prNumber`。线上从没跑通过：cairn 项目 2752 个 build 里只有 2 个带 PR（#2043、#2045，10-27） |
| 3.1 | PR 自动修复（D109 S3）已部署 | 可用 | 实测：#3189 在部署内。代码：`pr-watch.ts` 每 60 秒轮询（GitHub 额度低时 300 秒），日志里每分钟有一条 `ci pr-checks sweep`（当前候选 0） |
| 3.2 | 自动修复开关 | 部分可用 | 实测（代码）：只有每个 PR 一条的 `thread_pr.autoFix`，默认 `true`（`schema.ts:837`）；没有团队、项目或 flag 级开关，也没有能改它的 API（只有触顶上限时会自动关）。`/api/flags` 返回空 |
| 3.3 | 唤醒 harness 会话 | 可用（代码），线上未验证 | 实测（代码）：三种触发是冲突（dirty）、CI 失败（base 上为绿）、有写权限者的评审评论。有 step 在跑就走 steer；有 pending step 就并入 prompt；都没有就在同一 build 上新排一个 `session` step，续用原 session id，钉在原机器（`pr-wakes.ts:314-352`，`machine-claim.ts:564-575`）。上限：冲突 2 次、每个 head 的 CI 3 次、评审 3 次、总计 10 次 |
| 4.1 | Langfuse 接线 | 可用 | 实测：服务环境里有 `CAIRN_OTEL_ENDPOINT`（指向本机回环 `:3000/api/public/otel`）和 `CAIRN_OTEL_HEADERS`（键：`Authorization`、`x-langfuse-ingestion-version`）。Langfuse v4.68.0 跑在 docker（`ops/langfuse`），`/api/public/health` 返回 200，项目 `cairn-local` |
| 4.2 | 近期 trace 存在 | 可用 | 实测（ClickHouse `events_core`，只看计数）：今天共 980 个事件，最新 13:47:43Z。按名称：`step build` 193，`invoke_agent` 191，`chat glm-5.3` 190，`LLM Call` 175，`Tool: bash` 113，`chat gpt-6-luna` 26，`coordinator turn` 4 等 |
| 4.3 | 能产生 trace 的操作 | 部分可用 | 实测：协调者轮次（`coordinator turn`，session = chief 线程 id，带 `cairn.thread_id`）、build 根（`invoke_agent`，session = todo id，带 `cairn.build_id`）、`step <kind>`、pi 的 `chat <model>` 和 `execute_tool`。缺失（代码）：派发/认领、PR 轮询与唤醒、服务端工具执行器都没有 span；claude-code 只有工具 span，没有 LLM span |
| 4.4 | 用 API 读 trace | 缺失 | 实测：服务端用的是只写的 ingestion key，`/api/public/v2/observations` 返回 403（缺 `traces:read`）；v4 的 events_only 模式下旧的 `/api/public/traces` 返回 404。本次只能直接查 ClickHouse 计数 |
| 4.5 | Langfuse 界面入口 | 部分可用 | 实测：界面在 omarchy 本机 `http://127.0.0.1:3000`（compose 绑回环），tailscale serve 只暴露了 8787。cairn 界面里没有任何跳到 Langfuse 的链接 |
| 5 | 端到端试点 | **可用**（第 2 次运行） | 见 §2：聊天 → 派发 → harness → PR [#3263](https://github.com/xiechimon/cairn/pull/3263) → CI 全绿 → 已合并。中途有 4 处要人工介入（重叠检查、两处运维修复、批准推送），合并走的是 admin，cairn 的线程没有收尾（G12） |

另外顺带发现的事故（实测）：今天 00:00–11:47Z，协调者触发的 build 有 1192 个，其中 1194 个（含用户触发的）报 `404 Model "glm-5.3" is not supported`，大约每小时 100 个，来自两张研究核查卡（#116、#117，各 516 次）。永久性的模型错误没有退避，也不会停。

## 2. 试点时间线（第 1 次运行）

任务原文：「Freeze the clock in pr-screens captures so failed-thread screenshots stop showing false diffs (the time text differs between base and head). Open a PR.」

| 时间（UTC） | 事件 | 结果 | 来源 |
|---|---|---|---|
| 21:55:04 | 以 owner 身份 `POST /api/teams/:id/coordinator/messages`（projectId=cairn）；协调者线程 `chief-01a199d6-b6a7-7265-9428-f8077b79c6d4` | 发送成功 | 实测 |
| 21:55–21:57 | 协调者翻遍 issues（open 3 页 + closed 27 页）和 PR（closed 11 页）找重叠 | 约 45 次工具调用 | 实测 |
| 21:57:12 | 协调者拒绝建卡：工具查不到正文、文件，也不能搜索 | **卡住 → 缺口 G1** | 实测 |
| 22:01:01 | 我用 `scripts/github-overlap.mjs` 跑完整检查，把结果作为 owner 发给协调者 | — | 实测 |
| 22:01:14–15 | `create_todo` → 任务 #120 `6lZR1Jxn8vjh-hMsCp7x3`；`open_thread` → build `01a1b2e1-5b1a-…` | 派发成功 | 实测 |
| 22:01:21 | 工作区钩子 `.agents/setup` 退出码 1：mise 当前的 node 是 26.13.0（系统配置 `node=latest`），没有 corepack | **卡住 → 缺口 G8**（运维已修） | 实测 |
| 22:04:51 | 给 daemon 加 drop-in `50-mise-node-24.conf`（`MISE_NODE_VERSION=24`，和仓库 `.nvmrc` 一致），然后重启 daemon（重启时运行中的 step 为 0） | — | 实测 |
| 22:05–22:07 | 重试 build `01a1b2e4-…`：setup 通过（49 秒），claude-code 返回 `Failed to authenticate: OAuth token revoked` | **卡住 → 缺口 G9**（要 ian 登录） | 实测 |
| 22:09:33 | 把 routing rule `session` 改成 openai-codex / gpt-6.1-sol（pi），claude-code sonnet 作回退；原因写进 `DECISIONS-ian.md` | — | 实测 |
| 22:09:56 | 重试 build `01a1b2e9-4e99-7217-944e-256f79060e3b`（Codex，pi，omarchy） | 开始执行 | 实测 |
| 22:10–22:21 | 线程写了 plan，先写回归测试再实现，跑了 29 个 node 测试、3 个实时服务器测试，明暗两套截图零像素差异；lint、typecheck、spec 都通过；提交 `49fe9c5d3` | — | 实测（线程消息） |
| 22:21 | `pnpm prepush` 被 english-only-gate 拦下：daemon 运行期间往被跟踪的 `AGENTS.md` 里注入了 33 行中文 brief。线程没有绕过钩子，而是提问请示 | **卡住 → 缺口 G10** | 实测 |
| 22:24:49 | 我以 owner 身份批准了线程推荐的做法（先把 AGENTS.md 恢复成 HEAD 版本，正常跑钩子，推完再还原注入内容）。消息被投递为 `revision`，同一个 session 续跑 | — | 实测 |
| 22:34:17 | **线程开出 PR [#3263](https://github.com/xiechimon/cairn/pull/3263)** `ops(120): freeze seeded PR screenshot timestamps`，作者 `app/cairnwright`，改了 6 个文件。线程推送前先判断 `~/.cairn/github-create/lock` 已过期（mtime 不变），再删掉它 | PR 已开，CI 在跑 | 实测 |
| 22:36:41 | cairn 自动跑的 `review` step（claude-code）因 token 被吊销而失败，线程进入 failed；`sweepFailedRetries` 自动 restart，排了一个返工 session | **→ 缺口 G11** | 实测 |
| 22:37:39 | 新建 `review` 路由规则 = Codex gpt-6.1-sol | — | 实测 |
| 22:44 | 返工 session（Codex）确认修复仍然有效，重跑 harness 测试 5/5，往 #3263 推了第 2 个提交 `f06625b53`；之后线程停在 `building`，没有再排 review step | **→ 缺口 G12** | 实测 |
| 22:59:27 | **#3263 合并**（merge commit `9dfe66ad0`，`mergedBy=xiechimon`：ian 或协调会话做的 admin 合并，不是 cairn 自己的合并路线）。43 个检查 SUCCESS，唯一 FAILURE 是 `cairn/merge-gate`（`phase-not-review`） | 合并 | 实测 |
| 23:01 | cairn 的 gate 已经知道 PR 合并了（`pr-not-open: merged`），但线程 #120 仍停在 `building`；`ci pr-checks sweep` 把它记成 `unreadable: 1`，不会自动收尾成 done | **G12** | 实测 |

Langfuse 链接（omarchy 本机）：协调者轮次 `http://127.0.0.1:3000/project/cairn-local/traces/62701649b9a373fe53d3e0def5aece7e`（21:55，92 个 span），`…/traces/aa743b3623cda2a1bdf1ea4828532a1c`（22:01，建卡和派发）；会话视图 `http://127.0.0.1:3000/project/cairn-local/sessions/chief-01a199d6-b6a7-7265-9428-f8077b79c6d4`。工作线程的 span（60 次 `chat gpt-6.1-sol` 和 read/edit/bash/ask_user 等工具调用）挂在 build 的 trace 下；根 span `invoke_agent`（session = todo id）要等 build 结束才发出（实测：ClickHouse 计数）。

试点中顺便确认：`apps/web/pr-screens/capture-core.ts` 已经用 `page.clock.setFixedTime` 冻住了浏览器时钟，假差异来自 seeded 实时服务写入的真实时间戳。所以这个任务是真活，没有被别人做掉（实测）。

## 2b. 试点第 2 次运行（#3260、#3270 部署之后）

任务原文：「In Langfuse a running thread cannot be found by its session until the build ends … Make step spans … also carry langfuse.session.id and session.id set to the todo id, with a test. Open a PR.」（即缺口 L2，让 cairn 自己修自己的 Langfuse 缺口）

| 时间（UTC） | 事件 | 结果 | 来源 |
|---|---|---|---|
| 23:42:43 | 自部署到 `28530da30`，包含 #3260（`github_overlap`）和 #3270 | — | 实测 |
| 23:43:03 | 以 owner 身份发给协调者；**这次没有手工提供重叠检查结果** | — | 实测 |
| 23:43:34 | 协调者主动调用 `github_overlap`（4 个 terms，planned path 为 `runtime-otel.ts`）；`openIssues` 搜索单次请求超过 6 秒，工具按设计 fail closed，协调者不建卡 | **小卡点 → G1b** | 实测 |
| 23:45:58 | 我请它重试（同一条搜索在机器上直接 fetch 只要 158–915 ms） | — | 实测 |
| 23:46:09 | `github_overlap` 返回完整结果：没有同诉求的事项；发现开着的 #3259 也改了目标文件，并写进了任务 spec | 成功 | 实测 |
| 23:46:18–20 | `create_todo` → 任务 #121 `GLOLN1L4gRFDfXfeQnVwT`；`open_thread` → build `01a1b341-8e5e-7310-8a91-c7f519516ccc` | 派发成功 | 实测 |
| 23:46–00:02 | 线程（Codex gpt-6.1-sol，pi，omarchy）只用了 1 个 session step 就完成实现和测试，00:00:58 开出 **PR [#3283](https://github.com/xiechimon/cairn/pull/3283)** `server(3279): tag runtime steps with the todo session`（作者 `app/cairnwright`，1 个提交，改 2 个文件） | — | 实测 |
| 00:11:05 | 自动进入 Mergify 队列（规则 `bot`） | — | 实测 |
| 00:19:35 | **合并**（`a934e33`，经 Mergify；38 个检查 SUCCESS，只有 `cairn/merge-gate` 红） | — | 实测 |
| 00:20–00:21 | cairn 自己把 #121 推进到 review，再收尾成 **done** | **端到端跑通** | 实测 |

第 2 次运行的 Langfuse：协调者轮次在会话 `chief-01a199d6-…` 下；build 的 trace（根 span `invoke_agent`，session = `GLOLN1L4gRFDfXfeQnVwT`）是 `http://127.0.0.1:3000/project/cairn-local/traces/8a330d739337f44e8de37994c3bdcd26`（实测：ClickHouse 里有这条 trace 和它下面的 `step session`）。

结论：只有一次需要人工介入（请协调者重试 `github_overlap`，见 G1b），从聊天到合并、到线程收尾都由 cairn 自己完成。PR 上的 CI 和 Codex 云端审查都是绿的，没有触发 CI 失败唤醒，所以 PR 自动修复（D109 S3）这次还是没在线上被验证过。

## 2c. claude-code 认证复核（2026-11-07，实测）

| 时间（UTC） | 动作 | 结果 | 依据 |
|---|---|---|---|
| 02:52 | ian 在 cairn「设置 → 订阅」换上新的 Claude subscription | 订阅列表里只有这一条，创建于 02:52:17Z | 实测（API，不含 token 值） |
| 02:53 | `PATCH /api/teams/:id/routing-rules/session` 改回 claude-code / claude-sonnet-5-5（low），回退 openai-codex / gpt-6.1-sol；`review` 不动 | 返回的规则与请求一致 | 实测 |
| 02:54:19 | 通过协调者发一个真实的只读任务：诊断 G2（model_not_found 重试），只出报告、不开 PR | 协调者建了 #122 `Trace model-not-found step retry behavior`（output=info）并开线程 | 实测 |
| 02:54:40–02:55:50 | daemon 日志：`Loading claude-code runtime…`，executor record `backend=claude-code, model=claude-code/claude-sonnet-5-5, effort=low` | session step `done`；daemon 日志里没有 `authenticat`/`revoked`；usage 记了 sonnet 6160 个输出 token | 实测 |
| 02:56 | 报告附件（`reportAttachmentId`）是一份带 file:line 的诊断 | 线程进入 review | 实测 |
| — | Langfuse：session=#122 有 `step session` 1 个、工具 span 14 个（Bash 11 个等） | claude-code 仍没有 LLM 的 `chat` span（G5）；build 结束后才会有 `invoke_agent` 根 span | 实测（ClickHouse 计数） |

## 2d. 试点第 3 次运行（#3304 协调者内置、#3259 和 #3329 按能力路由部署之后）

线上提交 `aa9eb3f40`（07:02:21Z 部署，包含 #3304、#3259、#3329、#3330）。任务：修 `pi.ts` 的 `isRetryableError`（#122 诊断出来的问题）。

| 时间（UTC） | 动作 | 结果 | 依据 |
|---|---|---|---|
| 07:02:42 | `POST /api/teams/:id/coordinator/messages` 发送任务 | 发送成功 | 实测 |
| 07:02:43–07:03:02 | 协调者（服务内，openai-codex/gpt-6.1-sol）依次调用 `threads` → `github_overlap`（第一次就成功）→ `create_todo` → `open_thread` | 建了 #123 `Fix pi retry classification for HTTP statuses and permanent model errors` 并开线程，用时约 20 秒，中途没有人插手 | 实测 |
| — | (a) Langfuse `default.events_core`，trace `466ea981db5ca7be95e3093d39d4b61e` | `coordinator turn`（AGENT）1 个；`chat gpt-6.1-sol`（GENERATION，model=gpt-6.1-sol）5 个；工具 span `threads`、`github_overlap`、`create_todo`、`open_thread` 各 1 个；全部 environment=live | 实测（ClickHouse 查询） |
| 07:02:43–07:05:47 | session step `JgyoRiss6JUBuLfTDOmhO` 一直 pending，约 3 分钟 | — | 实测 |
| 07:05:47 | (b) `step_route` 行：kind=session，difficulty=standard，harness=claude-code，claude-sonnet-5-5，machine=omarchy，reason=`rule default (standard: no available candidate)`，rejected=[sonnet unavailable, gpt-6.1-sol unavailable] | 两个候选都被判为不可用，于是按规则默认值认领 | 实测（只读 SQLite） |
| 07:05:47–07:05:48 | daemon 加载 claude-code runtime；1 秒后 server 被 systemd 停掉（`deploy.json` 没变，不是自部署。协调者事后确认：是它的一个 agent 停服备份数据库，并把积压的摘要合并成一条占位摘要，没有改别的） | step 失败：`team skills distribution failed: fetch failed`，而且失败报告发不回去 | 实测（journal） |
| 07:06:19 | server 用同一个提交重新起来 | — | 实测 |
| 07:08:00 | 被弃 step 的清理把它放回 pending（`sessionId` 为空，没有 checkpoint） | — | 实测 |
| 07:08–08:33 | 一直 pending，没人认领 | **卡住 → 缺口 G13** | 实测 |
| 08:23:14 | G13 修复 PR [#3355](https://github.com/xiechimon/cairn/pull/3355) 经 Mergify 合并，`51e4513eb`；Codex 云端审查最后一轮无发现 | — | 实测 |
| 08:33:07 | 部署后第一个调度周期：`step_route` 行改写为 harness=pi，gpt-6.1-sol，reason=`re-routed: claude-sonnet-5-5 no longer runnable (quota); standard: gpt-6.1-sol ranked 2, higher ranks unavailable`；step 被认领 | 卡住的 step 自己解开了，修复在线上得到验证 | 实测（只读 SQLite） |
| 08:33:12 | daemon executor record：`backend=pi, model=openai-codex/gpt-6.1-sol, effort=low` | 开始实现 | 实测（journal） |
| 08:47:28 | cairn（app/cairnwright）开出 PR [#3377](https://github.com/xiechimon/cairn/pull/3377) `fix(pi): restrict retry classification to HTTP statuses`，改 `pi.ts` 和 `map-pi-event.test.ts` | — | 实测 |
| 08:59:27 | Mergify bot 队列合并 #3377，`f0e472ebe`；09:01:41 线程自己进入 done | **第 3 次试点通过：聊天 → 合并的 PR** | 实测 |
| — | (b) 补查：`step session` span（trace `e98dbe15aa2fb387b77f82101e04ddb6`）带 `cairn.route.harness=pi`、`provider=openai-codex`、`model=gpt-6.1-sol`、`difficulty=standard`、`reason=re-routed: …`、`rejected=[sonnet quota]`，和 `step_route` 行一致。同一 trace 里有 `invoke_agent` 1 个、`chat gpt-6.1-sol` 31 个、工具 span 32 个，全部 environment=live | 通过 | 实测（ClickHouse） |
| — | #3377 上 Codex 云端审查留了一个**没处理的 P2**：`503: {...}` 这种状态码在前、后面跟冒号的中转错误不再算可重试。按规则 P2 不挡合并，cairn 也没有回应就合了 | **→ 缺口 G14** | 实测 |
| 09:02:26 | 把这个 P2 当作新任务发给协调者 | 协调者建 #124 `Accept status-first 5xx relay errors in pi retry classification` 并开线程（重叠检查一次过） | 实测 |
| 09:03–09:18 | #124 的 step 一次认领：`step_route` = pi / gpt-6.1-sol，reason `standard: gpt-6.1-sol ranked 2, higher ranks unavailable`（Claude 仍因额度被拒） | — | 实测 |
| 09:35:32 | cairn 开的 PR [#3383](https://github.com/xiechimon/cairn/pull/3383) 经 Mergify 合并，`ee55c9411`；Codex 云端审查无发现；09:38 线程 done | 补修完成，没有人插手；我在 #3377 的审查线程上回复并关闭 | 实测 |

G13 的原因（实测，读代码和线上数据）：
- 已记录的 `step_route` 被当作「in-flight，保留已记录的模型」，`decideStepRoute` 不再看候选。
- 认领时的 `routedModelRunsOn` 判断 Claude 不可用：机器上报的 Claude 七天窗口已用 98%，超过 `QUOTA_REJECT_PERCENT = 70`。
- Claude 的限流状态只是 `allowed_warning`，所以不会进入 quota 等待，也不会触发回退。
- 结果：step 被钉在一个永远不会被认领的模型上。Codex gpt-6.1-sol 明明可用，也用不上。

(b) 里的 `cairn.route.*` span 属性还没查：step 一直没有真正跑起来。等修复部署后再查。

## 3. 缺口清单（按挡住试点的先后排）

| # | 缺口 | 最小修法 | 类型 | owner 路由？ | 状态 |
|---|---|---|---|---|---|
| G1 | 协调者完成不了重叠检查规则，所有代码类请求都被拒 | 新增只读工具 `github_overlap`，在服务端跑和 `scripts/github-overlap.mjs` 一样的查询；协调者提示词改成调用它；terms 上限 6 个（GitHub 搜索最多 5 个 OR） | 代码 | 否 | **PR [#3260](https://github.com/xiechimon/cairn/pull/3260)**：Codex 云端审查指出一个 P1（daemon 中转 10 秒超时），已改成共享 8 秒预算加并发，线程已回复并 resolve；Auto-fix 已开 |
| G8 | omarchy 上 mise 的 node=latest(26) 没有 corepack，每个 build 都死在 `.agents/setup` | 运维：daemon drop-in `MISE_NODE_VERSION=24` | 配置 | 否 | **已修**（22:04Z，实测 setup 通过） |
| G9 | cairn 里存的团队 Claude 订阅 token 被吊销；报错文案却说「预检 `claude auth status` = 未登录」，误导人去查机器登录 | ian 重新 `claude setup-token`；文案应区分「团队订阅 token 被拒」和「机器未登录」 | 登录 + 代码（`apps/daemon/src/backend/claude-code.ts` 的文案） | token：要 ian；文案：否 | **已关闭**：ian 11-07 换了 token，验证通过；路由已改回，真实 step 认证通过（§2c）。文案见 **PR [#3270](https://github.com/xiechimon/cairn/pull/3270)**（已合并） |
| G10 | 工作线程推不了 cairn 仓库：daemon 往被跟踪的 `AGENTS.md` 注入运行期 brief，english-only-gate 读工作区就会变红 | gate 跳过未提交的 CAIRN-RUNTIME 标记块；已提交的块照样报红 | 代码（`scripts/english-only-gate.mjs`） | 否 | **PR [#3262](https://github.com/xiechimon/cairn/pull/3262) 已合并**（22:51Z） |
| L1 | Langfuse 里失败的 span 只写 `ERROR failed`，看不出原因、机器和模型 | 把脱敏后的失败原因写进 status message 和 `cairn.error_message`，step span 加 build、todo、machine | 代码（`runtime-otel.ts`） | 否 | **PR [#3261](https://github.com/xiechimon/cairn/pull/3261) 已合并**（22:42Z），已自部署（`268629921`） |
| L2 | 运行中的线程在 Langfuse 里按 todo 找不到：根 span 结束时才发出，子 span 没有 session id | step span 也带 `langfuse.session.id` = todo id | 代码（`runtime-otel.ts`） | 否 | **cairn 自己修好了**：第 2 次试点的任务就是它，PR [#3283](https://github.com/xiechimon/cairn/pull/3283) 已合并 |
| G11 | PR 开出后 cairn 自己跑 `review` step，默认走 claude-code，因 token 被吊销而失败；`sweepFailedRetries` 不认为这是凭据问题（`isProviderAuthFailure` 不认 claude-code 的凭据文案），于是自动 restart，而 restart 重跑的是实现 session，不是失败的 review | 配置：建 `review` 路由规则 = Codex gpt-6.1-sol（ian 定的「审查一律 Codex」）。代码：claude-code 两种凭据失败都归为需要人处理；restart 重跑失败的那种 step | 配置 + 代码（`packages/shared/src/task-failure.ts`、`services/needs-you.ts`） | 否 | 配置**已改**（22:37Z）；凭据失败不再自动重试：**PR [#3270](https://github.com/xiechimon/cairn/pull/3270)**；「restart 重跑失败的那种 step」待做 |
| G12 | 自动 restart 的返工 session 结束后，线程停在 `building`；PR 被外部合并后也不收尾 | 推断（代码追踪）：已有 PR 的线程不会在 session 结束时进入 review，而是等 `ci-loop.ts` 的 `pollOne` 看到检查全绿再推进；合并后 head 分支被删，`commits/<branch>/check-runs` 返回 404，`pollOne` 每分钟记一次 unreadable；而合并对账 `reconcileOne` 只处理 review 相位。最小修法：`pollOne` 读到 PR 已不是 open 时，把线程转到 review，交给现有的合并对账收尾 | 代码（只改 `services/ci-loop.ts`） | 否 | **PR [#3276](https://github.com/xiechimon/cairn/pull/3276) 已合并并部署**；00:34Z 实测 #120 已自动收尾成 done |
| L3 | 线程里跑 cairn 自己的测试时，测试产生的 span 被发到了线上 Langfuse（23:39–23:53Z 有 178 个 fixture span，会话名形如 `todo-mapi-10-…`，在线上 DB 里都不存在）。推断原因：pi runtime 的子进程继承了 daemon 的 `CAIRN_OTEL_*`；claude-code 那条路径有 `claudeCliEnv` 清洗，pi 没有 | 运维：线上 server 和 daemon 的 span 加上 `CAIRN_OTEL_ENVIRONMENT=live`，在 Langfuse 里按 environment = live 过滤（已做）。代码：pi 的 step 环境同样清洗 OTel 变量 | 配置 + 代码（`apps/daemon/src/backend/`） | 否 | 配置**已改**（00:24Z）；代码 **PR [#3292](https://github.com/xiechimon/cairn/pull/3292)，已合并（00:47Z）**（清洗 pi 的 bash 子进程环境；pi 进程内自己发的 `LLM Call` span 仍然存在，标记为 environment=local，可以过滤掉） |
| G1b | `github_overlap` 第一次调用就超时（单个请求 6 秒，总预算 8 秒），重试才成功；推断：3 个搜索和最多 8 个并发的文件请求同时发出，容易碰上 GitHub 对搜索的二级限流或慢响应 | 先让搜索按顺序发出，文件请求用剩下的预算；或者对超时重试一次。观察几次再决定 | 代码（`github-overlap.ts`） | 否 | 观察中 |
| G2 | 永久性模型错误（model_not_found）无限重试，约每小时 100 个 build | 对不可重试的 provider 错误停止重排并通知 | 代码 | 待查 | 已诊断（由 cairn 任务 #122 用 claude-code 完成，见 §2c）：cairn 自己的分类把它判为不可重试，但 `pi.ts` 的 `retryable` 只记日志；重试多半来自 pi SDK 的自动重试（`maxRetries: 3`，推断）。还没改代码 |
| G3 | 协调者实际用 gpt-6-luna，界面显示 opus | — | — | — | 交给兄弟会话 routing-capability（PR #3259）；ian 已定协调者用 vani deepseek-v4.1-flash |
| G4 | 无法按任务指定 harness 或机器 | — | — | — | 同上，routing-capability 负责 |
| G13 | 被弃后放回 pending 的 step 仍被钉在已记录的模型上；这个模型因为额度超过路由阈值（70%）而永远不能被认领，又没有 quota 等待或回退，于是一直 pending（第 3 次试点，#123） | 还没开始 session 的 step，已记录的路由只算认领时的记录：按当前候选重新路由，并更新 `step_route` 行 | 代码（`services/step-route.ts`；认领代码在受保护的 `machine-claim.ts`，不改） | 否 | **已关闭**：PR [#3355](https://github.com/xiechimon/cairn/pull/3355)（`51e4513eb`）。Codex 审查第一轮指出被认领的 step 也没有 sessionId，会在取凭据时被改路由，已改成只有 pending 才重新路由。Codex lane 中途改了受保护的 `machine-claim.ts`，我让它退回，最终只改 `step-route.ts`。线上 08:33Z 验证通过 |
| G14 | cairn 自己的 PR 会带着没处理的 Codex P2 被合并：`review-gate` 只挡 P0/P1，cairn 的 PR 流程不读审查意见（#3377） | cairn 的 PR 监视在审查有新发现时唤醒线程，修完或写明不修的理由后再进队列；或者 merge-route 对 cairnwright 开的 PR 要求没有未解决的审查线程 | 代码（`pr-wakes.ts` / merge-route） | 待查 | 这一次用新任务 #124 补修（PR #3383 已合并）。ian 答「要」（11-07）：cairn 的 harness 必须处理完自己 PR 上每一条 Codex 发现（含 P2/P3：修掉，或在线程里回复不修的理由），未处理完不得 ready；仓库 review-gate 不变。调研见 `docs/research/review-findings-before-ready-2026-11-07.md`。实测：Codex 和 review-gate 都不审 draft（`codex-gate-core.mjs:255`；#3101 是审完才转 draft），所以不能 draft 起步。方案：服务端 GraphQL 读未 resolve 的 Codex 线程 → 有就转 draft（Mergify 出队）并唤醒线程（Codex 机器人不再被 write 权限过滤）→ 清零后服务端标 ready，触发对新 head 的复审；Mergify `bot` 队列加 `#review-threads-unresolved = 0` 兜底。PR #3401 五轮后暂停（11-07 15:4xZ，交 ian 定）：r1 hold 记录 → r2 修 dismissed/hold 写序/未答问题 → r3 改为每次轮询从 GitHub 幂等 reconcile → r4 归属用转 draft 的 actor（Codex：OAuth token 就是 ian，人手转的 draft 会被当成 cairn 的）→ r5 归属改用 `cairn-review-hold` 标签 + 「本 head 上人摘标签 = 覆盖」（Codex：cairn 自己清理标签也产生 UnlabeledEvent，同一 head 再出发现时被当成覆盖、不再 hold）。CI 全绿，**更正**：我曾写「Mergify `#review-threads-unresolved = 0` 把 #3401 挡在队外（实测）」，这是错的。#3401 作者是 xiechimon（lane 用 ian 的 gh 开 PR），走的是 `default` 队列，而这条兜底只加在 `bot` 队列。实测时间线：Codex 15:29:44Z 在 7d73bf82b 上留 P2，Mergify 15:33:55Z 照样入队，15:39:18Z 合并为 `4a14b42bb`（r5 版本，带「cairn 自己摘标签被当成人工覆盖」的 bug）进了 main。之前没进队，是因为 review-gate 还没完成或 PR 是 draft，不是兜底在起作用。根因（推断）：cairn 用的是 ian 的 OAuth token，GitHub 上 cairn 的动作和 ian 的动作无法区分，凡是靠 GitHub 事件判归属的方案都会撞上。ian 定（11-07）：选 (c)，删掉人工覆盖规则，cairn 扣住的 PR 只在 Codex 发现清零时放行，只有面板里关掉监视例外；之后另开 PR 让 cairn 的 GitHub 写操作改用 cairnwright App 身份，落地后再按「事件 actor 不是 cairnwright[bot]」恢复人工覆盖 |
| G5 | 派发、PR 轮询、唤醒没有 span；claude-code 没有 LLM span | 补 span | 代码 | 派发在 `machine-claim.ts`：**是** | 待办 |
| G6 | Langfuse 不能用 API 读 trace，界面只在 omarchy 本机 | 运维：建一把只读 key；Mac 用 `ssh -L 3000:127.0.0.1:3000 omarchy` | 配置 | 否 | 待办 |
| G7 | 自动修复没有开关 API | 先观察 #3263 上默认开启的行为 | 代码 | 否 | 观察中 |

本次对线上配置的改动（都可撤回）：
1. `~/.config/systemd/user/cairn-daemon.service.d/50-mise-node-24.conf`：`MISE_NODE_VERSION=24`。原因见 G8。撤回：删掉文件，`daemon-reload` 后重启 daemon。
2. 团队 routing rule `session`：从 claude-code / claude-sonnet-5-5（low，回退 openai-codex gpt-6.1-sol）改成 openai-codex / gpt-6.1-sol（medium，回退 claude-code sonnet）。原因见 G9。ian 换好 token 后改回。**已改回**（11-07 02:53Z）：claude-code / claude-sonnet-5-5（low），回退 openai-codex / gpt-6.1-sol。
3. 新建团队 routing rule `review` = openai-codex / gpt-6.1-sol（high），钉在 omarchy。依据是 ian 的决定「审查一律 Codex gpt-6.1-sol」，见 G11。G9 已关闭，实现默认走 Claude Code，cairn 内部审查走 Codex，又是两家了；但实现回退到 Codex 时，实现和审查仍是同一家。PR 上的 Codex 云端审查不受影响。
4. `~/.config/cairn/server.env` 和 `~/.config/cairn/otel.env` 都加上 `CAIRN_OTEL_ENVIRONMENT=live`，然后重启 server 和 daemon（00:23:57Z，当时运行中的 step 为 0）。原因见 L3。撤回：删掉这两行，再重启。

## 4. 日常怎么用 cairn 编排（建议）

### 4.1 对协调者说什么

在 cairn 的「协调者」对话里，选中项目 `cairn`，一次说一件可以单独验收的事，最后写明交付物，例如「…，开一个 PR」。比较好用的写法：

- **目标 + 现象 + 交付物**：「pr-screens 的 failed-thread 截图在 base 和 head 之间时间文本不同，造成假差异。冻结时钟，开一个 PR。」协调者会把原话写进任务 spec，然后自己去补探测到的事实。
- 知道涉及哪些文件就直接写上。#3260 上线后，协调者会拿这些路径去调 `github_overlap`，查有没有开着的 PR 也在改这些文件。
- 不要在一句话里塞多个 PR；要拆的话，协调者会按「能各自验收」来拆。
- 线程卡在提问或审批时，到线程里回复就行（试点里那条「批准推送」就是这样续上的），不用另开任务。
- 问进度：「#120 现在怎样」「哪些线程在等我」（协调者有 `threads`、`needs_you` 工具）。

### 4.2 在 Langfuse 看哪里

（实测：`/project/cairn-local/sessions`、`/traces`，以及具体 trace 页都返回 200；ClickHouse 里也确实写入了 session id。没有登录进界面逐页核对，这部分是推断。）

在 Mac 上执行 `ssh -o BatchMode=yes -o ConnectTimeout=5 -L 3000:127.0.0.1:3000 omarchy`，然后打开 `http://127.0.0.1:3000`，项目选 `cairn-local`。

| 想看什么 | 去哪看 | 怎么过滤 |
|---|---|---|
| 协调者每一轮做了什么（调了哪些工具、用的哪个模型） | Sessions → `chief-<线程 id>`（主线程是 `chief-01a199d6-…`） | trace 名 `coordinator turn`，tag `coordinator` |
| 某个任务的执行过程 | Sessions → todo id（例如 `6lZR1Jxn8vjh-hMsCp7x3`） | trace 名 `build`，根 span `invoke_agent`；下面是 `step session` / `step review`、`chat <模型>`、各个工具 |
| 为什么失败 | Traces，过滤 level = ERROR | #3261 上线后，status message 和 `cairn.error_message` 里是脱敏后的原因，另有 `cairn.machine_id` |
| 异常的重试风暴 | Traces 按名称计数，看同一个 todo 的 `invoke_agent` 有没有大量 ERROR | 今天的 glm-5.3 重试风暴在这里一眼就能看出来 |

现在的局限：运行中的任务要等 build 结束，根 span 才会出现（L2）；派发、认领、PR 轮询和唤醒都没有 span（G5）。这几步要看 cairn 界面里线程的系统消息。

### 4.3 在缺口关闭前，哪些还要 Claude Code

| 事情 | 原因 | 什么时候不再需要 |
|---|---|---|
| 写代码类请求的重叠检查 | 协调者自己完不成（G1） | #3260 合并并部署后 |
| 运维修复（mise、systemd、路由规则、token 过期） | cairn 没有这类运维能力，失败文案还会误导（G9） | 文案的问题由 #3270 解决；运维本身仍要人或 Claude Code |
| 线程卡在 `building`、合并后不收尾 | G12 | G12 修好后 |
| 合并 | cairn 自己的 merge-gate 要求线程停在审核关口；这次 #3263 是 admin 合并的 | G12 修好、线程能正常进入 review 之后，按 `mergePolicy=autonomous` 由 cairn 合并，或者进 Mergify 队列 |
| 盯 CI 并修 PR 上的问题 | cairn 的 PR 唤醒（D109 S3）已部署、默认开启，但这次试点还没真正触发过 CI 失败唤醒 | 下一轮试点验证一次 CI 失败 → 唤醒 → 修复 |

**建议的日常节奏**：ian 只和协调者说话，只在 Langfuse 看。Claude Code 只留一个值守会话：每次被唤醒，按 §3 的缺口表处理新出现的卡点，并把每个卡点变成一个小 PR 或一次记录在案的配置修改。#3260 和 G12 都关掉、并且有一次任务从聊天一路到合并都不需要人介入之后，就停掉定时 tick。

## 5. 本会话的偏差记录

- 有三处编辑（`scripts/english-only-gate*.mjs`、`#3260` 的 terms 上限和一处测试）是我在本会话里直接用 shell 改了其他 worktree 的文件。之后被 hook 提醒「不要从本会话写其他 worktree」，后面的改动都改由 Codex 在对应 worktree 里完成。
- #3263 的合并不是 cairn 自己完成的（`mergedBy=xiechimon`）。

## 6. 「#3263 在检查为红时被合并」：核实后不是事故

**最初的怀疑**：PR 页面上 `pr-evidence`、`merge-route` 是红的，合并者显示为 `xiechimon`，而且没有经过 GitHub app。我一开始推断是 ian 手动用管理员权限绕过了检查（这个推断错了）。

**核实结果（实测）**：
- #3263 上 Mergify 的评论：22:46 进入队列（规则 `bot`），「Merged into `main` as `9dfe66a` at 22:59 UTC」。
- `.mergify.yml` 里配置了 `merge_bot_account: xiechimon`，所以 Mergify 的每一次合并在 GitHub 上都显示为 xiechimon 合并、没有 app。第 2 次试点的 #3283 也一样（00:19Z）。
- head `f06625b53` 上检查的时间线：`review-gate` 22:37:44 成功，`merge-route` 22:48:09 成功，`pr-evidence` 22:49:55 成功，合并发生在 22:59:27。`pr-evidence` 和 `merge-route` 是在 23:01:5x 合并之后重跑才变红的，PR 页面显示的是这次重跑的结果。
- 合并时唯一的红是 `cairn/merge-gate`（`phase-not-review`），它不在 Mergify 的队列条件里。

**结论**：合并走的是正常的 Mergify 路线，没有绕过检查。我之前加到 `DECISIONS-ian.md` 的 `enforce_admins` 那一条，前提不成立，已删除。

**仍然保留的加固（纵深防御，不是事故修复）**：`main` 的 `enforce_admins=false`，而 cairn 的团队 GitHub 连接用的是管理员 token。所以 cairn 自己的 `POST /api/builds/:id/merge`（`mergeThroughGithub`）理论上可以在检查为红时合并成功。分支 `server/merge-requires-green-checks`（`275a5643b`）在发出 PUT 之前先复用门禁的 `requiredChecksReadiness` 自检，配了「必需检查为红就不发合并请求」的测试，29 个 TLA+ 结果都符合预期。因为 `builds.ts` 已有两个开着的 PR（#3259、#3164），等其中一个合并后再开这个 PR。

**教训**：判断「谁合并的」不能只看 GitHub 的 actor 字段。Mergify 用 `merge_bot_account` 合并时，actor 就是那个账号。要先看 PR 上 Mergify 的评论，再看检查在合并那一刻（而不是现在）的结论。
