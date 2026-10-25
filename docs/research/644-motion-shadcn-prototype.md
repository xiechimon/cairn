# 644 · 全站动效迁移 shadcn：原型与取舍

> 状态：**已裁决**（2026-10-02，用户拍板**方向 B**：全站采用 shadcn 默认，显式推翻 #73
> Status: **ruled** (2026-10-02, the user decided **direction B**: adopt shadcn defaults site-wide, explicitly overturning #73's
> replication discipline). The ruling canonical copy = `docs/adr/0009-site-wide-motion-converges-on-shadcn-defaults.md`; per-domain construction is in the execution ticket
> （票面引本原型 §4）。本文保留为裁决前的现状盘点与两向对比记录。
> 取数时点：`hp/pacman/t-0041-tabs` @ 2026-10-02；tw-animate-css 1.4.0（dist 逐字读取）；
> 参考站实测记录见 `docs/verify/644/reference-measurements.md`。

## 0. 两个必须先钉住的事实

1. `apps/web/src/styles/motion.css` 是**故意复刻参考站**的 transition registry（#73；文件头
   注释写明数值逐条抄自参考站生产样式表 `docs/research/assets/r1/f965382e067739e9.css`）。
   「迁到 shadcn」不是收拾残局，而是**对这条已生效决定的改判或重构**——所以本文给方向而不是直接动手。
2. `docs/spec/16-shadcn-rollout-batch-table-and-acceptance-criteria.md` **has no motion batch** (verified: §1's five batches are all
   structure/control migrations, and it states outright "per-domain migration is pure structure change, zero visual re-pinning"). Motion migration is **new scope**,
   needing the user's decision before appending a batch entry — it is not an already-scheduled item.

## 1. 现状盘点：站点已经是双动效系统并存

### 1.1 motion.css 复刻 registry（#73，机制 = 手写 keyframes + data-overlay-state 手动进出场）

| 动效面 | 复刻值（= 参考站生产样式表） |
|---|---|
| 挂载淡入 | `overlay-fade` 200ms `cubic-bezier(0,0,.2,1)`（--ease-out） |
| 浮层 pop | `overlay-pop`（opacity 0→1 + `scale(.95) translateY(-4px)`→none）150ms `cubic-bezier(.22,1,.36,1)`（--ease-pop） |
| 居中 dialog | **仅 fade** 200ms ease-out（r8 捕获实测：开场只有 opacity 动画，无 zoom） |
| 抽屉 | `drawer-in` translateX(100%→0) 300ms --ease-pop |
| hover 家族 | background-color 150ms --ease-standard，`--surface-hover`，细指针 gated |
| press | `opacity .85`（全局钮/链）；#629 板卡 = bg tint 瞬切（参考站 computed 0s） |
| spinner | braille reel 900ms steps(10)（#471，两方向都保留） |
| tab 指示条 | #644 本次落地：left/top/width/height 150ms `ease`（todos.dev CSSTransition 实测） |

进出场机制：`useOverlayMount` + `.overlay-mount[data-overlay-state]`——元素在 closed 态保留挂载，
visibility 最后翻转（hit-test/a11y 退场），退场靠 transition 而非 animation。

消费面（实测 grep）：**14 个 tsx** 挂 `anim-*`/`overlay-mount` 类——含三个 `components/ui`
适配层（`dialog-shell` / `floating-shell` / `select`）与 chief / detail / overlay / pages 各域；
`useOverlayMount` 2 文件（`overlays/dismiss.tsx` + hook 本体）。

### 1.2 shadcn/tw-animate-css 面（已入库，随 spec 16 各批铺开）

`tw-animate-css@1.4.0` 已是 web 依赖；6 个 tsx 已在用 `animate-in` 家族。dist 逐字读出的机制：

- `--animate-in: enter var(--tw-animation-duration, var(--tw-duration, .15s)) var(--tw-ease, ease) …`
  ——**默认 150ms、默认缓动 `ease`**；enter/exit 是单条合成 keyframe
  （opacity + translate3d + scale3d + rotate + blur 全在一条 transform 里）。
- 工具类映射：`fade-in-0`→`--tw-enter-opacity:0`；`zoom-in-95`→`--tw-enter-scale:.95`；
  `slide-in-from-top-2`→`--tw-enter-translate-y:-8px`（spacing 4px×2）；`duration-*`→`--tw-duration`。
- 进出场由 Base UI 的 `data-open/data-closed` 驱动，**不需要** useOverlayMount 那套手动保活。

仓内 shadcn 件现值（读自源码）：`dialog.tsx`/`dropdown-menu.tsx`/`popover.tsx` =
`duration-100 fade-in-0 zoom-in-95 (slide-in-from-*-2)`；`dialog-shell.tsx`（B1 的 .dlg 壳）=
`duration-200 fade-in-0 zoom-in-95`。

### 1.3 已经发生的漂移（不是假设，是现值）

| 面 | 复刻正本 | 仓内 shadcn 件现值 | 差 |
|---|---|---|---|
| 居中 dialog | 仅 fade 200ms ease-out（r8 实测） | fade + **zoom-in-95** 200ms（dialog-shell） | 多了 zoom；缓动是 tw 默认 `ease` 非 ease-out |
| 浮层 pop | 150ms --ease-pop，位移 **-4px** | 100ms `ease`，位移 **-8px**（dropdown/popover） | 时长 -50ms、缓动变平、位移加倍 |
| 挂载淡入 | 200ms ease-out | （shadcn 件未涉及；tw 默认 150ms ease） | -50ms、缓动变平 |

也就是说：**「迁到 shadcn」的一部分已经悄悄发生了**（B1/B2 落地的件带着 shadcn 默认动效进来），
本站当前是「复刻值为主、shadcn 默认值渗入了 6 个件」的混合态。本票要拍板的正是：混合态往哪边收敛。

## 2. 两个方向

### 方向 A：机制迁移，数值桥接（推荐）

**做法**：动效承载全部换成 shadcn/tw-animate-css 机制（`animate-in/out` + `data-open/data-closed`），
但把复刻值逐条桥进 tw 的变量层——`duration-[200ms]`、`ease-(--ease-out)`、
`zoom-in-95 slide-in-from-top-1`（= -4px，与 overlay-pop 逐值等价）等；`useOverlayMount` +
`.overlay-mount`/`.anim-*` 手动进出场随各面退役；motion.css 收缩到 spinner + hover/press +
tab 指示条这些 shadcn 无对应机制的状态面。

**观感**：与现行**完全一致**（原型第 2 列即此，GIF 里 A 列与「现行」列逐帧相同）——迁移是纯机制性的。

**代价**（按现消费面实测）：
- 14 个 tsx 消费点 + 3 个 ui 适配层的动效类改写，随 spec 16 的 B3/B4 逐域批次顺路做
  （弹层族本来就是 B3 的范围），**不需要单独的全站改动波**；
- 视觉 e2e 不动（钉的是几何/配色静止态）；动效相关断言只有 2 处 `getAnimations().finished`
  等待（机制无关）+ spinner duration（保留面），**重钉成本≈0**；
- 一处保真度损耗要认账：复刻的 reopen/exit 路径上 opacity 走 --ease-standard、transform 走
  --ease-pop（双缓动），tw 的单条 enter/exit keyframe 只能一个缓动——对齐到 transform 主缓动即可，
  肉眼差在 150ms 内的 opacity 曲线上，量级可忽略但记录在案。

**顺带修正**：1.3 的三处漂移在 A 下全部收回（dialog-shell 去 zoom-in-95 回「仅 fade」，
dropdown/popover 桥回 150ms --ease-pop / -4px）。

### 方向 B：直接采用 shadcn 默认动效语言

**做法**：全站统一到 tw-animate-css/shadcn 生态默认（150ms `ease` 基档，浮层 fade+zoom-95，
仓内已铺开的 duration-100 件维持现值），**废除复刻数值**；motion.css 退役到只剩 spinner 与
hover/press；1.3 的漂移不收回，反而成为新正典。

**观感**：整体更快更平（100–150ms、`ease`），是「通用 shadcn 件」的标准动效脸；
与 todos.dev 参考站产生**全站可感知漂移**（原型第 3 列）。

**代价**：
- 代码量反而最小（多为删类/删 hook），e2e 重钉同样≈0；
- 真正的代价在**决定层**：推翻 #73「数值逐条抄参考站」的复刻纪律，且与 #515 定位裁决的
  「语义轴对齐 todos」张力最大——动效是参考站观感的一部分，全站动效换脸等于宣布视觉层
  不再对齐参考站。这一步**只能用户拍板**，不能由迁移顺手发生（而 1.3 显示它正在顺手发生）。

### 两向共同项（不随方向变）

- tab 指示条（#644）、spinner reel、hover/press tint：shadcn 无竞争默认，两向都保持现值；
- `prefers-reduced-motion` 降级律两向都保留；
- 排期形态：都建议在 spec 16 追加「动效批」条目——**织入 B3/B4 逐域做**（每域结构迁移时
  顺手收该域动效），不另开全站波；验收沿用该册 §2 模板 + 本原型 GIF 作为 before/after 对照物。

## 3. 原型怎么用

- **交互原型**：浏览器直接打开 `docs/research/assets/644/motion-prototype.html`——
  5 个动效面 × 3 列（现行 / A / B）自动循环，可点「重播全部」；每格标注真实类名与数值。
  时间线由 Web Animations `currentTime` 驱动，交互与截图走同一条确定性路径。
- **逐面 GIF**（本目录，PR body 内嵌同一批）：`motion-pop.gif` / `motion-dialog.gif` /
  `motion-drawer.gif` / `motion-fade.gif` / `motion-pill.gif`；总览静帧 `motion-board.png`。
  注意 A 列与「现行」列**逐帧相同是刻意的**——它演示的是「机制换了、观感不动」。

## 4. 拍板结果（2026-10-02，用户裁决）

1. **方向 = B**（全站采用 shadcn 默认，显式推翻 #73 复刻纪律——理由与边界见 ADR 0009，
   本文的 A 向推荐未被采纳）。
2. **1.3 的三处既有漂移被 B 逐条追认**，不再单独裁：dialog 的 zoom-in-95、
   dropdown/popover 的 100ms/-8px、挂载淡入归 tw 默认档，均成为新正典。
3. **排期 = 动效批织入 spec 16 的 B3/B4 逐域**；执行票按逐域范围组织，
   #644 本身到原型交付为止（已随 PR #648 关闭）。
