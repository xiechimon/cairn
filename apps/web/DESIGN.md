---
name: Pacman
direction: Paper Dense · Grouped sidebar · Hybrid type
reference: docs/board-paper-r5.html?v=3
reference-dark: docs/board-paper-dark.html
colors:
  # 亮色为基准主题（定稿值）；暗色值在 colors-dark，规则见「暗色」一节
  canvas: '#f3eee5'        # 应用底色：侧栏与主面板之外的纸面
  sheet: '#fbf9f5'         # 主面板（圆角纸张）
  card: '#ffffff'          # 任务卡
  hover: '#ebe4d8'         # 侧栏行 hover
  line: '#ece5da'          # 卡片发丝环
  rule: '#e6dfd2'          # 列标题下划线
  divider: '#eee7dc'       # 顶栏下边线
  ink: '#2b2620'           # 标题、正文、主按钮底
  ink-2: '#5e564d'         # 次级文字（导航、按钮、说明）
  ink-3: '#746a5f'         # 元信息（项目、时间、计数）
  ink-4: '#b0a597'         # 仅装饰图标，不用于文字
  icon: '#9a9086'          # 带文字标签的图标（侧栏导航、列标题）
  accent: '#b4532a'        # 赭红：需要你处理、操作链接、计数徽章、激活图标
  accent-hover: '#f6ebe3'  # 操作链接 hover 底
  menu-hover: '#f6f2ec'    # 菜单行 hover 底
  backdrop: 'rgba(43, 38, 32, 0.14)'  # 弹窗背板（浅墨 dim，无 blur）
  running: '#5f8f5a'       # 执行中图标、在线点
  running-text: '#4f7049'  # 执行中说明文字
  running-bar: '#7ea476'
  running-track: '#ebe5da'
  online-ring: '#dfe9da'
  project-tiles: ['#c06a43', '#7d8b5a', '#6b7a8f', '#a0784a', '#8a6a9a', '#4f8a8b']
colors-dark:
  # 暗色（:root 默认）：同一阶梯的暖深纸面，海拔越高越亮；实测表 docs/verify/1396/contrast.txt
  canvas: '#1a1612'
  sheet: '#24201b'
  card: '#2f2a26'
  popover: '#37322d'       # 菜单与弹窗：卡片之上再亮一档（亮色里 popover 与 card 同为白）
  hover: 'rgb(255 252 248 / 0.05)'  # 侧栏行 hover：暖白 5% 盖在 canvas 上
  line: '#3e3a34'          # 发丝环、列标题下划线、顶栏下边线同一条
  rule: '#3e3a34'
  divider: '#3e3a34'
  ink: '#ece7df'
  ink-2: '#c5c0b9'
  ink-3: '#aca7a0'
  ink-4: '#7a756f'         # 仅装饰图标，不用于文字
  icon: '#908b85'
  accent: '#f0926d'        # 赭红提亮；其上的字是 on-accent 深墨，不是白
  on-accent: '#1a1612'
  accent-hover: '#46362f'  # 赭红 12% 染进卡底
  menu-hover: '#403b36'
  backdrop: 'rgba(0, 0, 0, 0.45)'
  running: '#7fb980'
  running-text: '#99ce9a'
  running-bar: '#70a971'
  running-track: '#3e3a34'
  online-ring: '#283b29'
  project-tiles: ['#da8f72', '#9eac76', '#8ba8c6', '#cca26e', '#b19ac4', '#6eb3b2']
typography:
  page-title:   { fontFamily: serif, fontSize: 18px, fontWeight: '500' }
  heading:      { fontFamily: serif, fontSize: 16px, fontWeight: '500' }
  brand:        { fontFamily: serif, fontSize: 16px, fontWeight: '600' }
  card-title:   { fontFamily: sans, fontSize: 14px, fontWeight: '500', lineHeight: '1.5' }
  ui:           { fontFamily: sans, fontSize: 13.5px, fontWeight: '400' }
  meta:         { fontFamily: sans, fontSize: 12px, fontWeight: '400' }
  caption:      { fontFamily: sans, fontSize: 11.5px, fontWeight: '500' }
  code:         { fontFamily: mono, fontSize: 12px, fontWeight: '400' }
fonts:
  serif: var(--font-source-serif)   # sourceSerif4 → Georgia → Songti SC
  sans: var(--font-inter) + PingFang SC
  mono: var(--font-jetbrains-mono)
rounded:
  tile: 5px
  control: 8px
  card: 10px         # --radius-card：所有卡片类表面同一个角
  menu: 10px         # --radius-popover：菜单、弹层、下拉
  sheet: 16px
  full: 9999px
spacing:
  grid: 4px
  card-padding: 12px 14px
  column-gap: 16px
  board-padding: 18px 24px
  header-height: 56px
  sidebar-width: 248px
  nav-row-height: 32px
  dialog-s: 400px    # --dialog-w-s
  dialog-m: 480px    # --dialog-w-m
  dialog-l: 640px    # --dialog-w-l
  menu-row-height: 32px
---

## 方向

pacman 是多 lane coding agent 编排台。用户是键盘优先的工程师，每天打开看板几十次，核心问题是「哪些事等我处理」。

定稿方向：**纸面、紧凑、一个强调色**。暖白纸面分三层（canvas 底 → sheet 主面板 → 白色卡片），层级靠底色深浅加发丝环，不靠重阴影。彩色只有两个：赭红 `accent` 表示「需要你」与可操作，绿色 `running` 表示「正在跑」。其余一律墨色阶梯。

参考 mockup：[`docs/board-paper-r5.html`](docs/board-paper-r5.html)，浏览器打开后按 `3` 切到定稿的 Hybrid 版（静态 HTML，数字键 1–4 切换对比稿）。mockup 与本文件不一致时以本文件为准。

## 颜色

- **三层纸面**：`canvas`（应用底，侧栏直接坐在上面）→ `sheet`（主面板，16px 圆角 + `line` 1px 描边）→ `card`（纯白任务卡）。
- **描边一律 1 个 CSS 像素**：主面板、任务卡、激活导航项、新任务按钮在高分屏上也是 1px（不跟 `--hairline` 降到 0.5px），描边要看得清。
- **墨色四级**：`ink` 标题与正文；`ink-2` 导航、按钮、说明；`ink-3` 元信息；`ink-4` 只给装饰图标。文字最浅用到 `ink-3`。
- **对比度（实测，WCAG 2.x）**：`ink` 在卡片 14.99、`ink-2` 7.21、`ink-3` 5.29、`accent` 4.99、`running-text` 5.61；`ink-3` 在 canvas 4.58。白字在 `accent` 底 4.99。`ink-4` 只有 2.42，所以不许当文字色。
- **强调色纪律**：`accent` 只用于：需要你处理的状态与计数、卡片上的操作链接、激活导航项的图标、计数徽章底色。不做装饰、不做大面积底色。
- **状态不只靠颜色**：每个状态都是「图标 + 颜色 + 文字」三件套（失败 ⊗ 失败 / 待确认 ☰ 待确认 / 待审阅 ⑂ 待审阅），色弱用户靠图标和文字也能分辨。
- **主按钮是墨色，不是彩色**：shadcn Button default 档，`ink` 底 + `sheet` 字，8px 圆角（`control`）。赭红不做主按钮底色。
- 颜色只住在 token 文件（`src/styles/shadcn.css` / `tokens.css`），组件里写 token 名，不写 hex（`scripts/ui-drift-gate.mjs` G2 已经钉住）。

## 字体（Hybrid）

- **衬线只给标题**：页面标题（顶栏「工作台」）、列标题（待开始 / 执行中…）、侧栏品牌名。字体 `var(--font-source-serif)`，中文落到 Songti SC。
- **其余全部无衬线**：卡片标题、导航、按钮、元信息。字体 Inter，中文落到 PingFang SC。卡片标题不用衬线：14px 宋体太细、中西混排显乱，这是定稿时否掉 Serif 方案的原因。
- **六档字号**，不许出现第七档：18 页面标题 / 16 列标题与品牌 / 14 卡片标题 / 13.5 界面文字 / 12 元信息 / 11.5 徽章与分组标签。代码里用对应 Tailwind 主题键 `text-page` / `text-heading` / `text-card-title` / `text-ui` / `text-meta` / `text-caption`（标题字体 `font-heading`），不写 `text-[13px]` 这类任意值；`scripts/ui-debt-gate.mjs` D5 只许任意值总数下降。
- **字重三档**：400 正文、500 卡片标题与激活项、600 计数徽章与品牌。不用 700。
- 已完成任务的标题降到 400 + `ink-3`，表示「已经不需要看」。

## 布局与间距

- 4px 网格。常用值：4 / 8 / 12 / 16 / 24。卡片内边距 12×14，卡片间距 8，列间距 16，看板内边距 18×24。
- 顶栏 56px：左侧衬线页面标题 + 「⚠ N 项等你处理」；右侧文字按钮（筛选、定时）+ 墨色主按钮「新任务」。所有顶栏元素 `nowrap`，窄窗口不换行。
- 侧栏 248px，坐在 `canvas` 上；主面板是右侧一张 `sheet`，四周留 10px。
- 一屏只有一个主操作（墨色主按钮），其余操作是文字按钮或卡片内的赭红链接。

## 图标

- 图标库 lucide（`components.json` 已配置），描边 1.75。
- 尺寸：元信息 12、卡片操作与状态 13、顶栏按钮 14、列标题 15、侧栏导航 16。
- 颜色：元信息图标与折叠箭头 `ink-4`（`text-content-dim`）；带文字标签的图标（侧栏导航、列标题）用 `icon` `#9a9086`（`text-icon`）；没有文字标签的纯图标按钮（搜索、收起侧栏、收起后的侧栏图标）用 `ink-3`，保住 3:1 的非文本对比；激活导航项与「需要你」相关图标 `accent`；执行中相关图标 `running`。
- 形状：工作台 = 三栏（Columns3），收起/展开侧栏 = 面板（PanelLeft，不带箭头）。
- 列标题图标固定：待开始 = 虚线圆、执行中 = 脉搏线、待处理 = 感叹圆、已完成 = 勾圆。

## 组件

### 侧栏（Grouped）
从上到下：
1. **工作区行**：像素吃豆人标记（`public/logo.svg` 作 mask，16px，一格一个 CSS 像素，取行墨色 `ink`）+ 衬线品牌名 + 下拉箭头；右侧两个图标按钮：搜索（⌘K）、收起侧栏。
2. **新任务按钮**：白底（`sheet`）、发丝环、赭红加号、右侧键帽 `C`。它是动作，不是导航项。
3. **工作导航**：工作台、需要我处理（右侧赭红计数徽章）、定时。激活项 = `sheet` 底 + 发丝环 + 赭红图标。
4. **项目**：分组标签「项目」+ 右侧加号；每个项目一行 = 彩色首字母方块（`project-tiles` 按序取色）+ 名称 + 未完成数。
5. **底部**：「资源」一行（技能 / MCP / 密钥 / 机器 / 模型服务折叠在里面，点击展开为缩进子列表）；用户行 = 头像 + 名字 + 第二行「● 2 台机器在线 · 执行中 N」。

### 看板列
- 列标题：状态图标 + 衬线列名 + `ink-3` 计数；hover「待开始」列时右侧出现加号（新任务只落在这一列，其它列不放加号）。下方一条 `rule` 线。
- 空列显示「暂无」，不画占位框。

### 任务卡
- 白底、10px 圆角（`--radius-card`）、`line` 1px 发丝环 + 一层极轻的暖色投影（`0 1px 2px`，4%），边缘清楚、不发虚；hover 时环加深、投影升到 `0 4px 14px` 7%（150ms ease-out）。不叠第二层大模糊阴影。
- 在飞编排（点了开始、总管还没派发）：待开始卡把「开始」换成一行底栏「⏳ 编排中 · 等待原因」（等 X 上线 / 缺能力 / 排队中）+ 右侧「查看会话」；失败卡把「重试」换成不可点的「编排中」。不在元信息行上叠层。
- 结构：标题（最多两行）→ 单行元信息（📁 项目 · #编号 · 🏷 标签 · 🕒 时间，永不换行；空间不够时先截断标签，项目名至少保留 5 个字宽）→ 按状态的底栏。标签图标着用户自定义的标签色，标签名用元信息墨色。
- 底栏：
  - 待处理三态：虚线分隔 + 「图标 状态名」（赭红）+ 原因（截断）+ 右侧赭红操作链接（↻ 重试 / ✓ 确认计划 / → 审阅）。
  - 执行中：机器人图标（缓慢呼吸）+ 「agent · 当前步骤」+ 右侧 `3/7`，下面一条 3px 进度条。
  - 待开始：没有底栏；未开始的卡「▶ 开始」悬停时浮在元信息行右侧，不占高度。排队中的卡（已开始）不浮「开始」；挂起时（等机器 / 等额度）元信息行带「⏳」等待原因，正常排队（机器在线、只是没轮到）不带。
  - 已完成：没有底栏，标题降级。
- 卡片上不放实心按钮。

### 按钮
- 主按钮：shadcn Button default 档，墨底，8px 圆角（`rounded-md`，即 `control`），高 32。
- 次按钮：文字按钮，hover 出浅底。
- 卡片操作：赭红文字链接 + 图标，hover 出 `accent-hover` 底。

### 选择器与 ⌘K
- 选中行（键盘光标或鼠标所在行）：白卡（`card`）+ `line` 发丝环 + 最多一档极轻投影（0 1px 2px）。不铺 hover 色、不带赭红。

### 设置列表（帐号页、Agent 概览）
见下节「页面模式 · 设置列表」。

## 页面模式

设置、资源、团队、项目这类页面共用下面几件。新页面先拼这几件，不在页面里另做一套卡片、空态或表单。件都在 `src/components/`，取值全部走 token 与六档字号。

### 卡片圆角：一个角
- **token**：`--radius-card` = 10px（`rounded.card`），类名 `rounded-(--radius-card)`，或 `settings-list.tsx` 导出的 `CARD_RADIUS_CLS`。
- **用在**：所有卡片类表面——任务卡、拖拽中的卡、设置卡、团队 / Agent 卡、成组的资源行卡、一次性提示卡。
- **不在此列**：弹窗与 ⌘K 面板是 sheet 档 16px（`--edge-radius`）；菜单与弹层用 `--radius-popover`（也是 10px，见下节「弹窗与菜单」）；控件 8px（`rounded-md`）；项目方块 5px。
- registry `Card` 自带 `rounded-xl`（14px），用作卡片时必须换成 `--radius-card`。
- 要：一页里所有卡同一个角。不要：页面里写 12px / 14px 的卡，或一页混两种卡角。

### 空态
件：`src/components/empty-state.tsx` 的 `EmptyState`（底座是 registry `Empty`）。
- **图标**：lucide 线条图标，24px，描边 1.75，`ink-3`（`text-content-tertiary`），不垫底块。
- **标题**：`h2`，`text-card-title` 500 `ink`。
- **说明**：`text-meta` `ink-3`，最宽 320px（约 44ch），居中，`text-balance`。
- **主操作**（可选）：shadcn Button default 档，墨底 32px 8px 角（`DIALOG_PRIMARY_BUTTON`）。一个空态最多一个主操作。
- **提示行**（可选）：主操作下方一行 `text-meta` `ink-3`，前面可带 12px 图标（`ink-4`），用来说明只读或权限原因。
- **用在**：列表页没有数据时（API 密钥、定时、技能、MCP、密钥……）。文案由调用方先翻译再传入。
- 要：裸图标 + 标题 + 一句说明。不要：带色块底的图标方块（橙色、米色都不要）、`size="sm"` 小按钮、两个并排主按钮、「查看文档」外链。

### 设置列表
件：`src/components/settings-list.tsx`。帐号页的「编辑名称」头部在 `src/components/profile-card.tsx`（`ProfileHeader`，组合 `SettingsHeader`）。
- **头部在卡上方**（`SettingsHeader`）：56px 白底圆形头像（`line` 1px 环）+ 衬线标题（`text-page` 500）+ 下方 `text-meta` `ink-3` 说明；右侧一个可选操作（通常是文字按钮）。名字不在卡里重复成一行。行内改名时 `editor` 替换标题、说明与操作。
- **一张卡**（`SettingsCard`）：白底、`line` 1px 外环、`--radius-card`，行不带底色（不做双色卡）。
- **行**（`SettingsRow`）：最小高 52px、左右 16px；左侧 `text-ui` `ink` 标签（可带一行 `text-meta` `ink-3` 说明），右侧控件。内容两行时行自然长高。不走 `SettingsRow` 的自定义行用 `SETTINGS_ROW_CLS`。
- **分隔线只画在已渲染的行之间**：卡上 `divide-y`，行按条件渲染，不用 CSS 隐藏。被隐藏的行仍是兄弟节点，会在卡顶画出第二条边。
- **控件带框，一类一种**：下拉 = 白底 + `line` 1px 环 + 8px 圆角 + 高 32（`SETTINGS_SELECT_TRIGGER_CLS`，与表单 `FORM_CONTROL_CLS` 同一串）；单选分段 = `SettingsSegmented`（即 `SegmentedRadio`，见下节「分段控件」）；开关 = shadcn Switch，开态墨色。
- **危险操作**（`SettingsDangerZone`）：页面最后单独一张卡，一行：左侧标签 + 说明，右侧 Button `variant="destructive"`，32px 8px 角（标准按钮形）。点了先弹确认层，不直接删除。
- 要：头部 + 一张卡 + 等高行。不要：头像大块占一行、行铺底色、圆角药丸形删除按钮、危险操作混在普通设置卡里。

### 表单
件：`src/components/form-layout.tsx`（底座是 registry `Field` 家族）。
- **栈**（`FormStack`）：字段竖排，字段间 16px，最宽 520px，靠左。
- **字段**（`FormField`）：标签在上（`text-ui` 500 `ink`，`htmlFor` 指向控件），控件，可选帮助文字（`text-meta` `ink-3`）在下。
- **控件**：Input / SelectTrigger 加 `FORM_CONTROL_CLS`：高 32、白底、`line` 1px 环、8px 圆角、`text-ui`。
- **操作行**（`FormActions`）：表单最后一行，靠右；可选文字按钮（如「取消」）在左，shadcn Button default 主按钮在右。不能提交时用按钮自身的 `disabled`（半透明），不另画灰条。
- 要：窄栏、标签在上、主按钮靠右。不要：撑满整列的输入框、整宽的灰色提交条、标签和输入框左右并排的双栏表单。

### 分段控件
件：`src/components/segmented.tsx`。一种外观，两种语义：
- **`SegmentedTabs`**：切换视图——每个选项控制一块面板或一条路由（Agent 概览 / 记忆 / 权限、项目 任务 | 文件、文件 | 历史、列表 | 网格、团队 网格 | 组织图、模型服务 runtime、分支弹窗、总管设置）。底座是 registry `Tabs`，保留 `tablist` / `tab` 语义。
- **`SegmentedRadio`**：在表单或设置里选一个值（帐号页的密度、用户菜单的外观 / 密度、定时频率）。`radiogroup` / `radio` 语义，方向键移动并选中，roving tabindex。选「改了会存下来的值」用它；选「看哪块内容」用 tabs。
- **放不下就换下拉**：选项文字按 12px 内边距排不进所在栏宽时，不缩字、不截断，改用表单 Select（`SelectTrigger` + `FORM_CONTROL_CLS`）。例：新建模型服务的 API 协议（三个协议名约需 460px，弹窗栏宽 416）。
- **外观**：轨道高 32、内衬 2、8px 角，底色 `canvas` 一个纸色 token；选项高 28、6px 角，文字选项左右 12，纯图标选项是 28 的正方形（必须带 `ariaLabel`）。未选中 `ink-2` 字、hover 变 `ink`、不铺底；选中 = 白底（`card`）+ `line` 1px 环 + 一层极轻投影，字 500 `ink`。不用赭红。禁用项用原语自带的半透明。
- **焦点**：鼠标点击不出环。键盘 `:focus-visible` 是 2px `--focus-ring` 环，**内描**在选项盒里（`outline-offset: -2px`，`styles/app.css` 的 `[data-segmented="option"]` 规则）：选项之间只隔 2px，外描会压到邻居。
- **滑动**：`slide` 让白签以一条 150ms 的底层 pill 在选项间滑动（只有总管设置用，#644）。
- 要：所有分段都从这两件拼；e2e 句柄用 `className`（轨道）和 `optionHandle`（选项）挂。不要：手写 `role="radiogroup"` / `role="tab"`，或在页面里直接用 `TabsList` / `TabsTrigger` 另调一套皮肤——`scripts/ui-drift-gate.mjs` G7 会拦下。

### 弹窗与菜单
件：`src/components/ui/dialog-shell.tsx`（`DialogShell` + 导出的 `DIALOG_*` 件、`DialogFootRow`、`dialogWidth`）、`alert-dialog-shell.tsx`（确认面）、`dropdown-menu.tsx` / `popover.tsx`（菜单与弹层）。`dialog.tsx` / `alert-dialog.tsx` / `select.tsx` 是 pristine registry 件，它们的 Paper 皮肤住在 `styles/app.css` 的 `[data-slot=…]` 规则与 token 上。
- **背板**：一层浅墨 dim `--dialog-backdrop`（亮 `rgba(43,38,32,.14)`），不加 blur。所有弹窗、确认面、⌘K 同一层，不做深色幕布。
- **面**：`sheet` 底（`--dialog-surface`）、16px 角（`--edge-radius`）、`--dialog-shadow`（1px `line` 环 + 两层软投影）。
- **三档宽**（`size`，`--dialog-w-*`，窄屏 `min(100% - 2rem, …)` 收口）：
  - S 400：密钥、API 密钥、删除与其它确认、短表单。
  - M 480：技能、多数新建表单（Agent、定时、章程、审核、请求修改）。
  - L 640：多步流程与长列表（添加机器、模型服务选择器、GitHub issue、原始错误、附件预览、新建任务）。
- **头**：16px 衬线标题（`text-heading`）+ 可选一行 12px `ink-3` 副行（`subtitle`）；右上角 28px ghost 关闭钮。关闭钮在 DOM 里排最后，初始焦点落在第一个字段上。
- **体**：唯一的滚动盒（`min-h-0`），左右 20px 内边距同时是焦点环的房间。面板封顶 `100vh - 64px`，矮视口里滚的是体，脚永远在屏内。
- **脚（分栏）**：左边一条 12px `ink-3` 提示或状态（`hint`：文档链接、快捷键、等待状态、页码），右边操作组。主操作是 shadcn Button default（墨底 32px 8px 角，`DIALOG_PRIMARY_BUTTON`），次操作是 ghost 文字按钮（`DIALOG_TEXT_BUTTON`），危险确认换 `destructive`。没有提示时操作照样靠右。不画底色带、不画分隔线。
- **分组选择器**（模型服务）：顶部搜索框，下面按小标题分组（`text-caption` 500 `ink-3`），每行 40px = 22px 首字母方块（白底 + `line` 环）+ 名称 + 右侧 `ink-3` 标签（OAuth / 暂未开通）。hover 与键盘焦点 = 选择器选中行（白卡 + 发丝环）。禁用行字降到 `ink-3`、不出 hover。搜索跨组过滤，空组整组隐藏；「其他 · 自定义端点」始终在。
- **菜单**（Paper menu，`DropdownMenu` / `Popover` / Select 弹层同一张面）：白底、10px 角（`--radius-popover`）、4px 内衬、`--shadow-popover`（1px 环 + 软投影）。行高 32、6px 角、13.5px 字、15px `ink-3` 图标、hover `menu-hover`；快捷键提示靠右 `text-caption` `ink-3`；分隔线 1px、左右内缩 6px；分组标签 `text-caption` 500 `ink-3`。危险行字与图标走 `destructive`，hover `danger-soft`。菜单里的分段控件用 `SegmentedRadio` / `SegmentedTabs`，不手搓。
- 要：一个弹窗选一档宽、提示靠左操作靠右、菜单行等高。不要：深色或模糊背板、整宽提交条、灰色底色带脚、outline 次按钮、12px 字的小灰菜单。
- `e2e/paper-overlays.spec.ts` 钉背板颜色、三档宽、分栏脚、菜单行高与分组选择器；`e2e/color-freeze.spec.ts` 钉 `dialog-backdrop` / `menu-hover`。

## 动效

纸面是安静的。动效只有四类，每类定一个时长一个缓动；取值走 `src/styles/tokens.css` 的 motion 槽（`--dur-fast` / `--dur-overlay` / `--ease-standard` / `--ease-pop` / `--ease-out-expo` / `--spring-snappy`）或 tw-animate-css 的缺省档。新面先在下表对号入座，对不上就不加动效；要加新槽，同一个 PR 里必须带上消费点。

| 类 | 面 | 时长 | 缓动 | 动的属性 |
|---|---|---|---|---|
| 微交互 | 行 / 卡 / 按钮的 hover 与 press 染色、分段控件、折叠箭头 | 150ms（`--dur-fast`） | `--ease-standard`（tw `ease-out` 同档） | `background-color` / `color` / `box-shadow` / `transform` |
| 微交互 | 任务卡 hover 抬升与投影 | 200ms | `--ease-out-expo` | `box-shadow` / `translate` |
| 弹层进出 | 弹窗、确认面、⌘K、总管窗 | 进出各 200ms（`--dur-overlay` / `duration-200`） | tw 缺省 `ease` | `opacity` + `scale(.95→1)` |
| 弹层进出 | 菜单、弹层、Select | 进出各 100ms | tw 缺省 `ease` | `opacity` + `scale(.95→1)` + 8px 位移 |
| 弹层进出 | Tooltip | 进出各 150ms（tw-animate 缺省） | tw 缺省 `ease` | `opacity` + `scale(.95→1)` + 8px 位移 |
| 弹层进出 | 内联小弹层（提及、斜杠、chip） | 进 100ms，无出场 | tw 缺省 `ease` | `opacity` + `scale(.98→1)` |
| 内容到达 | 新卡上板 / 换列 / 筛选命中 | 150ms | `--ease-pop` | `opacity` + `translateY(4px→0)` |
| 内容到达 | 对话消息入场 | 380ms（`--spring-snappy-dur`） | `--spring-snappy` | `opacity` + `translateY` |
| 内容到达 | 流式字符显现 | 350ms | `--ease-out-expo` | `opacity` |
| 内容到达 | 保存勾衰减 | 2.5s | `--ease-out-expo` | `opacity` + `scale` |
| 循环 | 执行中图标呼吸 | 2.4s | `ease-in-out` | `opacity` |
| 循环 | 在飞 spinner 呼吸 | 3.6s | `ease-in-out` | `opacity` + `scale` |

- 只动 `opacity` / `transform` / 阴影 / 颜色，不动布局属性（width / height / top）。
- 瞬切不过渡：按压（`:active` 压暗、卡面 bg tint）、粗指针下的一切、拖拽落位（`dropAnimation` 为 null，对齐参考站）、侧栏展开 / 收起、主题切换（`.theme-suppress` 关过渡两帧）。
- `prefers-reduced-motion`：全站 keyframe 动画压到 0.01ms、循环只跑一次（`motion.css` 全站法）；过渡不动。
- 没有的东西：路由转场、列表 FLIP、列间飞行、弹簧曲线家族（只留消息入场这一条 `--spring-snappy`）。
- 钉扎：`e2e/cds-motion.spec.ts` 钉 motion 槽的存活与退役、`anim-*` 类名；`e2e/card-press.spec.ts` 钉按压瞬切；`e2e/color-freeze.spec.ts` 钉 `--ease-out-expo`。

## 暗色

暗色是 `:root` 默认（`.light` 是亮色）。定稿 mockup：[`docs/board-paper-dark.html`](docs/board-paper-dark.html)，数字键 1–6 切看板 / 详情 / 设置 / 弹窗 / 菜单 / 色板（色板页从渲染色实时算对比度）。值在 frontmatter `colors-dark`，实测表 `docs/verify/1396/contrast.txt`（`docs/verify/1396/palette.mjs` 用 OKLCH 定义、换算 sRGB 再量）。

- **同一阶梯，方向反过来**：暗色里海拔越高越亮——`canvas` #1a1612 → `sheet` #24201b → `card` #2f2a26 → `popover` #37322d。四档同一色相（OKLCH 色相 70、色度 0.011），是奶油纸的深端，不是中性灰。亮色里菜单与弹窗和卡片同色（白）；暗色里投影弱，菜单与弹窗比卡片再亮一档，靠亮度差加发丝环分层。侧栏经 `--surface-1` 坐在 `canvas` 上，两侧同形。
- **发丝环照画**：`line` #3e3a34 在卡上 1.26、在 sheet 上 1.43，和亮色一样是一个 CSS 像素，不靠投影。
- **墨色阶梯倒过来**：`ink` #ece7df 标题正文、`ink-2` #c5c0b9 导航按钮、`ink-3` #aca7a0 元信息、`icon` #908b85 带标签图标；`ink-4` #7a756f 只做装饰。
- **对比度（实测，WCAG 2.x）**：卡上 `ink` 11.53、`ink-2` 7.85、`ink-3` 5.94、`icon` 4.20（非文本门 3）、`accent` 6.11、`running-text` 7.87、`destructive` 7.95；canvas 上 `ink-3` 7.53；菜单 hover 行上 `ink-3` 4.63。`ink-4` 在卡上 3.11，仍只做装饰。
- **赭红上的字是深墨**：`accent` 提亮到 #f0926d 后白字只有 2.32，所以计数徽章、项目方块上的字走 `--text-on-accent` = canvas 深墨（徽章 7.74，六块方块 6.98 起）。亮色里是白字，这是两侧唯一一处反向。
- **强调色 hover 底是深染不是浅染**：`accent-hover` #46362f = 赭红 12% 染进卡底，链接在上面 4.94（亮色 4.25）。`spot-soft` 选中底同法，上面的字 `spot-text-on-tint` #fbc3a7 淡赭红 7.02。
- **执行中绿提亮**：图标 #7fb980（卡上 6.18）、文字 #99ce9a（7.87）、进度条 #70a971 压轨道 4.09；轨道就是发丝线。
- **弹窗背板**：黑 45%，无 blur；弹窗面 = `popover`，和菜单同一档。
- **状态色不在本阶梯里**：chip、diff、列点、`badge-attention`、`destructive` #ffabb7 沿用 E 色板暗侧值（亮色那轮同样只换了 Paper 槽），每个文字对都在新卡底上重测过 4.5。
- **新增语义 token 的规则**：必须同时在 `.light` 与 `:root` 两处定义；暗侧从本阶梯取值并实测，不取「最近的现有档」。

## 给 agent 的美学约束（粘贴进提示词）

```text
Pacman UI rules (source: apps/web/DESIGN.md):
- Look: warm paper, dense, calm. Three layers: canvas #f3eee5 → sheet #fbf9f5 → white cards. Hairline rings, almost no shadow.
- Dark (:root default): the same ladder, lighter with elevation: canvas #1a1612 → sheet #24201b → card #2f2a26 → popover #37322d (menus and dialogs). Ink #ece7df / #c5c0b9 / #aca7a0. Accent #f0926d with dark text on it (badge, project tiles). Running #7fb980. Only token values differ between themes.
- One accent: terracotta (accent) only for "needs you", action links, count badges, active icons. Green (running) only for running/online. Everything else is ink greys.
- Type: serif (--font-source-serif) only for page title, column headings, brand. Everything else sans (Inter / PingFang). Sizes only 18/16/14/13.5/12/11.5. Weights 400/500/600.
- Spacing on the 4px grid. No arbitrary px values (text-[13px], ml-[10.5px]).
- Every status = icon + color + label. Lucide icons, stroke 1.75.
- Primary button = shadcn default Button in ink, 8px corners, 32px tall. Card actions = terracotta text links. No solid buttons on cards.
- Dialogs: DialogShell with size s (400) / m (480) / l (640), light dim backdrop (no blur), 16px serif title + optional 12px sub-line, split footer (12px ink-3 hint left, actions right, ink primary). Menus: white, 10px corners, 4px padding, 32px rows, 13.5px text, 15px ink-3 icons, #f6f2ec hover, danger rows in destructive.
- Segmented controls only from components/segmented.tsx: SegmentedTabs for view switches, SegmentedRadio for value pickers. Canvas track, white selected option with a 1px ring, inset keyboard ring. Never hand-roll role=tab/radio or restyle TabsList.
- One card corner: --radius-card (10px) on every card-like surface. Pages compose EmptyState / SettingsHeader+SettingsCard+SettingsRow / FormStack+FormField+FormActions; no tinted icon tiles, no full-width submit bars, no two-tone cards, no pill buttons.
- Sidebar = Grouped: workspace row (16px pixel pac-man mark from logo.svg in ink, serif name), New task button, Workbench / Needs me / Schedules, Projects, collapsed Resources, user row with machine status.
- Use components/ui primitives and tokens; no hex in components.
```

## 迁移状态

代码里的现状与本文件不一致的地方，按 `apps/web/docs/paper-redesign-plan.md` 的顺序逐步落地。新写的代码直接按本文件取值。
