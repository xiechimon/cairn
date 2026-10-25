# Cairn 工作流（给任何接手的 Claude / agent）

> 目的：换账号、换机器后，新的 Claude（Desktop / Code）克隆本仓，读完这一页和 `AGENTS.md` 就能按同样方式继续。本文件只写工作方式、分工和当前进展摘要；规则细节以 `AGENTS.md` 为准，冲突时 `AGENTS.md` 赢。
> 本仓是公开的：不写密钥、内部地址、个人信息、额度细节。

## 1. 项目目标

让 cairn 能自己迭代自己：跑通 spec 28 自举闭环（ADR 0021），cairn 自己领票、实现、审核、合并 PR；再用评测与轨迹数据闭环持续优化 harness（提示词、技能、路由）。不微调模型：这里说的「训练」指优化 harness，不是改权重。杂活交给便宜的执行器，尽量省 Claude 的 token。

## 2. 工作方式

- 一律用中文大白话回复，少用术语。
- 修复中发现的同类 bug 或遗留问题，直接修，CI 绿了就合并，不用问。
- 不给人留手动步骤（例如去 GitHub 摘标签）。不给 PR 打 `needs-decision`：需要拍板的事在聊天里问，问完自己合并。
- 设计取舍（改变原定行为、动 ADR 或保护路径）先问人，再动手。
- 开完 PR 就打开 GitHub auto-merge 然后收工，不要挂着盯 CI。
- 每个线程收尾前自动做一次 retro（见 `.claude/skills/retro-cairn/SKILL.md`），不用人提醒。错误台账在 `docs/lessons.md`。
- 一件事一个本机线程：新主题开新线程，不往已有的「调度本机 agent」线程里堆活；已有事项在原线程做完。
- 线程默认模型用 Sonnet 级以省 token；拆票、审改动、写 PR、做取舍才是 Claude 的活。
- 派活时不要停下来等人排优先级，自己选顺序直接做。附图片直接附在回复里，别只放进文件库。

## 3. 分工（省 token）

| 执行器 | 用在哪 |
|---|---|
| pi | 默认执行器，不限量：实现、跑测试、lint、e2e、批量改动、审查 |
| codex | 额度少，只接难活 |
| grok | 按本周剩余额度的节奏用，优先上网和 X 搜索 |
| Claude | 只拆票、审改动、写 PR、做取舍，尽量不自己读大段代码或写代码 |

这些执行器都在本机，云端线程够不着，必须通过跑在本机上的线程派活。在 `git clone --local` 出来的独立目录里干活，别直接动主工作区。

派活一律用 `ai-route run <implement|test|bulk|review|scout|summary> [-C <目录>] [--hard] "<任务>"`：它每次实测可用模型、读剩余额度再挑执行器和模型。不手写 pi / codex / grok 命令，也不套固定模型名单。

后台起 `ai-route` 一律走 `scripts/dispatch-agent.mjs start <id> -- <命令>`：脱离进程组启动、立即核对进程并写状态文件（`( ... & )` / `nohup` 直起的任务会被工具调用边界的进程组清理杀掉）。汇报前先 `check <id>` 读状态文件，直起的任务没有状态记录，check 报进程不存在（#1556）。

## 4. 模型规则

- 只用 1M 上下文的模型。
- 不用：额外模型、gpt-6-astra（codex 也一样，保持它原来的模型）、GPT 5.6 系列、旧代模型、MiniMax M3、DeepSeek V4 Flash。
- 可用的：glm-5.3、glm-5.3-flash、deepseek-v4.1-flash。
- 公司 Claude 线路约每 6 小时撞一次配额，撞了就换别的执行器。

## 5. 当前进展摘要（会过时，以 issue 为准）

- 主线：spec 28 自举闭环（ADR 0021），票 #1401 到 #1409；P4 到 P8 未开始。spec 28 第 8 节的台账略有滞后。
- 评测闭环：#1510 到 #1519。
- harness A/B 评测 #1532：弱模型 glm-5.3-flash 对强模型 glm-5.3；先做评分标准和基线，#1511 到 #1514 合并后再做完整对比。
- 过程错误复盘：台账 `docs/lessons.md`；后续 L1 `pnpm prepush`（#1533）、L2 fail→fix 检测器（#1535，依赖 E0）、L3 拦截计数与复发升级（#1534）。动 AGENTS.md 的票由人合并。
- 注释纪律 #1520；另有待办：单开票清理存量注释。
- 已知：150 多个陈旧远端分支待清理；云端构建 better-sqlite3 需先 `npm i -g node-gyp`。
- cairn 自己不能合并自己的 PR：chief 的 merge_builds 被硬拒（`chief.ts`），人在 web 界面点「完成」。

## 6. 接手清单

1. 读 `AGENTS.md`、本文件、`docs/lessons.md`。
2. 看 `.claude/skills/`：`pr-cairn`（写 PR body）、`retro-cairn`（收尾复盘）、`verify-cairn`、`verify-step-claim`。
3. `gh issue list` 看在途票，从 spec 28 主线和评测闭环里挑下一张，不等人排序。
