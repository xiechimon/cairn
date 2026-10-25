# pacman × Base UI 覆盖地图：手搓面账本、逐面代价与批次日次

> 基线：`633afa37`（= origin/main，2026-10-03 取数；本文全部数字可用 §9 命令复跑）。
> 产出：t-0057 线程（只读盘点，未动产品代码）。
> 轴：**交互语义是否走 Base UI 官方件**。这与 spec 16 的「裸控件是否收进 `components/ui`」是
> 两本账——一面可以在 spec 16 轴上账面干净、在本轴上仍是手搓。最典型的例子就是
> `components/ui/select.tsx` 原语自身：它由 Button + FloatingShell 组装、手写 role=listbox，
> 在 spec 16 轴上是「原语」，在本轴上是最大缺口家族的核心。
> 上游裁决：#410（primitives = base）、spec 16 §3（「B1 起所有 shadcn 件按 base 形态拉取」）、
> ADR 0009 + #656（动效收敛 shadcn 默认、织入逐域）。
> 文档查证：Base UI 官方文档经 Context7（`/websites/base-ui_react`）按需核对，语义结论逐条给
> 出处；已装件目录读自主检出 `node_modules/.pnpm/@base-ui+react@1.8.0_*/node_modules/@base-ui/react/`
>（实物，不凭记忆）。

## 0. 结论一览

1. **覆盖率比票面预设高。** 共享壳（Dialog/AlertDialog 两代 shell）、Button（49 文件）、Input（16）、
   Tabs（含分段控制器正本）、Switch、Avatar/Badge 适配层、Popover（filter-panel）都已在官方件上。
   真缺口集中在 **6 个家族**：Select/listbox 族、Menu/popover 机制族、Checkbox 族、drawer、
   tooltip 面、collapsible 族——其中前四个有明确官方对应件，后两个是产品裁决面。
2. **spec 16 的「B3/B4 未开工」读数已过时。** XMON-24（detail，#593）、XMON-23（chief，#588）、
   XMON-25（pages，#607）、XMON-75（下拉/复选统一，#570）、XMON-72（复选收口，#600）等已把
   B4 高三件的结构切换落地：全站裸控件从 spec 16 账面 171 降到 **71（修正口径，§1.2）**，
   `ui/` 老原语消费点从 16 文件/17 处降到 **3 文件/3 处**。spec 16 账本主体停在 XMON-28（#547）
   时点，需要 rebase（§2）。
3. **三个官方件在仓里闲置，而对应的手搓面就在旁边。** `components/ui/dropdown-menu.tsx`
   （完整的 Base UI Menu registry 包装，Portal+Positioner+data-open 动效俱全）0 消费点，而
   `overlay/more-menu.tsx` 手写 role=menu；`dialog.tsx`、`alert-dialog.tsx` 两个 wrapper 同为
   0 消费点（壳职能已由 dialog-shell / alert-dialog-shell 适配层承担）。`ui/button.tsx` 是死文件
   （0 消费点）。卫生面见 §3.10 / U0。
4. **#656（动效方向 B）与本地图的缺口面是同一批文件。** #656 票面 14 个 tsx（现测 17 个，§5.3）
   与 Select 族 / Menu 族 / drawer / OverlayMount 旧世代高度重合；且 Base UI 官方件自带
   `data-open/data-closed` + shadcn 默认动效——**换官方件即自动达成 #656 的机制目标**。
   分开走 = 同一面动两次、两次像素验证。结论：**执行层按域合并（一次验收），票据层分开**（§7）。
5. **有边界，不是「全迁」。** mention-picker / search-panel / chip-popover / dir-browser 的内容层、
   hidden file input、textarea、separator、KbdHint、ClickCatcher（UX 裁决）、toast（sonner，#631
   已裁）——这些或无官方 drop-in、或已有仓内裁决、或纯属呈现，§3.9 逐条声明不迁理由。

**总览表**（详情与 file:line 证据在 §3，对照与语义判定在 §4，代价在 §5，批次在 §6）：

| 面 | 现机制 | Base UI 官方对应 | 判定 | 批 |
|---|---|---|---|---|
| Select 原语 + 6 个手搓 listbox 兄弟面 | FloatingShell(Dialog 非模态)+ClickCatcher+Button 行 | **Select**（完整件族） | 缺口，语义超集 | U2 |
| more-menu（role=menu） | FloatingShell + fixed capture 坐标 | **Menu**（wrapper 已在仓，闲置） | 缺口 | U3 |
| user-menu（sidebar 弹层） | OverlayMount 旧世代 + ClickCatcher + useEscapeClose | **Popover / Menu** | 缺口（机制代差） | U3 |
| sched-form-overlay（居中弹窗） | useOverlayMount + ClickCatcher 自绘 | **Dialog**（DialogShell 族） | 缺口（族外自绘） | U3 |
| chief-drawer | OverlayMount + `aside.anim-drawer` | ** positioned Dialog**（官方指引）或 Drawer.Root | 缺口，机制三选待裁 | U4 |
| ui/checkbox + filter-panel 三态行 + branch-dialog 旋钮 | 真 native input + 自绘皮肤 | **Checkbox**（span+hidden input，indeterminate 一等） | 缺口（有意的，但官方给同样的「白送」） | U1 |
| 41 处 `title=` + KbdHint hover chip | 原生 tooltip / 纯 CSS hover | **Tooltip** | 产品裁决面，默认不迁 | U6 |
| sidebar 组折叠 / board 列折叠 / transcript 行折叠 | aria-expanded 手搓（ARIA 正确） | **Collapsible** | 低收益，默认不入批 | U7 |
| toaster（sonner） | shadcn 官方配方 | Toast（存在） | **已有裁决（#631），不迁** | — |
| mention-picker / search-panel / chip-popover / dir-browser 内容层 | FloatingShell 或 DialogShell 机制 + 手搓内容 | 无 drop-in（Combobox 需自持 input） | 边界声明 | — |
| sidebar 9 + filter-panel 6 + resources 对话框 14 裸 button | 裸控件 | Button（件已官方，账未收） | spec 16 轴残留 | U5 |
| ui/button（死）、dialog.tsx / alert-dialog.tsx / dropdown-menu.tsx（闲置）、ui/README.md（过时） | — | — | 卫生面 | U0 |

## 1. 账本口径与基线复核

### 1.1 任务书已知事实逐条复核（全部成立，两处精化）

| 已知事实 | 复核结果 |
|---|---|
| `@base-ui/react ^1.8.0` 在 web 依赖 | 成立（`apps/web/package.json:19`） |
| 13 个文件引用 | 成立（§3.1 清单逐文件核对） |
| 用到 10 个子包 | 精化：**9 个组件子包 + 2 个工具子包**——alert-dialog（×2 文件）/ avatar / button / dialog（×3：dialog.tsx、dialog-shell、floating-shell）/ input / menu / popover / switch / tabs，加 merge-props + use-render（均 badge.tsx:1-2） |
| checkbox.tsx 手搓（只 import cn） | 成立，且是**有文档理由的有意手搓**（文件头 1-4 行：真 native input 承载键盘/表单/读屏，视觉骑自制 tile）——但 Base UI Checkbox 同样给这些语义（§4），理由不构成永久豁免 |
| select.tsx 手搓（只用 useState） | 成立——但注意它不是「忘了迁」：它是 XMON-75 建的**家族法组件**（FloatingShell + ClickCatcher + Esc，absolute 锚定 wrap，文件头 10-17 行），是仓内弹层词汇的一部分 |

### 1.2 裸控件账本修正：脚本 75 → 实 71

`node scripts/count-raw-controls.mjs` 现值 75，其中 **4 处是注释文本被脚本按子串误计**
（该脚本不剥注释）：

| 误计位置 | 注释原文形态 |
|---|---|
| `components/ui/checkbox.tsx:2` | 头注释里的 `` `<input type="checkbox">` `` |
| `components/ui/select.tsx:5` | 头注释里的 `` 原生 `<select>` `` |
| `routes/api-key-create-dialog.tsx:118` | XMON-75 迁移说明注释里的 `` `<input type="checkbox">` `` |
| `routes/agent-detail-page.tsx:314` | XMON-75 迁移说明注释里的 `` `<select>` `` |

**修正后全域账（633afa37 实测，口径 = 剥注释后的四类裸控件）**：

| 域 | button | input | select | textarea | 合计 |
|---|---|---|---|---|---|
| resources | 16 | 0 | 0 | 2 | 18 |
| board | 15 | 1 | 0 | 0 | 16 |
| overlay | 10 | 0 | 0 | 1 | 12（more-menu 5 · new-task-dialog 4 · mention-picker 3） |
| overlays | 6 | 0 | 0 | 0 | 6（search-panel 4 · plan-dropdown 1 · dismiss 1） |
| pages | 5 | 0 | 0 | 0 | 5（project-new-page 3 · project-page 1 · schedules-page 1） |
| chief | 2 | 0 | 0 | 2 | 4 |
| detail | 0 | 2 | 0 | 2 | 4（composer 2 · branch-dialog 1 · review-dialog 1） |
| routes | 0 | 1 | 0 | 1 | 2（agent-detail-page 的名称行内改名 input + textarea） |
| components | 1 | 1 | 0 | 0 | 2（model-select-core 1 · ui/checkbox 本体 1） |
| ui（老原语本体） | 1 | 1 | 0 | 0 | 2 |
| **合计** | **56** | **7** | **0** | **8** | **71** |

**71 处里有 11 处不是 Base UI 轴的缺口**（本轴净账 = 60）：textarea 8 处（Base UI 无 textarea
件，shadcn 的 Textarea 也是纯样式壳）、hidden file input 2 处（`detail/composer.tsx:148`、
`overlay/new-task-dialog.tsx:440`——原生触发器标准模式）、`overlays/dismiss.tsx` 的
ClickCatcher 1 处（透明全屏 button 是**有意的 UX 原语**，floating-shell.tsx:14-17 头注释明文
「换它是 UX 变更，不是机械迁移」）。**原生 `<select>` 全站为 0**——XMON-75 的「原生 select
清零」声明经剥注释复核成立。

### 1.3 三种动态拼接的落点（grep 字面零命中 ≠ 不存在）

| 拼接形态 | 落点 | 性质 |
|---|---|---|
| `` `btn--${variant}` `` | `ui/button.tsx:34` | 老原语死文件（0 消费点），拼接随文件退役 |
| `` `${prefix}-wrap/select/shell/menu/row/...` `` | `components/ui/select.tsx:75-135` | **面钩子家族**：消费面传 prefix（sched-form ×3、agent-skill / agent-runtime / agent-model、agent 级联 ×2），e2e 与面 css 全钉这层钩子——迁官方件时类钩子必须原样保输出（#411 别名优先） |
| `` `${codeClassName}--link` `` | `detail/segments.tsx:47` | 内容渲染钩子（chat-code--link / doc-code--link），非控件面，不入账 |

### 1.4 已装官方件目录（1.8.0 实物，47 个入口）

accordion / alert-dialog / autocomplete / avatar / button / checkbox / checkbox-group /
collapsible / combobox / context-menu / csp-provider / dialog / direction-provider / drawer /
field / fieldset / floating-ui-react / form / input / internals / menu / menubar / merge-props /
meter / navigation-menu / number-field / otp-field / popover / preview-card / progress / radio /
radio-group / scroll-area / select / separator / slider / switch / tabs / toast / toggle /
toggle-group / toolbar / tooltip / types / unstable-use-media-query / use-render / utils。

比任务书抄的上游目录多出：**navigation-menu、otp-field、preview-card**（及 provider/工具类
入口）——对照一律以本实物目录为准。

## 2. spec 16 现状修正（rebase 读数）

spec 16 账本主体（§0 状态列、§5.2 消费点表、§6.5 裸控件账）停在 **XMON-28（#547）时点**，
外加 #561 收口行的局部更新；此后的落地没有回写。逐条对账：

| spec 16 记载 | 633afa37 实测 | 落地证据（commit / PR） |
|---|---|---|
| B4 高三件「未开工」，剩 11 个 tsx 消费点、裸控件 83 | chief / detail / pages 结构切换**已落地**；三域裸控件余 13（chief 4 · detail 4 · pages 5） | XMON-24 detail 12 文件 42 控件（`134de3bf` #593）、XMON-23 chief 20 控件（`b5609a9c` #588）、XMON-25 pages 35+5 控件（`980e43a3` #607） |
| §5.2 老原语消费 16 文件 / 17 处 | **3 文件 / 3 处**：`resources/create-provider-dialog.tsx:34`（ui/input）、`resources/create-secret-dialog.tsx:11`（ui/input）、`routes/agent-detail-page.tsx:93`（ui/chip） | XMON-23/24/25 各票收口；ui/button 消费点已清零（文件成死件） |
| §6.5 全站裸控件 171 | **71**（修正口径 §1.2） | 同上 + XMON-75 下拉/复选统一（`804bfef9` #570）、XMON-72 复选收口（`61f4de2f` #600）、filter-panel 重建（`296b7179`）、看板拖拽重做（`ee636a5f` #618） |
| 分段控制器 = 手搓 `.team-layout-tabs` | **Tabs variant="segmented" 正本**（XMON-103，`bb1370d6` #585）：`routes/team-page.tsx:135-145`、`resources/providers-page.tsx:154` | 已在 Base UI Tabs 上 |
| 静息方框无原语 | **Panel 原语**（XMON-104，`de3dff33` #587，cva 皮肤档） | 呈现件，无 Base UI 对应需求 |
| toast 无面 | **sonner toaster**（#631，`43528c48` #635）+ #638（26 件接线）进行中 | §3.8 裁决面 |
| e2e 66 spec / 61 有类名钉扎（§6.4，`8c30775` 时点） | **83 个 spec 文件** | `ls apps/web/e2e/*.spec.ts` |
| 域 css 体量表（§5.1，`fa54bbad`） | 漂移：chief 841→**1100 行**（470→591 decl）、pages 1927→**1984**（1094→1110）、detail 1913→**1925**（955→925）、secondary 924→**814**（488→426）、board 140→**183**；新增 profile-card.css 150、components/ui/{checkbox,select}.css 45/81 | §9 复跑命令 |

两处遗留裁决的状态更新：

- **§6.5「resources create-* 排除面留给父票裁」**——父票 #417 已关（2026-09-30 被 PR #522
  的 squash 误关，见仓 CLAUDE.md 记载），裁决悬空。本地图 U5 把它收进「裸控件账清零」批。
- **#414 试点片「sidebar 9 处」**——仍在（`board/sidebar.tsx` 修正后 9 处裸 button，全侧栏
  导航行/搜索行/rail 切换），归 U5。

老 `ui/` 层退役现状：button.tsx+button.css **死文件**；dialog-shell.tsx 已随 B1 删除；
chip 1 消费点、input 2 消费点；`ui/dialog.css`（246 行/93 decl）**仍是活的**——`.dlg-*` 族
per-face 几何正本，由 `components/ui/dialog-shell.tsx` 输出别名类（该文件 13-15 行注释）；
`ui/README.md` 内容过时（仍列已删除的 dialog-shell 行）。

## 3. 手搓面清单（全站扫描）

### 3.1 对照组：已在 Base UI 上的面

| 件 | 子包 | 消费文件数 | 备注 |
|---|---|---|---|
| `ui/button.tsx` | button | **49** | 全站按钮正本 |
| `ui/dialog-shell.tsx` | dialog | **17** | B1 弹层壳（.dlg 别名 + dlg-viewport 两档），动效已 data-open 化 |
| `ui/input.tsx` | input | 16 | |
| `ui/seeded-avatar.tsx` → `ui/avatar.tsx` | avatar | 15（+1 内层） | XMON-14 适配层 |
| `ui/floating-shell.tsx` | dialog（**非模态**） | 8 | 锚定浮层族共用底座：`modal={false}` + Portal container 回锚 + role=dialog（floating-shell.tsx:50-68）；Esc 走 Base UI layer 栈 |
| `ui/tag-chip.tsx` → `ui/badge.tsx` | merge-props + use-render | 6（+5 内层） | |
| `ui/kbd-hint.tsx` → `ui/kbd.tsx` | —（registry 呈现件） | 5（+2 内层） | hover/focus CSS chip，见 §3.6 |
| `ui/tabs.tsx` | tabs | 4 | providers-page / chief-settings / agent-detail-page / team-page；含 segmented 档正本 |
| `ui/checkbox.tsx` | —（手搓） | 4 | **缺口**，见 §3.3 |
| `ui/card.tsx` | —（呈现） | 4 | 布局容器，无对应官方件需求 |
| `ui/select.tsx` | —（手搓） | 3 | **缺口核心**，见 §3.2 |
| `ui/switch.tsx` | switch | 3 | machines-page / agent-detail-page / account-page |
| `ui/alert-dialog-shell.tsx` | alert-dialog | 2 | 内部另用 use-esc.ts（老 Esc hook 唯一消费者） |
| `ui/panel.tsx` | —（呈现，cva） | 2 | XMON-104 |
| `ui/empty.tsx` | —（呈现） | 2 | |
| `ui/popover.tsx` | popover | **1** | 唯一消费点 = `board/filter-panel.tsx:45`（重建时并入全站 popup vocabulary，`a6234e9b`）——官方 Positioner 世代目前只有这一面 |
| `ui/toaster.tsx` | —（sonner） | 1（App.tsx 挂载） | §3.8 |
| `ui/dialog.tsx` | dialog | **0（闲置）** | §3.10 |
| `ui/alert-dialog.tsx` | alert-dialog | **0（闲置）** | §3.10 |
| `ui/dropdown-menu.tsx` | menu | **0（闲置）** | 完整 Menu registry 包装：Portal + Positioner(side/align/offset) + Popup 带 data-open/data-closed animate-in/out + Group/Label/Item 族——**正是 #656 的目标动效形态**，U3 启用 |

FloatingShell 直接消费者（8 文件）：select.tsx、plan-dropdown、skills-page（排序菜单）、
chief-model-select、dhead（chip-popover 锚）、more-menu、mention-picker、agent-detail-page:467。
ClickCatcher 消费者（15 文件）：上列 + sidebar、chief-drawer、new-task-dialog、schedules-page、
project-new-page、project-page、dir-browser、account-page。

### 3.2 缺口家族 A：Select / listbox 族（最大家族群）

**原语**：`components/ui/select.tsx`——触发钮（Button ghost）+ FloatingShell + ClickCatcher +
`role="listbox"` 菜单 + Button 行 `role="option"`（75-138 行）。几何法（头注释 10-17 行）：
absolute 贴 wrap 左缘向下展开、z 30 压 ClickCatcher 的 29、面 css 以 `.ui-select-menu.<prefix>-menu`
复合选择器写覆盖。

**消费实例（7 处 / 3 文件 + 1 复用件）**：

| prefix | 位置 | 面 |
|---|---|---|
| `sched-form` ×3 | `pages/schedules-page.tsx:285,299,310` | 排期 日期·时·分 |
| `agent-skill` / `agent-runtime` / `agent-model` | `routes/agent-detail-page.tsx:319,348,357` | agent 概览三槽 |
| 透传 prefix ×2 | `routes/agent-model-select.tsx:89,130` | 创建 agent 弹窗 + 概览槽的两级级联（t-0024 / #617 形态，行投影律单源在 `components/model-select-core.tsx`，#626 收敛） |

**手搓兄弟面（同语义、不走原语，6 面）**：

| 面 | 位置 | 形态 |
|---|---|---|
| `.chief-model-menu` | `chief/chief-model-select.tsx:104` | role=listbox「压缩模型」，FloatingShell + anim-pop；model-select-core 头注释明言 chief 面**不收编壳**（两级级联与 flat+搜索形态不同构，产品裁决） |
| `.new-task-project-menu` | `overlay/new-task-dialog.tsx:385` | role=listbox 项目选择，aria-expanded 挂 369 行 |
| `.prj-tasks-menu` | `pages/project-page.tsx:244` | role=listbox 任务视图选择 |
| `.prj-new-repo-menu` | `pages/project-new-page.tsx:449` | role=listbox 仓库选择 |
| `.prj-new-gh-picker` | `pages/project-new-page.tsx:492` | GitHub issue 选择弹层 |
| plan-dropdown | `overlays/plan-dropdown.tsx` | 方案/变更 + 右栏视图 picker，FloatingShell + ClickCatcher + Button 行，「select-and-close 律」（#306） |
| skills-page 排序菜单 | `resources/skills-page.tsx` | FloatingShell 家族成员（floating-shell.tsx:2-3 头注释点名） |

**官方对应件 = Select**（已装 1.8.0 件族实物：Root/Label/Trigger/Value/Icon/Portal/Backdrop/
Positioner/Popup/List/Item/ItemText/ItemIndicator/Group/GroupLabel/Separator/ScrollUpArrow/
ScrollDownArrow/Arrow）。语义判定（官方文档，base-ui.com/react/components/select.md 经
Context7 核对）：

- **超集**：键盘导航 + typeahead、floating-ui 定位、滚动箭头、items API、受控 value/onValueChange
  全内置；现手搓面只有点击 + Esc。
- 两处**不等价点要显式处理**：① 官方 popup 默认**叠在 trigger 上**（macOS 式选中行对齐），
  仓内几何法是「贴左缘向下展开」——须关默认对齐改 Positioner side/align/sideOffset；
  ② 表单参与经 Field hidden input（handbook/forms.md），仓内各面走 JS mutation 不走原生
  submit，可不用 Field（值仍经 onValueChange）。
- 官方指引原文：「Select is not filterable, aside from basic keyboard typeahead… **Prefer
  Combobox** when the number of items is sufficiently large」——模型面数十行在 Select 舒适区；
  带搜索框的 chief 主模型 dialog 若未来要收编才涉及 Combobox。

### 3.3 缺口家族 B：Checkbox 族

| 面 | 位置 | 现机制 |
|---|---|---|
| `ui/checkbox.tsx` 原语 | 消费 4 文件：create-provider-dialog / accept-dialog / stop-confirm-dialog / api-key-create-dialog | 真 `<input type="checkbox">`（id 透传给 e2e/labelFor）+ 自制 tile（方角 18px 实底白勾）；**无 indeterminate 支持** |
| filter-panel 三态全选行 | `board/filter-panel.tsx:213-236` | 裸 input + `ref` 设 indeterminate + appearance-none Tailwind 自绘（勾/横杠覆层）；注释裁决「三态走 indeterminate 属性，语义与键盘/读屏行为白送」 |
| branch-dialog 强制同步旋钮 | `detail/branch-dialog.tsx:159-172` | 裸 checkbox **扮 switch**（`.dlg-toggle` + knob）——对应件其实是仓内已有的 `ui/switch`（Base UI Switch），不是 Checkbox |

**官方对应件 = Checkbox + CheckboxGroup**。语义判定（base-ui.com/react/components/checkbox.md、
checkbox-group.md 经 Context7 核对）：Root 渲染 `<span>` + **hidden native input**；props 含
`name/value/uncheckedValue/form`（表单参与）、**`indeterminate` 一等公民**、`parent` +
CheckboxGroup `allValues`（父级三态自动管理）、`data-checked/data-unchecked/data-indeterminate`
样式钩子。结论：**「白送语义」的立论对官方件同样成立**——手搓版的理由（原生键盘/表单/读屏）
不构成豁免；差异在 e2e 定位面（真 input → hidden input：`toBeChecked` 仍可断言，`.check()`
直点 input 的写法要改点 Root）与 id 落点（hidden input 可继续吃 id）。

### 3.4 缺口家族 C：Menu / popover 机制族（含机制三代差）

**机制三代差**是本家族的真问题——同一类浮层，仓内并存三代机制：

| 世代 | 机制 | 现存面 |
|---|---|---|
| 旧世代 | `OverlayMount`（useOverlayMount 手动保活）+ ClickCatcher + useEscapeClose | sidebar user-menu（sidebar.tsx:264-270）、chief-drawer（§3.5）、dir-browser（dir-browser.tsx:17,119-121「弹层家族法 #67/#127」）、sched-form-overlay（schedules-page.tsx:224）、project-page / project-new-page / account-page 的各弹层 |
| 过渡世代 | FloatingShell（Base UI Dialog 非模态）+ ClickCatcher + 各面自管定位 CSS | select 族、more-menu、plan-dropdown、mention-picker、chip-popover（dhead 锚）、skills 排序 |
| 官方世代 | 官方件 Portal + **Positioner**（floating-ui 锚定） | 仅 filter-panel（Popover） |

具体面：

- **more-menu**（`overlay/more-menu.tsx:53-57`）：role=menu、fixed capture 坐标、5 行
  Button ghost（复制/禁止/删除等）。**官方对应 = Menu，且 wrapper 已在仓**（dropdown-menu.tsx，
  §3.1）——启用即得 Positioner 锚定 + data-open 动效 + 焦点管理 + typeahead。
- **user-menu**（`detail/user-menu.tsx`）：内容面板（身份头 + 外观行 + 3 条 Link 导航行），
  弹层机制在 sidebar（旧世代）。**外观主题分段 = 2×ghost Button + data-active**
  （user-menu.tsx:73-88，XMON-24 注释）——与 XMON-103 的 Tabs-segmented 正本并存两套分段形态；
  官方对应 = Popover（面板）或 Menu（行语义），主题段可随迁 Tabs-segmented 或 ToggleGroup。
- **sched-form-overlay**（`pages/schedules-page.tsx:224`）：居中弹窗自绘皮肤（anim-fade），
  没走 DialogShell 族——族外居中弹窗独此一例。官方对应 = Dialog（收进 DialogShell 即归族）。
- **chip-popover**（`overlays/chip-popover.tsx:31`）：role=dialog 内容面板（项目头 + 任务行 +
  执行对话行 + 编辑分配），dhead 经 FloatingShell 锚定。内容层无官方对应（信息面板），机制层
  随家族走。

### 3.5 缺口家族 D：chief-drawer

`chief/chief-drawer.tsx:272-273`：`<OverlayMount open={open} exitMs={DRAWER_EXIT_MS}>` +
`<aside className="chief-drawer anim-drawer">`——手动保活 + 手写 keyframes（motion.css 的
drawer-in 300ms）。35.5K 单文件，贴右竖板（ADR 0004 / #447），N 键作用域热键（#645），
threads 切换 popover 用 ClickCatcher。

官方判定（Context7 核对两处原文）：

- dialog.md 使用指引：「**A panel that slides in from the edge of the screen and doesn't need
  gesture support is a positioned Dialog.**」——chief-drawer 无手势需求（桌面 dock 面板，
  fab/热键开合），按官方指引应走**非模态 Dialog 机制**（FloatingShell 同律，docked 定位 CSS
  不变）。
- drawer.md：Drawer.Root 支持 `modal={false}` + `disablePointerDismissal` + `swipeDirection`——
  若未来要手势/吸附点才值得上 Drawer 件。

#656 要求进出场改 `data-open/data-closed` 驱动——手搓 aside 拿不到这两个属性，**机制必须换**，
三选：非模态 Dialog 机制（推荐）/ Drawer.Root / 手挂 data 属性（违 ADR 0009 D1「手动机制退役」
的方向，不推荐）。

### 3.6 缺口家族 E：Tooltip 面（产品裁决）

- **41 处原生 `title=`**（约 30 文件；top：agent-detail-page 3、todo-detail-page / skills /
  secrets / mcp-servers / schedules / detail-overlays / chat-markdown 各 2）——无样式、系统延迟、
  明暗主题不随仓；**e2e 零钉扎**（`getAttribute('title')` 全站 0 命中）。
- **KbdHint**（`components/ui/kbd-hint.tsx`）：hover/focus-visible 纯 CSS 浮出 chip
  （`[:is(:hover,:focus-visible)>&]` + visibility/opacity 120ms），aria-hidden（读屏语义由宿主
  控件 aria-label 承载）；头注释明文：静息隐藏走 visibility 是 **hotkeys.spec 的 toBeHidden
  探针依赖**。
- `ui/kbd.tsx:15` 已带 registry 的 `in-data-[slot=tooltip-content]:` 变体——**悬空**（仓内无
  tooltip-content slot，等 ui/tooltip 件落地才生效）。

官方对应 = Tooltip（Trigger+Portal+Positioner+Popup）。迁与不迁是**产品裁决**：原生 title
零 JS 零维护；统一设计语言则要新增 registry 件 + 41 处逐面换 + KbdHint 机制迁移（hotkeys.spec
探针改写）。默认建议**不迁**（U6 只留裁决题）。

### 3.7 缺口家族 F：Collapsible 族（低收益，默认不入批）

手搓折叠四处，ARIA 全部正确（aria-expanded + 持久化）：sidebar 组折叠（sidebar.tsx:117-187，
GROUP_STORAGE_KEYS localStorage 持久化 + chevron rotate + rail 孪生态）、board #147 列折叠族
（board.tsx:3）、transcript 行折叠（transcript.tsx:133-140）、new-task-dialog 项目段
（new-task-dialog.tsx:369）。官方 Collapsible 提供的是高度动画 + presence 管理；在 ADR 0009
方向 B 下若全站折叠要统一 shadcn 默认动画语言才有收益——当前无此需求，声明边界（U7 不排期）。

### 3.8 有官方对应、但已有仓内裁决的面（不迁，记录在案）

- **Toast = sonner**：`ui/toaster.tsx` 头注释（#631）明言「shadcn 官方 toast 实现是 sonner——
  本件即其官方配方按本仓形态的适配」（主题镜像 + popover 族皮肤槽 + bottom-left 让位 drawer）。
  Base UI Toast 存在，但迁移 = 推翻 #631 + 打断 #638（26 件 toast.error 接线，进行中）——
  **纯 churn，不迁**。shadcn registry 的 toast 正本本来就是 sonner，与「shadcn 件按 base 形态
  拉取」（spec 16 §3）不冲突：该句约束的是 registry 有 base 形态的件。
- **分段控制器 = Tabs variant="segmented"**（XMON-103 正本）：已在 Base UI Tabs 上，不是缺口；
  user-menu 主题段是**仓内一致性**问题（两套分段形态并存），随 U3 收敛到正本即可，不需新件。

### 3.9 边界声明：无官方 drop-in 或非交互语义（不迁，逐条理由）

| 面 | 理由 |
|---|---|
| mention-picker 内容层（`overlay/mention-picker.tsx`） | 居中 400 宽双层钻入 + 多选累计 + 插入(N) 底栏——**实体选择器 dialog**，不是 input 补全。Combobox/Autocomplete 要求组件自持 input，而 mention 的宿主是外部 composer textarea（picker「never touches the editor」，头注释）。机制层已是 Base UI Dialog（FloatingShell）。`mention-inline`（:365）同族。若内层「搜索框+行表」将来要 typeahead 可局部评估 Combobox，不入批 |
| search-panel 内容层 | 机制 = DialogShell（官方）；结果行是内容，无对应件 |
| chip-popover / dir-browser / new-task-discard 内容层 | 同上；dir-browser 的**机制**是 OverlayMount 旧世代，归 U4 退役面，内容层（文件夹行表）手搓合理 |
| hidden file input ×2 | `composer.tsx:148`、`new-task-dialog.tsx:440`——原生触发器标准模式，Base UI 无对应件 |
| textarea ×8 | Base UI 无 textarea 件（shadcn Textarea 亦纯样式壳）；收编属 spec 16 轴（纯样式），非本轴 |
| ClickCatcher | 有意 UX 原语（外点只关浮层不穿透），floating-shell.tsx:14-17 明文「换它是 UX 变更」。**注意**：迁官方 Select/Menu 时官方 outside-press 语义 = 关面且事件继续打到下层——每面要么接受官方语义（UX 变更，需确认），要么保留 catcher 层。这是 U2/U3 的逐面裁决点，不是机械项 |
| separator | `chip-popover-divider` 等 div+css，零行为语义；官方 Separator 存在但组件化收益 ≈ 0 |
| ScrollArea | 全站无自绘滚动条皮肤（detail.css:1036 唯一命中是注释）；原生滚动是现状裁决 |
| Field / Form / Fieldset | 全站唯一 `<form>` = token-gate:71；表单走 JS mutation 非原生 submit；dlg-form-* 手搓 label 模式够用。官方 Field 的收益（hidden input 表单参与 / validate）当前无消费场景 |
| Radio / RadioGroup / Slider / NumberField / Meter / Progress / ContextMenu / Menubar / Toolbar / NavigationMenu / OtpField / PreviewCard / Autocomplete / Combobox | 全站无对应手搓面：`type="radio"/range/number` 0 命中、`onContextMenu` 0 命中、progress/meter 0 命中——N/A |

### 3.10 死件与卫生面

| 件 | 状态 | 处置建议 |
|---|---|---|
| `ui/button.tsx` + `ui/button.css` | **0 消费点**（死文件；仓内仅 3 处注释提及旧 variant 谱系） | 删 |
| `components/ui/dialog.tsx` | 0 消费点（dialog-shell 直连 primitive） | 删或留作 registry 重拉底座——批内小裁决；633afa37 刚做过「orphaned primitive variants」清理，倾向删 |
| `components/ui/alert-dialog.tsx` | 0 消费点（alert-dialog-shell 直连 primitive） | 同上 |
| `components/ui/dropdown-menu.tsx` | 0 消费点但**完整可用** | 留，U3 启用（more-menu） |
| `ui/README.md` | 过时（列已删除的 dialog-shell；「新代码必须用原语」指向的层已半退役） | 随 U0 改写为退役状态说明 |
| `ui/input.tsx` + `ui/chip.tsx` | 各 2 / 1 消费点 | U5 收编后删（input → components/ui/input；chip → tag-chip 或保留裁决） |
| `ui/dialog.css` | **活**（.dlg-* per-face 几何正本） | 不动（B1 口径） |
| `overlay/use-esc.ts` | 1 消费点（alert-dialog-shell） | U4 验证 Base UI layer 栈等价后退役 |

## 4. 逐面对表（官方件 × 语义等价 × 迁移性质）

迁移性质四档：**机械**（结构换件、行为语义不变）/ **像素**（几何正本需 Positioner 平移 + 逐面
bbox 对拍）/ **UX 裁决**（行为语义有差，需确认）/ **产品裁决**（迁不迁本身是产品决定）。

| 面 | 官方件 | 语义等价判定 | 迁移性质 | 主要阻塞点 |
|---|---|---|---|---|
| Select 原语（7 实例） | Select | 超集（键盘/typeahead/定位/滚动箭头全补上）；受控 value/onPick 一一映射；unsetLabel 清空行 = 普通 Item(value=null) | 像素 + UX | popup 默认叠 trigger 须关；「贴 wrap 左缘向下」平移 Positioner；ClickCatcher 语义（§3.9）；prefix 钩子 7 组全保（#411） |
| 手搓 listbox 兄弟面 ×6 | Select | 同上；model-select-core 行投影律不动（#626 单源在 core，壳迁移不碰） | 像素 + UX | chief 面「不收编壳」是产品裁决（model-select-core 头注释）——迁 Select 件≠统一壳，逐面保皮肤 |
| plan-dropdown | Select（view picker 语义） | 等价；「select-and-close 律」= Select 原生行为 | 像素 | fixed 坐标 → Positioner |
| more-menu | Menu（wrapper 在仓） | 超集（焦点圈/typeahead/子菜单）；role=menu 保持 | 像素 + UX | fixed capture 坐标 → Positioner 锚定；disabled 行语义（Ban 行条件禁用）映射 Menu.Item disabled |
| user-menu | Popover 或 Menu | 面板含导航 Link 行 + 主题分段——Menu 支持 item render Link；Popover 更贴「内容面板」现实 | 像素 + UX | 机制在 sidebar（旧世代），弹层锚定律 v3（#611「净空对触发行盒顶量」）要用 Positioner 偏移表达；8 文件/24 处钉扎 |
| 主题分段（user-menu 内） | Tabs-segmented 正本（仓内）或 ToggleGroup | 非视图切换、是设置项——两可 | 机械 | 与 XMON-103 正本一致性裁决 |
| sched-form-overlay | Dialog（DialogShell 族） | 等价（居中模态弹窗） | 像素 | 自绘皮肤（8 css hits）并入 .dlg 族或保留 per-face |
| chief-drawer | 非模态 Dialog 机制（官方指引）/ Drawer.Root | 官方指引原文判给 positioned Dialog；无手势需求 | 像素 + UX | 35.5K 单文件；always-docked 布局不变，只换进出场机制；#656 强耦合（U4） |
| ui/checkbox | Checkbox | 等价超集：hidden input 给同样的表单/读屏语义，indeterminate 补上手搓版缺口；label 兜底 aria-label 保持 | 机械 + 像素 | e2e 定位面（真 input → hidden input）；tile 皮肤（方角 18px 白勾）平移到 data-checked 钩子；checkbox-unified.spec 断言层改写 |
| filter-panel 三态行 | Checkbox（indeterminate + parent 可选） | 官方 indeterminate 一等公民，ref 手法退役 | 机械 | 该面有注释裁决语气（「白送」）——迁官方件同样白送，建议迁；不迁则记录为声明保留 |
| branch-dialog 旋钮 | **Switch**（仓内已有件） | 语义本来就是 switch（knob 形态） | 机械 | dlg-toggle css 5 hits 退役；行为钉扎走 merge/reject 链 spec |
| tooltip 面 | Tooltip | 官方件 = 设计语言统一 + 可控延迟/主题 | **产品裁决** | 41 处逐面 + KbdHint 机制（hotkeys.spec toBeHidden 探针依赖 visibility 手法） |
| collapsible 族 | Collapsible | 手搓 ARIA 已正确；官方补高度动画/presence | 产品裁决（默认不迁） | 收益仅机制统一 |
| toaster | Toast | sonner = shadcn 官方配方，已裁（#631） | **不迁** | — |

## 5. 逐面代价

### 5.1 探针面现状（先立标尺）

- `toHaveScreenshot` = **0**——本仓没有截图比对探针；「像素探针」实体 = **bbox 几何断言
  18 文件** + **getBoundingClientRect 断言 21 文件**（有重叠），外加 `docs/verify/` 证据 PNG
  的人工目检面（a636fb09 后证据捕获已改 opt-in，全量跑不再重写 PNG）。
- 横切 spec（任何批都撞）：dead-buttons（28.9K，#222「死钮不渲染」律）、hotkeys（33.7K）、
  escape-wiring、dialog-viewport、shell-consistency、shadcn-primitives、visual-polish、brand-typo。
- `title=` 属性 e2e 零钉扎；`dlg-viewport` 类钩子现 0 命中（spec 16 时代的 34 处钉扎已随
  B1/后续重钉消化）。

### 5.2 逐面代价表

| 面 | css 体量（行/decl 或钩子命中） | e2e 钉扎（文件/处） | 几何探针 | 估 lane-day |
|---|---|---|---|---|
| Select 原语 + 兄弟面 | select.css 81/44；面钩子 css 命中 ≈103（ui-select 21 · sched-form 28 · agent-* 19 · prj-new-repo/gh 27 · prj-tasks 5 · chief-model 1 · new-task-project 1） | 广谱 `-menu` 钩子触及 **21 文件**；逐面：project-new-repo 4/18 · newtask-project-select 2/5 · project-tasks-toolbar 1/8 · chief-drawer-model 1/4 · project-new-github 1/4 · sched-form-overlay 1/8 | agent-create-model ✓bbox · agent-detail ✓bbox · segmented-controls ✓ | **3**（拆 3 PR） |
| more-menu | overlay.css 钩子 19 | 3/7 | dead-buttons 横切 | 0.5 |
| user-menu | detail.css `.user-menu` 族 | **8/24** | user-menu-trigger ✓bbox | 1 |
| chip-popover | overlays.css 钩子 18 | 5/12 | chip-hotzone（rect 几何） | （随机制族 0.5） |
| plan-dropdown | overlays.css 钩子 12 | 2/9 | — | 0.5 |
| search-panel | overlays.css `.search-*` 9 | 6/12 | search-focus ✓bbox | 机制已官方，不动 |
| mention-picker | mention-picker.css **405/225** + 钩子 32 | 1/1（+inline 1/1） | mention-picker-center（rect 居中钉） | 边界不迁；动效尾随 #656 |
| chief-drawer | chief.css **1100/591**（域 css ≈ drawer 本体） | 8/19 | chief-panel ✓bbox · chief-fab ✓bbox | 1.5 |
| sidebar（9 裸 btn + 组折叠） | board.css 183/84 + tsx 内 Tailwind（RAIL_ROW 族） | sidebar-nav / sidebar-seam（rect）/ sidebar-visual（rect）/ collapse-family 1/7 / hotkeys | ✓rect ×3 | 1 |
| filter-panel（6 btn + 三态 1） | Tailwind 自绘（域 css 钩子 0） | board-filter（rect，filter-dimension 1/5） | ✓rect | 0.5 |
| checkbox 原语 | checkbox.css 45/25 | checkbox-unified 1/1 | ✓bbox | 0.5 |
| branch-dialog 旋钮 | ui/dialog.css `.dlg-toggle` 5 | 类钩子 0（行为走 merge/reject 链） | — | 0.25 |
| sched-form-overlay | pages.css 钩子 8 | 1/8 | — | 0.5 |
| dir-browser | pages.css 钩子 | **2/29**（project-new-dir-browser · project-new-fs-pick） | — | 机制随 U4 |
| resources 创建对话框（14 btn + 2 老 input） | resources.css 706/362（域共享） | provider-add-dialog · secret-add-dialog · machine-add-dialog · skills-write · provider-oauth | — | 1 |
| tooltip 面 | 0 css（原生 title）+ kbd-hint Tailwind | **0** | hotkeys toBeHidden（KbdHint 机制） | 裁决前 0 |
| toast（sonner） | shadcn.css 皮肤槽 | 2 文件（agent-detail · composer-wire-reject） | — | 不迁 |
| 死件清理 | ui/button.css 59/28 等 | 0 | 0 | 0.25 |

### 5.3 动效面（#656 的账，供合流对拍）

`anim-*|overlay-mount|OverlayMount` 消费 tsx 现测 **17 文件**（#656 票面记 14，取数时点差）：
票面 14（dialog-shell / floating-shell / select / search-panel / dismiss / more-menu /
new-task-dialog / mention-picker / chief-model-select / chief-drawer / schedules-page /
project-new-page / project-page / dir-browser）之外新增 **sidebar.tsx、alert-dialog-shell.tsx、
todo-detail-page.tsx** 3 个。`use-overlay-mount.ts` 与 `styles/motion.css`（207 行）仍在；
ADR 0009 的护栏验收 = 这些消费点 grep 清零 + motion.css 收缩到 D4 保留面。

## 6. 批次表 + 依赖序（U 系列）

切批原则沿用 spec 16：**按域 + 一次验收**，不按目录。每片验收 = spec 16 §2 模板五条
（全切官方件 / 该域 e2e 全绿 / 视觉探针零像素漂移——按 #411 口径重钉 locator 不改断言 /
verify-pacman 证据归档 `docs/verify/<票号>/` / 未迁残留声明）+ 各批额外面。
并发纪律：最多 2 lane（spec 16 B4 教训）；每 lane 私有 E2E_PORT；每 PR 本地全量 e2e
（83 spec，~1.5min，便宜——该防的是并发互踩不是时长）。

| 批 | 内容 | 并行 | 依赖 | 额外面 |
|---|---|---|---|---|
| **U0 卫生件** | 删 ui/button.tsx+css；闲置 wrapper 裁决（建议删 dialog.tsx / alert-dialog.tsx，留 dropdown-menu 待 U3）；ui/README.md 改写退役状态 | 与 U1 并行 | 无 | 零行为面：三闸 + 全量 e2e 即验收 |
| **U1 Checkbox 面** | ui/checkbox → Base UI Checkbox（类钩子/id 透传保留）；branch-dialog 旋钮 → ui/switch；filter-panel 三态行迁 indeterminate 或声明保留（批内裁决） | 1 lane | 无 | checkbox-unified 断言层改写（定位面）；board-filter 绿；tile 皮肤像素对拍 |
| **U2 Select/listbox 族** | U2a：select.tsx 原语换 Base UI Select（对外 API 与 prefix 钩子不变，几何法平移 Positioner）；U2b：兄弟面逐面收编或换件（prj-tasks / prj-new-repo / prj-new-gh / new-task-project / plan-dropdown / skills 排序 / chief-model-menu） | U2a 串行先行；U2b 域内 2 lane（pages+overlay ∥ chief） | U2a → U2b；ClickCatcher 逐面裁决（§3.9） | 最重钉扎面（21 文件触及）；「popup 不叠 trigger」的仓内几何律写进 U2a 验收；model-select-core 律不动 |
| **U3 Menu/popover 机制族** | more-menu → 启用 dropdown-menu.tsx；user-menu → Popover/Menu + 主题分段随 XMON-103 正本；sched-form-overlay → DialogShell 族或保留自绘（批内裁决）；**同 lane 顺收各面 anim-* → data-open/data-closed（#656 尾）** | 与 U2b 错域可并行 | 无硬依赖；与 #656 共 lane | user-menu 锚定律 v3（#611）Positioner 表达；sidebar 弹层机制离开 OverlayMount 旧世代 |
| **U4 drawer + 旧世代退役（= #656 收尾 PR）** | chief-drawer 机制三选裁决（推荐非模态 Dialog）；OverlayMount / use-overlay-mount.ts / use-esc.ts 随最后消费者退役；motion.css 收缩到 ADR 0009 D4 | 1 lane | **U3 完成**（旧世代消费者清零是前提）；dir-browser / schedules / project-* 的机制面随 U2b/U3 已迁 | ADR 0009 护栏验收：`anim-*|overlay-mount|OverlayMount` grep 清零（现 17 文件）；spinner/hover-press/tab 指示条 D4 保留面数值不动 |
| **U5 裸控件账清零 + spec 16 rebase** | resources create-* 14 btn + 2 老 ui/input（老 ui/ 层退役：chip 1 处裁决）；sidebar 9；filter-panel 6；spec 16 账本回写（§2 对账表落进该册，或声明本地图为新读数、spec 16 归档） | 2 lane（resources ∥ board）+ docs 同 lane | 无 | #422 排除面悬空裁决在此收口；sidebar 导航行 Link vs Button 形态裁决 |
| **U6 Tooltip（裁决题）** | 默认不迁；若裁迁：ui/tooltip.tsx registry 件 + 41 处逐面 + KbdHint 机制迁移 + kbd.tsx 悬空变体激活 | — | 用户/产品裁决 | hotkeys.spec toBeHidden 探针改写 |
| **U7 Collapsible（声明）** | 默认不入批；声明边界（ARIA 已正确） | — | — | — |

**日次建议**（lane-day 总量 ≈ 9.5，日历 6 天，含裁决等待）：

| 日 | lane 1 | lane 2 |
|---|---|---|
| D1 | U0 卫生件（半天） | U1 Checkbox 面 |
| D2 | U2a Select 原语（串行先行） | U1 收尾/像素对拍 |
| D3 | U2b pages+overlay 域 | U2b chief 域 |
| D4 | U3 menu/popover 机制族（#656 尾同收） | U5 resources 对话框 |
| D5 | U4 drawer + 旧世代退役（#656 收尾 PR） | U5 sidebar/filter-panel |
| D6 | spec 16 rebase（docs） + 全线回归 | 缓冲/像素复核 |

U6/U7 不占排期，等裁决。

## 7. 关系题结论：B3/B4 × #656 × Base UI 缺口，合并还是分开

**事实一：「合并进 B3/B4」的问题前提已失效。** spec 16 的 B3/B4 结构面已经由 XMON-23/24/25/
72/75 落地（§2 对账），B3/B4 作为「未开工的将来批次」不存在了；它们的残余（resources 排除面、
sidebar 9 处）是裸控件账，被 U5 吸收。所以 Base UI 缺口不需要「与 B3/B4 合并」——需要合并的
对象只剩 #656。

**事实二：#656 的排期前提同样失效，且它的文件集与本地图缺口面高度重合。** #656（连同 ADR 0009
D5）写的排期形态是「织入 spec 16 的 B3/B4 逐域批次」——而 B3/B4 结构切换在它开票前就已落地，
织入对象不存在；它实际剩下的是一条**逐域动效机制路径**（17 个 tsx），与本地图的 Select 族 /
Menu 族 / drawer / OverlayMount 旧世代几乎是同一张文件清单（重合 14/17）。

**事实三：换 Base UI 官方件会自动完成 #656 的机制目标。** 官方件（Select/Menu/Dialog/Popover）
自带 `data-open/data-closed` 与 shadcn 默认动效值（仓内 dropdown-menu.tsx wrapper 的 Popup
类串就是 ADR 0009 追认的新正典形态）；反之若 #656 先行、在手搓壳上把 anim-* 改成
animate-in/out + 手挂 data 属性，随后 U2/U3 又把手搓壳换成官方件——**同一面两次结构改动、
两次像素验证、两次全量 e2e**，且中间态（手搓壳 + 官方动效类）是要被立刻推翻的过渡形态。

**结论：执行层合并，票据层分开。**

- **重合面（Select 族、Menu/popover 族、drawer、OverlayMount 退役）合成「逐域机制收口」一条
  路径**：每个域的 PR 一次做完「结构换官方件 + 动效归 data-open/data-closed + 该域 anim-* 清零」，
  一次验收（spec 16 §2 模板 + ADR 0009 护栏 grep）。对应 U2b / U3 / U4；#656 的收尾 PR = U4
  （motion.css 收缩 + use-overlay-mount.ts 删除 + 消费点清零），#656 票面建议扩写或按 U 系列
  重新关联（**这是已裁决执行票的排期形态调整，归用户拍板**）。
- **不重合面分开走**：U1（checkbox，无动效交集）、U5（裸控件账 + spec 16 rebase，纯结构）、
  U0（卫生）、U6/U7（裁决面）与 #656 无文件交集，独立批次，不等待。
- **顺序护栏**：U2a（Select 原语）串行先行——它是 7 个消费实例 + 兄弟面的公共底座；U4 必须
  在 U3 之后（OverlayMount 最后消费者清零才可删机制）。

## 8. 票据草稿（若裁出 Map 票）

按「同一块活、同一批验证合成一张票」收敛为 4 张执行票 + 1 张裁决票；每票验收都含 spec 16 §2
五条模板 + 本地图对应节的额外面；票面范围以本地图 file:line 清单为准（开工前按当时 main 重跑
§9 取数，基线漂移就地标注）。

1. **U-A `web: Base UI coverage — checkbox face + dead-primitive hygiene`**
   范围：§3.3 三面 + §3.10 死件清单。验收：checkbox-unified / board-filter / merge-reject 链绿；
   ui/button 删除后三闸绿；bbox 像素对拍零漂移；证据 `docs/verify/<票号>/`。依赖：无。
2. **U-B `web: Base UI coverage — select/listbox family onto official Select`**
   范围：§3.2 全族（原语换芯 + 6 兄弟面 + 级联回归）。分 2-3 PR（U2a 先行串行）。验收：
   21 个触及 `-menu` 钩子的 spec 全绿且断言不改（#411）；prefix 钩子 7 组原样输出；
   ClickCatcher 逐面裁决记录进 PR body；agent-create-model / agent-detail / segmented-controls
   bbox 零漂移。依赖：U-A 无关可并行；ClickCatcher 语义裁决。
3. **U-C `web: menu/popover/drawer mechanism convergence + motion batch tail (#656)`**
   范围：§3.4 + §3.5 + §5.3（含 #656 的 17 文件动效账）。验收：dropdown-menu wrapper 有消费点；
   `anim-*|overlay-mount|OverlayMount` grep 清零；motion.css 收缩到 ADR 0009 D4；
   use-overlay-mount.ts / use-esc.ts 删除；hotkeys / escape-wiring / user-menu 8 文件 24 处 /
   chief-drawer 8 文件 19 处钉扎全绿。依赖：U-B（Select 族先离开旧机制）；**#656 票面调整需
   用户确认**。
4. **U-D `web: raw-control ledger closure + spec 16 rebase`**
   范围：§1.2 修正账的 60 处净账中属 spec 16 轴的部分（resources 14 + sidebar 9 + filter-panel 6 +
   老 ui/ 层 3 消费点）+ spec 16 账本回写（§2 对账表）。验收：修正口径 census 归边界声明面
   （textarea/file-input/ClickCatcher）之外清零；spec 16 与树一致；#422 悬空裁决收口记录。
5. **U-E `web: tooltip unification — product decision`**（裁决票，默认不迁）
   材料：§3.6（41 处 title= / KbdHint 机制 / kbd.tsx 悬空变体 / e2e 零钉扎）+ §4 行。
   产出：迁（新增 ui/tooltip + 逐面 + 探针改写）或声明边界（记录进本地图 §3.9）。

## 9. 取数命令（全部可复跑）

```sh
# 修正版裸控件账（§1.2）——剥注释后 71 处；脚本原值 75 含 4 处注释文本
node scripts/count-raw-controls.mjs   # 脚本原值
grep -rn '<button\|<input\|<select\|<textarea' apps/web/src --include='*.tsx' \
  | grep -vE ':[0-9]+:\s*(//|\*|/\*)' | grep -vE '\{/\*'   # 修正口径（71）

# Base UI 消费面（§3.1）
grep -rn "@base-ui/react" apps/web/src --include='*.tsx'
# 逐件消费文件数（new 原语；old 原语用 from '(\.\./)+ui/<p>\.js' 形态）
grep -rlE "components/ui/<p>\.js'|from '\./<p>\.js'|from '\./ui/<p>\.js'" apps/web/src --include='*.tsx'

# 已装官方件目录（§1.4，主检出 pnpm 实体路径）
ls <repo>/node_modules/.pnpm/@base-ui+react@1.8.0_*/node_modules/@base-ui/react/

# 域 css 体量（§2 表）
find apps/web/src -name '*.css' | sort | while read f; do \
  printf "%-46s %5s lines %5s decl\n" "${f#apps/web/src/}" "$(wc -l < "$f")" \
  "$(grep -cE '^[[:space:]]*[-a-zA-Z]+[[:space:]]*:.*;' "$f")"; done

# 浮层家族机制世代（§3.4）
grep -rln "floating-shell.js'" apps/web/src --include='*.tsx'      # 过渡世代 8
grep -rln "from '.*dismiss.js'" apps/web/src --include='*.tsx'     # ClickCatcher 15
grep -rln 'anim-\|overlay-mount\|OverlayMount' apps/web/src --include='*.tsx'  # 动效账 17

# e2e 钉扎（§5）
ls apps/web/e2e/*.spec.ts | wc -l                                  # 83
grep -rln 'toHaveScreenshot' apps/web/e2e/ | wc -l                 # 0
grep -rln 'boundingBox' apps/web/e2e/ | wc -l                      # 18
grep -rln 'getBoundingClientRect' apps/web/e2e/ | wc -l            # 21
grep -rl -- '<面钩子>' apps/web/e2e/ | wc -l                        # 逐面（§5.2 表列值）

# Base UI 语义出处（§4）：Context7 /websites/base-ui_react 三查——
#   checkbox.md（span+hidden input / indeterminate / parent+allValues / name/value/uncheckedValue/form）
#   select.md（件族 anatomy / items / typeahead-only / popup 默认叠 trigger / Combobox 指引）+ handbook/forms.md（Field hidden input）
#   dialog.md 使用指引（edge panel 无手势 = positioned Dialog）+ drawer.md（modal=false + disablePointerDismissal）
```
