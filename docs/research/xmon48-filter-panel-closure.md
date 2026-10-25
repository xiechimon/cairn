# XMON-48 工作台筛选交互：调研收尾与决策材料

日期：2026-10-02 · 票：XMON-48（子票 XMON-57 · PR #564 · commit `6f079a81`）
pacman 侧核对基准：`origin/main@4647eaf`（board 筛选面文件自 `6f079a81` 起零改动）
Reference evidence: Multica = line-by-line review of a local source checkout (2026-10-02); todos.dev = archived official llms-full.txt plus a live re-capture of the changelog (2026-10-02).

## 1. 结论先行

XMON-48 抱怨的交互（左侧仓库逐个点、右侧类型逐个点、两个入口互不相干）**已于 2026-10-01 全量落地修复**：调研 → 用户裁决 8 条 → PR #564 合入（`6f079a81`）→ CI 全绿 → 用户确认 merge。票停在 `in_review` 只因 Multica 在翻状态前退役，不是有活没干完。

本文档是该线的收尾记录 + 残余开放项的决策材料。残余只剩两个真决策：**本地项目类型词表是否可扩展**（推荐维持 6 词固定；若做，走「FIXED_TAGS 保底 + 项目级追加词（描述必填）」的混合路径，Multica 的 select 自定义属性是形态参考）与**命名已保存视图 `?view=`**（推荐不做——pacman 的 URL 即真值已覆盖其大部分价值）。侧栏聚合已被用户裁决不做，仅存档。

## 2. 票据时间线（XMON-48 → XMON-57 → #564）

时间为 Multica 记录的 UTC（评论区 verbatim 存档）。

| 时间 | 事件 |
|---|---|
| 2026-09（≤30 日） | XMON-48 开：用户抱怨工作台「全部/凭证链路验证/pacman」与类型需逐个选择 |
| 09-30T23:21Z~23:54Z | 调研交付：Multica 源码级 + todos.dev 文档级（runtime 侧见 r10/r11） |
| 10-01T05:42Z~07:28Z | 用户 6 答：痛处=顶栏不是侧栏；仓库轴保留并集；采纳统一筛选面板；侧栏保持现状；已保存视图先不做；类型词表「帮我做点动态的」 |
| 10-01 | 方案冻结为 8 条裁决（下）；PR #564 合入 `6f079a81`，CI 绿（board-filter 20 passed；dead-buttons/escape-wiring/shadcn-primitives 34 passed；vitest 40；lint/typecheck 0） |
| 10-01T08:26Z | 用户确认 merge & done；08:31Z 收尾评论 |
| 10-01 后 | Multica 退役（本地 daemon 下线），XMON-48 状态没来得及翻 |

### 冻结的 8 条裁决（XMON-57，全部已核实落地，见 §3）

1. 痛点面 = 看板顶栏（仓库 chip 组 + 类型 popover），**不是侧栏**——「全部-凭证链路验证-pacman」是仓库 chips 的渲染序
2. 仓库轴保留**并集选择** + 全选/清除/反选，**不采** todos.dev 的排除模型
3. 采纳方案 C：**统一筛选面板**（两轴收进一个 popover）
4. 侧栏**保持现状**（方案 B 撤回）
5. **不做**已保存视图 / `?view=`
6. 类型词表**动态化**（补齐 ADR 0005 D2）
7. 规范序 = **字典序**
8. 同名异色标签 → 取**规范序第一个项目**的颜色

明确不做清单：侧栏改动、已保存视图、`__none__` 哨兵（无标签恒可见裁决保留）、按名字启发式过滤（ADR 0005 禁止）、URL 参数形状变更。

## 3. 现状（2026-10-02 代码实测，file:line 为 origin/main@4647eaf）

**顶栏布局** `apps/web/src/board/board.tsx:338-351`：左侧 `FilterChips`（生效筛选条，独立容器、不进 `board-topbar-actions`——dead-buttons e2e 钉死右动作区恰好一钮）；右侧唯一按钮 `FilterPanel`。标题 absolute + pointer-events-none 不拦截点击。

**统一筛选面板** `apps/web/src/board/filter-panel.tsx`（321 行）：
- 触发钮：ghost Button + Funnel 图标 + 已选计数 badge（:263-320；选择器别名 `board-type-filter`/`type-filter-popover` 按 #411 别名优先保留）
- 每维度（仓库/类型）：头部「名称 + 已选 n/m + 全部选中 + 清除」（disabled 态、位置稳定）；>8 项出搜索框（`SEARCH_THRESHOLD = 8`，:41）；`role=listbox aria-multiselectable`，max-h-[220px]；hover 露出「仅此」按钮（仅在已有选中时）；每项计数 = **另一轴收窄后**的命中数（本轴排除，否则选一次后全变 0）
- 空词表态：「本作用域内没有可选的仓库/类型」
- 底部「清除全部」仅在 >1 项选中时出现；点选项保持面板开；query 每开合周期重置

**类型词表动态化**（裁决 6/7/8 落地）：
- `apps/web/src/api/hooks.ts:140-165` `useProjectTags` 产出 `{tagById, nameById, ordered[], ready}`，ordered 按 projectIds 序（= 字典序规范序）——裁决 8「同名取第一个项目的颜色」由投影序保证
- `apps/web/src/board/tag-filter.ts:43-47` `parseTagParam(raw, vocab)`：词表未就绪 gate、去重 + 交集 + 字典序；:52-63 `matchesTagFilter`：空选=全显，**无标签任务恒可见**（保留裁决）；:70-95 `buildTagOptions`：first-color-wins、他轴计数、字典序
- `apps/web/src/routes/board-page.tsx:113,128-132` 接线；:225-227 全选写入 `[...tagVocab].sort()`（批次键语义 = 写满词表，读数 N/N 而非 0/N）
- 卡片标签从**每项目 tag 记录**解析（`cardTag`），不再硬编码 FIXED_TAGS

**仓库轴** `apps/web/src/board/repo-filter.ts`：并集模型保留（模块头注释记录了排除模型的否决）；`parseProjectsParam` 保留未知 id（:36-39）；`buildRepoOptions` entries 序 = 行序（:52-67）。

**FIXED_TAGS 仍为 6 词**（设计如此，见 §8.1）：`packages/shared/src/task-meta.ts:28`（bug/feature/improvement/refactor/docs/chore，各带描述与颜色）；`apps/server/src/services/tags.ts:19` `seedFixedTags`、:48 `backfillFixedTags`（github 形态项目跳过 :51）、:83 `syncGithubLabels`（github 项目镜像真实 repo labels = 天然动态）、:127 `resolveProjectTagIds`；`apps/server/src/services/machines.ts:1183-1184` `set_task_meta` 白名单校验（local/hosted = FIXED_TAGS + 单 tag）。

**空态** `apps/web/src/board/board.tsx:378-393`：`board-filter-empty` +「没有匹配筛选条件的任务」+ 具名生效筛选摘要（回答「我的卡去哪了」）+「清除筛选」按钮。

**侧栏**：未动（裁决 4）——`sidebar.tsx` 无「全部项目」聚合行（grep 零命中）。

**e2e** `apps/web/e2e/board-filter.spec.ts`：20 用例，含批次键（:389「全部选中 = 写满词表（读数 N/N，非 0/N）；『仅此』塌成单值」）、生效筛选条（:413）、卡片 chip（:447）、URL 规范序、空态、参数直达、双轴 AND。

**另一处「全部」**：项目页内单选状态菜单（全部/进行中/已完成，`apps/web/src/pages/project-page.tsx:201-205` `TASK_FILTERS`）与看板顶栏筛选无关，XMON-57 §0 已裁定不属本票。

## 4. 为什么曾不合理（pre-#564 痛点根因）

原状 = pacman #403/#445 自造的两个独立控件（左侧仓库 chip 组 + 右侧类型 popover），非任何参考实现的复刻：

1. **一个逻辑操作拆成两个入口**：筛「某仓库的某类型」要在顶栏两侧来回走，两控件互不知晓对方状态
2. **无跨轴计数**：选项不显示「选了它会剩多少」，只能盲选后数卡片
3. **无批次键**：没有全选/清除/反选/「仅此」，N 个仓库要点 N-1 次才能表达「除 X 外全部」
4. **chip 渲染序无语义**：「全部-凭证链路验证-pacman」按行序排，「全部」像第三个选项而非状态读数（用户抱怨原文的直接来源）
5. **类型词表硬编码**：FIXED_TAGS 写死在 UI 层，github 项目的真实 labels 到不了类型轴（ADR 0005 D2 缺口）

#564 的修法与根因一一对应：单面板（1）、他轴计数（2）、全选/清除/仅此（3）、chips 变为生效筛选条 + 计数 badge（4）、词表从每项目 tag 记录动态投影（5）。

## 5. Multica 实际怎么做（源码级）

来源：本地源码逐行复核（2026-10-02，file:line 以当前工作树为准）+ XMON-57 调研（github.com/multica-ai/multica @`43b0571f`，2026-10-01）。核心 UI 在 `packages/views/*`，状态/类型在 `packages/core/*`。

**侧栏 = 扁平分组导航，不列 repo 树**（`packages/views/layout/app-sidebar.tsx`）：
- 自上而下：Workspace 切换器（:616-746）/ 搜索槽 + New Issue（:747-768）/ Inbox·My Issues·Chat（:147-151）/ Pinned 可折叠组（拖拽重排，:811-858）/ Issues·Projects·Autopilots（:153-157）/ Agents·Squads·Skills·Runtimes（:159-164）/ Usage·Settings（:166-169）。每项一击直达路由，无逐级下钻
- **「全部」= workspace 级 Issues 聚合看板**（zh 文案 `all_label`="全部"，`packages/views/locales/zh-Hans/issues.json:146-147`）；repo 只是 project 的属性（`packages/core/types/project.ts:64-67` `github_repo|local_directory`），不进侧栏
- scope 三粒度：workspace 聚合（Issues）/ project 详情页（`project-detail.tsx:551`）/ 个人（My Issues）。「只看某几个 repo」= Project facet 多选，而非侧栏逐点
- ViewBar（`view-bar.tsx`；`issues-header.tsx:1300-1360`）：内置 scope tab（All/Members/Agents，单选 radio 语义，`issues-scope-store.ts:8`）与 saved views 混排成可拖拽扁平行，在内容区不在侧栏

**筛选 = 单 funnel 菜单 + 每维度二级子菜单，全维度多选**（`issues-header.tsx` + `view-store.ts` + `filter-chips-bar.tsx`）：
- 触发钮（`issues-header.tsx:2063-2085`）：无筛选 outline+"Filter"，有筛选 brand 底色+"N filters" 计数
- 维度：status / priority / assignee / creator / project / projectStatus / label / `property:<id>`（`FilterDimension`，`view-store.ts:137-145`）+ dateFilter、agentRunningFilter（:96-100, 242-272）
- 每维度 checkbox 多选（`DropdownMenuCheckboxItem` + `toggle*Filter`，`view-store.ts:420-490`）；**维度内 OR、跨维度 AND**（:251-264 注释明说）
- 每选项带匹配计数（`filters.issue_count`；服务端 facets，XMON-57 核于 `issues-header.tsx:204-255`）；长列表（assignee/project/label）子菜单内嵌搜索框（:345-370, 527-541, 662-674），assignee 支持拼音、按 Members/Agents/Squads 分组
- **无维度内「全选」按钮**；有全局「Reset all filters」（:1857-1874，saved view 内 reset 回 view 基线）+ chip 条右端 Clear（`filter-chips-bar.tsx:586-589, 675-683`）
- chip 条：每激活维度一枚 chip（图标 + 维度名 +「首值 +N」摘要 + ≤3 叠加图标 + 单维移除 X；:44-64, 594-640）；无筛选整条不渲染（:672）
- 三段式空态（`issue-surface.tsx:302-329`，XMON-57 核）：「筛选出来的空 ≠ 真空」

**「类型」词表——Multica 没有内建 issue type**（`packages/core/types/issue.ts` 无 type 字段）：由 **select 型自定义属性**扮演——可多选筛选（`togglePropertyFilter`，`view-store.ts:480-490`）、可作看板分组列（`IssueGrouping` 含 `property:${string}`，:20-24）、创建时用 picker 选值（`create-issue.tsx:95` → `custom-property-picker.tsx`）。词表完全由 workspace 用户定义。

**持久化双层**：
- 普通 filter = workspace 级 localStorage（zustand persist key `multica_issues_view`，`view-store.ts:658-706`；partialize 排除 dateFilter/agentRunningFilter :661-667；切 workspace 清空 :836-847）——**不进 URL、不可分享**
- saved view = 10 字段 `FilterSnapshot`（:120-133）存服务端，`?view=` URL 双向同步（`use-issue-view-url-sync.ts`），可 pin 进侧栏；锁定的维度在菜单里 checked-and-disabled（`active-view-store.ts:38-60`）

**键盘**：Cmd/Ctrl+K 命令面板、C 建 issue、Cmd+B 折叠侧栏（`shortcuts/definitions.ts:80-82`）；导航类动作可自绑（:111-122）；筛选维度无默认快捷键 [推断]。

**对 XMON-48 的映射**：两个投诉面在 Multica 都无「逐项单选」——侧栏用「聚合看板 + Project 多选 facet」替代 repo 逐点；「类型」天然是多选 checkbox facet。

## 6. todos.dev 实际怎么做（文档级）

来源：官方 `llms-full.txt` 全量归档（32 篇 docs，2026-09-30 抓取，逐段核验一致）+ changelog live 重抓（agent-reach，补至 09-30，无漂移）。全部为文档文字、无截图；登录墙内行为逐项标注。

**导航**：
- 对象层级 Team → Project → Todo；「Workspace」是首页的名字，不是层级（docs/chief#the-workspace）
- **首页即聚合视图**：Chief 对话 + 全团队跨项目看板并排，「全部」是默认态、零点击；侧栏 project 行只是去项目页的捷径
- 侧栏（changelog 拼合 [推断]）：team 行 / New task / Workspace / board 入口（`/inbox` 全页看板）/ Projects 区（**前 5 + Show all (N)**、pin 置顶账号级同步，08-28、09-03）/ Resources 区（Connections·Machines·Providers·Secrets，09-30）/ Schedules / ⌘K。09-30 侧栏可拖宽 200-400px、过阈值收成图标栏
- 导航栈：侧栏跳转重置栈，Back 恒回看板（09-26）；进项目页 = 1 击

**类型**：
- **todo 无 type 字段**，工作单元只有一种（docs/concepts#todo）
- 文档里的 "type filter" = **列内 phase 子分面**：Needs you 列「待确认 plan vs 待验收 changes」、In progress 列「planning vs building」（changelog 09-25、09-26）
- **Tags 是唯一用户自定义分类**，有「filter the board by it」能力（docs/projects#tags），单选/多选形态 [未取证]；board 级筛选菜单无 tag 维度（09-26 维度清单完整 = Created by + Projects）

**筛选**：
- 看板筛选 2026-09-25/26 才诞生：09-25 每列列头独立 filter menu；09-26 project 过滤**上移**成看板右上单 filter 图标，与 Created by 合并为一个菜单、作用于所有列
- Projects = **checkbox 多选、默认全勾、新项目默认勾上**（09-26）；Created by = 只留我 / Chief 或 agent / 其他成员，控件形态原文未明说、措辞倾向单选 [推断]
- 两层筛选：board 级 + 列级相互独立；手机端 filter sheet 行带 checkbox（09-26）
- URL 持久化 [未取证]（changelog 全量 06-04→09-28 零记载）；saved views 判断不存在 [推断]（docs + 117 条 changelog 零记载）
- 空态：只实测到「列空」文案（Needs you = `Nothing waiting on you`）；过滤见底的空态 [未取证]

**批量操作**（「逐个选」在 todos.dev 任何时期都不成立的证据）：06-17 卡片勾选框驱动 batch selection → 07-06 bulk 菜单（complete/copy-link/merge）→ 09-12 Ctrl/Cmd 多选拖拽（不适配的卡自动跳过并报告数量）→ 09-27 多选卡一起拖进 Chief 变 todo chips → 09-29 批量完成（先查可合并变更、一次确认）。

## 7. 三方对照总表

| 轴 | pacman 现状（#564 后） | Multica | todos.dev |
|---|---|---|---|
| 筛选入口 | 顶栏唯一「筛选」钮 + 统一面板（2 维平铺） | 单 Filter 钮 + 每维二级子菜单（~10 维） | board 右上单图标 + 列级独立菜单 |
| 仓库/项目轴 | 并集多选 + 全选/清除/仅此 | 多选 checkbox（无维度级全选，全局 Reset） | checkbox 多选、默认全勾（排除模型） |
| 类型轴 | 动态词表投影，多选 + 批次键 | 无内建 type；select 自定义属性多选 | 无 type 字段；「type」= 列内 phase 子分面 |
| 每选项计数 | ✅ 他轴收窄后命中数 | ✅ 服务端 facets | ❌（文档无记载） |
| 生效筛选读数 | chips 条 + 触发钮 badge | chip 条（首值 +N、单维移除）+ N filters | [未取证] |
| 无标签/无归类 | 恒可见（裁决保留） | `__none__` 哨兵 + includeNoAssignee/Project | tags 可过滤，形态 [未取证] |
| 空态 | 具名摘要 + 清除筛选 | 三段式（筛选空 ≠ 真空） | 仅「列空」文案已证 |
| URL 可分享 | ✅ 全参数规范化 | 仅 saved view `?view=`；普通 filter 在 localStorage | [未取证] |
| 已保存视图 | 无（裁决 5 先不做） | 服务端 FilterSnapshot + `?view=` + 锁定维度 | 判断不存在 [推断] |
| 侧栏聚合行 | 无（裁决 4） | 无（Issues 即聚合看板） | 无（首页即聚合） |
| 侧栏防膨胀 | 项目行直列 | Pinned 手动 pin | 前 5 + Show all + pin |

**判读**：pacman 在计数、批次键（维度级全选/清除/仅此，Multica 都没有）、URL 可分享（强于 Multica 的 localStorage 瞬态层）三点上已达或超过两家参考；Multica 独有且 pacman 没有的只剩**命名 saved views**（§8.2）与更多筛选维度（pacman 只有两轴是产品形态使然，非缺陷）；todos.dev 独有的侧栏防膨胀（前 5 + Show all + pin）已被裁决 4 关闭，仅存档。

## 8. 残余开放项与方案

### 8.1 本地项目类型词表是否可扩展（唯一的真开放产品决策）

**事实**：词表 UI 层已动态（裁决 6），但**本地/托管项目的词表内容**仍是 FIXED_TAGS 6 词（`task-meta.ts:28`；ADR 0002 D4 有意固定：标签描述进 worker prompt 做分类，词表越宽分类越钝）。github 形态项目已镜像真实 labels（`tags.ts:83`），天然动态。XMON-57 冻结口径：「想做随时说」。

**参考实现**：Multica 的答案是「类型 = 用户自定义 select 属性」（§5）——证明类型词表开放有成熟形态（picker 选值 + facet 多选 + 可作分组列）。但 Multica 的属性不承担 worker-prompt 分类职责，pacman 的 FIXED_TAGS 描述是分类链路的一部分，不能整条照搬；可借的是其**形态**（项目级定义 + picker + 多选 facet）。

**方案 A（推荐）：维持 6 词固定**。代价 = 0。ADR 0002 D4 的理由未被任何新事实推翻；用户 6 答要的「动态」已由 #564 在 UI 层兑现（github 项目词表确实随 repo 动）。风险 = 若用户想给本地项目自定义类型，需求会再开——届时走 C。

**方案 B：每项目自定义类型（全放开，Multica 形态照搬）**。触碰面：`tags.ts` 增 CRUD + `machines.ts:1183-1184` 白名单放开 + worker prompt 分类质量（自定义词无描述或描述差 → 分类漂移，正是 ADR 0002 的核心顾虑）+ 存量数据迁移 + 类型轴 UI 的管理入口。代价 = 高（服务端 + prompt 链 + UI 三面），且与「固定词表喂分类」的架构理由正面冲突。

**方案 C：混合——FIXED_TAGS 保底 + 项目级追加词（描述必填）**。追加词强制带描述字段（喂 prompt，借 Multica property-picker 形态），`set_task_meta` 白名单改为 FIXED_TAGS ∪ 项目追加集。代价 = 中；保留分类质量护栏；不破坏存量；词表 UI 层已动态，前端零改动（追加词自动进投影）。若将来要做，这是最低风险路径。

**推荐**：A（现状），B/C 取舍存档如上；用户点名要做时直接走 C，无需再调研。

### 8.2 命名已保存视图 `?view=`

**事实**：用户已裁决「先不做」（6 答之 5）。关键差距认知：pacman 的 **URL 即真值已让任意筛选组合可分享、可收藏**（`?projects=&tags=` 规范序 + replace 写回），这比 Multica 的瞬态筛选（localStorage、不可分享）**强**；Multica 真正多出来的只有「命名 + 服务端存储 + 一键切换 + 锁定维度」（§5 持久化双层）。todos.dev 判断根本没有 saved views。

**方案 A（推荐）：继续不做**。代价 = 0；浏览器书签已覆盖大部分场景；无服务端存储与迁移负担。触发重新评估的证据 = 用户出现「同一组合反复手敲/反复贴 URL」的真实使用行为。

**方案 B：服务端命名视图（Multica 模型）**。需 view 表 + CRUD + `?view=` 解析 + 与现参数轴的优先级裁决（view 与显式 `?projects=&tags=` 冲突谁赢——Multica 的答案是 view 锁定维度 checked-and-disabled，可借）+ pin 入口。代价 = 高；收益 = 多设备同步 + 团队共享视图。若做，Multica 双层模型是唯一已核实的参考实现。

**方案 C：localStorage 命名称**。代价 = 低，但跨设备不可用——恰是 Multica 瞬态层的弱点，做了也是半吊子，无独立价值。

**推荐**：A；届时直接评估 B（C 排除）。

### 8.3 侧栏聚合（已裁决，仅存档）

用户裁决 4「保持现状」；Multica 与 todos.dev 的侧栏也都没有「全部项目」聚合行（§5/§6）——pacman 现状与两家参考一致，且两家都把「全部」放在内容区（Multica = Issues 路由，todos = Workspace 首页）而非侧栏。若将来项目数膨胀，todos.dev 的「前 5 + Show all (N) + pin 置顶」是已核实的参考实现（changelog 08-28、09-03）。无行动项。

### 8.4 票据收尾

XMON-48 停在 `in_review`。本调研为只读线程（Multica 写操作在边界外，且本地 daemon 已退役）；**本文档即收尾记录**。待 Multica 写通道恢复（或由有权限的会话）翻 `done` 或归档即可，无代码动作。

## 9. 验证口径

- **已实测**（2026-10-02，pacman `origin/main@4647eaf`）：§3 全部 file:line 逐条核对；FIXED_TAGS / tags.ts / machines.ts 锚点 grep 复核；侧栏无聚合行 grep 零命中；e2e 用例数与关键断言原文核对
- **源码级取证**（§5）：Multica 本地源逐行复核（2026-10-02），file:line 以当前工作树为准；空态一处沿用 XMON-57 @`43b0571f` 的核对（本地工作树同段无改动迹象）
- **文档级取证**（§6）：todos.dev 官方 docs 全量归档 + changelog live 重抓；登录墙内行为一律标 `[未取证]`，拼合处标 `[推断]`，未编造
- **未做**：运行中应用的实机走查（调研票不启服务；#564 自带 CI 绿 + 截图证据链，见 XMON-57 评论区）
