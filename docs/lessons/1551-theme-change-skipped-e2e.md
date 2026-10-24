---
类别: 改界面主题变量只跑了 lint 与 typecheck，没跑 e2e，PR 上 CI 红约 60 条（写死旧值的测试加一处真实对比度问题）
首次来源: PR #1551 (2026-10-23)
级别: 5
防护: 记忆 pacman-ui-theme-needs-e2e
拦截: 0
复发: 0
备注: 待升到级别 2：样式或共享 UI 变更时 pnpm prepush 自动跑 e2e:affected，见 #1555
---
