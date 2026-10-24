---
类别: chief 工具 schema 新增 integer 参数，daemon 转换词表只支持 number
首次来源: #1586 (2026-10-24)
级别: 2
防护: 既有 `claude-t4-tools.test.ts` 全量转换 CHIEF_REMOTE_TOOLS，服务端保留 safe integer 校验
拦截: 1
复发: 0
备注: 真实负对照：offset type=integer 抛 not in vocabulary；沿用 number 词表并在执行侧校验后转绿，无需改 provider 声明
---
