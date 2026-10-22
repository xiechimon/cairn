# #1492 验证证据

| 文件 | 内容 |
| --- | --- |
| `shared-unit.txt` | 结构校验（缺节 / 空话 / 合格三类）、结构补写指令、票去重键、verify 清单对账的单测逐条结果 |
| `server-gate.txt` | 产物闸 + 结构闸（补写一次、补写仍不合格失败收尾、合格直进 confirm）、build 兜底报告、规划 → 确认 → 执行 → 验证全链按清单出判定 |
| `integration-real-stack.txt` | 真进程栈（server + daemon + pi 真会话 + stub LLM）：方案带 Verification 的规划步照常进 confirm，执行、审核、合并、崩溃恢复、上传恢复不回归 |

本地跑法：`pnpm exec vitest run <测试文件>`（分别在 packages/shared、apps/server、integration 下）。
