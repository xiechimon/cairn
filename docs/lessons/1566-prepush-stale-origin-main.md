---
类别: 本地 `origin/main` 引用过期，`pnpm prepush` 把几百个别人的改动算进本次差异，纯文档推送也跑了全量测试并失败
首次来源: PR #1566 (2026-10-23)
级别: 2
防护: `scripts/prepush.mjs` 的 `changedPaths()` 在基线为 `origin/main` 时先 `git fetch origin main`，失败退回本地 ref 并提示可能过期，`scripts/prepush.test.mjs` 钉住
拦截: 0
复发: 0
备注: #1630 落地，级别 5 升 2；负对照：本地 origin/main 停在他人改动合并前，旧实现把该改动算进差异跑全量检查（测试先红），fetch 后只剩本分支改动转绿
---
