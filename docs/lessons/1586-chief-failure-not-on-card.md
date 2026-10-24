---
类别: 总管失败只写会话消息，卡片没有失败原因读面
首次来源: #1586 (2026-10-24)
级别: 2
防护: `chief-context-failure.test.ts` 覆盖 finishStep 到线程 API 与失败时无通知；`chief-orchestration-failure.test.ts` 验证真实卡片渲染失败原因及重试
拦截: 1
复发: 0
备注: 负对照：context_length_exceeded 回报后 API 缺 lastTurnError、卡片缺编排失败；补齐投影后转绿，运行态与失败态共用线程数据源
---
