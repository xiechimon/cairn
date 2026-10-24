---
类别: 解 `ci.yml` 冲突后，新步骤落在了另一个 job 里，推送前没看 hunk 所在 job
首次来源: PR #1540 (2026-10-23)
级别: 2
防护: `scripts/ci-job-structure-gate.mjs` 对照 `scripts/ci-job-structure-baseline.json` 钉住每个 job 的命名步骤，CI check job 装机前一步与 `pnpm prepush` 共用；负对照 = #1540 错误 hunk（freshness 步落进 comment-discipline-gate）在 `scripts/ci-job-structure-gate.test.mjs` 变红
拦截: 1
复发: 0
备注: #1557 落地，级别 5 升 2；首拦：rebase 后 baseline 漏跟上游步骤迁移，闸拦下后才补
---
