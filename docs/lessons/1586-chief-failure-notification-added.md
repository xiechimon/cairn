---
类别: 为让最小化面板的卡片拿到失败刷新，在总管失败时新增 chief_message 团队通知，违反「失败不通知，失败走 system 行 + toast」的既有约定
首次来源: #1586 (2026-10-24)
级别: 2
防护: 既有 `m4a-chief-loop.test.ts` 钉住失败无 chief_message 通知；`chief-context-failure.test.ts` 改为断言失败时无通知事件；卡片靠 `useChiefThreads` 在有回合在飞时 3 秒轮询取到 lastTurnError，e2e 不再伪造通知事件
拦截: 1
复发: 0
备注: 真实负对照：新增通知的实现下两条测试均红（chief_message 行数 1，期望 0）；移除通知并改轮询后转绿，prepush 也由这条既有测试首先拦下
---
