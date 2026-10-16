---
name: Pacman
direction: Paper Dense · Grouped sidebar · Hybrid type
reference: docs/board-paper-r5.html?v=3
colors:
  # 亮色为基准主题（定稿值）；暗色见「暗色」一节
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
  accent: '#b4532a'        # 赭红：需要你处理、操作链接、计数徽章、激活图标
  accent-hover: '#f6ebe3'  # 操作链接 hover 底
  running: '#5f8f5a'       # 执行中图标、在线点
  running-text: '#4f7049'  # 执行中说明文字
  running-bar: '#7ea476'
  running-track: '#ebe5da'
  online-ring: '#dfe9da'
  project-tiles: ['#c06a43', '#7d8b5a', '#6b7a8f', '#a0784a', '#8a6a9a', '#4f8a8b']
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
  card: 10px
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
---

## 方向

pacman 是多 lane coding agent 编排台。用户是键盘优先的工程师，每天打开看板几十次，核心问题是「哪些事等我处理」。

定稿方向：**纸面、紧凑、一个强调色**。暖白纸面分三层（canvas 底 → sheet 主面板 → 白色卡片），层级靠底色深浅加发丝环，不靠重阴影。彩色只有两个：赭红 `accent` 表示「需要你」与可操作，绿色 `running` 表示「正在跑」。其余一律墨色阶梯。

参考 mockup：[`docs/board-paper-r5.html`](docs/board-paper-r5.html)，浏览器打开后按 `3` 切到定稿的 Hybrid 版（静态 HTML，数字键 1–4 切换对比稿）。mockup 与本文件不一致时以本文件为准。

## 颜色

- **三层纸面**：`canvas`（应用底，侧栏直接坐在上面）→ `sheet`（主面板，16px 圆角 + `line` 发丝环）→ `card`（纯白任务卡）。
- **墨色四级**：`ink` 标题与正文；`ink-2` 导航、按钮、说明；`ink-3` 元信息；`ink-4` 只给装饰图标。文字最浅用到 `ink-3`。
- **对比度（实测，WCAG 2.x）**：`ink` 在卡片 14.99、`ink-2` 7.21、`ink-3` 5.29、`accent` 4.99、`running-text` 5.61；`ink-3` 在 canvas 4.58。白字在 `accent` 底 4.99。`ink-4` 只有 2.42，所以不许当文字色。
- **强调色纪律**：`accent` 只用于：需要你处理的状态与计数、卡片上的操作链接、激活导航项的图标、计数徽章底色。不做装饰、不做大面积底色。
- **状态不只靠颜色**：每个状态都是「图标 + 颜色 + 文字」三件套（失败 ⊗ 失败 / 待确认 ☰ 待确认 / 待审阅 ⑂ 待审阅），色弱用户靠图标和文字也能分辨。
- **主按钮是墨色，不是彩色**：`ink` 底 + `sheet` 字，圆角胶囊。赭红不做主按钮底色。
- 颜色只住在 token 文件（`src/styles/shadcn.css` / `tokens.css`），组件里写 token 名，不写 hex（`scripts/ui-drift-gate.mjs` G2 已经钉住）。

## 字体（Hybrid）

- **衬线只给标题**：页面标题（顶栏「工作台」）、列标题（待开始 / 执行中…）、侧栏品牌名。字体 `var(--font-source-serif)`，中文落到 Songti SC。
- **其余全部无衬线**：卡片标题、导航、按钮、元信息。字体 Inter，中文落到 PingFang SC。卡片标题不用衬线：14px 宋体太细、中西混排显乱，这是定稿时否掉 Serif 方案的原因。
- **六档字号**，不许出现第七档：18 页面标题 / 16 列标题与品牌 / 14 卡片标题 / 13.5 界面文字 / 12 元信息 / 11.5 徽章与分组标签。代码里用对应 Tailwind 主题键 `text-page` / `text-heading` / `text-card-title` / `text-ui` / `text-meta` / `text-caption`（标题字体 `font-heading`），不写 `text-[13px]` 这类任意值；`scripts/ui-debt-gate.mjs` D5 只许任意值总数下降。
- **字重三档**：400 正文、500 卡片标题与激活项、600 计数徽章与品牌。不用 700。
- 已完成任务的标题降到 400 + `ink-3`，表示「已经不需要看」。

## 布局与间距

- 4px 网格。常用值：4 / 8 / 12 / 16 / 24。卡片内边距 12×14，卡片间距 8，列间距 16，看板内边距 18×24。
- 顶栏 56px：左侧衬线页面标题 + 「⚠ N 项等你处理」；右侧文字按钮（筛选、定时）+ 墨色胶囊「新任务」。所有顶栏元素 `nowrap`，窄窗口不换行。
- 侧栏 248px，坐在 `canvas` 上；主面板是右侧一张 `sheet`，四周留 10px。
- 一屏只有一个主操作（墨色胶囊），其余操作是文字按钮或卡片内的赭红链接。

## 图标

- 图标库 lucide（`components.json` 已配置），描边 1.75。
- 尺寸：元信息 12、卡片操作与状态 13、顶栏按钮 14、列标题 15、侧栏导航 16。
- 颜色：元信息图标 `ink-4`；默认图标 `ink-3`；激活导航项与「需要你」相关图标 `accent`；执行中相关图标 `running`。
- 列标题图标固定：待开始 = 虚线圆、执行中 = 脉搏线、待处理 = 感叹圆、已完成 = 勾圆。

## 组件

### 侧栏（Grouped）
从上到下：
1. **工作区行**：品牌方块（`accent` 底、白色衬线首字母）+ 衬线品牌名 + 下拉箭头；右侧两个图标按钮：搜索（⌘K）、收起侧栏。
2. **新任务按钮**：白底（`sheet`）、发丝环、赭红加号、右侧键帽 `C`。它是动作，不是导航项。
3. **工作导航**：工作台、需要我处理（右侧赭红计数徽章）、定时。激活项 = `sheet` 底 + 发丝环 + 赭红图标。
4. **项目**：分组标签「项目」+ 右侧加号；每个项目一行 = 彩色首字母方块（`project-tiles` 按序取色）+ 名称 + 未完成数。
5. **底部**：「资源」一行（技能 / MCP / 密钥 / 机器 / 模型服务折叠在里面，点击展开为缩进子列表）；用户行 = 头像 + 名字 + 第二行「● 2 台机器在线 · 执行中 N」。

### 看板列
- 列标题：状态图标 + 衬线列名 + `ink-3` 计数；hover「待开始」列时右侧出现加号（新任务只落在这一列，其它列不放加号）。下方一条 `rule` 线。
- 空列显示「暂无」，不画占位框。

### 任务卡
- 白底、10px 圆角、`line` 发丝环 + 极轻投影；hover 时环加深、投影升一档（150ms ease-out）。
- 结构：标题（最多两行）→ 单行元信息（📁 项目 · #编号 · 🏷 标签 · 🕒 时间，永不换行；空间不够时先截断标签，项目名至少保留 5 个字宽）→ 按状态的底栏。标签图标着用户自定义的标签色，标签名用元信息墨色。
- 底栏：
  - 待处理三态：虚线分隔 + 「图标 状态名」（赭红）+ 原因（截断）+ 右侧赭红操作链接（↻ 重试 / ✓ 确认计划 / → 审阅）。
  - 执行中：机器人图标（缓慢呼吸）+ 「agent · 当前步骤」+ 右侧 `3/7`，下面一条 3px 进度条。
  - 待开始：没有底栏；「▶ 开始」悬停时浮在元信息行右侧，不占高度。
  - 已完成：没有底栏，标题降级。
- 卡片上不放实心按钮。

### 按钮
- 主按钮：墨色胶囊，高 30–34。
- 次按钮：文字按钮，hover 出浅底。
- 卡片操作：赭红文字链接 + 图标，hover 出 `accent-hover` 底。

## 动效

- 只动 `opacity` / `transform` / 阴影；时长 150ms，`ease-out`。
- 执行中图标 2.4s 呼吸（opacity），这是唯一的循环动画。
- `prefers-reduced-motion` 下关掉呼吸与所有入场动画。

## 暗色

定稿只做了亮色。暗色主题（`:root` 默认）保留现有值，直到单独做一轮暗色 mockup 并定稿。规则：每新增一个语义 token，必须同时在 `.light` 与 `:root` 两处定义；暗色值先取现有暗色阶梯里最接近的那档。

## 给 agent 的美学约束（粘贴进提示词）

```text
Pacman UI rules (source: apps/web/DESIGN.md):
- Look: warm paper, dense, calm. Three layers: canvas #f3eee5 → sheet #fbf9f5 → white cards. Hairline rings, almost no shadow.
- One accent: terracotta (accent) only for "needs you", action links, count badges, active icons. Green (running) only for running/online. Everything else is ink greys.
- Type: serif (--font-source-serif) only for page title, column headings, brand. Everything else sans (Inter / PingFang). Sizes only 18/16/14/13.5/12/11.5. Weights 400/500/600.
- Spacing on the 4px grid. No arbitrary px values (text-[13px], ml-[10.5px]).
- Every status = icon + color + label. Lucide icons, stroke 1.75.
- Primary button = ink pill. Card actions = terracotta text links. No solid buttons on cards.
- Sidebar = Grouped: workspace row, New task button, Workbench / Needs me / Schedules, Projects, collapsed Resources, user row with machine status.
- Use components/ui primitives and tokens; no hex in components.
```

## 迁移状态

代码里的现状与本文件不一致的地方，按 `apps/web/docs/paper-redesign-plan.md` 的顺序逐步落地。新写的代码直接按本文件取值。
