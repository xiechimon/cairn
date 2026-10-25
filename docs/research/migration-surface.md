<!-- XMON-11 | 来源：research/migration-surface @ def4b57 | 正文逐字未改，偏差以「偏差标注」块就地插入 -->

> **入仓说明（XMON-11；父票 XMON-3 裁决 A4=A）**
> 本文件是 #409 的迁移面盘点报告。正文**逐字取自** `research/migration-surface` 分支的 `def4b57`
> （`docs/research/migration-surface.md`，2026-09-29 17:49 +0800；报告自述基线 `origin/main @ 8c30775`）。
> 并入 `main` 的理由：每片验收的第 3 件要按本文件的 §3 与附录 A/B 摘 e2e 清单，底账得在主干可查。
> **正文不作改写**——它是 #409 时点的快照，价值在于能与当前树逐条对照；凡与当前树不符处，一律以
> 「偏差标注」块**就地**标出，不改原文。每个标注块都写明复核所依据的 commit。
> 本次复核 commit：`9a0613b`（2026-10-01 00:13 +0800），比报告基线晚 **77 个 commit**。

# 迁移面盘点：ui 原语消费矩阵 + css 依赖图 + 三面钉扎点清单

> 票：#409（地图 #406「apps/web 组件架构切换到 shadcn/ui」的研究票）。
> 目的：为切片策略与 e2e 重钉策略供事实——原语谁在用、23 个 css 谁依赖谁、
> 三面钉扎（web e2e 类名断言 / integration locator / 视觉几何断言）各钉了哪些
> 选择子、散件 css 收编难度分级。
> 方法：纯本地读码（grep + 逐文件抄录 import 语句），未起服务未跑测试。
> 基线：`origin/main @ 8c30775`（2026-09-29，#394 新建任务无标题面 + #401 快捷键组已合入）。
> 140 tsx / 23 css（与地图笔记一致）。

## 偏差总览（复核 @ `9a0613b`，2026-10-01）

本文件成文于 `8c30775`。到 `9a0613b` 之间隔了 77 个 commit（`git log --oneline 8c30775..HEAD` 共 **77** 行），
地图 #406 下的搬迁已大面积开工——报告写作时「迁移未起、先分级再排期」的前提不再成立。以下是打掉正文判断的几笔：

| commit | 内容 | 失效的正文处 |
|---|---|---|
| `84ff110` | web(414) 主界面 shadcn 化——`components/ui/` 适配层进仓 + 四列对账 (#416) | §1 原语矩阵、§2.2 原语层 |
| `cfa962e` | web(435) 值正本并流 `shadcn.css` + `tokens.css` 降别名层 + 清 16 死 token (#449) | §2.1 token 口径、附录 C |
| `f73fef6` | web(419) mention-picker 悬空 token 重接仓内单源 (#427) | §2.1「5 个悬空 token」整条 |
| `dfc5809` | web(425) B1 弹层族收编 shadcn/Base UI——三适配层 + 基切换 (#454) | §1.1 律 2、§2.2 `ui/dialog.css` |
| `aa1314b` | web(426) token-gate + machine-authorize 两件切 shadcn 件（B2 热身） (#474) | §4 两件「低难度」散件 |
| `839f59e` | web(423) resources 域全切 shadcn——第一片真域 (#481) | §4 resources 行 |
| `2b6bf61` | web(453) search-panel（⌘K）迁 DialogShell 视口根变体 (#467) | §2.3 域层 import 边 |
| `3511dc3` | web(468) ⌘J 改 toggle + `KbdHint` 原语进仓 (#475) | §1 原语清单 |
| `06f7ef9` `fd25629` `7ccdcf2` `417f714` `8f6825c` `2234522` 等 | 看板 / 详情 / 总管 / 侧栏接连搬迁与重排 | §3 三面钉扎的全部计数、附录 A |

**读法**：本文件的**方法**没过期（口径、css 三层骨架、家族律、收编分级口径）；过期的是**数字**与**成员表**。
引用任何数字前先看对应节的「偏差标注」。

## 0. 口径

- **import 文件数** = grep `ui/<name>` 命中且不在 `ui/` 目录内的 tsx/ts 文件数（已人工复核排除纯注释提及）。
- **JSX 实点数** = `<Component` 出现次数（props 折行导致的行尾断行已计入）。
- **css 依赖边** = 逐文件抄录 `^import .*\.css` 原文（45 条），不走 basename 猜测——`detail/overlays.css` 与 `overlays/overlays.css` 同名不同物，basename 匹配会把两者消费面混为一谈（本盘点中途实测撞上一次，已纠正）。
- **钉扎点** = `locator('.…')` 类名选择子（web e2e 与 integration 同口径）；几何断言 = `boundingBox` 调用点 + 视觉 spec 内 `page.evaluate` 探针的 expect。

## 1. ui/ 原语消费矩阵

`apps/web/src/ui/` 共 7 原语 6 css（avatar 无 css，纯行为原语：dicebear 生成 + onError 兜底，视觉尺寸由消费面 per-face css 给定）。

| 原语 | 样式 | import 文件 | JSX 实点 | 消费文件分布 |
|---|---|---|---|---|
| Button | button.css (41 decl) | **22** | **38** / 21 文件 | 全域：board 3、chief 2、detail 5、overlay 4、pages 3、resources 2、routes 3 |
| Card | card.css (6 decl) | **0** | **0** | **死原语**——见 §1.1 |
| Chip | chip.css (25 decl) | 2 | 2 | detail/dhead.tsx、resources/parts.tsx |
| DialogShell | dialog.css (126 decl) | 11 | 11 | 11 个 dialog 各 1 处壳（chief 2、detail 4、resources 3、routes 2） |
| Input | input.css (24 decl) | 6 | 12 | token-gate、search-panel、4 个创建 dialog（create-provider 一处 6 点） |
| TagChip | tag-chip.css (14 decl) | 1 | 1 | 仅 detail/fresh-block.tsx |
| Avatar | —（无 css） | 9 | 12 | sidebar、todo-card、detail 2、overlays 2、pages 1、routes 2 |

Button 消费 Top：overlay/new-task-dialog 6 点、detail/overlays 5 点。

> **偏差标注（复核 @ `9a0613b`）**——矩阵已失真，起因是原语层**分叉成了两层**：
>
> 1. `apps/web/src/ui/` 仍是老原语层：`button` / `card` / `chip` / `input` / `tag-chip` / `kbd-hint`（六件各带同名 css）
>    + `avatar`（无 css）。
> 2. `apps/web/src/components/ui/` 是 #414 起进仓的 **shadcn 适配层**，共 14 件：`alert-dialog` `alert-dialog-shell`
>    `badge` `button` `card` `dialog` `dialog-shell` `dropdown-menu` `empty` `floating-shell` `input` `popover`
>    `switch` `tabs`。**同一语义名两层并存**——`Button` 就是两套，消费方各引各的。
> 3. `DialogShell` 已从 `ui/` 移出到 `components/ui/dialog-shell.tsx`（`ui/dialog.css` 改由它自引）；
>    新增 `ui/kbd-hint.tsx`（#468）；`ui/avatar.tsx` 已从 `ui/README.md` 的原语表退出。
>
> 现值（口径同左：import 路径精确匹配；JSX 用词边界 `<Name\b`，比原文的前缀匹配略少算）：

| 原语 | 定义位置 | import 文件数 | JSX 实点 |
|---|---|---|---|
| Button | `ui/button.tsx`（老层） | 18 | 两层混计 |
| Button | `components/ui/button.tsx`（shadcn 层） | 8（6 业务 + `dialog.tsx` / `alert-dialog.tsx` 两个同层适配件） | 两层混计 |
| Chip | `ui/chip.tsx` | 1 | 1 |
| Card | `ui/card.tsx`（老层） | **0**（已死） | 0 |
| Card | `components/ui/card.tsx`（shadcn 层） | 4 | 5 |
| Input | `ui/input.tsx`（老层） | 8 | 14 |
| Input | `components/ui/input.tsx`（shadcn 层） | 2 | 2 |
| TagChip | `ui/tag-chip.tsx` | 6 | 4 |
| KbdHint | `ui/kbd-hint.tsx` | 3 | 3 |
| Avatar | `ui/avatar.tsx` | 12 | 15 |
| DialogShell | `components/ui/dialog-shell.tsx` | 16 | 14 |

> 全仓 `<Button` 共 **49** 处，老层 / 新层混在一起，本次未逐层拆——搬走的面已改用 tailwind 工具类，
> 原语计数对切片成本的指示力已不如原文时点。

### 1.1 四个原生事实（直接影响选型/切片）

1. **Card 是死原语**。`ui/card.tsx` 导出 `Card`（tone: card/inset/elevated），全仓 0 import、0 JSX；card.css 仅被 card.tsx 自引。真实「卡片」是 **7 个 per-face 类族**，全部绕开原语直写域 css：
   - `res-card`/`res-rowcard`（resources.css：machines/secrets/skills/mcp-servers 4 页行卡）
   - `prj-set-card`（pages.css：项目设置）、`prj-task-card`（pages.css：项目任务卡）
   - `sched-card`（pages.css：定时列表卡）、`team-agent-card`（secondary.css：团队网格卡）
   - `account-card`（secondary.css）、`authorize-card`（machine-authorize.css）
   迁移含义：shadcn Card 落地不是「替换 Card 原语」，而是**新立组件 + 收编 7 族散写**；card.tsx/card.css 可直接退役。
2. **DialogShell 族有一个出族大户**。overlay/new-task-dialog.tsx 在 #394（无标题单字段面）后**不再用 DialogShell**——手搓 OverlayMount + ClickCatcher + Esc 三件套（家族律 #67/#127 的原始形态），仅保留 `.new-task-dialog` 类名作 e2e 锚。它同时是 TagChip 的原第二大消费面，#394 固定标签词表后 TagChip 只剩 fresh-block 一处。**弹窗族实际 = DialogShell 11 壳 + new-task-dialog 1 个手工壳**，迁移时这第 12 个面要么收编回族要么单独立项。
3. **per-face 类名 = e2e 定位别名**（ui/README 规则 2 明文）。例：dhead.tsx 渲染 `<Chip variant={tone} className="detail-chip--{tone}">` 且外层保留 `.detail-chip` 基类——e2e 按 `.detail-chip` 定位点击。同类别名遍布全仓（token-gate-input/-submit、fresh-tag-chip、new-task-dialog…）。**迁移组件时类名别名必须原样保留或 e2e 同步重钉**，这是三面钉扎（§3）与组件层之间的契约面。
4. **1 处死 import**：routes/account-page.tsx 引 `Button` 从未渲染（#148 账户页净化残留，lint 未拦）。

> **偏差标注（复核 @ `9a0613b`）**——四条原生事实里三条已翻案：
>
> - **律 1「Card 是死原语」→ 半失效**。老 `ui/card.tsx` 现在确实是死的（0 消费），但 #414 进的
>   shadcn `components/ui/card.tsx` 已被 4 个文件消费：`board/todo-card.tsx`、`overlay/token-gate.tsx`、
>   `resources/parts.tsx`、`routes/machine-authorize-page.tsx`（5 处 JSX）。原文「Card 落地 = 新立组件
>   + 收编 7 族散写」的方向对；「card.tsx/card.css 可直接退役」只对**老层**成立。
> - **律 2「new-task-dialog 出族」→ 已收回**。`overlay/new-task-dialog.tsx` 现 `import { DialogShell }
>   from '../components/ui/dialog-shell.js'`（第 30 行，渲染在第 227 行）。弹窗族已是 **12 壳同在 DialogShell 内**，
>   不再是「11 壳 + 1 手工壳」，原文「这第 12 个面要么收编回族要么单独立项」的岔路已走掉。
> - **律 3（per-face 类名 = e2e 定位别名）→ 仍成立，且已升格为仓级政策**。`ui/dialog.css` 头注写明
>   **#411 别名优先政策**：#425 换壳机制时 `.dlg-*` 类名「原样不动」。`.dlg` 在 e2e 的钉扎处数 67 → **69**。
> - **律 4「account-page.tsx 死 import」→ 已清**（`routes/account-page.tsx` 现无 `Button` import）。

另：overlay/token-gate.tsx 源码注释提及「样式本体在 ui/input.css / ui/button.css」，易被 grep 误读为直引 css——实测只 import 组件，无 seam 违规。

## 2. css 依赖图

23 个 css 分三层。依赖边全部来自 tsx 顶部静态 import（无任何 css `@import` 他 css；唯一 `@import` 是 app.css 引 tailwindcss）。

> **偏差标注（复核 @ `9a0613b`）**——三层骨架还在，成员换了：
>
> - css 总数仍 **23**，但增删各 3：**删** `board/sidebar.css`、`overlay/token-gate.css`、`routes/machine-authorize.css`；
>   **增** `styles/shadcn.css`、`ui/kbd-hint.css`、`routes/agent-detail.css`。`board/sidebar.css` 的
>   `.sidebar-row` / `.rail-row` 规则现落在 `overlays/overlays.css`。
> - `@import` 不再是「唯一 app.css 引 tailwindcss」：`styles/app.css` 现为 `@import "tailwindcss"` +
>   `@import "./shadcn.css"` 两条。`shadcn.css` 不直接被任何 tsx 引，只经 app.css 注入。
> - 静态 `^import .*\.css` 边数 **45 → 37**。

### 2.1 全局层（main.tsx 直引 4 件）

| 文件 | 体量 | 角色 |
|---|---|---|
| styles/tokens.css | 16.4K，119 个 distinct token（:root = dark 默认 L11，.light 镜像 L231） | 唯一 token 源 |
| styles/fonts.css | 22 decl | @font-face + --font-inter |
| styles/motion.css | 35 decl | 动效 token/关键帧 |
| styles/app.css | tailwind @import + `@theme inline` 映射（--color-* → tokens.css 变量）+ 全局 focus 环收编（#388） | tailwind v4 入口 |

token 流通实测（全 src grep `var(--`）：

- **119 定义 / 109 被消费 / 19 个死 token**（defined-but-unused）：`--active-text` `--blue-400` `--card-ghost-border` `--chip-active-bg` `--chip-active-border` `--col-dot-building` `--col-dot-confirm` `--col-dot-idle` `--col-dot-planning` `--col-dot-review` `--disabled-fg` `--indigo-400` `--nav-bg` `--send-disabled` `--space-1..4` `--space-6`。col-dot 五态整族 + space 间距族全灭——迁移前可先清。
- **5 个被消费但全仓无定义**（无 fallback，共 20 处 var() 引用）：`--surface-base` `--border` `--ring` `--text` `--text-muted`——**全部由 overlay/mention-picker.css 独占**。该文件系 #311 从参考应用移植时带入的对岸 token 名，#334 只 token 化了圆角；css 变量未定义且无 fallback = IACVT（background/border 这类非继承属性落 initial——面板底色透明、边框消失；color 经继承侥幸不显坏）。**这是现存缺陷也是迁移必答题**：mention-picker 无论迁不迁都得重接 token。
- detail.css 的 `var(--color-danger, #dc2626)` / `var(--color-warning, #f59e0b)` 带 fallback，属自足写法，不在缺陷列；fonts.css 的 --font-inter 与 detail.css 的 --detail-pane-right 为本地定义本地用。
- tsx 内联 `style` 消费 `var(--`：**0 处**——token 消费 100% 走 css 文件，组件层无内联 token 耦合。

> **偏差标注（复核 @ `9a0613b`）**——token 管道整体换过（`#435`，落地 `#412` P2b 裁定）：
>
> - **值正本搬家**：颜色 token 的唯一持值文件已是 `styles/shadcn.css`（shadcn 官方语义词表 + 仓内补位族并存）；
>   `tokens.css` 退为**别名层 + 非颜色层**（motion / 字体栈 / 阴影 / 圆角仍归它）。逐名归属见
>   `docs/research/412-token-mapping.md`。
> - **计数口径变了**，原文的「119 定义 / 109 被消费」不再可比。现值：`tokens.css` + `shadcn.css` 共定义 **153** 名；
>   全 src 消费 **129** 名（只按 `var(--x)` 判）/ **135** 名（连 tailwind 简写 `-(--x)` 一起判）。
> - **死 token：19 → 0**。原文那 19 名整族已被 `#449` 清掉（`--col-dot-*` 只剩 idle/confirm/building 三态、且都被消费）。
>   复核口径：`tokens.css` + `shadcn.css` 的 defined-but-unused，**同时算 `var(--x)` 与 tailwind 简写 `-(--x)` 两种消费形态**，
>   并剔除 tailwind `@theme` 命名空间（`--color-*` / `--radius-*`，经工具类间接消费，不该记死）。
>   只按 `var(--` 单形态判会把 `--badge-attention`（消费在 `board/todo-card.tsx:123` 的 `bg-(--badge-attention)`）误记成死。
>   全仓 css 范围内唯一 defined-but-unused 的是 `styles/fonts.css:37` 的 `--font-jetbrains-mono`。
> - **悬空 token：5 → 0**。`overlay/mention-picker.css` 里的 `--border` / `--text` / `--text-muted` /
>   `--surface-base` / `--ring` 已由 `#427` 重接仓内单源，该文件现 **0 处**引用它们。原文「这是现存缺陷也是迁移必答题」已结。
> - **全局层四件体量也变了**：`tokens.css` 16.4K → **5.9K**（111 行，颜色值已迁出）；新增 `styles/shadcn.css`
>   **15.6K**（355 行），它不直接被 tsx 引、只经 `styles/app.css` 的 `@import "./shadcn.css"` 注入
>   （TW4 只在含 `@import "tailwindcss"` 的样式表里吃 `@theme`）。`fonts.css` 1.0K / `motion.css` 4.8K / `app.css` 4.3K。
> - 自足 fallback（非缺陷）仍只有 `detail/detail.css` 的 `--color-danger` / `--color-warning`（各 2 处，带 hex fallback）。

### 2.2 原语层（ui/ 6 件，各随 tsx 自引）

button.css ← button.tsx；card.css ← card.tsx（死）；chip.css ← chip.tsx + **tag-chip.tsx 双引**；dialog.css ← dialog-shell.tsx；input.css ← input.tsx；tag-chip.css ← tag-chip.tsx。

> **偏差标注（复核 @ `9a0613b`）**——原语层现 7 件 css（原 6 件 + `kbd-hint.css`），边有一处变：
> `dialog.css ← components/ui/dialog-shell.tsx`（定义它的 tsx 换了目录）。其余照旧：
> `button.css ← button.tsx`、`card.css ← card.tsx`（**死**）、`chip.css ← chip.tsx + tag-chip.tsx 双引`、
> `input.css ← input.tsx`、`tag-chip.css ← tag-chip.tsx`、`kbd-hint.css ← kbd-hint.tsx`。
>
> 另：`#425` 之后 `ui/dialog.css` 已不含壳级规则——`.dlg-backdrop` / `.dlg` / `.dlg-head` / `.dlg-title` /
> `.dlg-close` / `.dlg-body` / `.dlg-foot` 随适配层退役，壳机制换 Base UI Dialog、几何改由适配层工具类承载
> （值与原规则逐条对齐）。本文件现只留 `dlg-form-*` 表单族、选择器驱动的退场配方
> （`.dlg-shell[data-ending-style]` / `.dlg-viewport[data-ending-style]`）与视口根容器，以及各 per-face 弹窗类。

### 2.3 域层（13 件散件）——import 边全表

| css | decl 数 | import 它的 tsx | 覆盖界面 |
|---|---|---|---|
| board/board.css | 257 | board/board.tsx、routes/board-page.tsx | 看板列/拖拽/topbar |
| board/sidebar.css | 241 | board/sidebar.tsx | 侧栏树 + rail 窄栏（经 shell 复用于全域） |
| chief/chief.css | 464 | chief/chief-drawer.tsx、chief/chief-settings.tsx | 总管抽屉 + 设置 |
| detail/detail.css | 852 | routes/todo-detail-page.tsx（路由级单引） | 任务详情 3 pane + transcript/diff/spec-block |
| detail/overlays.css | 404 | detail/{accept-dialog, branch-dialog, right-pane, stop-confirm-dialog}.tsx | 详情域弹层内容 + 右 pane 静止 section（dlg-* 内容族） |
| overlay/overlay.css | 278 | overlay/{new-task-dialog, delete-confirm, delete-project-confirm, more-menu}.tsx | 弹层批 A（#66）：新建任务 + 删除确认 + ⋯菜单（#394 后瘦身） |
| overlay/mention-picker.css | 223 | overlay/mention-picker.tsx、detail/segments.tsx | 提及弹层（死 token 面，§2.1） |
| overlay/token-gate.css | 30 | overlay/token-gate.tsx | token 闸页（最小散件） |
| overlays/overlays.css | 241 | overlays/{search-panel, chip-popover, plan-dropdown, dismiss}.tsx | 弹层批 B（#67）：⌘K 搜索 + 状态 popover + 方案下拉 |
| pages/pages.css | 899 | pages/{project-new, project, project-settings, schedules}-page.tsx | 4 个 pages/* 页（最大散件） |
| resources/resources.css | 326 | resources/shell.tsx（shell 模式单引） | machines/providers/secrets/skills/mcp-servers 5 页 |
| routes/machine-authorize.css | 41 | routes/machine-authorize-page.tsx | 授权机器页（独立小件） |
| secondary/secondary.css | 389 | secondary/shell.tsx（shell 模式单引） | account/team/api-keys 3 页 |

结构观察：
- **shell 模式两处**：resources/shell.tsx 与 secondary/shell.tsx 各自单引域 css 并内嵌 AppSidebar——routes/ 下 account/team/api-keys 三页自身 0 css import，样式全经 secondary.css 注入。
- **路由级直引两处**：todo-detail-page.tsx 引 detail.css、board-page.tsx 引 board.css（域组件自身不引，由路由兜底）。
- **overlay/ 与 overlays/ 是两个目录**（弹层分批 #66/#67 的历史形态），加 detail/overlays.css 共三个「overlays」命名物——迁移时命名归一可顺带做。

> **偏差标注（复核 @ `9a0613b`）**——域层仍 13 件，成员换了两件：
>
> - **删**：`overlay/token-gate.css`、`routes/machine-authorize.css`（`#474` 两件都切了 shadcn 件）。
> - **增**：`routes/agent-detail.css`（由 `routes/agent-detail-page.tsx` 路由级直引，与 detail.css / board.css 同形）。
> - `board/sidebar.css` 除名后 `board/board.css` 自身也瘦成「#414 试点后的残留层」：只剩跨域共用件
>   （`.project-avatar` / `.chief-fab`）、未迁的 `.board-notify-banner*`、行为态规则（拖拽锁选 / 升层阴影 / 落点染色）。
> - 三条结构观察仍成立、各多一例：**shell 模式**仍是 `resources/shell.tsx` / `secondary/shell.tsx` 两处；
>   **路由级直引** 2 处 → **3 处**（+`routes/agent-detail-page.tsx` → `agent-detail.css`）；
>   **三处 overlays 命名物**（`overlay/`、`overlays/`、`detail/overlays.css`）仍未归一。
> - 上面那张「import 它的 tsx」全表已整体过期；现值以 `grep -rn --include='*.tsx' --include='*.ts' -E "^import .*\.css"` 的 **37** 条边为准。

## 3. 三面钉扎点清单

### 3.1 web e2e 类名断言（apps/web/e2e/，50 个 spec，1278 个 expect）

- **872 处 `.locator('.…')` 类名钉扎，钉 302 个 distinct 选择子**（含 `.x .y` 复合与 `[attr]` 组合）。46/50 个 spec 有类名钉扎。
- 非类名定位极少：getByRole ×8、getByText ×3、getByLabel/Placeholder ×0、data-testid ×0；locator 内 aria-label 组合 ×43。**类名是唯一规模化定位机制**——shadcn 切换（类名全换）对这面是全面重钉，无侥幸面。
- 钉扎密度 Top 5 spec：dead-buttons 119（76 distinct，全站死钮普查面）、provider-add-dialog 51、chief-settings 49、project-tasks-toolbar 36、detail-3pane 34 / dialog-viewport 34。
- 选择子族分布（300 distinct 按前缀）：prj-* 42、dlg-* 35、chief-* 23、res-* 18、board-* 18、new-task-* 14、sched-* 13、sidebar-* 11、detail-* 10、team-* 9、delete-* 9、doc-* 8、search-* 7、diff-* 6、account-* 6、token-gate-* 5、rail-* 5、overlay-* 5、chat-* 5……（全量按文件清单见附录 A）
- 单选择子热度 Top：`.dlg` ×67（11 个 DialogShell 共享壳类，最热单点）、`.dlg-provider-preset` ×20、`.sidebar-row` ×17、`.dlg-title` ×16、`.diff-expand` ×12、`.chief-pick-row` ×11。

> **偏差标注（复核 @ `9a0613b`）**——这一面是本次复核里涨得最猛的，原文的计数全部过期：

| 项 | 原文 @ `8c30775` | 现值 @ `9a0613b` |
|---|---|---|
| spec 数 | 50 | **66** |
| `expect(` 处数 | 1278 | **1871** |
| `locator('.…')` 处数 | 872 | **1200** |
| distinct 选择子 | 302 | **479** |
| 有类名钉扎的 spec | 46 / 50 | **61 / 66** |
| getByRole / getByText | 8 / 3 | 13 / 8 |
| getByLabel / getByPlaceholder | 0 / 0 | 0 / 0 |
| `data-testid` | 0 | **首次出现**：`e2e/github-issue-writeback.spec.ts` 用 `[data-testid="source-issue-*"]` |
| locator 内 aria-label 组合 | 43 | 53 |

> 结论方向没变：**类名仍是唯一规模化定位机制**。密度 Top 5 换成 dead-buttons **127 处 / 95 distinct**、
> `agent-detail` **77 / 41**、`provider-add-dialog` 51、`chief-settings` 49、`project-new-dir-browser` 38
> （`detail-3pane` 与 `dialog-viewport` 各 36 并列其后）。最热单点 `.dlg` 67 → **69**。
>
> 族分布重算（口径：从 distinct 选择子串直接取 `^\.[a-z0-9]+-` 前缀，复合选择子若不以带 `-` 的类开头则不归类——
> 与原文「首类归并」口径**不完全等同**，仅供量级参考）：`prj-*` 52、`dlg-*` 38、`agent-*` 35、`chief-*` 29、
> `team-*` 26、`board-*` 25、`res-*` 23、`chat-*` 18、`detail-*` 15、`new-*` 14、`sidebar-*` 12、`sched-*` 12。
> `agent-*` 自成一族（配套 `routes/agent-detail.css` + #497 等），原文的族表里没有它。原文那张表按任何口径重算都会全变，不逐格复刻。

### 3.2 integration locator（integration/test/，vitest + playwright）

- 3 个文件用类名 locator，共 **59 处钉 40 个 distinct 选择子**：m5-web-e2e.test.ts 38（28 distinct）、task-meta-e2e.test.ts 13（12 distinct）、m7-branch-dialog-e2e.test.ts 8（6 distinct）。其余 13 个 integration 测试不打 UI。
- 与 web e2e 高度同族（.todo-card/.board-new-task/.new-task-*/.dlg-*/.detail-*/.sched-*/.doc-*），即同一批类名被两面同钉——改一处类名两面齐碎。
- 非类名：getByRole ×2，其余个别文本定位。

> **偏差标注（复核 @ `9a0613b`）**——钉扎处数**一字未动**：仍是 3 个文件、**59 处**。变的是 distinct 与分母：
>
> - distinct **40 → 36**：m5-web-e2e 28 → **24**、task-meta-e2e 12 → **10**、m7-branch-dialog-e2e 6 → **6**。
> - `integration/test/` 现有 **17** 个 `*.test.ts`（原文 16）；仍是同样 3 个打 UI、其余 14 个不打。
> - 「与 web e2e 高度同族、两面同钉、改一处齐碎」的判断仍成立。

### 3.3 视觉几何断言

- **`toHaveScreenshot` 全仓 0 处**——「视觉 spec」不落截图基线，全部是**数值几何/计算样式断言**，重钉 = 改数字与选择子，不涉及位图再基线化。
- 专职视觉 spec 两个，均走 `page.evaluate` 探针（getComputedStyle + getBoundingClientRect）：
  - visual-polish.spec.ts：30 expects，4 个 evaluate 探针。钉卡片/列/通知条/菜单的 border=0 + radius=12px + shadow/ring 配方（#161 边缘家族）、侧栏与主区同底（#390）、scrollbar 形态、rail borderRight/shadow。
  - sidebar-visual.spec.ts：19 expects，7 个探针。钉 .sidebar-row 选中态 inset（top/bottom 2px、radius 6px）、行宽=侧栏 clientWidth、sidebarWidth=240、online-dot 定位、hover 配色一致性。
- **boundingBox 36 处散在 8 个行为 spec**：board-dnd 10（拖拽几何）、providers-tabs 6、shell-consistency 5、dialog-viewport 4、chief-panel 3、segmented-controls 3、user-menu-trigger 3、collapse-family 2。
- 视觉面探针选择子集中在 sidebar/board 两族（.board-sidebar .sidebar-row* .sidebar-online-dot .sidebar-kbd .board-topbar .board-main .board-scroller）——**侧栏是几何钉扎最密的域**。

> **偏差标注（复核 @ `9a0613b`）**：
>
> - `toHaveScreenshot` 仍**全仓 0 处**——「视觉 spec 不落截图基线」是本次复核里少数**完全没变**的事实。
> - `visual-polish.spec.ts`：30 expects → **31**；`page.evaluate` 探针 4 → **1**（探针收敛了）。
>   `sidebar-visual.spec.ts`：19 expects / 7 探针，**与原文逐字一致**。
> - `boundingBox`：**36 处散在 8 个 spec → 63 处散在 13 个 spec**。新增的 6 个 spec：
>   `agent-create-model`、`agent-detail`、`board-overflow`、`chief-fab`、`skills-readonly`、`team-org-chart`。

### 3.4 三面合流的重钉含义

- 最热重钉单点 = `.dlg`（67 处 web e2e + integration 同族）——它钉的是 ui/dialog.css 的壳基类，11 个 DialogShell 消费面共享；shadcn Dialog 换壳时壳类别名策略（保留 .dlg 还是全面换钉）是第一裁决。
- per-face 别名（§1.1 律 3）与三面钉扎是同一份契约的两端：组件层换实现时别名保留 ⇒ 三面零改动；别名不保留 ⇒ 853+59+几何面同步重钉。**重钉策略票可直接据此量化两案成本**。

> **偏差标注（复核 @ `9a0613b`）**——结论仍成立，但已被执行验证过一轮：`.dlg` 别名确实被保留（69 处钉扎零改动），
> `#411 别名优先政策`把它写成了仓级规则。原文「重钉策略票可直接据此量化两案成本」这一步已被 `#425` 的选择
> （换壳机制 + 保别名）走掉，两案不再并列。

## 4. 「一域一样式」散件分布与收编难度分级

视觉密度口径：声明中含 color/background/shadow/border/radius/font/outline/opacity/filter 的比例（全仓域 css 无纯布局壳——最低 sidebar 26% 也带实色配方）。

| css | decl | 视觉占比 | 覆盖 | 收编难度 | 理由 |
|---|---|---|---|---|---|
| overlay/token-gate.css | 30 | 47% | 单页 | **低** | 已 Button/Input 原语化，余量仅壳布局 |
| routes/machine-authorize.css | 41 | 51% | 单页 | **低** | 单页单卡（authorize-card 族 1 处） |
| overlay/mention-picker.css | 223 | 48% | 提及弹层 | **中（须先修）** | 死 token 面（§2.1），迁前须重接 token 才有真基线 |
| board/board.css | 257 | 28% | 看板 | **中** | 布局为主（列/拖拽/滚动），但 board-dnd 10 处 boundingBox 钉拖拽几何 |
| board/sidebar.css | 241 | 26% | 侧栏+rail | **中** | 全仓最几何敏感：sidebar-visual 19 expects + collapse/shell 两 spec 同钉 |
| overlays/overlays.css | 241 | 36% | 搜索/popover/下拉 | **中** | search-* 7 + chip-popover + plan-dropdown 族；⌘K 面板形态独立 |
| resources/resources.css | 326 | 33% | 5 页 | **中** | res-* 18 选择子 / res-card 行卡族；5 页同族收编一次到位 |
| overlay/overlay.css | 278 | 34% | 新建任务+删除+菜单 | **中** | #394 后瘦身；new-task-dialog 18.6K 且已出 DialogShell 族（§1.1 律 2），单独立项感强 |
| secondary/secondary.css | 389 | 37% | 3 页 | **中** | account/team/keys 三页 + team-agent-card/account-card 两卡族 |
| detail/overlays.css | 404 | 41% | 详情弹层内容 | **中** | 壳已上提 ui/dialog.css，余 dlg-* 内容族随 DialogShell 迁移顺带 |
| chief/chief.css | 464 | 38% | 总管 | **高** | chief-* 22 选择子 + chief-settings 49 处钉扎（单 spec 密度第 3） |
| detail/detail.css | 852 | 33% | 任务详情全域 | **高** | 最大技术深度：transcript/diff/spec-block 组件级视觉（diff-* 族双 spec 同钉）+ todo-detail-page.tsx 41K 全仓最大单文件 |
| pages/pages.css | 899 | 38% | 4 页 | **高** | 最大散件：prj-* 42 选择子（族最大户）+ sched-* 13，project-new github/repo 双流程 |

分级合计：**低 2 / 中 9（含 1 个须先修）/ 高 3**——13 件域散件无一件是纯布局壳。
建议切片顺序（供蓝图票参考，非裁决）：低难度两件（token-gate、machine-authorize）当试点热身——面小、钉扎少（token-gate spec 16 处但选择子只 6 个）、已部分原语化；中难度里 resources 或 secondary 当第一个「真域」（shell 模式单引 css，收编边界整齐）；高三件（chief/detail/pages）留到 token 管道与重钉策略稳定后。

> **偏差标注（复核 @ `9a0613b`）**——分级的**方法**（视觉密度口径、四档难度）仍可用，但成员表与切片建议已被执行进度盖过：
>
> - **原文建议的切片顺序基本被照做**：`#474` 先做两件低难度热身（token-gate、machine-authorize），
>   `#481` 接着做第一个「真域」resources（原文是「resources 或 secondary」二选一，取的是 resources）。
>   这两件低难度散件在表里**已不存在**，resources 也不再是待收编项。
> - **中难度里的一件已消前提**：`overlay/mention-picker.css` 的「须先修」（悬空 token）由 `#427` 消除。
> - **成员表变了**：删 2（token-gate / machine-authorize）、增 1（`routes/agent-detail.css`，未在原文分级里）、
>   `board/sidebar.css` 除名。
> - 高三件（chief / detail / pages）**仍在原地**；按 `#522`（`docs/417`）的批次表，铺开仍在推进中。
> - Both columns of the original were recomputed under **the same convention** and can be compared directly. The decl convention is taken from this repo's `docs/spec/16-shadcn-rollout-batch-table-and-acceptance-criteria.md` §7
>   的取数命令（`grep -cE '^[[:space:]]*[-a-zA-Z]+[[:space:]]*:.*;'`）；视觉占比口径同原文（decl 行里属性命中
>   color/background/shadow/border/radius/font/outline/opacity/filter 等的比例）：

| css | decl @ `8c30775` | decl @ `9a0613b` | 视觉占比 @ `9a0613b`（原文值） | 状态 |
|---|---|---|---|---|
| pages/pages.css | 899 | 1094 | 38%（38%） | 未迁 |
| detail/detail.css | 852 | 955 | 33%（33%） | 未迁 |
| secondary/secondary.css | 389 | 491 | 34%（37%） | 未迁 |
| chief/chief.css | 464 | 470 | 37%（38%） | 未迁 |
| detail/overlays.css | 404 | 420 | 41%（41%） | 壳已上提，内容族未迁 |
| resources/resources.css | 326 | 363 | 35%（33%） | 域已切 shadcn（#481），本文件仍在 |
| overlays/overlays.css | 241 | 238 | 37%（36%） | 未迁（sidebar 规则并入此处） |
| overlay/overlay.css | 278 | 240 | 35%（34%） | 未迁 |
| overlay/mention-picker.css | 223 | 227 | 49%（48%） | 未迁（悬空 token 已修，#427） |
| board/board.css | 257 | **64** | 35%（28%） | 看板已迁 shadcn（#414），本文件成残留层 |
| board/sidebar.css | 241 | **—** | —（26%） | **文件已删**，规则并入 overlays/overlays.css |
| ui/dialog.css | 126 | 93 | 44% | 壳级规则已退役（#425），余表单族与 per-face 类 |
| overlay/token-gate.css | 30 | **—** | —（47%） | **文件已删**（#474 切 shadcn 件） |
| routes/machine-authorize.css | 41 | **—** | —（51%） | **文件已删**（#474 切 shadcn 件） |
| routes/agent-detail.css | — | 185 | 40% | **新增**，原文分级里没有它 |
| styles/shadcn.css | — | 210 | —（值文件，该口径不适用） | **新增**（#435 值正本） |
| ui/kbd-hint.css | — | 21 | 38% | **新增**（#468） |

> 视觉占比复算值与原文逐行落在 ±3 个百分点内，说明原文口径可复现；`board/board.css` 的 28% → 35% 是文件瘦身后
> 分母变小所致，不是配方变多。

## 附录 A：web e2e 类名钉扎按文件全表（46 spec，基线 8c30775）

列 = spec（去 .spec.ts）｜钉扎处数｜distinct 数｜distinct 选择子（首类，复合选择子按首类归并）。

> **偏差标注（复核 @ `9a0613b`）**——本附录是 `8c30775` 时点的 46 spec 全表，**不能当现行清单用**：
> 现 e2e 共 **66** 个 spec、其中 **61** 个有类名钉扎，表内每行的「处 / distinct / 选择子」都可能已变
> （例：dead-buttons 119 → 127 处、76 → 95 distinct；新增 `agent-detail`、`agent-create-model`、`project-new-dir-browser`、
> `team-org-chart`、`skills-readonly` 等一批 spec 整行缺位）。
> **本表保留原样**——它的价值正是「与当前树对照」。要现行清单，按 §3.1 偏差块的口径重跑一遍。
> 附录标题里的「基线 8c30775」是原文自带的，未改。

| spec | 处 | distinct | 选择子 |
|---|---|---|---|
| account-team-cleanse | 21 | 12 | .account-avatar .account-card .account-delete .account-logout .account-swap .account-switch .secondary-link .team-agent-card .team-chart-empty .team-create-agent .team-layout-tab .team-members |
| avatar-dicebear | 21 | 15 | .chip-popover .chip-popover-row .chip-popover-section--selected .dlg-agent-avatar .prj-task-avatar .rail-user .search-panel .search-row-icon--agent .sidebar-row .sidebar-user .team-agent-avatar .team-agent-card .team-create-agent .todo-agent-avatar .user-menu-head |
| board-dnd | 9 | 4 | .board-drag-overlay .board-scroller .board-sidebar .todo-card-action--ghost |
| brand-typo | 1 | 1 | .res-back |
| chief-panel | 11 | 7 | .chief-composer-bar .chief-drawer .chief-example .chief-examples .chief-stream .chief-switcher .secondary-fab |
| chief-settings | 49 | 15 | .chief-agent-row .chief-dlg-charter-input .chief-dlg-ghost .chief-dlg-primary .chief-edit-btn .chief-model-menu .chief-model-row .chief-model-row-provider .chief-pick-empty .chief-pick-input .chief-pick-name .chief-pick-row .dlg .dlg-close .dlg-title |
| chip-assign | 25 | 12 | .chief-pick-check .chief-pick-empty .chief-pick-input .chief-pick-name .chief-pick-row .chip-popover .chip-popover-edit .chip-popover-section--selected .detail-chip .dlg .dlg-close .dlg-title |
| collapse-family | 28 | 10 | .board-column .board-column--collapsed .board-column-collapse .board-column-count .board-column-strip .rail-group .rail-row .sidebar-group .sidebar-group--collapsed .sidebar-subrow |
| dead-buttons | 119 | 76 | .account-avatar .account-swap .board-guide .board-guide-pop .board-guide-wrap .board-new-task .board-topbar-actions .btn--overlay .chat-collapse .chat-tool-pill .chief-head-actions .chief-pick-row .composer-toolbar .delete-confirm .delete-confirm-delete .detail-head-action .detail-head-icon--more .detail-right .dlg .dlg-agent-avatar .dlg-agent-swap .dlg-title .doc-empty .doc-select-wrap .keys-create .keys-docs .keys-empty .more-menu .more-menu-item .new-task-close .new-task-dialog .new-task-discard .new-task-discard-drop .new-task-discard-keep .new-task-spec .new-task-tools .overlay .overlay-title .plan-dropdown .plan-dropdown-row .prj-branch-chip .prj-file-row .prj-files-seg-tab .prj-files-share .prj-history-row .prj-set-avatar .prj-set-change .prj-task-card .prj-task-row .prj-tasks-view-btn .rerun-agent-label .rerun-agent-name .rerun-agent-row .rerun-switch .res-doclink .res-dot .res-empty .res-empty-desc .res-grow .res-new .res-row-more .res-rowcard .res-rowcard--mcp .res-sort .res-sort-menu .res-sort-row .sched-card .sched-card-menu .sched-card-menu-row .sched-card-more .sched-empty .sched-empty-docs .sched-empty-new .sidebar-user .team-create-agent .user-menu |
| detail-3pane | 34 | 16 | .chat-plan-open .detail-center .detail-head .detail-head-icon--more .detail-right .detail-tab .detail-tabs .detail-tabs-group .dlg .dlg-token-total .doc-pane .doc-pane-body .doc-select-wrap .plan-dropdown .plan-dropdown-row .right-empty |
| dialog-viewport | 34 | 24 | .chief-agent-row .chief-dlg-ghost .chief-dlg-primary .chief-edit-btn .chief-pick-list .dlg .dlg-accept-cancel .dlg-accept-done .dlg-agent-create .dlg-body .dlg-branch-body .dlg-enroll-apikey .dlg-enroll-keylink .dlg-enroll-toggle .dlg-provider-create .dlg-provider-custom .dlg-provider-model-add .dlg-secret-create .dlg-seg-tab .dlg-sync .res-add .res-new .team-create-agent .todo-card-branch |
| diff-full-file | 20 | 6 | .diff-expand .diff-full .diff-hunk-head .diff-line .diff-line--add .diff-no--new |
| file-viewer | 12 | 6 | .prj-file-content .prj-file-row .prj-file-row--active .prj-files-seg-tab .prj-files-viewer .prj-history-row |
| hotkeys | 18 | 9 | .chief-composer-input .chief-drawer .new-task-dialog .new-task-project-name .new-task-spec .search-input-row .search-panel .sidebar-kbd .sidebar-row |
| machine-add-dialog | 22 | 12 | .dlg .dlg-close .dlg-enroll-apikey .dlg-enroll-browserlink .dlg-enroll-cmd .dlg-enroll-copy .dlg-enroll-desc .dlg-enroll-keylink .dlg-enroll-lead .dlg-enroll-toggle .dlg-title .res-add |
| machines-local | 1 | 1 | .res-row-title |
| newtask-project-select | 18 | 6 | .board-new-task .new-task-dialog .new-task-project .new-task-project-menu .new-task-project-name .new-task-project-row |
| newtask-single-field | 12 | 7 | .board-new-task .new-task-dialog .new-task-input .new-task-spec .new-task-tag-add .new-task-tags .todo-card-title |
| notify-banner | 9 | 4 | .board-notify-banner .board-notify-banner-action .board-notify-banner-body .board-notify-banner-title |
| overlay-focus | 12 | 7 | .board-new-task .new-task-dialog .overlay-mount .page-new-action .sched-form-cancel .sched-form-close .sched-form-overlay |
| plan-diff-full-file | 20 | 6 | .diff-expand .diff-full .diff-hunk-head .diff-line .diff-line--add .diff-no--new |
| project-empty-new-task | 8 | 6 | .new-task-dialog .new-task-project-name .new-task-spec .prj-task-row .prj-tasks-empty .prj-tasks-empty-new |
| project-files-local-disabled | 12 | 4 | .page-tab .prj-files-disabled .prj-files-pane .prj-task-row |
| project-new-github | 31 | 13 | .prj-new-gh-auth .prj-new-gh-disconnect .prj-new-gh-empty .prj-new-gh-error .prj-new-gh-link .prj-new-gh-login .prj-new-gh-picker .prj-new-gh-row .prj-new-gh-search .prj-new-repo-input .prj-new-repo-menu .prj-new-repo-menu-row .prj-new-repo-swap |
| project-new-repo | 22 | 7 | .prj-new-error .prj-new-gh-auth .prj-new-gh-link .prj-new-repo-menu .prj-new-repo-menu-row .prj-new-repo-swap .prj-new-submit |
| project-settings-delete | 13 | 11 | .delete-confirm--project .delete-confirm-cancel .delete-confirm-close .delete-confirm-delete .delete-confirm-input .delete-confirm-prompt .delete-confirm-summary .delete-confirm-title .prj-set-danger-label .prj-set-danger-title .prj-set-delete |
| project-tasks-toolbar | 36 | 9 | .prj-task-card .prj-task-row .prj-tasks-empty .prj-tasks-filter .prj-tasks-menu .prj-tasks-menu-row .prj-tasks-nomatch .prj-tasks-search .prj-tasks-view-btn |
| provider-add-dialog | 51 | 13 | .dlg .dlg-close .dlg-provider-back .dlg-provider-badge .dlg-provider-create .dlg-provider-custom .dlg-provider-model-add .dlg-provider-note .dlg-provider-preset .dlg-provider-search .dlg-provider-seg-tab .dlg-title .res-new |
| provider-oauth | 22 | 6 | .dlg .dlg-provider-badge .dlg-provider-note .dlg-provider-oauth-error .dlg-provider-preset .res-new |
| reject-chain | 18 | 13 | .chat-plan-title .chat-streaming-label .composer-send .detail-chip .detail-head-action .diff-hunk-head .diff-line--add .doc-file-row .doc-pane-select .doc-range-chip .doc-range-wrap .version-menu--sub .version-menu-row |
| rerun-close-family | 9 | 4 | .overlay .overlay-back .overlay-close .overlay-title |
| search-focus | 11 | 9 | .rail-row--selected .search-group-label .search-input-row .search-panel .search-row .search-row--selected .search-row--todo .sidebar-row .sidebar-row--selected |
| search-result-rows | 7 | 6 | .detail-shell .search-panel .search-row .search-row--selected .search-row--todo .sidebar-row |
| secret-add-dialog | 13 | 6 | .dlg .dlg-close .dlg-secret-create .dlg-secret-note .dlg-title .res-new |
| segmented-controls | 23 | 14 | .chief-tab .dlg .dlg-seg-tab .page-tab .prj-files .prj-files-seg-tab .prj-tasks-view-btn .sched-form-freq .sched-form-freq-tab .sched-form-freq-tab--active .team-layout-tab .team-layout-tab--active .todo-card-branch .user-menu-seg |
| shell-consistency | 18 | 10 | .board-sidebar .board-sidebar--collapsed .chief-drawer .rail-row .sidebar-row .sidebar-subrow .sidebar-team-collapse .sidebar-team-name .team-plan .team-upgrade |
| sidebar-nav | 15 | 9 | .board-sidebar .rail-install .rail-row .sidebar-install .sidebar-row .sidebar-subrow .sidebar-team-name .sidebar-team-row .sidebar-user |
| sidebar-search-offboard | 2 | 2 | .search-panel .sidebar-row |
| skills-readonly | 13 | 7 | .res-empty .res-empty-desc .res-empty-hint .res-empty-title .res-new .res-primary .res-rowcard |
| team-create-agent | 16 | 9 | .dlg .dlg-agent-configure .dlg-agent-create .dlg-agent-warn .dlg-close .dlg-title .team-chart-empty .team-create-agent .team-layout-tab |
| theme-toggle | 2 | 1 | .user-menu-seg |
| title-band-clicks | 4 | 4 | .res-back .res-new .secondary-back .secondary-head-right |
| token-gate | 16 | 6 | .board-sidebar .token-gate .token-gate-error .token-gate-input .token-gate-submit .token-gate-title |
| user-menu-nav | 4 | 3 | .sidebar-user .user-menu .user-menu-row |
| user-menu-trigger | 8 | 4 | .rail-user .sidebar-user .user-menu .user-menu-seg |
| visual-polish | 2 | 2 | .board-scroller .board-sidebar--collapsed |

## 附录 B：integration 类名钉扎按文件全表（3 spec，基线 8c30775）

| spec | 处 | distinct | 选择子 |
|---|---|---|---|
| m5-web-e2e | 38 | 28 | .board-column .board-column-name .board-new-task .chat-bubble .chat-note .chat-plan-title .chat-scheduled .composer-input .composer-send .detail-chip .detail-head-action .detail-shell .dlg-accept-done .doc-file-row .doc-pane-select .doc-range-chip .doc-range-wrap .new-task-spec .new-task-start .page-new-action .sched-card .sched-form .sched-form-freq-tab .sched-form-save .todo-card .todo-card-link .todo-card-title .version-menu-row |
| task-meta-e2e | 13 | 12 | .board-new-task .detail-shell .fresh-tags .new-task-dialog .new-task-input .new-task-save .new-task-spec .new-task-tag-add .new-task-tags .todo-card .todo-card-link .todo-card-title |
| m7-branch-dialog-e2e | 8 | 6 | .detail-right .dlg-branch-value .dlg-dir--input .dlg-machine .dlg-machine-menu .plan-dropdown-row |

> **偏差标注（复核 @ `9a0613b`）**——处数列（38 / 13 / 8 = 59）**与现值完全一致**；distinct 列现值：
> m5-web-e2e 28 → **24**、task-meta-e2e 12 → **10**、m7-branch-dialog-e2e 6 → **6**（合计 40 → **36**）。

## 附录 C：死 token 与悬空 token 全单

- 死 token（tokens.css 定义、全 src 零消费，19）：--active-text、--blue-400、--card-ghost-border、--chip-active-bg、--chip-active-border、--col-dot-building、--col-dot-confirm、--col-dot-idle、--col-dot-planning、--col-dot-review、--disabled-fg、--indigo-400、--nav-bg、--send-disabled、--space-1、--space-2、--space-3、--space-4、--space-6。
- 悬空 token（消费但全仓无定义，5，均在 overlay/mention-picker.css）：--border（5 处）、--text（5 处）、--text-muted（5 处）、--surface-base（4 处）、--ring（1 处）。
- 自足 fallback（非缺陷）：detail.css 的 --color-danger/--color-warning（各 2 处，均带 hex fallback）；fonts.css 的 --font-inter 与 detail.css 的 --detail-pane-right 为本地定义本地用。

> **偏差标注（复核 @ `9a0613b`）**——三条现状：
>
> - **死 token：19 → 0**。`#449` 清掉 16 名。原文 19 名里 `--col-dot-*` 五态现只剩 idle / confirm / building 三个
>   定义（planning / review 已删），且三个**都有活消费点**（`src/board/columns.ts:52,60,67` 的 `dot:` 值）——
>   定义见 `styles/shadcn.css:143–145`（`.light` 镜像 283–285）。按 §2.1 偏差块的复合口径重跑，`tokens.css` +
>   `shadcn.css` 范围内 defined-but-unused 为 **0**；全仓 css 范围内只剩 `styles/fonts.css:37` 的 `--font-jetbrains-mono`。
> - **悬空 token：5 → 0**。整条已由 `#427` 解决，`overlay/mention-picker.css` 现 0 处引用它们。
> - **自足 fallback**：`detail/detail.css` 的 `--color-danger` / `--color-warning` 仍在（各 2 处，带 hex fallback）；
>   新增一处同性质写法 `secondary/secondary.css:429` 的 `var(--card-border-hover, var(--text-tertiary))`。
>   `--font-inter` / `--detail-pane-right` 不变。
