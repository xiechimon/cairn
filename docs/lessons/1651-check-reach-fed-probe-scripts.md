---
类别: 改 `scripts/e2e-affected.mjs` 的 `--check-coverage` 让它拒收非 spec 路径，没人发现 verify-cairn 的 `vp-registry-gate.mjs --check-reach` 把探针脚本一并喂给它；探针可达闸只在咨询性 CI job 里跑，main 连红多个提交无人拦
首次来源: probe-reach-gate 在 main 上红 (#1651, 2026-10-24)
级别: 2
防护: `vp-registry-gate.mjs --check-reach` 只把 `*.spec.ts` 交给 e2e-affected，探针脚本由它自己的 drive 注册判定；`docs/verify/1542/reach.test.mjs` 进 `scripts/prepush.mjs` 必需检查，`scripts/prepush.test.mjs` 钉住；该测试里替换家族表前缀的改写对象随 #1599 的表结构更新
拦截: 0
复发: 1
备注: 负对照：修前 `node --test docs/verify/1542/reach.test.mjs` 两条红（drive-hotkeys.mjs 可达探针、从基线发现新增文件），修后 9 条全绿；`prepush.test.mjs` 在计划里加该命令前先红
---
