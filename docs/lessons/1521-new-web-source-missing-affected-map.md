---
类别: 新增 web 源文件没进 `e2e-affected` 的文件映射，`e2e:affected` 回落成全量 172 条跑了 15 分钟
首次来源: #1521 (2026-10-24)
级别: 3
防护: `scripts/e2e-affected.mjs` 文件映射补 `agent-fallback-models.tsx`，机器检查尚无
拦截: 0
复发: 0
备注: 负对照：`--dry-run -- apps/web/src/routes/agent-fallback-models.tsx` 旧表为 FULL，新表为 file map；待升：#1599 让 `--check-coverage` 也报未映射的 routes 源文件
---
