---
类别: 台账闸只在 retro 技能文字里提了一句，没接进 prepush 与 CI，主干上的坏条目（备注写「待升」却没带票号）一直没人发现，拆分台账时才被迁移校验查出
首次来源: #1656 (2026-10-25)
级别: 2
防护: `scripts/lessons-ledger-gate.mjs` 进 `scripts/prepush.mjs` 必需检查（本地 pre-push 与 CI `pnpm prepush --ci` 共用），只改 `docs/lessons/` 条目的纯文档推送也会跑；`scripts/prepush.test.mjs` 钉住
拦截: 1
复发: 0
备注: 负对照：旧闸跑在旧表上，对「新增 web 源文件没进 e2e-affected」那一行报「待升必须带票号」红（旧表已在主干上），补上 #1599 后转绿；`scripts/lessons-ledger-gate.test.mjs` 的真实坏条目用例保留了原文
---
