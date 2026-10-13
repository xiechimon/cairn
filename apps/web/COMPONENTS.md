# 复用清单（pacman web）

> 这份文件只回答一个问题：**要写一个新的 UI 件之前，先看这里——已有的能不能直接用。**
> 「长什么样」（颜色 / 字号 / 圆角 / 阴影 / 动效 / 各件的视觉规格）在 [DESIGN.md](./DESIGN.md)；本文件管「**有哪些、在哪、该复用谁**」。
> 三条机器门钉住它不腐烂（`test/ui-reuse-inventory.test.ts`）：新轨每件必须登记、清单里的件必须真实存在、旧轨终态（`src/ui/` 目录不得复活）。

## 一、单轨（旧轨已退役）

| 轨 | 位置 | 状态 |
|---|---|---|
| **唯一轨** | `src/components/ui/` | **新代码一律落这里。** shadcn 件 + Base UI 基（#410 裁决），带仓内偏离记录 |
| ~~旧轨~~ | ~~`src/ui/`~~ | **已整目录删除（#952，spec/22 §5 退役正典表执行完毕）**：`chip`→`status-chip.tsx`（#942）、`input`→`components/ui/input.tsx`（#944）、`dialog.css` 表单族→utility 等值迁移 + `dialog-shell.tsx` 机制内联（#952）。机器门钉住目录不得复活 |
| 弹层族 | `src/overlay/` + `src/overlays/` | 挂在共享壳上（见第三节），**不自己手搓 OverlayMount + useEscClose** |

<!-- inventory:old-track-frozen -->
```text
```
<!-- /inventory:old-track-frozen -->

（上面这段是机器门读的终态名单：旧轨已删空，名单恒空；`src/ui/` 目录重新出现即报错。）

## 二、新轨原语（34）

<!-- inventory:new-track -->
```text
alert-dialog-shell.tsx   # 确认面共用底座（删除确认 / 丢草稿确认），走 Base UI AlertDialog
alert-dialog.tsx
attachment.tsx           # shadcn Attachment 族（Attachment/Media/Content/Title/Description/Actions/Trigger/Group）：附件卡片原语（#1009 B 段附件面消费；别手写附件盒）
avatar.tsx               # shadcn Avatar 族（Root/Image/Fallback/Badge/Group，底座 Base UI，上游发丝环在位）；头像消费别直接用三件套，走 seeded-avatar.tsx
badge.tsx                # 计数 / 标签 pill；任务状态语义色族见 DESIGN.md
bubble.tsx               # shadcn Bubble 族（Bubble/Content/Group/Reactions）：聊天流消息气泡（#1009 A1 chief 消息流 / A2 detail 对话列消费）；皮肤走 variant 档 + 消费点中和，别发明底色
button.tsx               # registry 同源 + 仓内语义映射（type=button 默认、data-variant/data-size 观测点，#411）；主 CTA = default 档（brand 档已退役，#982/#991）
card.tsx
checkbox.tsx             # 复选（registry 同源 + 一件零皮肤语义映射：indeterminate 渲染横杠，#952/#982）；行盒 = 消费点 label 包裹；**别直接摆裸 `<input type="checkbox">`**——浏览器自带方框与仓内复选行不同族
copy-button.tsx          # 复制钮单源（#1268）：dsh MessageIconActions 形（28px 盒 / 15px 字标 / tertiary 墨 / hover --seg-hover 升二级墨）+ copy→check 1s 自动复位；`fadeByRecency`（默认 true）挂 `.chat-copy` 走新近律（最新回合恒显、更早 hover 浮现），块自带 chrome（代码块横幅）传 false 恒显——**聊天面复制钮一律复用它，别在各消息行手搓 useState+Clipboard**
dialog-shell.tsx         # 对话框共用底座（e2e 载体 = role=dialog 可及名 + dialog-head/-body/-foot testid，spec/22 §5.5）
dialog.tsx
dropdown-menu.tsx        # 仓内语义映射：z 走 --z-dialog 单梯（#733）、Content 透出 anchor（#454）；动效 = 上游默认（#991 Q9）
empty.tsx
field.tsx                # 表单行组合（FieldGroup/Field/FieldLabel/FieldContent/FieldError…）：表单布局一律用它，别拿 div + space-y 手排
input.tsx
input-group.tsx          # 输入组合件（InputGroupInput/InputGroupAddon/InputGroupButton…）：输入框里要挂按钮/图标/前后缀时用它，别把裸 Input 塞进自制盒子
kbd.tsx                  # 按键角标原语（文档正文里的 ⌘K 角标）；悬浮快捷键提示 = TooltipContent 内放 Kbd（官网组合，#1008）
label.tsx                # 表单标签原语（配合 field.tsx 的 FieldLabel 使用；独立 label 场景直用）
marker.tsx               # shadcn Marker 族（Marker/Icon/Content，separator/border 档）：聊天流内标注行（系统提示/失败行/分隔等居中 annotation）
message-scroller.tsx     # shadcn MessageScroller 族（Provider/Root/Viewport/Content/Item/Button + useMessageScroller hooks）：聊天流滚动容器唯一实现（autoScroll 贴底跟随 + jump-to-latest + messageId 贯通）；别再手写 overflow-y-auto 对话列
message.tsx              # shadcn Message 族（Message/Avatar/Content/Header/Footer/Group）：聊天流消息行骨架（头像列 + 内容列）；行皮肤归 bubble/marker
panel.tsx                # 静息内容容器消解（Panel/PanelHead/PanelRow/PanelLabel/PanelValue）：贴在页面里的方框一律用它；皮肤档 quiet/outlined，per-face 数值留属地 css
popover.tsx              # 仓内语义映射：z 走 --z-dialog 单梯（#733）；动效 = 上游默认（#991 Q9）
seeded-avatar.tsx        # dicebear 种子头像适配层（src 覆盖 > name 种子 > 兜底换图，img 常驻 DOM；Root 定尺盒，几何走消费点 className size-N，#983/#1003）；头像一律用它
select.tsx               # 单选下拉（registry 同源 compound 族：Select/SelectTrigger/SelectValue/SelectContent/SelectItem，#1010 回源，XMON-75 手写形退役；清空档 = value=null 的 SelectItem，几何/锚位归 Base UI Positioner 默认）；**别再用原生 `<select>`**——它弹的是系统菜单，跟自制弹层并排就是两套弹窗
separator.tsx            # 语义分隔线（field.tsx 的 registryDependency）：替代 <hr> 与 border-t div
status-chip.tsx          # 任务状态五态 chip（idle/plan/confirm/done/failed，皮肤 = --chip-* token 对）；落在 badge.tsx 上，状态载体 data-tone；替旧轨 ui/chip.tsx（正典表 spec/22 §5.2，#942）
switch.tsx
tabs.tsx                 # default/line 两档走上游原生 data-[variant] 机制 + TabsIndicator 零 chrome 透传（#644，去留归 #1009）；segmented/bare 手写档已退役（#991），分段控制器皮肤 = pages/parts.ts 的 SEG_* 配方
tag-chip.tsx             # 用户数据色标签 chip（tag.color 走 inline style 白字）；落在 badge.tsx 上，别新建皮肤件
textarea.tsx             # 多行输入（registry 同源）；**别摆裸 `<textarea>`**——老 .dlg-form-textarea 族已退役（spec/22 §5.3）
toaster.tsx              # toast 原语（sonner，shadcn 官方配方；#631）：App 根挂一次 <Toaster />，任意处 imperative `toast.*`；**失败反馈别再造静默 catch**——异常/toast 一律走它
tooltip.tsx              # hover/focus 信息气泡（官网形态；z 走 --z-dialog 单梯）；快捷键提示 chip = Tooltip+Kbd 组合（#983 判决，#1008 已落地，kbd-hint.tsx 退役）；App 根已挂全站 TooltipProvider（delay=0）
```
<!-- /inventory:new-track -->

**上游同源纪律（#989 正典）**：`components/ui/` 只许 registry 同源件 + 零皮肤适配层。每件的同源状态（pristine / deviated + 理由）以 `scripts/ui-registry.json` hash 账本为**唯一事实源**，CI 闸机械核对；重拉上游走 `node scripts/ui-registry-refresh.mjs`（CLI pin + R1–R5 重写 + biome 归一），**禁止**手改件内容绕过账本——改一处没重冻账本，check job 即红。

## 三、什么时候用哪个

| 要做的面 | 用什么 | 别做什么 |
|---|---|---|
| 按钮 / 图标按钮 | `components/ui/button.tsx` | 别新写 `<button>` + 自造类 |
| 输入框 | `components/ui/input.tsx` | 别摆裸 `<input>`（deliberate-native 标记除外） |
| 多行输入 | `components/ui/textarea.tsx` | 别摆裸 `<textarea>` / 别沿用 `.dlg-form-textarea` 老类 |
| 任务状态 chip（五态） | `components/ui/status-chip.tsx`（退役正典表 = spec/22 §5，#942） | 别新写 `.chip--*` 类族（ui-drift-gate G3 钉） |
| 开关 | `components/ui/switch.tsx` | — |
| 标签页 | `components/ui/tabs.tsx` | — |
| 计数 / 标签 pill | `components/ui/badge.tsx`（状态色族） | 状态五态走 `status-chip.tsx`，别混两种载体 |
| 空态 | `components/ui/empty.tsx` | 别每处自写空态文案块 |
| 确认对话框 | `components/ui/alert-dialog-shell.tsx` | 别手搓 `OverlayMount` + `useEscClose` |
| 普通对话框 | `components/ui/dialog-shell.tsx` | 消费点只改 import 路径即可（API 逐字相同） |
| 锚定浮层（下拉 / 菜单 / popover） | `dropdown-menu.tsx`（菜单族）/ `popover.tsx`（面板族，跨组件锚走 Content 的 `anchor`）/ `dialog.tsx`（居中模态族） | 别自造定位壳（floating-shell.tsx 已随 #1010 删除） |
| **单选下拉**（选一个值出来） | `components/ui/select.tsx`（registry compound 族，#1010） | 别用原生 `<select>`（弹系统菜单，与自制弹层并排两套）、别各面自写触发钮+弹层 |
| 复选 | `components/ui/checkbox.tsx` | 别摆裸 `<input type="checkbox">`——浏览器自带方框与仓内复选行不同族 |
| **静息方框**（页面里不动的卡 / 面板 / 设置块） | `components/ui/panel.tsx`（`Panel` + `PanelHead` / `PanelRow` / `PanelLabel` / `PanelValue`） | 别新起 `.xxx-card` 手写类——皮肤（描边 / 底色 / 圆角）只住 Panel 一处 |
| 布局块（要自带皮肤的容器） | `components/ui/card.tsx`（shadcn 布局壳；消费点自覆盖 `ring-0` / `py-0` / 圆角） | 别拿它当视觉原件——它的 `ring-1` + `rounded-xl` + `bg-card` 与仓内需求错配，真卡是 per-face 类族 |
| **头像** | `components/ui/seeded-avatar.tsx`（dicebear 种子 + 兜底换图，img 常驻 DOM；尺寸走 SeededAvatar 的 `className="size-N"`，Root 定尺盒） | 别直接用 `avatar.tsx` 三件套——种子/兜底语义会抄散 |
| 表单行组合 | `components/ui/field.tsx`（FieldGroup + Field + FieldLabel） | 别拿 `div` + `space-y-*` / `grid gap-*` 手排表单 |
| 输入框带按钮/图标 | `components/ui/input-group.tsx` | 别把裸 `Input` 塞进自制组合盒 |
| hover 信息气泡 | `components/ui/tooltip.tsx` | — |
| 分隔线 | `components/ui/separator.tsx` | 别用 `<hr>` / `border-t` div |
| 快捷键提示 chip | `tooltip.tsx` + `kbd.tsx` 消费点现场组合（TooltipContent 内放 Kbd，#1008/#983 判决） | 别自写绝对定位 + 显隐；文档正文里的按键角标直用 `kbd.tsx` |
| 标签 chip（用户数据色） | `components/ui/tag-chip.tsx` | 状态色族仍走 `badge.tsx`；别混两种色来源 |
| **toast / 轻量失败反馈** | `toast.*`（imperative；`components/ui/toaster.tsx` 已在 App 根挂载） | 别静默吞 mutation 错误；**面内已有 scoped 红字行 canon 的（XMON-80/P2）继续走面内，不叠 toast** |

## 四、消费现状（2026-09-30 快照，仅供判断，不进门）

- `Button` 消费点最广（22/38 面），是原语层的骨干；`Card` 消费 0——**真实卡片是 7 个 per-face 类族**，说明「Card」这个原语抽象与仓内实际需求错配。**迁移时以消费点为准，不以原语名号为准。**
- 弹层族实测 **19 个挂载文件**（共享壳 14 消费点 + 2 手工壳，见 #418），整族先迁、排在各域之前，避免半迁移的缝合线在每个域重复出现。
- 类名钉扎 872 处 / 302 distinct，视觉回归靠 computed-style 探针（无位图基线）。

## 五、指针

- **#417** — 全站铺开 shadcn/ui 的批次表与验收口径（本文件的迁移期前提）
- **#409** — 散件分级盘点（低 2 / 中 9 / 高 3）
- **#410** — primitives 选型裁决（Base UI / `@base-ui/react`）
- **#418** — 弹层族实测对照矩阵
- [DESIGN.md](./DESIGN.md) — 视觉身份与各件视觉规格；跨 shell 的缝色 `--border-default` 与 focus 环 canon 是契约，改动走视觉 spec