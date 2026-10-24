---
类别: 工具事件测试夹具误把 arguments 写成 args
首次来源: #1591 (2026-10-24)
级别: 1
防护: 工具调用夹具显式标注 `ToolCallRecord`，daemon typecheck 同时覆盖 test 目录
拦截: 1
复发: 0
备注: 原错误字段负对照由 tsc 报 TS2353；改成 arguments 后全仓 typecheck 通过
---
