# Paper 改版落地计划

定稿方向见 [`../DESIGN.md`](../DESIGN.md)：Paper Dense 看板 · Grouped 侧栏 · Hybrid 字体（衬线标题 + 无衬线正文）。参考 mockup：[`board-paper-r5.html`](board-paper-r5.html)（浏览器打开后按 `3`）。

## 原则

- **一次一面，一个 PR**。每个 PR 可以单独合并、单独回滚，按下面的顺序走：先 token，再看板，再侧栏，最后铺到其它页面。
- **先亮色**。暗色主题保持现值，最后单独做一轮 mockup 再改。
- **有意改的视觉钉扎就改钉扎**。近期 CDS 系列（#1355–#1366）钉了一批值（侧栏 288px、面板卡 10px、`color-freeze` 锁值等）。本计划会有意推翻其中一部分；每个 PR 在同一 diff 里更新对应 spec，并在 PR body 写明「哪个钉扎、旧值 → 新值、为什么」。
- **每个 PR 的验收**（仓规）：`pnpm lint` / `pnpm typecheck` / `pnpm spec:parse` / `pnpm exec vitest run --changed` / `pnpm --filter @pacman/web e2e:affected`（默认 8398，先 `lsof -iTCP:8398`）；截图 = fixture 两态 + live 真点击，存 `docs/verify/<票号>/`，PR body 用 raw 永久链引用。

## PR 1 · 亮色 token 换成 Paper 值

只改 token，不改组件。合并后整个亮色主题的底色、文字、强调色一起变。

- `src/styles/shadcn.css` 的 `.light` 块：
  - 先盘点：哪个槽在画「应用底 / 主面板 / 任务卡」（目前主面板走 `bg-(--card)`，卡片走哪个槽要在 PR 里查实），再按角色映射到 `canvas #f3eee5` / `sheet #fbf9f5` / `card #fff`。
  - 文字阶梯：`--foreground` → `ink #2b2620`，`--text-secondary` → `ink-2 #5e564d`，`--text-tertiary` → `ink-3 #746a5f`，`--text-dim` 只留给装饰。
  - 强调色：`--card-button` / `--focus-ring` 目前是洋红 `#97227e`，改成赭红 `#b4532a`；`--spot-*` 派生色随之自动跟。
  - 新增语义 token：`--running` / `--running-text` / `--running-bar` / `--running-track`、`--accent-hover`、`--project-tile-1..6`。同时在 `:root`（暗色）给出取自现有暗色阶梯的值。
- 要更新的 spec：`e2e/color-freeze.spec.ts`（锁值本来就是为了拦「无意」改动，这里是有意改）。
- 风险：`--spot-*` 消费面广（DESIGN.md 旧版的「品牌墨」G6 规则），先跑 `node scripts/ui-drift-gate.mjs` 确认没有新增未登记消费点。

## PR 2 · 字号 token + 任意值棘轮

- `src/styles/app.css` 的 `@theme inline` 加六档字号键：`text-page`(18) / `text-heading`(16) / `text-card-title`(14) / `text-ui`(13.5) / `text-meta`(12) / `text-caption`(11.5)，乘现有 `--rem-scale`（密度切换照常生效）；加 `font-heading` = `var(--font-source-serif)`。14px 档不叫 `text-card`：shadcn 的 `--color-card` 已占用这个类名（Tailwind 只输出颜色）。
- `scripts/ui-debt-gate.mjs` 加第三本账：`text-[Npx]` 与间距类 `-[Npx]` 任意值的出现次数（今天约 179 处字号 + 273 处间距），冻结进 `scripts/ui-debt-baseline.json`，只降不升（复用现有 D3 机制）。
- 不改任何页面，只是让漂移从此不能再涨。后面每个 PR 顺手把自己那块的任意值换成 token 并重冻基线。

## PR 3 · 任务卡与看板列

- `src/board/todo-card.tsx`：按 DESIGN.md「任务卡」重写结构——标题 → 单行元信息（图标 + 截断优先级：标签先截、项目名至少 5 字宽）→ 按状态的底栏；去掉卡片上的实心按钮（`Button variant="default"`），待开始的「开始」改为悬停浮现、不占高度。顺带删掉三处重复的 badge className（约 195 / 218 / 227 行）。
- `src/board/board.tsx` + `src/board/columns.ts`：列标题 = 状态图标 + 衬线列名 + 计数，hover 出加号（只在「待开始」列：新任务总是落在这一列，其它列的加号没有对应动作）。
- 标签：卡片不再渲染 `components/ui/tag-chip.tsx` 的实心色块，改为标签图标 + 文字，图标着 `tag.color`（已定问题 2）；`TagChip` 本身保留给筛选弹层。`e2e/board-filter.spec.ts` 的卡面契约改为「tag.color → 标签图标 color」。
- 要更新的 spec：`cds-board.spec.ts`、`card-press.spec.ts`、`board-filter.spec.ts`、`visual-polish.spec.ts`。改类名前先 grep `apps/web/e2e` 与 `integration/` 的类名钉扎。

## PR 4 · 看板顶栏

- `src/routes/board-page.tsx`（及顶栏实际所在组件）：56px；左侧衬线「工作台」+「⚠ N 项等你处理」；右侧「筛选」「定时」文字按钮 + 墨色胶囊「新任务」；全部 `nowrap`。

## PR 5 · Grouped 侧栏

- `src/board/sidebar.tsx`（主体，695 行）+ `src/board/app-sidebar.tsx`：按 DESIGN.md「侧栏」五段重排——工作区行（搜索、收起两个图标按钮）→ 新任务按钮 → 工作台 / 需要我处理 / 定时 → 项目 → 底部「资源」折叠行 + 用户行（第二行机器状态）。「需要我处理」= 打开看板并只显示「待处理」列（已定问题 1），不新建页面。
- `src/styles/tokens.css`：`--sidebar-w` 288 → 248。
- `src/board/project-avatar.tsx`：首字母方块按 `--project-tile-1..6` 顺序取色。
- 资源折叠的展开状态存 `safe-storage`，刷新不丢。
- 要更新的 spec：`cds-sidebar.spec.ts`（288px 钉扎）、`sidebar-visual.spec.ts`、`sidebar-nav.spec.ts`、`sidebar-seam.spec.ts`、`sidebar-search-offboard.spec.ts`、`visual-polish.spec.ts`（收起态）。

## PR 6 · 三个页面壳合一

- `src/pages/shell.tsx`（PageShell）、`src/resources/shell.tsx`（ResourceShell）、`src/secondary/shell.tsx`（SecondaryShell）各自重画了一遍侧栏 + 顶栏，标题字号（14 / 16 / 14）、内容宽（768 / 768 / 766）、底色都不一样。合成一个壳，统一用 PR 4 的顶栏；侧栏目的地页面去掉无意义的返回箭头。
- 这是结构重构，放在视觉定型之后做，避免一边改结构一边改样式。

## PR 7 起 · 铺到其它页面

按使用频率：任务详情页 → 资源页（机器 / 技能 / MCP / 密钥 / 模型服务）→ 定时 → 项目页 → 对话框。每页一个 PR：套 token 与字号键、清掉该页任意值、重冻棘轮基线。

其余页面（项目设置 / 新建项目、资源与 API 密钥与定时、团队与 Agent 卡）先合入一个共享件 PR：`--radius-card`、`EmptyState`、设置列表、表单件，规则见 DESIGN.md「页面模式」；之后各页 PR 只拼这几件，不另做卡片、空态或表单。

## 最后 · 暗色

单独一轮 mockup（同样的 Paper 结构，暖深色纸面），定稿后改 `:root` 块与 `color-freeze` 暗色锁值。

## 已定问题

1. **「需要我处理」点进去是什么**：打开看板并筛到「待处理」一列，不做独立收件箱页。落在 PR 5（侧栏导航项）+ 看板的状态筛选。
2. **标签颜色**：保留用户自定义的标签色，着在卡片的标签图标上，标签名用正文墨色；卡片上不再是实心色块。`TagChip` 留给筛选弹层等其它面。已在 PR 3 落地。
3. **暗色时机**：亮色 PR 1–5 合并后单独做一轮暗色 mockup 再改。
