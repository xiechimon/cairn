# R14 · 编排拆分的父卡去留：三路取证与建议（XMON-98 拍板点 1）

> 票：XMON-98「保存并开始」后 agent 行为（Multica 票，平台已停用；决策链由 r12 承接）。本篇只闭合拍板点 1（父卡去留），其余拍板点 2–7 维持 r12 §5.1 已拍裁决。
> **前置裁决（用户 2026-10-02 原话，经协调线程转达）**：「关于开始任务这边的执行与规划，用不同的 agent，你这个按钮不要再给我了。开始任务时，你也不要再给我选择，直接默认、直接执行、直接去规划。我的一个总管 agent 可以直接开始规划，然后根据实际的活儿，派发给前端 agent、后端 agent，或者什么验证 agent 之类的 agent。」——r12 那道「直接执行 vs 先后台编排」的题就此答死：**编排为唯一默认路径**，开始任务面不再给用户二选一。本篇的建议建立在这个前提上（父卡即这段编排过程的对象）；入口面按钮/开关的移除属实现票，不在本篇。
> 性质：决策材料，非实现。只读调研 + 参考站最小写实验（已清理），产品代码零改动。
> 代码基线：`origin/main` = `ee636a5`（2026-10-02；本分支即此 tip）。P 侧行号全部在此基线逐行核实。
> 前序：`r12-save-and-start-behavior.md` §5.2 给出双方立场（用户「只要子卡、不要父卡」vs 反提案「父记录=会话、看板不渲染、子卡带来源字段」），本篇按用户要求做三路实证后拍建议——todos.dev 怎么做 / 其他同类怎么做 / herdr 当前怎么做，然后给推荐与反例批判。
> 取证执行：三路各一条独立调研线程（L-A/L-B/L-C），证据原文与截图归档 `docs/research/assets/r14/`。

## 0. 阅读约定

出处四类，逐条标注：

- **P**（pacman 代码）= `路径:行号`，2026-10-02 在 `ee636a5` 逐行核实。
- **L-A / L-B / L-C**（三路取证）= 调研线程产物，正本归档：
  - L-A `docs/research/assets/r14/raw/xmon98-laneA-todos.md`（todos.dev：仓内归档重解析 + 活体 API/浏览器取证 + 拆分实验）；
  - L-B `docs/research/assets/r14/raw/xmon98-laneB-others.md`（Multica 官方文档快照一手 + GitHub/Linear 官方 docs live 抓取，留档同目录 `xmon98-gh-*.md` / `xmon98-linear*.md`）；
  - L-C `docs/research/assets/r14/raw/xmon98-laneC-herdr.md`（herdr/herdr-projects 本机只读取证）。
- **W**（wiki 转引）= `~/.agents/wiki/wiki/todos.dev 与 Multica 对照.md`（2026-09-30 两边官方文档全量精读产物），本篇引用、未重拉原文。
- 未经复核的转引标 `[转引]`，判断标 `[推断]`；L 系证据分级沿用各产物自身的 `[实测]/[归档转引]/[推断]` 标注。

截图索引（`docs/research/assets/r14/`）：参考站活体捕获（2026-10-02）——`11-todo12-card-zoom.png`（看板卡「由总管创建」芯片特写）、`15-board-after-split.png`（拆分实验后看板）、`14-chief-round1-receipt.png`（拆分回执）、`12-chief-chat-expanded.png`（chief 会话面板全貌）、`03-todo12-detail.png`（详情页全文——零来源呈现）、`10-cdp-board.png`、`06-board-with-chief-created-chip.png`、`13-chief-gap-exp-round1.png`；用户供给——`07-start-task-dialog-user-shot.png`（当前「开始任务」弹窗，即前置裁决中要撤掉选择的面：双分支按钮与指派选择器，代码面 `overlays.tsx:322,329`，载荷 #318）。

## 1. 判定问题与既定约束

**前提（用户 2026-10-02 已拍）**：编排是唯一默认路径——每个「开始任务」（含「保存并开始」）都过总管编排回合：总管直接规划，按活的类型派给前端 / 后端 / 验证等专职 agent，入口不给选择。这同时修正 r12 §5.1 拍板点 4 的后半句（「对话框加用户开关」作废——入口无开关），并把「每次开始都产生一个编排回合」变成常态。据此本篇的问题重述为：**这段编排过程的对象（父）该不该出现在看板；派发出去的专职 agent 各自的任务卡怎么归属**——这才是父卡问题的实质。

三个候选形态：（a）父卡对象并渲染看板；（b）父记录存在但不渲染；（c）父不存在、只有子卡。连带：数据面怎么表达归属、完成判定挂哪、原文锚点在哪。

**P 侧既定事实**（约束面，全部 2026-10-02 在 `ee636a5` 重核）：

1. `todo.sourceTodo` 休眠列存在但恒写 null（`apps/server/src/db/schema.ts:81`；`apps/server/src/services/todos.ts:224`）。激活它 = 把父子关系抬进领域模型。
2. 来源家族已有：`sourceKind` 枚举现仅 `['github-issue','github-issue-self']`（`packages/shared/src/records/todo.ts:43`），`sourceRef` 形如 `github:owner/repo#123`（格式单源 #446）；详情页有来源面板（`apps/web/src/detail/source-issue.tsx:26`——`sourceKind === null` 即整块不渲染）；看板卡片当前无来源标识。
3. `CONTEXT.md:31` 现裁决：「无 Goal 概念——工作单元只有一个，即 todo」；「来源」词条定义为「todo 的**外部**出处」。
4. Chief 建卡溯源已实装且对齐参考站：`create_todo` 落 `createdBy = ctx.chiefAgentId`、`sourceBuildId = ctx.chiefId`（`apps/server/src/services/chief-tools.ts:369-375`）——但 `sourceBuildId` 是 chief **实例** id（`chief-<userId>-<teamId>`，跨全部请求共用），**答得出「谁建的」、答不出「哪次请求拆的」**；`create_todo` 工具无 sourceKind 参数面。
5. Chief 会话面板已存在（`apps/web/src/overlays/hotkeys.ts:89-94` ⌘J 抽屉；#619 刚做过总管抽屉闭环）——「整个请求」的聚合视图有现成落点。
6. 相位九值无「编排中」（`apps/web/src/phase.ts`）；Build≡Conversation（执行与消息流同一实体两面，CONTEXT.md 边界裁决）；GitHub-backed 项目每 todo fire-and-forget 建镜像 issue（`apps/server/src/services/todos.ts:242`）。

## 2. 三路取证

### 2.1 todos.dev（参考站——语义轴对齐对象）

来源：L-A（环境：team free 档，chief 绑定 Agent r3-builder，tds CLI 0.1.53；活体含唯一写操作=拆分缺口实验，r98 标记，事后已清理——实验卡删除、daemon 停、参考站回到实验前状态）。

1. **父概念四层全无** [L-A 实测]：
   - API：todo doc 字段集 20 键（19+v）无 parent/parentId/goalId/epicId 任何形态——活体 `GET /api/teams/{id}/progress` 重放 + r5 时代抓包 5 张 doc 交叉验证（字段集两代一致）。
   - Chief 工具词表：49 键（活体 `toolDefHashes`）无 create_parent/goal/epic/subtask 类工具。
   - docs/MCP 能力面：写工具 13 件、能力六组，无 parent 概念（`r3-protocol-executor.md:208,216`）。
   - UI：看板 6 相位列平铺卡片（`r2-app-ui-inventory.md:147-165`）、详情页字段清单、新建表单均无父引用；营销站 21 条功能卡无 epic/goal/milestone 字样（`r1-site-inventory.md:124-125`）。
2. **拆分实验** [L-A 实测]：自然措辞「一份文档 + 一个代码功能」（两件互不依赖的跨类型交付物）→ Chief 回合 46s 拆 **2 张 todo**（#23/#24），按职责文本分派（代码→r3-builder、文档→r5-scribe），派工即 `withPlan:false` 直接执行 + 自动挂 watch。看板渲染 = **2 张平级卡落相位列、随相位各漂各列**（#23→review、#24→failed），无父行/分组/容器卡，唯一共同视觉是同项目芯片（`15-board-after-split.png`）。回执在会话线程内，列两张卡的实体芯片（`14-chief-round1-receipt.png`）。
   - 对照 r5 时代「三件同类小事」→ **1 张** todo（标题 `+` 连接，`r5-chief-behavior.md:60`）——**拆不拆是 Chief 按请求结构自裁**：同类小事项合并、跨类型可独立验收的交付物拆开，无用户确认闸。
3. **溯源三层** [L-A 实测]：
   - 机器字段：`createdBy` = chief 绑定 Agent id（人手建卡该字段=用户 id，活样本对照）；`sourceBuildId` = **chief 记录 id，不是线程 id**——#12（线程 A）与 #23/#24（线程 r98）三卡同值。「子卡→具体哪次会话」的链接只存在于 ①会话消息里的 `[#N](todo:<id>)` 实体引用、②watch 记录的 `threadId`（watch 在 settle/failed 后自动解除——解除后即无持久链接）。
   - spec 结构：`> 归一化改写后的本子任务相关片段`（非逐字全文，「第一件/第二件」被剥掉、冠以请求主题）+ `要求：` bullet + **兄弟任务的文字交叉引用**（无数据字段）。逐字原话只保存在 chief 会话的 user 消息里。r5 §3.2（#11 spec 三段式）同构。
   - 可见呈现：看板卡底行一枚「**由总管创建**」芯片（`11-todo12-card-zoom.png`；2026-10-02 新观测，r5 时代无此芯片——UI 演进新增）；**详情页零来源**（`03-todo12-detail.png` 全文核）。
4. **容器 = chief 会话** [L-A 实测]：入口两处（侧栏「工作台」+ 看板头「展开总管聊天」，`12-chief-chat-expanded.png`）；user 消息逐字存原话（唯一逐字存档处）；gate/settle/failed 的全部 wake 汇报回流该线程（r5 §3.5：review 停关 1 秒内 chief 领 wake step 在线程内汇报）。无任何其他「请求级」视图：看板不聚合、项目页任务 tab 平列表、搜索无请求分组。

### 2.2 其他同类（Multica + GitHub sub-issues + Linear）

来源：L-B（Multica = wiki raw 官方文档快照一手复核，`~/.agents/wiki/raw/sources/2026-09/2026-09-30-todos-vs-multica-docs/multica/`；GitHub 四页 + Linear 两页 = 2026-10-02 agent-reach Jina live 抓取复核，留档 `assets/r14/raw/xmon98-gh-*.md`、`xmon98-linear*.md`）。取证细节（issues.txt/cli.txt 行号、REST 端点、Display Options 引文）全在 L-B 原文，本节只收裁决相关结论。

1. **三家共同形态**：父 = 一张真实 issue（渲染成卡/条目）；子 = 完整 issue（自己的编号/assignee/状态/执行历史）；**归属一律存子票上的显式关系字段**（Multica `--parent`/`--stage`、GitHub REST+gh CLI+Projects 字段、Linear parent 字段+属性继承）。没有一家把父做成纯会话或纯记录。
2. **分歧只在两条轴**：父子状态联动（Multica 无 / GitHub 无 / Linear 团队级可选双向）× 看板折叠（不折叠 / 不折叠 / 可隐藏子票）。
3. **Multica 的窄化**（issues.txt:101 原话「Parent and child statuses do not affect each other」）：父卡语义被窄化为三件事——总目标正本（「the parent issue keeps the overall goal」）、leader 核收线程（XMON-92 活样本：派发回执/核销汇报全落父票评论区，核收权在 leader）、stage 屏障唤醒锚点（最早未完成 stage 的子票全关时通知父票订阅者并唤醒 leader）。父票翻 `in_review` 归 leader、`done` 归人或 PR；通知只冒泡状态变更不冒泡评论。
4. **GitHub 的窄化**：纯数据关系 + 只读聚合——子票区嵌父票描述底部、`Sub-issues · 1/3 (33%)` 进度行、子票头部常驻回链；Projects 里父与子**各自是独立 item**，靠 group by "Parent issue" / filter 表达层级；无状态联动记载。上限 100 子票 / 8 层嵌套。
5. **Linear 的窄化**：子票显示是视图层开关（列表里只显示父与无父票）；rollup 是团队级 opt-in（子全 done→父 done / 父 done→子全 done，双向可分别开）；拆票是父票详情页一等动作（保存一张自动开下一张）；**「父转 project」**= 容器升级官方先例（父大到不该是一张卡时换容器类型并解除父子关系）。
6. **L-B 对 pacman 的判词**：反提案（来源字段 + 会话容器）在 issue 系家族里无先例，等于把 Multica 父卡的三职能（原话锚点/核收线程/唤醒锚点）拆出去另设容器——「属无人走过的形态，落地时三承接点需自证」。

### 2.3 herdr / herdr-projects（用户自己的协调系统）

来源：L-C（只读取证：`--help` / list / show / overview / context + Read；herdr client 0.9.3 / server 0.9.1 / 插件 0.2.34；取样项目 = pacman 本身，本调研线程即其 t-0033 线程——自己就是活样本）。

1. **对象**：项目 = 磁盘文件夹（PROJECT.md/TASKS.md/memory/threads/…）+ 一个 cwd 钉在文件夹里的常驻 coordinator agent；线程 = `threads/t-NNNN.toml` + `.task.md`（任务书 + 全部 follow-up prompt）+ report `.md` 三件套挂一个 herdr pane。
2. **父/子词汇不存在**：线程记录 48 字段里**零个父引用**；唯一连结是 TASKS.md 任务行行尾可选后缀 `· t-NNNN`——**做完即删的指针**，历史沉淀在线程记录里（resolved 27 条 overview 永久在列）。
3. **项目从不渲染成卡/行**：四个界面（TUI 侧边栏分组头、projects popup scope、tab bar 计数、overview 标题行）全部是容器形态；状态（idle/working/blocked、percent）全长在线程上；工作单元永远是线程。
4. **完成判定外包**：任务行由用户口述/coordinator 删、PR merged 由 ticker 自动 resolve——没有「全子绿=父解决」自动聚合语义。
5. **结构差** [L-C 推断]：herdr 的会话容器是 **per-project 常驻 coordinator**，不是 per-request；per-request 溯源靠 per-thread `.task.md` 任务书 + 命名嵌 slug（记录目录/worktree 名/thread_dir 名/sidebar token 四处重复、零引用字段）——等价于 sourceKind 路线而不带字段。

## 3. 交叉对照

| 轴 | todos.dev（参考站） | Multica | GitHub sub-issues | Linear | herdr |
|---|---|---|---|---|---|
| 父对象 | **无**（四层零概念） | issue（一等部件） | issue | issue | **无**（项目=文件夹+常驻会话） |
| 父在看板 | —（看板只有 todo） | 五视图同渲普通卡 | 父子各自独立 item | 可视图层隐藏子票 | 项目=分组头/scope/计数 |
| 归属存哪 | 子卡机器字段（chief **记录级**）+会话实体引用+watch threadId（瞬态） | 子票 `--parent`/`--stage` | 子票 parent 关系（REST/CLI/Projects） | 子票 parent+属性继承 | 磁盘布局+命名（4 处、零字段）+任务行后缀（易逝） |
| 状态联动 | — | 零联动（leader 协议管父） | 零联动（只读聚合） | 团队级可选双向 | —（人+ticker） |
| 请求容器 | chief 会话（逐字原话+回执+全 wake 回流） | 父票评论区 | 父票描述底部子票区 | 父票描述下方 | coordinator 常驻会话（per-project） |
| 完成判定 | — | leader 人工核收 | 计数显示（不联动） | opt-in 计数 auto-close | 人+ticker（PR merged 自动 resolve） |
| 可见溯源 UI | 看板卡「由总管创建」芯片 | 子票挂父票下（关系即显示） | 子票头部常驻回链 | 子票列表+filter | 侧边栏分组 |

**两极**：参考站与 herdr（**容器非卡**：会话/文件夹是父，子才是可见工作对象）vs issue 系三家（**父=卡 + 语义窄化**：状态不联动、显示可关、聚合只读）。pacman 的语义轴已钉在 todos.dev（spec 18 定位两轴：语义对齐 todos 三点核心），且看板模型（相位列=执行单元）与 issue 系（自由状态+视图自由分组）不同构——这决定了下面的取向。

## 4. 别的做法错在哪

先立界：三家在自己的语境里都自洽（issue 是人手写的规划对象、父票先于工作存在、视图层自由分组）。下面列的是**对 pacman 语境**的错处——pacman 的入口是「对话框里一句请求」，拆分发生在 agent 侧、产物落相位机看板。

**Multica（父卡=看板实体，三职能全压父卡）**：
1. **状态双轨**：父票有自己的状态、平台不联动，leader 协议被迫背一条「只在整体达成时翻 in_review」的责任——父状态是可从子票推导的信息的劣化副本，多出一类 drift 失败（父 in_progress 而子全绿），而修正它靠 prompt 纪律不靠机制。
2. **原文锚点被混流掩埋**：父票线程既是编排会话载体（派发回执/核收汇报/兜底唤醒全落评论区），原话就和新事件流共线——XMON-92 活样本里用户原话被派发回执顶到深处。锚点要的是稳定地址，不是热闹地址。
3. **看板上多一个不可执行位**：pacman 相位九值没有一个能描述父卡——它没有自己的 plan/build/review，落哪列都是谎；且每请求核销次数 +1（先父后子），正是用户直觉要删的噪音。

**GitHub sub-issues（纯数据关系+只读聚合）**：
1. **WIP 双计**：父与子在 Projects 里各自是独立 item——3 子任务请求 = 4 行；父票带进度显示却无执行语义，占位不干活。
2. **计数聚合给假完整感**：`1/3 (33%)` 只数已关子票——**漏拆的那张根本不在分母里**。r12 §5.4 死因 4（错拆/漏拆静默通过）在计数 rollup 下不是被对冲而是被放大。

**Linear（可隐藏+可选联动）**：
1. 双向 auto-close 把上一条公式化到极致：**子全 done → 父自动 done**——把语义核收降维成计数闸，「全绿=解决」恰是要防的假信号。
2. 但它贡献两个**正向**反例：子票显示做成视图层开关（显示问题不上升为对象模型问题）；「父转 project」官方承认卡不是万能容器——容器大到不该是一张卡时换容器类型，而不是让父卡膨胀。

**herdr（正向样本）**：容器=会话/文件夹、子=工作单元、任务行=做完即删的指针——「父是容器、子才可见」在 27 条 resolved 线程的日用量下运转良好。完成判定外包给人+ticker，不做计数聚合。

**todos.dev（推荐形态，两处欠账 pacman 应补而非照抄）** [推断]：
1. **per-request 链接不持久**：`sourceBuildId` 只到 chief 记录级；「子卡→哪次会话」靠会话内实体引用与 watch threadId 传递，watch 在 settle/failed 后自动解除——重拆/聚合场景下链接即失。pacman 若照抄，驳回重拆与「按请求看全貌」都只能靠文本搜索。
2. **详情页零来源**：卡片芯片之外，从子卡详情页找不到「这张卡从哪来」——发现路径依赖用户知道去开 chief 面板。

## 5. 建议

**一句话：父卡不引入、看板不渲染任何父容器；「父」= 编排会话（chief conversation）+ 子卡持久来源字段（sourceKind 家族扩 `orchestration`，sourceRef = 编排会话 id）；不激活 sourceTodo、不加相位、不做计数 rollup。**

即 r12 §5.2 反提案路线，本篇三路取证后确认成立，且比参考站多走一步（per-request 持久字段——补它的两处欠账）。

**前置裁决给这条结论加的码**：编排既然是每次开始的常态，父卡就不再是「复杂请求的附属品」而是**每任务恒 +1 的看板对象**——单任务裁定（总管判不拆，1 张卡指派一个专职 agent）也要配一张父卡才自洽，等于给产品加一道人人可见的仪式对象。反过来，容器=会话在这前提下**渲染成本恒为零**：不拆时就是一张普通卡（无容器语义），拆了才会话面板多一轮线索——编排的可见性随拆分发生才出现，正好匹配「拆分是总管自裁、多数请求不拆」的实测形态（§2.1.2：同类合并、跨类型才拆）。专职 agent 派发机制现成：职责文本权重分派（r5 §3.3 实测 + pacman chief 系统提示分派策略段）。

### 5.1 对象面：不引入父卡

- 对齐参考站四层零概念实测（§2.1.1）+ 用户直觉（父卡=核销次数+占位噪音）；前置裁决下（每任务都编排）这层直觉从「噪音偶尔出现」升级为「噪音恒定出现」，不引入的结论更硬。
- `CONTEXT.md`「无 Goal 概念」裁决不动——会话不是 todo，不新增工作单元类；看板保持「一卡 = 一可执行工作单元」。
- 不加「编排中」相位：父卡没有自己的 plan/build/review，九相位无一适用（§4 Multica 错处 3）；单任务裁定不拆时 = 1 张卡由总管指派专职 agent 直接执行（withPlan 沿 r12 拍板点 5 = false），看板体验与一张普通卡一致、无容器语义。

### 5.2 容器面：编排会话

三承接点全有现成机制（对 L-B 判词「三承接点需自证」的正面回答，全部 P 侧已核）：

| Multica 压在父卡上的职能 | pacman 承接物 | 依据 |
|---|---|---|
| 总目标正本 | 会话 user 消息（逐字、稳定地址）+ 子卡 spec 内嵌归一化片段 | 参考站同构（§2.1.3：逐字原话只在会话，子卡 spec 是归一化引语）；spec 三段式 = r5 §3.2 实测样本 |
| 核收线程 | 会话本身：拆分回执列实体芯片，gate/settle/failed wake 全回流 | r5 §3.5 实测（review 停关 1s 内会话内汇报）；pacman chief 会话面板已存在（P 事实 5） |
| 唤醒锚点 | 派工即自动 watch（带 threadId）+ set_wake 定时兜底 | r12 §1.3b（49 词表含 watch/wake，`run_builds` 派工即 watch 现成）；参考站活体同构（§2.1.2） |

编排 prompt 纪律（拆分护栏，进实现票）：**拆分粒度 = 核销次数**——按可独立验收的成果拆（参考站实测：跨类型交付物拆 2、同类小事并 1）；子卡 spec 必须内嵌原文片段引语 + 兄弟任务文字交叉引用（参考站 spec 结构同构，§2.1.3）。

### 5.3 数据面：来源家族扩一档（比参考站多走的一步）

- `TASK_SOURCE_KINDS` + `'orchestration'`；`sourceRef` = 编排会话 id（per-request 粒度，格式沿 #446 单源纪律在实现票定死，形如 `chief:<conversationId>`）。
- **为何比参考站多**：参考站实测证明实例级字段不足以答「哪次请求」（§2.1.3：三卡跨两线程同值；watch 解除后链接消失）。pacman 的驳回重拆（回到原话重新拆）、按请求聚合、来源面板都需要持久查询能力——成本是一个枚举值 + 一个 ref 格式，零 migration、零新对象。
- `createdBy`/`sourceBuildId` 维持现语义（谁建的）；`sourceKind='orchestration'` + `sourceRef` 答「哪次请求拆的」——三层各答一问，不混。
- `todo.sourceTodo` 保持休眠：激活 = 把父子抬进领域模型，正面撞「无 Goal 概念」裁决，还要回答「父 todo 的 phase 语义」这个无解题。留作记录在案的备选，重开触发条件见 §5.6。

### 5.4 UI 面：对齐参考站已演进出的事实

- **看板卡片「由总管创建」芯片**：参考站 2026-10 已新增的可见溯源（§2.1.3、`11-todo12-card-zoom.png`）——pacman 直接对齐，回答「agent 拆的卡与人手建的卡怎么区分」。
- **详情页来源面板加 orchestration 渲染**：链到编排会话面板。这里比参考站多给（它详情页零来源）——因为 pacman 的 sourceRef 有会话粒度、来源面板家族已存在（`source-issue.tsx` 同族），成本是一格渲染。
- T0 反馈（点击「保存并开始」后「我的东西去哪了」）沿用 r12 §5.3 已定的短命 toast。

### 5.5 完成判定：会话内自检，不做计数闸

- 最后一子卡 settle → chief 在会话内发覆盖度自检总结（对照原话逐条核拆分完整性）——**消息不是闸**；发现缺口走 `notify_user`（不只静默在会话里说）。
- 不采纳 Linear 式 auto-close（§4：计数闸给假完整感）；核收权在人——对齐 Multica leader 核收语义，但不为它付一张父卡。

### 5.6 明确不做清单与重开条件

不做：父 todo 对象、「编排中」相位、看板父子分组/折叠、父子状态联动、计数 rollup、激活 sourceTodo。

**重开父卡路线的触发条件**（记录在案）：将来出现「请求级甘特/泳道/portfolio 视图」这类**跨请求、时间轴维度**的需求（Linear convert-to-project 位——容器大到不该是会话时换容器，届时再议父子对象）。看板内的请求级聚合不构成触发条件——那是 filter 能答的问题（见 premortem 3 的护栏）。

### 5.7 影响面（实现票范围；本 PR 零码改）

- **入口面（前置裁决的落地，另开实现票）**：卡片级「开始任务」双分支撤销（`overlays.tsx:322,329` 的「先做规划/立即执行」两钮 + 指派选择，载荷 #318）——单按钮直发总管编排回合；新建对话框「保存并开始」同语义（首步入队编排步，替换现状写死的 `withPlan:true` plan 步，`use-new-task-surface.ts:165`）。用户参考截图：`assets/r14/07-start-task-dialog-user-shot.png`。
- `packages/shared`：`TASK_SOURCE_KINDS` +1 值（`records/todo.ts:43`）→ zod schema JSON 投影变 → **snapshot.test 必红**，本地 `vitest run test/snapshot.test.ts -u` 更新后逐块核 diff 再推（动 shared schema 槽的既定纪律）。
- `CONTEXT.md`：「来源」词条「外部出处」→「出处（含编排来源）」；「无 Goal 概念」不动。
- server：编排步接线处（`startBuilds` withPlan 分叉，r12 §5.3 系统视角时序）+ `create_todo` 落 `sourceKind`/`sourceRef`（工具 schema 加可选参数，或编排步建卡路径 server 侧自动落——实现票定）；拆分纪律句进编排 prompt。
- web：卡片「由总管创建」芯片 + 详情来源面板 orchestration 渲染（链会话面板）。
- 兼容性：zod enum 扩值——旧版本 daemon/CLI parse 新值会 validation 失败；自托管单用户滚动升级风险低，实现票核一遍版本交错窗口。
- 无 DB migration：`sourceKind`/`sourceRef` 列已在；`sourceTodo` 不动。
- GitHub 镜像面（开放问题）：GitHub-backed 项目每 todo fire-and-forget 建镜像 issue（P 事实 6）；子卡镜像天然各自独立 issue、无父 issue 可挂。将来要 GitHub 侧聚合时，在镜像层加 sub-issue 关系即可（外部表达，不动 pacman 模型）——不在本裁决范围。

### 5.8 为何不是另外两条路（反方最佳论证与回应）

1. **「父卡+窄化是主流，反提案无先例」（L-B 判词）**——回应：pacman 语义轴钉在 todos.dev（spec 18），参考站本身就是容器形态且日活运营中；「无先例」只在 issue 系家族内成立，pacman 不在那个家族（相位机看板 vs 自由状态+视图分组，§3）。herdr 作为用户日用系统给出了容器形态的第二个活样本。父卡路线的四个代价（新工作单元类 / 相位语义无解 / 核销 +1 / 状态双轨或计数闸）换一个「看板内聚合显示」，而聚合已有会话面板承接。前置裁决（编排常态化）把这杆秤再压一档：四个代价从「复杂请求才付」变成「每个任务都付」。
2. **「纯子卡零容器」（用户直觉的极端版）**——回应：丢三样（r12 §5.2：原文锚点/完成判定/溯源区分），参考站也不这么走（它有 chief 会话容器）。本建议保住用户直觉的实质（看板只见子卡、零额外核销），容器挂在用户看不见的层。

### 5.9 Premortem（假设三个月后失败，最可能死因与护栏）

1. **漏拆静默通过**（全绿 ≠ 解决）→ 护栏：最后一 settle 的会话内覆盖度自检 + 缺口 `notify_user`（§5.5）。
2. **用户找不到「我的请求去哪了」**（会话面板入口深）→ 护栏：卡片芯片 + 详情来源面板链会话 + T0 toast（§5.4）。
3. **聚合可扫视性不足**（放弃看板 rollup 的代价显形）→ 护栏：先会话面板；不够再加「按来源会话过滤」的看板 filter——视图层解决，不上升为对象模型（Linear 启示，§4）。
4. **sourceRef 格式漂移/两处写** → 护栏：#446 单源纪律，格式实现票定死（§5.3）。

## 6. 证据核对明细

- **P 侧**：全部 file:line 于 2026-10-02 在 `ee636a5` 逐条核实（sourceTodo 休眠 / sourceKind 家族 / CONTEXT.md 裁决 / create_todo 溯源 / ⌘J 抽屉 / 相位九值 / 镜像 issue）。
- **L-A**：todos.dev 活体（API 重放 + ego-browser/CDP 截图 + 拆分实验全记录）；实验写操作已清理（实验卡 DELETE 204 ×2、回读 progress 复原、daemon 停）；黑屏废片已剔除，归档 8 张有效截图均走 CDP 捕获。仓内引用 r1/r2/r3/r5/r5b/r8 + `assets/r5/raw/` 重解析。
- **L-B**：Multica 六页官方快照一手复核（行号钉死）；GitHub 四页 + Linear 两页 agent-reach Jina live 抓取复核；两处原 `[转引]`（Linear display-options、GitHub Copilot 页）已补抓升复核，留档在 `assets/r14/raw/`。
- **L-C**：全程只读（`--help`/list/show/overview/context + Read），无任何写状态命令。
- **用户裁决（前置）**：2026-10-02 原话经协调线程转达（见篇头引用），指导本篇问题的重述；供给截图 `07-start-task-dialog-user-shot.png` 归档于 `assets/r14/`（读图通道对本调研不可用，弹窗结构按代码面 `overlays.tsx:322,329` 与 r12 §1.3 描述引用）。
- **W**：wiki 页转引（官方文档精读产物），未重拉原文。
- 未核实事项就地标注（`[推断]`）；三路取证线程的原始产物全文归档 `docs/research/assets/r14/raw/`，本篇只收裁决相关结论。

## 7. 相关文档

- `r12-save-and-start-behavior.md` — 本票前序（§5.1 已拍裁决 2–7、§5.2 双方立场）
- `r5-chief-behavior.md` — 参考站 Chief 行为一手观察（spec 三段式 / watch 回路 / 线程形状）
- `r2-app-ui-inventory.md` / `r1-site-inventory.md` — 参考站看板与站点清单
- wiki [[todos.dev 与 Multica 对照]] — 对象面宽窄对照底座（L-B 的 Multica 一手来源）
- `CONTEXT.md` — 「无 Goal 概念」「来源=外部出处」现裁决（§5.7 列出随实现票更新的词条）
- `docs/spec/18-positioning-and-differentiation.md` — the positioning canonical copy that pins the semantic axes to todos.dev (basis of §5.8 argument 1)
