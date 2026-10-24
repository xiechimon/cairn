---
类别: web PR 推送前漏跑 ui-debt 与 dead-class 两道闸，CI 红两轮
首次来源: PR #1523 (2026-10-22)
级别: 2
防护: `pnpm prepush` 与 CI 共用 `scripts/prepush.mjs`，`scripts/prepush.test.mjs` 检查入口一致
拦截: 1
复发: 0
备注: #1533：`mt-[3px]` 负对照触发 D5，移除后静态检查转绿；dead-class 在 CI 保持咨询性
---
