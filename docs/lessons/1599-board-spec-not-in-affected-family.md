---
类别: 改看板列样式后只跑了 board-dnd 一条 spec，首版修复打破 cds-board 的「列静止无圆角」断言；查下去发现 board.tsx 的 e2e:affected 家族表根本不含 cds-board 等 4 条看板 spec，prepush 也拦不住
首次来源: 拖拽列直角修复 (2026-10-24)
级别: 2
防护: `scripts/e2e-affected.mjs` BOARD 家族补 cds-board / paper-board- / paper-card / quota-wait-board
拦截: 0
复发: 0
备注: 负对照：`--dry-run -- apps/web/src/board/board.tsx` 旧表选中这 4 条为 0，新表为 4；`--check-coverage` 仍报 32 条无家族的 spec，待升：#1599 补全并把 coverage 检查接进 prepush
---
