---
类别: 新写的脚本测试把 cwd 设成真仓（`process.env.PWD`）去 `git rm` 基线文件，真仓的 `scripts/lint-warning-baseline.json` 被删出暂存区
首次来源: #1617 (2026-10-24)
级别: 2
防护: `scripts/baseline-ratchet-gate.test.mjs` 在 before/after 钩子比较真仓 `git status --porcelain -- scripts`，测试只许碰自建的一次性仓
拦截: 1
复发: 0
备注: 负对照：先加一条在真仓 `git rm` 基线的用例，after 钩子报 tests must only touch their own throwaway repos 变红；去掉该用例后恢复文件并转绿
---
