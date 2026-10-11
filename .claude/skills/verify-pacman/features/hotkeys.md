# 快捷键组（新任务 C + 空格呼出总管 + 抽屉开态 N）

任意 shell 页（非输入态）按 `C` 开新建任务 dialog——侧栏「新任务」行动作入口（Plus 图标 + `sidebar-kbd` 的 C 角标，上游 todos.dev 形态）与热键共用同一 opener；按 `⌘J` 呼出总管抽屉且焦点落草稿框（dialog 家族 autofocus 律；#442 起 ⌘J 取代 Space，Space 回归原生语义）。守卫律：输入态（input/textarea/select/contenteditable）两键均不触发；交互态（button/a/role 族）Space 保留原生激活语义；修饰键组合（⌘C、Ctrl+Space 输入法）放行。键位 XMON-41 起由 N 改为 C（`n` 不再开面，小写键位、Shift 态两版一致不触发）；#645 把 N 以**抽屉作用域**请回——抽屉开态裸 `N` = 头部 +（新主题），关态监听器不在 window 上（XMON-37 的全局退役律照旧成立）。

## Sub-features

- `hotkeys-new-task` C 开 `.new-task-dialog`：board 走本页 dialog（fixture 保存落本地卡），project 页走本页 dialog（保存锚路由项目，PageShell `onNewTask` 透传），其余路由走 AppSidebar 内部全局 dialog（`useNewTaskSurface` 同一 live save 路径）。侧栏行点击 = 同一 opener。
- `hotkeys-chief-wake` `⌘J` 开 `.chief-drawer` + `[data-testid="chief-composer-input"]` 持焦；⌘J toggle 收起（ADR 0013 D3：Esc 不收窗；#442 起 Space 不再是呼出键）。抽屉随根 layout 单实例**常驻挂载**（ADR 0013 D6，关态 hidden-but-mounted）——开态判据 = 可见性不是 DOM 计数。
- `hotkeys-kbd-hint`（#468）FAB 的 `⌘J` 悬浮提示：#983/#1004/#1008 起 `.kbd-hint` 类退役，载体 = registry Tooltip + Kbd 组合——trigger = `button[aria-label="总管"]`，壳 = `[data-slot="tooltip-content"]`，键帽 = 壳内 `[data-slot="kbd"]`。静息 = tooltip 未挂载；父控件 hover 浮出。落位三变体：above（FAB 族）/ right（rail 行）/ below（#645 抽屉头部行——头部贴视口顶，above 会落屏外）。
- `hotkeys-chief-new-thread`（#645）抽屉开态裸 `N` = 头部 + 新主题（与钮同 handler：触发 + 收切换器 popover）。作用域门 = `useHotkey` 的 enabled 参（抽屉关态监听器不在 window 上）；守卫 = _plain_ 输入态律（**不带** ⌘J 的 drawer 内豁免：开抽屉的 autofocus 落 composer，聚焦时 n 归打字员）。钮载 `KbdHint` 的 N 悬浮提示（below）+ `aria-keyshortcuts="N"`。
- `hotkeys-guards` 输入态/交互态负向：搜索面板输入框持焦时 C/Space 不误触且字符照常入框；按钮持焦时 Space 原生激活按钮（不劫持）。

## How to get to it (user POV)

- 展开态侧栏「新任务」行（`button.sidebar-row` 含「新任务」文案 + `.sidebar-kbd` C 角标）。
- 键盘：任意页 `C`（非输入态）；`⌘J` 呼出总管抽屉。

## Driving it with verify-pacman

Preconditions:

- `launch.mjs` 起栈 + `doctor.mjs` 全 PASS。无需铺底（无项目时保存自动建「默认项目」，board-new-task 同律）。

- **全链。** Run `node <skill>/scripts/drive-hotkeys.mjs`。链路：侧栏行 + 角标断言 → 行点击开/Esc 关 → C 开（标题框持焦）→ 填题保存 → FAB 的 `⌘J` 提示（registry Tooltip+Kbd：静息未挂载 + 悬浮键帽 `⌘J`）→ ⌘K 输入态负向（`c ` 入框、无 dialog/drawer；#1166/#1181 载体 = role dialog「搜索」scope 的 textbox）→ `⌘J` 开抽屉（草稿框持焦；⌘J toggle 收起）→ /app/schedules C 开全局 dialog 保存。真值：`GET /api/todos` 双行（board 面 + schedules 面）+ SQLite `todo` 表双行。证据 `01..04-*.png` + `02b-fab-tooltip.png` + `result.json`（titles 字段）。

- **键位专测（XMON-41）。** Run `node <skill>/scripts/drive-newtask-key.mjs [旧键]`。正负成对跑在同一页面状态上：c 开（`.new-task-dialog` + `.new-task-spec` 持焦）/ 旧键 `n` ×5 一次不开，三条渲染路径各一对（board 本页 / project 本页 / schedules 全局面），外加输入态守卫（`c` 入框不开面）、侧栏行点击入口、以及「c 开面 → 保存 → API + SQLite 双行」全链。旧提交栈上加 `--expect=old` 反转期望，用来证明「同等场景」集合没有随改键漂移。

- **抽屉 N 键专测（#645）。** Run `node <skill>/scripts/drive-chief-new-thread-key.mjs`。依赖全新库（发送会建线程，重验 = 重 launch）。链路：关态裸 N ×3 不开 → ⌘J 开抽屉焦点落 composer → composer 聚焦按 n 入草稿（守卫）→ 铺底（providers/agents/PATCH chief，非被测路径）+ 重载 → 发送建线程落线程视图 → 徽标静息隐藏/悬浮浮出 N/`aria-keyshortcuts` → 线程视图下 composer 聚焦按 n 仍归打字员 → blur 后裸 N 落新主题视图（stream 收、hero 出、chip 回「新主题」）→ 切换器 popover 开着时 N 一并收 → ⌘J 收抽屉后裸 N ×3 再不触发。fixture 面钉不住这几条（onNewThread 是 live-only，fixture 面钮惰性、触发零 DOM 变化），e2e hotkeys.spec 只钉徽标与关态负向。证据 `01-before-n-thread-view.png` / `02-hint-hover.png` / `03-after-n-hero.png` + `result.json`。

## Gotchas

- **热键首按可能早于 hydration**（监听注册在被动 effect）：probe 内 `pressUntil` 重按至目标可见即停；两键均 open-only（非 toggle），重按幂等。
- **OverlayMount 的 mounted 滞后 open 一帧**（`useOverlayMount` 在 effect 里才 setMounted）：弹层「开后聚焦」若只挂 `[open]` effect，鲜开时节点尚不存在 = 焦点静默丢失。家族律 = ref callback 载首焦 + `[open]` effect 兜 retained-mount 重开（SearchPanel attachInput 先例；#389 把 NewTaskDialog/ChiefDrawer 收到同律）。
- fixture 面回归（守卫/角标/两路径）在 `apps/web/e2e/hotkeys.spec.ts`，不经本 probe。
- **`.kbd-hint` 的 visibility 翻在过渡第一帧**（历史注记：`.kbd-hint` 退役前，`transition-[opacity,visibility]` 120ms 内 hover 后单次 `isVisible()` 会读到 progress 0 的 hidden，#645 probe 实测 FAIL 一次）；断言浮出一律走 `waitFor({ state: 'visible' })`（= e2e `expect().toBeVisible()` 的重试律）——registry Tooltip 形态下同样适用（tooltip 挂载 + 进场动画均在异步帧）。
