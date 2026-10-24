---
类别: 新代码把只调用一次的查询拆成独立私有函数，`single-use-helper-gate` 报红
首次来源: 派活查重 #1569/#1578 (2026-10-24)
级别: 2
防护: `scripts/single-use-helper-gate.mjs`（`pnpm prepush` 与 CI 共用）
拦截: 3
复发: 0
备注: 负对照：首版 `scripts/dispatch-agent.mjs` 的 tempWorkdirs 等 5 个单次调用函数报红，收进导出的 `collectTicketSources` 后为 0；#1615 的 `retry-lessons.ts` 里 turnedGreenSince 报红，内联后为 0；#1656 的 `scripts/lessons-ledger-gate.mjs` 里 cell、测试里 entryNames 报红，内联后为 0
---
