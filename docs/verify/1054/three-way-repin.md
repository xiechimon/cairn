# #1054 三方对拍：旧钉 → 新钉 → 探针实测（#910 裁定 5 / #986 流程）

测法：`probe/probe-evidence.mjs`（归档于本目录）对两套 fixture 栈
（`vite build --mode fixture` + `vite preview`）跑同一脚本——
before = origin/main @ `5d9d91d6`（一次性 detached worktree，端口 8412），
after = 本分支（端口 8413）。半径读 `getComputedStyle().borderTopLeftRadius`，
双模（dark/light）各一遍。原始输出 = `measure-before.md` / `measure-after.md`
（含 JSON 版）；截图 = `shots/`（同名 before/after 成对）。

## 重钉面（e2e 绝对值钉移动的四处）

| 面 | spec 钉（旧 → 新） | before 实测 | after 实测 |
| --- | --- | --- | --- |
| board-column（列容器） | visual-polish.spec `0px` → `14px`（双模） | 0px / 0px | 14px / 14px |
| drag-card（拖拽克隆） | board-dnd.spec `0px` → `14px`（双模，resolveStyle 期望值） | 0px / 0px | 14px / 14px |
| user-menu 盘 | visual-polish.spec `0px` → `10px`（双模） | 0px / 0px | 10px / 10px |
| spec-block 简报卡 | spec-brief-card.spec `0px` → `10px` | 0px / 0px | 10px / 10px |

参照行（未动，证测量口径）：todo-card = 14px 双侧同值（registry Card，
L1 #1058 已裁）；composer = 0px 双侧同值、chat-bubble = 0px 双侧同值、
chief-composer = 0px 双侧同值（三处 = 台账登记偏离，本票**不动视觉**，
measure-*.md 里带 `(registered deviation, stays)` 标注）。

## 无钉面（渲染值移动但 e2e 无绝对半径断言，探针留档）

| 面 | before | after |
| --- | --- | --- |
| chief TabsList（role=tablist） | 0px | 10px |
| chief tab indicator（滑动 pill） | 0px | 8px |
| chief 设置面 secondary-bg 卡族（62px 行卡 ×2，探针按渲染色扫块） | 0px | 14px |
| chief 设置面行钮（44px，Button 承载） | 0px | 10px |
| mention-picker insert 钮圆角（Button 承载参照） | 10px | 10px（几何未动，动的是墨色，见 ../1055/） |

其余无钉改动面（gate 横幅 / TURN_TOOLS / 切换器盘 / 示例卡 / icon tile /
SEARCH_BOX / token-gate input / EMPTY_CARD / 章程块 / 虚线空态框）为类级
A single-point change; basis and per-site reasoning in `docs/spec/27-consumer-surface-shapes-and-brand-ink-ledger.md` §2;
segmented-controls.spec 的 pill 追踪断言（位置/尺寸 ≤1px，无半径）与
chief-settings.spec 的 inset 断言在改动后全绿（本分支 e2e:affected 663 passed）。

## 闸双向验证（本目录 gate-demo-*.txt）

1. `gate-demo-1-red.txt` — 消费文件塞一行未登记的 `rounded-none` 方角盒：红，exit 1。
2. `gate-demo-2-green.txt` — 同一行登记进台账：绿，exit 0。
3. `gate-demo-3-stale-red.txt` — 把该行改对（rounded-lg）但留台账条目：STALE 红，exit 1。
4. `gate-demo-4-green.txt` — 条目随修复同 PR 删除：绿，exit 0。
