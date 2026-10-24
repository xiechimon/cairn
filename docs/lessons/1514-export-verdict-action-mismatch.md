---
类别: 导出裁决与落库动作不一一对应：先漏确认与批准，后按 side 推动作，把审核关口的 revision 标成 restart
首次来源: #1514 (2026-10-24)
级别: 1
防护: 动作直接取 build_feedback.kind 列，导出器不再有 side 到动作的映射；diff 契约收 revision；`trajectory-export.test.ts` 断言结构化驳回、带 actor 的过闸宣告、gate_verdict、build 侧 revision 与 restart 分开，并插入 actor 为空的同文案宣告断言不进裁决
拦截: 2
复发: 1
备注: 负对照：旧导出缺 confirm/approve；复发时旧导出把 build 侧 revision 输出为 restart，测试变红，取 kind 后通过
---
