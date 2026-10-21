# #1428 阴影槽实测表：改前 → 改后（computed box-shadow）

取值方式：dev server（vite，fixture 场景 `/app?scenario=01`）上建一个裸 `div`，`style.boxShadow = var(--槽)`，读 `getComputedStyle().boxShadow`。1x = deviceScaleFactor 1（e2e 口径），2x 列只列与 1x 不同的槽。
「相等」= 同一组阴影（允许环从头移到尾——box-shadow 列表顺序只影响重叠处的绘制序，1px 环与低 alpha 投影不重叠）。

## light

| 槽 | 改前 | 改后 | 判定 |
| --- | --- | --- | --- |
| `--cds-shadow-sm` | `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px, rgba(0, 0, 0, 0.08) 0px 2px 8px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | 有意变化：e1 的池 = DESIGN.md 任务卡定稿投影（0 1px 2px 4%）。唯一消费面是通知条（经 --card-shadow），从两层 5%/8% 收到和卡片同一池 |
| `--cds-shadow-md` | `rgba(0, 0, 0, 0.05) 0px 2px 4px 0px, rgba(0, 0, 0, 0.08) 0px 6px 16px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px` | 有意变化：e2 的池 = 菜单定稿投影（旧 --shadow-popover 去环）。无直接消费点 |
| `--cds-shadow-lg` | `rgba(0, 0, 0, 0.06) 0px 4px 8px 0px, rgba(0, 0, 0, 0.08) 0px 12px 28px -2px` | `rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px` | 有意变化：e3 的池 = 对话框定稿投影（旧 --dialog-shadow 去环）。直接消费点 = 总管窗与 FAB（经 --floating-shadow） |
| `--edge-shadow` | `rgba(0, 0, 0, 0.05) 0px 2px 4px 0px, rgba(0, 0, 0, 0.08) 0px 6px 16px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 有意变化：别名 → --e2。无消费点 |
| `--card-shadow` | `rgba(0, 0, 0, 0.05) 0px 1px 2px 0px, rgba(0, 0, 0, 0.08) 0px 2px 8px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | 有意变化：别名 → 池 sm（通知条自带 --edge-ring，取池不取档，一条边一个环）。值随池变 |
| `--card-lift` | `rgba(28, 25, 23, 0.05) 0px 3px 10px 0px, rgba(28, 25, 23, 0.04) 0px 1px 3px 0px` | `oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px, rgba(80, 60, 30, 0.07) 0px 4px 14px 0px` | 有意变化：别名 → --panel-shadow-hover（它是状态，不是档）。无消费点 |
| `--shadow-popover` | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 相等（环移到末尾） |
| `--shadow-composer` | `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset` | 相等 |
| `--shadow-composer-hover` | `rgba(0, 0, 0, 0.06) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.06) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px inset` | 相等 |
| `--shadow-composer-focus` | `rgba(0, 0, 0, 0.08) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px inset, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px` | `rgba(0, 0, 0, 0.08) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px inset, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px` | 相等 |
| `--panel-shadow` | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 相等（环移到末尾） |
| `--panel-shadow-hover` | `oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px, rgba(80, 60, 30, 0.07) 0px 4px 14px 0px` | `oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 1px, rgba(80, 60, 30, 0.07) 0px 4px 14px 0px` | 相等 |
| `--drag-shadow` | `rgba(0, 0, 0, 0.18) 0px 8px 24px 0px` | `rgba(0, 0, 0, 0.18) 0px 8px 24px 0px` | 相等 |
| `--fab-shadow` | `rgba(0, 0, 0, 0.05) 0px 2px 4px 0px, rgba(0, 0, 0, 0.08) 0px 6px 16px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 有意变化：别名 → --e2。无消费点 |
| `--plate-shadow` | `rgba(0, 0, 0, 0.12) 0px 6px 16px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 有意变化：别名 → --e2。无消费点（V2 弹层壳已退役） |
| `--dialog-shadow` | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px` | `rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 相等（环移到末尾） |
| `--chief-shadow` | `rgba(28, 25, 23, 0.16) 0px 4px 24px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 有意变化：别名 → --e2。无消费点（抽屉头 popover 已走 --shadow-popover） |
| `--floating-shadow` | `rgba(15, 23, 42, 0.14) 0px 16px 40px 0px, rgba(15, 23, 42, 0.08) 0px 3px 10px 0px` | `rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px` | 有意变化：别名 → 池 lg：暖墨 16/40 16% + 2/6 6% 替 Multica slate 14%/8%，总管窗与对话框同档；总管窗/FAB 自带 --edge-ring |

新增槽：

| 槽 | 值 |
| --- | --- |
| `--e1` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` |
| `--e2` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` |
| `--e3` | `rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` |
| `--top` | `rgba(255, 255, 255, 0) 0px 1px 0px 0px inset` |

2x 下与 1x 不同的槽（改后）：

- `--shadow-composer`: `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 0.5px inset`（状态槽的发丝环仍走 --hairline，本票未动）
- `--shadow-composer-hover`: `rgba(0, 0, 0, 0.06) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 0.5px inset`（状态槽的发丝环仍走 --hairline，本票未动）
- `--shadow-composer-focus`: `rgba(0, 0, 0, 0.08) 0px 4px 24px 0px, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 0.5px inset, oklab(0.272041 0.00400013 0.0124831 / 0.09) 0px 0px 0px 0.5px`（状态槽的发丝环仍走 --hairline，本票未动）

## dark

| 槽 | 改前 | 改后 | 判定 |
| --- | --- | --- | --- |
| `--cds-shadow-sm` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | 相等 |
| `--cds-shadow-md` | `rgba(0, 0, 0, 0.4) 0px 2px 4px 0px, rgba(0, 0, 0, 0.4) 0px 6px 16px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` | 有意变化：e2 的池 = 旧 --shadow-popover 的两层（明度不变）+ --top。无直接消费点 |
| `--cds-shadow-lg` | `rgba(0, 0, 0, 0.5) 0px 4px 8px 0px, rgba(0, 0, 0, 0.4) 0px 16px 36px -2px` | `rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` | 有意变化：e3 的池 = 旧 --dialog-shadow 的两层（明度不变）+ --top。直接消费点 = 总管窗与 FAB |
| `--edge-shadow` | `rgba(0, 0, 0, 0.4) 0px 2px 4px 0px, rgba(0, 0, 0, 0.4) 0px 6px 16px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | 有意变化：别名 → --e2。无消费点 |
| `--card-shadow` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | 相等 |
| `--card-lift` | `rgba(0, 0, 0, 0.14) 0px 4px 16px 0px, rgba(0, 0, 0, 0.08) 0px 1px 4px 0px` | `oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px, rgba(0, 0, 0, 0.09) 0px 4px 16px -2px` | 有意变化：别名 → --panel-shadow-hover。无消费点 |
| `--shadow-popover` | `oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | 有意变化：inset 发丝环 → 外 1px 环（梯约定，环色与对话框同为 --ring-inset-highlight）+ --top；两层投影明度不变 |
| `--shadow-composer` | `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 1px inset` | 相等 |
| `--shadow-composer-hover` | `rgba(0, 0, 0, 0.55) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.55) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px inset` | 相等 |
| `--shadow-composer-focus` | `rgba(0, 0, 0, 0.65) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | `rgba(0, 0, 0, 0.65) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | 相等 |
| `--panel-shadow` | `rgb(45, 41, 38) 0px 0px 0px 1px, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(45, 41, 38) 0px 0px 0px 1px` | 有意变化：@1x 同一组值、环移末尾；@2x 环 0.5px → 1px（DESIGN.md 描边一律 1 CSS px，--sheet-ring 同例） |
| `--panel-shadow-hover` | `oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px, rgba(0, 0, 0, 0.09) 0px 4px 16px -2px` | `oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 1px, rgba(0, 0, 0, 0.09) 0px 4px 16px -2px` | 相等@1x；@2x 有意变化：环 0.5px → 1px，与 e1 静止环同宽，hover 不再把环变细（code-review 发现） |
| `--drag-shadow` | `rgba(0, 0, 0, 0.18) 0px 8px 24px 0px` | `rgba(0, 0, 0, 0.18) 0px 8px 24px 0px` | 相等 |
| `--fab-shadow` | `rgba(0, 0, 0, 0.4) 0px 2px 4px 0px, rgba(0, 0, 0, 0.4) 0px 6px 16px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | 有意变化：别名 → --e2。无消费点 |
| `--plate-shadow` | `none` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | 有意变化：别名 → --e2（none → 档值）。无消费点；#854「暗侧线框承重」裁定的手搓盘已随 V2 壳退役 |
| `--dialog-shadow` | `oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px, rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px` | `rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | 有意变化：环移末尾 + --top；两层投影与环色不变 |
| `--chief-shadow` | `rgba(0, 0, 0, 0.35) 0px 4px 24px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | 有意变化：别名 → --e2。无消费点 |
| `--floating-shadow` | `rgba(0, 0, 0, 0.46) 0px 20px 48px 0px, rgba(0, 0, 0, 0.28) 0px 4px 12px 0px` | `rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` | 有意变化：别名 → 池 lg：16/40 50% + 2/6 30% + --top 替 20/48 46% + 4/12 28%，总管窗与对话框同档；总管窗/FAB 自带 --edge-ring |

新增槽：

| 槽 | 值 |
| --- | --- |
| `--e1` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(45, 41, 38) 0px 0px 0px 1px` |
| `--e2` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` |
| `--e3` | `rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` |
| `--top` | `rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` |

2x 下与 1x 不同的槽（改后）：

- `--shadow-composer`: `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 0.5px inset`（状态槽的发丝环仍走 --hairline，本票未动）
- `--shadow-composer-hover`: `rgba(0, 0, 0, 0.55) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.09) 0px 0px 0px 0.5px inset`（状态槽的发丝环仍走 --hairline，本票未动）
- `--shadow-composer-focus`: `rgba(0, 0, 0, 0.65) 0px 4px 24px 0px, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 0.5px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 0.5px`（状态槽的发丝环仍走 --hairline，本票未动）

## 渲染面（消费点一行未改）

| 面 | 主题 | 改前 | 改后 | 环数 |
| --- | --- | --- | --- | --- |
| todo-card | light | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 1 |
| notify-banner | light | `rgb(236, 229, 218) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.05) 0px 1px 2px 0px, rgba(0, 0, 0, 0.08) 0px 2px 8px 0px` | `rgb(236, 229, 218) 0px 0px 0px 1px inset, rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | 1 |
| user-menu | light | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px` | `rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 1 |
| composer | light | `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset` | 1 |
| chief-drawer | light | `rgb(236, 229, 218) 0px 0px 0px 1px inset, rgba(15, 23, 42, 0.14) 0px 16px 40px 0px, rgba(15, 23, 42, 0.08) 0px 3px 10px 0px` | `rgb(236, 229, 218) 0px 0px 0px 1px inset, rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px` | 1 |
| team-agent-card | light | `rgb(236, 229, 218) 0px 0px 0px 1px, rgba(80, 60, 30, 0.04) 0px 1px 2px 0px` | `rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px` | 1 |
| todo-card | dark | `rgb(45, 41, 38) 0px 0px 0px 1px, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(45, 41, 38) 0px 0px 0px 1px` | 1 |
| notify-banner | dark | `rgb(45, 41, 38) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgb(45, 41, 38) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | 1 |
| user-menu | dark | `oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset, oklab(0.934561 0.00473785 0.00706124 / 0.1) 0px 0px 0px 1px` | 1 |
| composer | dark | `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 1px inset` | `rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(45, 41, 38) 0px 0px 0px 1px inset` | 1 |
| chief-drawer | dark | `rgb(45, 41, 38) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.46) 0px 20px 48px 0px, rgba(0, 0, 0, 0.28) 0px 4px 12px 0px` | `rgb(45, 41, 38) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset` | 1 |
| team-agent-card | dark | `rgb(45, 41, 38) 0px 0px 0px 1px, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px` | `rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(45, 41, 38) 0px 0px 0px 1px` | 1 |

（渲染面列里去掉了 tailwind `shadow-(--x)` 工具类自带的四个零宽 `--tw-*` 占位项。）

