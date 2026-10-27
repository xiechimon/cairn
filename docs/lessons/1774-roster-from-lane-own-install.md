---
Category: Model roster data generated from the lane's own install (pi-ai 1.0.4) was squash-merged cleanly over a sibling lane's pi-ai 1.0.4 → 1.4.0 upgrade, so main's checked-in roster faced the new catalogs and went red the moment the merge landed; the PR itself stayed green because its lockfile still pinned the old version
Source: #1774, PR #1818 (2026-10-26)
Level: 2
Safeguard: `apps/server/test/merge-gate-model-roster.test.ts` reds on catalog drift; it caught the merge immediately on main. When a lane checks in data derived from an installed dependency, rebase on main and regenerate before merging if main moved that dependency
Intercepts: 1
Recurrences: 0
Notes: Measured: the pi-ai@1.0.4 tarball (integrity-matched to PR #1818's lockfile pin) derives exactly the checked-in 157-entry roster; main's 1.4.0 lockfile derives 162 entries. The squash was CLEAN because the PR touched no lockfile lines, so GitHub reported no conflict while the semantic input (node_modules catalogs) had moved
---

