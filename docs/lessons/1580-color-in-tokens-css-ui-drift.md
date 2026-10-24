---
类别: 新颜色值写进 tokens.css，ui-drift 闸只在 CI 跑，推上去才红
首次来源: PR #1580 (2026-10-23)
级别: 2
防护: `scripts/prepush.mjs` 共用清单加入 `ui-drift-gate.mjs`，本地 pre-push 与 CI（`pnpm prepush --ci`）同一入口，`scripts/prepush.test.mjs` 钉住
拦截: 0
复发: 0
备注: 负对照：#1580 首版 tokens.css 四行 hex 在该闸下报 G2 红，挪进 shadcn.css 后转绿
---
