# Cairn domain model and vocabulary

This file fixes, for each domain concept, a three-column mapping between the Chinese UI word, the English word and the internal code name, and settles the boundaries between concepts (positioning is in `docs/spec/18-positioning-and-differentiation.md`). Implementation contracts (the full phase enum, REST and SSE endpoints, record shapes) are not here; they live in the `docs/spec/` architecture specs (map ticket #41).

Internal names are renamed only where a word is overloaded, and each rename is marked (see `密钥`).

## 租户层级

| 中文界面词 | 英文原词 | 内部名 | 定义 / 边界 |
|---|---|---|---|
| 团队 | Team | `team` | 顶层租户边界，项目、Agent、机器、资源与套餐（plan）都归属其下。 |
| 项目 | Project | `project` | 团队下聚合任务、仓库与文件的单位。 |
| 仓库 | Repo | `repo` | 项目绑定的代码来源，两种形态：GitHub 接入（`githubRepo`）或本地文件夹（`localPath`，必须是 git 仓库——server 三态校验 not_absolute / not_found / not_git）。是 Project 的属性，不是独立租户层。hosted（Cairn 托管）形态已移除。**形态的可丢性分叉**（ADR 0016）：`githubRepo` 真值在远端、机器死了换机续跑；`localPath` 是单机器缓存形态——真值在该机文件系统，机器损坏进度随机器走，不享受换机续跑。**双执行源**（ADR 0017 / #1213）：`githubRepo` 形态项目可加挂可选 `localPath` 作同机执行加速位——真值恒为 GitHub（server 只验绝对路径形态，daemon 物化时双条件判定「路径存在 + 该路径 origin 与 githubRepo 同仓」，不过则静默回落 GitHub clone）；同一项目被两种机器执行，各走各能到的源。**local 形态的执行边界**（#1210）：local 形态的 `localPath` 是登记机文件系统上的路径，步骤只在仓库所在机器上可执行；其它执行机上路径不可达 = daemon 在 clone/fetch 之前显式失败，步 errorMessage 点名机器、路径、原因与补法（把任务钉选改回仓库所在机器，或跨机开发用 GitHub 形态建项目）。 |

_Avoid_：**Workspace** —— 它不是领域实体，仅指执行机本地的任务检出目录（`~/.cairn/workspaces/<conversationId>`）；禁止用它指代团队或任何界面层级。

## 任务生命周期

| 中文界面词 | 英文原词 | 内部名 | 定义 / 边界 |
|---|---|---|---|
| 任务 | Todo | `todo` | 用户要办的一件事，持久且带序号（`#seqNum`）；看板上的卡片即一个 todo。 |
| 阶段 | Phase | `phase` | todo 的当前状态。看板的列只是 phase 的一种视图，非独立实体。 |
| 运行 | Build | `build` | todo 的一次执行：一次运行 = 一个 build = 一个 conversation = 一个 worktree+分支。其 id 与 `conversationId` 同值。 |
| 对话 | Conversation | `conversation` | build 产生的消息流的别名视图，与其同 UUID；不作为独立实体。 |
| 方案 | Plan | `plan` | build 内类型化的规划产物卡（Context / Changes / Edge cases / Verification）；不是独立实体。 |
| 标签 | Tag | `tag` | todo 的 category 标签。**词表来源与数量上限随仓库形态分叉**：`githubRepo` 项目 = 该仓库实际的 label 集（动态，issue 挂几个贴几个）；`local` 项目 = 固定 6 词表（bug / feature / improvement / refactor / docs / chore），随项目播种，每任务至多 1 个。两形态都是派发时由执行 agent 回填、无人工创建/挑选 UI（ADR 0002 D4/D5，ADR 0005 D2/D4）。 |
| 占位标题 | Placeholder title | `title`（占位态） | 保存任务时落库的首行截断标题（正文首行 ≤50 字符）；执行 agent 接单后用 LLM 总结回填正式标题覆盖之。**仅 local 项目**——github 项目从 issue 建的任务直接用 issue 标题，没有占位态（ADR 0005 D5）。 |
| 来源 | Source | `sourceKind` / `sourceRef` | todo 的出处——**外部出处或编排出处**（#640 / r14 §5.3：不再限于外部）；一个任务至多一个，归 `todo` 既有的溯源家族。两族：`github-issue` / `github-issue-self`（外部，`sourceRef` 形如 `github:owner/repo#123`）——github 项目的任务**两侧都有落点**，领来的记下那枚 issue、自派的建一枚（ADR 0005 D6、ADR 0006 D1），但**不改写 issue 的状态、不自动覆盖**，issue 侧仍是真值、cairn 只显示差异（ADR 0006 D5/D6）；`orchestration`（编排，`sourceRef` 形如 `chief:<uuid>`）——总管编排回合拆出的子卡，指向那次请求的编排会话（per-request 粒度，答「哪次请求拆的」，与答「谁建的」的 `createdBy`/`sourceBuildId` 三层各答一问，r14 §5.3）。至多一个来源，GitHub 接入项目的镜像写向优先占槽（r14 §5.7）。 |

边界裁决：
- **无 Goal 概念** —— 工作单元只有一个，即 `todo`；「Goal」不引入。
- **`待验收` 与 `审核` 是同一 phase 的两个界面词**，正名取列名 `待验收`；`完成`（`done`）是动作/按钮，不是阶段名。
- **`待处理` 只指看板「需要我处理」列**（`confirm` / `review` / `failed`）。`todo` 在 `待开始` 列，芯片词 `待开始`；`queued`（已启动、等空闲机器）在 `执行中` 列，芯片词 `排队中`（#1400，列位 #1447）。芯片词可以和列名不同（`确认` / `审核` / `失败` 都在 `待处理` 列），但芯片词与某个列名同字时，该 phase 必须在那一列。
- Build 与 Conversation 是一个实体的两面（执行 vs 消息流），不拆成两套 id。
- **新建任务无「标题」填写面** —— 用户只写任务正文，标题 = 占位标题 → agent 回填两段式（ADR 0002，**仅 local 项目**；github 项目的任务从 issue 取标题，见 ADR 0005 D5）；标签的 state 轴不引入，已由 `phase` 承载。
- **标签与标题的真值随仓库形态分叉** —— `githubRepo` 项目的元信息对 issue 取真值，`local` 项目留在 cairn 内（ADR 0005 D1）。分叉的依据是约束不是偏好：local 项目没有外部真值可依。读这条词表时不要默认两种形态行为一致。
- **`issue` 不是 cairn 实体** —— GitHub issue 只在「来源」里作为外部引用出现。cairn 会往 GitHub 建 issue、写它的标题（ADR 0006 D1/D3），但**不引入 Issue 记录、不镜像状态、不做自动同步**——真值方向始终是 issue → cairn（ADR 0005 D1、ADR 0006 D5）。

## 执行体

| 中文界面词 | 英文原词 | 内部名 | 定义 / 边界 |
|---|---|---|---|
| 机器 | Machine | `machine` | 登记的执行主机（`cairn` daemon + 内嵌 pi runtime），领取并运行 build 步。一个机器可承载多个 Agent 的步；它不是 Agent 的属性。 |
| Agent | Agent | `agent` | 配了模型、职责、技能、工具、密钥、MCP 与记忆的执行角色；运行在某台机器上。 |
| 总管 | Chief | `chief` | 每「用户×团队」一个的调度与对话代理，负责分派任务；领域上区别于干活的 worker Agent。 |
| 主力机 | Primary machine | `chief.machineId` | chief 的默认执行机器（#895）：chief 新线程钉选缺省链的第二级（`todo.machineId` → 本槽 → null），钉选语义同 `todo.machineId`——确定性、无自动回退，解除归用户；null = 自动（任何在线机器认领 + 会话亲和）。只辖 chief 线程的钉选，不辖 worker 派发。设定面在 chief 设置 Agent tab「机器」槽（PATCH /chief），machines 页只读三态标注（总管主机 / 回合进行中 / 等待机器）。 |
| `记忆` | Memory | `memory` | Experience entries an agent accumulates while working. The todos.dev write path is unmeasured [black box]; the replica uses a minimal mechanism (02-architecture-parity §4.4, all marked [inferred], pending #46 calibration). |

Boundary: Agent ≠ Machine (one is a configured role, the other the physical host that carries it). Chief is its own concept, never called a kind of Agent. The chief panel is a floating window (ADR 0013, superseding ADR 0004's right-docked column); its vocabulary is in "Chief panel and machine binding" below.

## 资源与配置

| 中文界面词 | 英文原词 | 内部名 | 定义 / 边界 |
|---|---|---|---|
| 技能 | Skill | `skill` | 含 `SKILL.md` 的可复用流程文件夹，传授给 Agent；Agent 可默认携带或被授予。 |
| 模型服务 | Provider | `provider` | 配了凭证的模型来源（api_key / oauth / 自定义端点三协议）。 |
| 模型 | Model | `model` | Provider 下的一个具名可选项。[排除项：内置 built-in 模型走 Pro，不在复刻范围。] |
| MCP 服务器 | MCP server | `mcpServer` | 团队接入、为 Agent 提供额外工具的外部 MCP 服务器（方向：外部 → Agent）；工具名 `mcp__<标识符>__<工具>`。 |
| 团队密钥 | Secret | `secret` | 按 Agent 授权、按步下发的键值，只写不读；明文不预置进任务 shell 环境（agent 经取用通道显式取用，取用留审计行）。 |
| API 密钥 | API key | `apiKey` | `cairn_…` 形态的凭证，用于注册机器与作为 MCP Bearer，带读/写工具白名单。 |

边界裁决：
- **「密钥」是重载词，强制拆两义** —— `secret`（团队密钥）≠ `apiKey`（访问令牌）。代码里两词严格分开。
- **MCP 只有一个方向是实体** —— `mcpServer` 指团队接入外部工具（外部 → Agent）。todos.dev 自身被外部 MCP 客户端连接，是 `apiKey` 的一项能力，不单立 `McpClient`/`McpGateway` 概念。
- Provider ≠ Model（一个是配凭证的来源，一个是其下的可选项）。

## 记录与观测

| 中文界面词 | 英文原词 | 内部名 | 定义 / 边界 |
|---|---|---|---|
| 定时 | Schedule | `schedule` | 按周期或单次自动重跑某 todo，每轮触发一个新 build，到确认/审核关口暂停。 |
| 通知 | Notification | `notification` | 桌面浏览器推送 + 站内未读的统称；一个概念、多种投递渠道。 |
| 记录流 | Transcript | `transcript` | build 的有序消息与工具调用记录；是 build 的一面（facet），非独立可操作实体。 |
| 段 | Segment | `segment`（行形 `msg-<stepId>-<n>`） | 一次回合内模型输出的**一段连续同类型增量**（`text` 或 `thinking`）。工具调用是独立记录，不是段。段在**写入端**封口（类型变化 / 工具到达 / 消息结束 / 步收尾），流式期与落库期同源——同一个段既是流式期即时出现的那条行，也是终稿里的那条行。 |
| Token 用量 | Token usage | `tokenUsage` | 按「build × model × 输入/输出/缓存读/缓存写」统计的记账读数；值对象，无自身生命周期。 |

## Chief panel and machine binding

Moved from the former `GLOSSARY.md`. Each entry names the canonical UI word and the words to avoid.

| UI word | English | Definition | Avoid |
|---|---|---|---|
| `总管` | Chief | The resident orchestration agent, one per user × team: it plans tasks, dispatches builds and talks with people. | `主管`, boss |
| `总管面板` | Chief panel | The chief's only conversation surface, shaped as a floating window (ADR 0013). | `抽屉`, drawer, `竖板`, `主管` pane (the first three name the retired right-docked panel; code identifiers such as `chief-drawer.tsx` are cleaned up with #1009 A0) |
| `悬浮窗` | Floating window | A floating card window anchored to the bottom right of the content area: no modal, no scrim, resident across pages, open state persisted (closed by default). Follows the Multica floating chat window. | `悬浮卡`, `浮窗`, `浮层` |
| `常驻` | Resident | How the floating window exists: mounted once in the root layout, not remounted on route change, kept (inert) when closed, open state kept across reloads. | `常开`, `永挂` |
| `最小化` | Minimize | The floating window's only way to collapse: it returns to the bottom-right FAB and keeps its draft, scroll and thread. It is not a destructive close. | `关闭` (for the floating window), `收起` |
| `贴右竖板` | Right-docked panel | Historical (ADR 0004, retired): a full-height panel docked to the right edge that pushed the content column aside. Appears in old tickets and ADRs; not used in new copy. | |
| `让位` | Yield | Historical (ADR 0004 D2/D7/D8, retired): the content column narrowing or pushing the right pane away when the panel opened. The floating window overlays, so nothing yields. | |
| `归属机` | Home machine | The one machine an agent is bound to: all of that agent's steps go to it, and it is required when the agent is created. The only answer to which machine an agent belongs to (ADR 0019). | `绑定机`, `钉选` (the retired mechanism below) |
| `换绑` | Rebind | Moving an agent's home machine to another machine. The target must be able to run the agent (runtime and models present), otherwise the rebind is refused. | `迁移` (short for whole-machine migration, a different thing), `改派` |
| `整机迁移` | Machine migration | Rebinding every agent of one machine to another in one go. Agents that pass the check move; the rest stay with the reason listed. A partial migration is a normal outcome, not a failure. | `撤离`, evacuate (kept in code identifiers, not in copy) |
| `钉选` | Pin | Historical (ADR 0018 decision 4, retired): four separate ways to name an execution machine on a task, build, chief thread or schedule. All retired when home machines landed; appears in old tickets. | |
