---
类别: 本机全局 git 配了 `http.proxy`，跑 `vitest run --changed` 时 integration 里 daemon 对回环 server 的 git clone 走代理得 502，一批全链测试假红，等满 20 分钟才查到原因；重跑时又用了 macOS 没有的 `timeout` 命令，退出码 127
首次来源: #1624 (2026-10-25)
级别: 3
防护: 本机跑 integration 前先 `git config --global --get http.proxy`，有值就带 `NO_PROXY=127.0.0.1,localhost`；长测按 AGENTS.md 用 `tee` 盯日志，不套 `timeout`
拦截: 0
复发: 0
备注: 可升到级别 1：daemon 已对 undici 合并回环 `NO_PROXY`（`apps/daemon/src/proxy.ts` 的 `loopbackNoProxy`），git 子进程环境还没有，用户本机同样会撞；改动在 #1624 范围之外，需另开票。负对照：不带 `NO_PROXY` 时 `m5-web-e2e` 主时序脊柱 clone 得 502，带上后通过
---
