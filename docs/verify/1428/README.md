# #1428 阴影收成三档梯 + 暗色顶部高光 — 验收证据

只动 `apps/web/src/styles/tokens.css`、e2e 钉扎（新增 `e2e/elevation-ladder.spec.ts`，`scripts/e2e-affected.mjs` 家族表登记）与 `apps/web/DESIGN.md` 正典；消费点一行未改。

## 梯

| 档 | 池（无环） | 档（池 + 1px 环） | 面 |
| --- | --- | --- | --- |
| 1 | `--cds-shadow-sm` | `--e1` | 卡、行、分段控件白签 |
| 2 | `--cds-shadow-md` | `--e2` | 菜单、弹层、Select 弹出、overlay 盘 |
| 3 | `--cds-shadow-lg` | `--e3` | 对话框、总管悬浮窗 |

- 环是 1 CSS px（DESIGN.md「描边一律 1 个 CSS 像素」，`--sheet-ring` 同例），不是 `--hairline`。亮色三档环色 `--border`；暗色 e1 环 `--border`，e2/e3 环 `--ring-inset-highlight`（对话框收梯前的环色——`--border` 在 `--popover` 上看不见）。
- `--top`：暗 `inset 0 1px 0 rgb(255 255 255 / 0.08)`，只拼进 e2/e3 的池；亮 `inset 0 1px 0 rgb(255 255 255 / 0)`——零 alpha 的空操作而不是票面写的 `none`：`none` 混进逗号列表会让整条 box-shadow 失效，而 Tailwind `shadow-(--x)` 工具类永远逗号拼五个变量（code-review 发现，改前亮色池也只是按字面写出不引用它）。
- 自己画 `--edge-ring` 的面（通知条 `--card-shadow`、总管窗/FAB `--floating-shadow`）取池不取档，一条边只有一个环。
- 旧槽名全部变别名（`--panel-shadow → --e1`、`--shadow-popover → --e2`、`--dialog-shadow → --e3`、`--edge/fab/plate/chief-shadow → --e2`、`--card-shadow → 池 sm`、`--floating-shadow → 池 lg`、`--card-lift → --panel-shadow-hover`）。状态槽（`--panel-shadow-hover`、`--shadow-composer*`）与拖拽克隆 `--drag-shadow` 保留字面值：状态不是档，composer 的 inset 内环保住。

## 先列的失败方式 → 钉在哪

| # | 失败方式 | 钉扎 |
| --- | --- | --- |
| 1 | 某档丢环，或环不在列表末尾 | `elevation-ladder.spec`「each rung is its pool plus one ring, ring last」 |
| 2 | `--top` 漏进 e1（卡面不该有），或暗色 e2/e3 缺 `--top` | 「pools hold the pre-ladder darkness; --top only in dark e2/e3」 |
| 3 | 亮色 `--top` 不再是可拼接的空操作（写成 `none` 拼进档值会让整条失效） | 同上：亮 `--top` 钉零 alpha 值；亮色 e2/e3 ≠ none 且不含 inset |
| 4 | `.light` 没重定义某档，亮面继承暗池 | 环色断言（亮 `--border` = rgb(236,229,218)，暗 e1 = rgb(45,41,38)） |
| 5 | 旧槽名不再指向梯；池不等于「档去环」 | 「old slot names alias the ladder」+ `value.startsWith(pool)` |
| 6 | 双环：自带 `--edge-ring` 的面又从 token 拿到外环 | 「one ring per edge on the rendered surfaces」：卡 / 通知条 / 总管窗 / FAB / 用户菜单 / composer / 对话框，环数 == 1 |
| 7 | composer 丢 inset 内环 | 同上 + `shadow-composer*` 含 `0px 0px 0px 1px inset` |
| 8 | 暗色池明度漂移（#1396 的活） | 暗池字面钉：sm 40/40、md 65/45、lg 50/30 |
| 9 | 既有钉值坏（visual-polish / cds-dialogs `8px 28px` / paper-team-pages `0px 1px 2px` / chief-panel `inset`） | `04-e2e-pins.txt`：目标 6 spec 48/48 绿 |
| 10 | 探针漂移 | `probe-comparison.md`（全量 probe:dump） |

测试先于实现：`04-e2e-pins.txt` 里先是 spec 对旧 token 的红（7 失败 = 新 spec 的 7 条，其余 1096 绿），再是改 token 后的绿。

## 实测表

`shadow-slots.md`：18 槽 × 亮暗 改前/改后 computed 值逐行判定；原始 dump 在 `slots-before.json` / `slots-after.json`（含 1x/2x 与 6 个渲染面）。

有意变化清单（其余相等或只是环移到末尾）：

| 槽 | 亮 | 暗 |
| --- | --- | --- |
| `--cds-shadow-sm` | 两层 5%/8% → 卡片定稿池 `0 1px 2px` 4%（唯一消费面通知条随之变轻） | 相等 |
| `--cds-shadow-md` | 泛用 md → 菜单池 | 泛用 md → 旧 popover 两层 + `--top` |
| `--cds-shadow-lg` | 泛用 lg → 对话框池 | 泛用 lg → 旧 dialog 两层 + `--top` |
| `--shadow-popover` | 相等（环移末尾） | inset 发丝环 → 外 1px 环 + `--top`；投影不变 |
| `--dialog-shadow` | 相等（环移末尾） | 环移末尾 + `--top`；投影与环色不变 |
| `--panel-shadow` | 相等（环移末尾） | @1x 相等；@2x 环 0.5px → 1px |
| `--panel-shadow-hover` | 相等 | @1x 相等；@2x 环 0.5px → 1px，与 e1 静止环同宽（code-review 发现 hover 会把环变细） |
| `--floating-shadow` | Multica slate 14%/8% → 暖墨对话框池 16%/6% | 20/48 46% + 4/12 28% → 16/40 50% + 2/6 30% + `--top` |
| `--card-shadow` | 随池 sm 变 | 相等 |
| `--edge/fab/plate/chief-shadow`、`--card-lift` | 别名（零消费点） | 别名（零消费点；plate 暗 `none` → e2） |

## 截图（`shots/`，dpr 2）

fixture 两态：`board-{light,dark}.png`（看板 e1）、`user-menu-{light,dark}.png`（scenario 17 打开的用户菜单 e2）、`chief-window-{light,dark}.png`（scenario 111 总管窗，池 lg + 自带 edge-ring）。
live 真点击：`live-new-task-dialog-{light,dark}.png`（看板顶栏点「新任务」打开的对话框 e3；暗色看顶边那条 8% 白高光）。

## 闸

`01-lint.txt`（biome ci：0 error，1 条 info 是 main 上既有的 machines-page.tsx noUselessFragments）、`02-typecheck.txt`、`03-spec-parse.txt`、`04-e2e-pins.txt`、`05-e2e-affected.txt`（styles/ 改动触发全量回落）、`probe-comparison.md`。

## 跳过与登记

- **墨底主按钮不加 `--top`**：Button default 在暗色是浅墨底（`--primary` #eee8e4），8% 白高光压上去差 1–2 个色阶看不见；亮色 `--top` 是 `none`。两侧都是空操作，加了只是死装饰，且 `components/ui/button.tsx` 类串与上游逐字同源。
- 暗色明度一律沿用旧值（#1396 翻）。
- `docs/spec/22` §2.4 的四档表是 #915 时期的历史账（值早已不符 tokens.css），本票不改它，正典在 DESIGN.md。
- 零消费点的 `--edge-shadow` / `--fab-shadow` / `--plate-shadow` / `--chief-shadow` / `--card-lift` 本票只别名不删（CLAUDE.md：移除前先问），退役另票。
- `docs/adr/0013` D2「阴影对齐 Multica 原值」已在 ADR 头部登记修订（总管窗改走 e3 的池）。

## code-review（开 PR 前，high）

7 条发现，修了 5 条：别名断言改布尔（oklab 开头的值会被 probe-dump #411 判 VIOLATION）；暗色 `--panel-shadow-hover` 环 hairline → 1px；亮色 `--top` 由 `none` 改零 alpha；visual-polish 过期注释；DESIGN.md 暗色环色口径。未修 2 条：零消费槽删除（需用户确认，见上）；ADR 0013 已补修订行。
