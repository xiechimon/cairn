# ADR 0018 · 多 agent 团队三层 + 机器能力闸协调模型

> 状态：**已裁决**（2026-10-12，#1248 定案）。讨论票 #1248；前序 ADR 0017（双执行源）。设计输入：addyosmani/agent-skills 参照仓侦察（#1248 评论七点，见决策 1）。施工票 #1250（层 1 流水线）、#1251（能力上报 + 能力闸），均待本 ADR 合并后开工。
>
> 修订：「合并动作留人」由 ADR 0021（2026-10-20）修订为「合并动作按项目策略归属，默认留人」——`mergePolicy = human` 时本文与 #1256 原样有效。正文不改。

## Problem Statement

pacman 现状是一个 agent 加一个运行时跑完一张 ticket：`assignment` 双槽 `{plan, build}` 只区分规划/执行两个阶段，两张槽可以指同一个 agent——用户明确不要这个形态，要「跟公司里的团队一样」把任务拆成多 agent 组合（角色名用英文），并追问两个机器之间（本机 vs mea）的 agent 归属与 skill/MCP 协调：agent 是哪台机器的？各自的 skill 和 MCP 如何对账？

问题拆成三个正交子题：

1. **票内**：一张 ticket 的 plan/build/review/verify 各阶段由谁干？（单 agent 全包 → 角色流水线）
2. **票间**：大票怎么拆成多张子卡并行推进？（chief 只派单卡的现状 → 拆票 + 依赖边）
3. **跨机**：agent 不绑机器的前提下，怎么保证被派发的步只落到「装得齐它要的东西」的机器上？（mcpServers 声明了没人校验的缺口）

## 侦察事实

| # | 事实 | 出处 |
|---|---|---|
| F1 | `stepKindSchema` 现有五值：plan/build/merge/chief/review——review 步 M7 #312 已建，agentId 走 prompt meta header 不走 assignment 槽；verify 步不存在 | `packages/shared/src/records/step.ts` |
| F2 | `assignment` 为双槽 `{plan, build}`（`assignmentSchema`），扩四步种是纯增量 | `packages/shared/src/records/todo.ts` |
| F3 | agent 级并发闸 #1138 已建（`agentRunningCount`）；机器并发 #1108 已建（maxConcurrent 1..16，PATCH 热写）；#1241 机器推荐并发方案四段已定（写点算推荐值 + `maxConcurrentOverridden`，公式落 dispatch-eligibility.ts） | dispatch-eligibility.ts / 记忆 #1241 plan 四段 |
| F4 | `dispatch-eligibility.ts` 是 claim/sweep 共用判定单源叶子（#881 下沉），能力闸的加钉点 | `apps/server/src/services/dispatch-eligibility.ts` |
| F5 | skills 由 server skillsDir 单源按步下发（`/api/machine/skills/:stepId`）——机器无关已成立 | routes-machine.ts |
| F6 | `agent.mcpServers` 声明在 agent 记录上，但执行机是否实装**无人校验**——协调模型要补的缺口 | records/agent.ts |
| F7 | presence 心跳在 routes-machine.ts；02 §5.4 心跳红线：字段级解析失败不阻心跳（#1241 方案已引用此纪律） | routes-machine.ts / 02 §5.4 |
| F8 | 依赖边：#1248 票面称「看板已有 blocking 边模型」，但代码内未见 blockedBy/dependency 列（schema.ts、todo.ts 均无）——两说并存，实现承载（既有模型还是新建）留 #1250 施工期核实 | 票面 vs 代码 grep |
| F9 | Multica 先例：agent 绑 runtime（机器）+ 保存时能力闸（requireWorktreeCapableDaemon，project_resource.go:151-204）+ 离线/缺能力 reason code 族（dispatch/reason.go） | #1248 票面侦察 |
| F10 | 参照仓 addyosmani/agent-skills（105k stars，SDLC 技能包）七点设计输入（见决策 1） | #1248 评论 |
| F11 | 施工票落位：票面预写「#1249 层 1、#1250 能力闸」——#1249 已被 open PR（ci(1240) pr-tasks-gate）占用，故实际新建 #1250（层 1 流水线）+ #1251（能力闸） | 2026-10-12 gh issue view 实测 |

## Decision

### 0 · 名册定案（1 编排者 + 6 persona，共 7 名）

角色名全英文（用户点名）。每名 description 照 persona 契约写：role / scope / output format / rules + **Composition 块**（经哪个步种入口、禁止被其他 persona 调）——这是设计输入 ① 的落法：Skill=how（server 单源 skills）/ Persona=who（角色 agent）/ Command=when（步种 + chief 派发）三层分离。

| 角色 | 入口 | 职责 | 输出 artifact |
|---|---|---|---|
| **Chief**（编排者） | chief 步 | `split_todo` 拆解 / 派发 / 关口通知 / review 三报告小合并出 go/no-go / 合并裁决建议。**禁施工、禁转述 hop**（meta-orchestrator 反模式——chief 附加值 = 拆解 + 关口 + 合并裁决，不做纯路由） | 派发决策、拆解方案、go/no-go |
| **Planner** | plan 步 | 读票 + 仓出 plan.md 四段，不碰代码 | 方案文档（plan.md） |
| **Implementer** | build 步 | 按 plan 薄垂直切片 TDD 逐条 commit，开六节 body PR | 分支 + PR |
| **CodeReviewer** | review 步（fan-out 三视角之一，并行只出报告不改码） | 五轴 review + severity 标签 | review 报告 |
| **SecurityAuditor** | review 步（fan-out 三视角之一） | OWASP 式审计；diff 触 server/auth/crypto 时参战 | 安全审计报告 |
| **TestEngineer** | review 步（fan-out 三视角之一） | 覆盖缺口 + Prove-It | 缺测清单 |
| **Verifier** | verify 步（新增） | 跑 docs/verify/<票号>/ e2e + pr-evidence-gate + CI 对账，输出证据包 + pass/fail；与 TestEngineer 分工 = 读 diff 批评 vs 跑真系统取证，artifact 不同故分设 | 证据包 + pass/fail |

- **WebPerf 不设 agent**——作 Verifier 的条件 skill hop（diff 触 apps/web 时跑），不是 persona。
- **合并动作留人**（协调者），不在名册内。
- **硬律：personas do not invoke other personas**（设计输入 ②）——chief 是唯一编排者；角色 agent 结构上无派发工具（不挂 run_builds 类工具面），编排单层。
- 模型档位按角色注记（Chief/Planner 高档、Implementer 中高档、review 族中档、Verifier 中档——具体档位值由 #1250 seeding 时按当时模型清单定，本 ADR 只定「按角色注记」的结构）。

### 1 · 层 1：票内流水线

步种 → 角色挂接：plan→Planner / build→Implementer / review→Reviewer 族（fan-out 三视角，见下）/ **新增 verify→Verifier**。`assignment` 从双槽扩四步种槽位。

- **confirm/merge 关口留人**：`/build auto` 先例（设计输入 ⑥——plan 一次批准、逐任务 TDD、失败即停）与 pacman 既有 confirm 关口同形；唯一人工步留在 confirm，流水线其余全自动。
- **review fan-out 三视角**（设计输入 ④）：PR diff 上并行 CodeReviewer/SecurityAuditor/TestEngineer，只出报告不改码；**小合并步**（chief 持全上下文）出 go/no-go。同一 artifact 上并行独立视角 + 小合并是唯一认可的 fan-out 形态。
- **review 槽承载**（F1 设计点钉法）：review 步现有 agentId 走 prompt meta header（M7 #312 定，不走 assignment 槽）语义**不动**；assignment 扩的 review 槽是缺省挂接位（UI 指派面用），fan-out 三视角仍经 meta header 派生（一次 fan-out = 三条 review 步、各带视角 agentId 的 meta header）——槽位管「默认谁审」，meta header 管「这一条步实际跑谁」，两层正交。verify 步走 assignment 槽（与 plan/build 同形）。四槽扩展不得破坏 meta header 语义。

### 2 · 层 2：票间拆解

chief 加 `split_todo` 工具：大票拆 N 子卡 + 依赖边（F8：票面称看板已有 blocking 边模型、代码未见对应列——实现承载留 #1250 施工期核实，按看板 blocking 边口径入账），子卡各钉角色 agent，**子全 done 父自动收**。拆解方案进 confirm 关口给人审（过拆防线见 Premortem 3）。

**拆解判据 = 决策矩阵**（设计输入 ⑤）：单视角单 artifact = 直调；子任务真独立 = 并行 fan-out；有序依赖 = 顺序依赖边。

### 3 · 层 3：并行

角色 agent 各自 `maxConcurrentTasks`（#1138 agent 级闸）+ #1241 机器推荐并发（机器级闸），两层叠加跨机并行自然成立：同一 persona 的多张子卡分到多台机器，每台机器内又被 maxConcurrent 封顶。#1241 公式与写点方案以其 plan 交接物为准，本 ADR 只引用不重定义。

### 4 · 协调模型（agent 与机器/skills/MCP，答用户问）

**agent 不绑死机器**（保留跨机弹性——这是与 Multica「agent 绑 runtime」先例的刻意分叉：pacman 的 agent 是 team 级记录，执行位由派发闸决定）。定案 = **能力声明 + 派发闸**：

1. **daemon 注册/心跳上报能力清单**：已装 MCP server 名集、skills 版本、模型二进制与档位。字段级解析失败不阻心跳（F7 红线沿用到能力字段——能力上报是增强信号，坏一条不能打死心跳通道）。
2. **agent 记录加 `requiredCapabilities`**：声明该 agent 的步需要什么（MCP server 名、runtime/模型档位等）。
3. **dispatch-eligibility 加能力闸**（F4 单源叶子，票面指定加钉点）：机器能力清单不满足 `requiredCapabilities` 的，不领该 agent 的步。闸只看 server 侧已收到的上报快照（Premortem 2 护栏）。
4. **pending 配可见 reason**（抄 Multica dispatch/reason.go 族语义）：缺能力 = 给修法（reason 文案指名缺什么、装了即解锁）；机器离线 = 等（reason 区分「等机器上线」与「缺能力装 X」两种 pending 成因，不再让步静默无期 pending）。
5. **skills 维持 server 单源**按步下发（F5 已成立，不动）。
6. **MCP 由能力上报对账**：agent 面显示「哪些机器可跑它」= requiredCapabilities × 各机上报清单的交集。平台事实佐证（设计输入 ⑦）：plugin agents 的 mcpServers frontmatter 被静默忽略——MCP 协调必须在机器/daemon 层做，写不进 agent 定义面。

## Premortem（假设本裁决错了，三个最可能的死因）

1. **review fan-out 三视角报告合并时上下文丢失**——三报告各自截取 diff 的不同面，合并者只拿摘要会丢跨视角关联（如安全发现其实源于测试缺口）→ 护栏：小合并步（chief）持全上下文（三报告 + diff）出 go/no-go，不是纯投票；chief 的合并裁决是名册里点名的能力。
2. **能力清单上报漂移**——机器装了没报（daemon 版本旧）、报了没装（卸载后清单滞留），能力闸按错清单放行/错杀 → 护栏：心跳字段级容错（坏字段不阻心跳）+ 闸只看 server 侧已收快照（不信任机器自报以外的任何路径）；真装没报导致错杀时，可见 reason 会指名「缺 X」，人修法即闭环。
3. **拆票粒度失控**——chief 把票拆太碎（每子卡一个文件级改动），confirm 人审关口被 N 张子卡淹没，协调开销吃掉并行收益 → 护栏：拆解方案进 confirm 人审（人可以驳回整棵拆解树）+ 决策矩阵判据（单视角单 artifact = 直调，不拆）；「子全 done 父自动收」保证收口不会被漏。

## 与 ADR 0017 的关系

0017 裁决双执行源：githubRepo 恒为真值源，localPath 是同机执行加速位（机器选源双条件判定）。0018 与它正交不冲突：**0017 回答「仓从哪来」，0018 回答「谁来干、在哪台机干」**。选源判定先于能力闸——机器先决定用本地加速位还是 GitHub clone（0017 的 remote/HEAD 对账），再判能否领这条步（0018 的能力闸）；localPath 命中的机器若缺能力，步照常 pending 给别的能力齐机器（走 GitHub clone 源），两条判定不互相改写。0017 的可丢性归属（真值与可丢性只属于 githubRepo）不受能力闸影响。

## 施工票拆分

| 票 | 范围 | 依赖 |
|---|---|---|
| **#1250** server,shared,web | 层 1 流水线：四步种（含 verify 步新增）+ 四槽 assignment + persona seeding（7 员 description 按 Composition 契约）+ chief split_todo（含依赖边承载核实，F8） | 待本 ADR 合并 |
| **#1251** daemon,server | 能力上报（daemon 心跳扩展）+ requiredCapabilities + dispatch-eligibility 能力闸 + 可见 pending reason | 待本 ADR 合并；与 #1241 推荐并发同钉 dispatch-eligibility.ts，施工顺序对齐 |

**落位注记（F11）**：#1248 票面预写的施工号是「#1249 层 1、#1250 能力闸」；因 #1249 已被 open PR（ci(1240) pr-tasks-gate）占用，实际新建号为 **#1250（层 1）/ #1251（能力闸）**。后来者按票面旧号找不到票时，以本表为准。
