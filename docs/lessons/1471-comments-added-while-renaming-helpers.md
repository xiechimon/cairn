---
类别: 改名或重写 e2e 辅助函数时顺手写了新的说明注释，14 行被注释纪律检查报出
首次来源: #1471 (2026-10-24)
级别: 2
防护: `scripts/comment-discipline-gate.mjs` 收尾必跑；真实失误做负对照：helpers.ts、hotkeys.spec.ts 与五个 search 类 spec 的 14 行新注释报红，删除后 0 行
拦截: 1
复发: 0
备注: 检查已覆盖，无需追加防护；该检查在 CI 仍是咨询性
---
