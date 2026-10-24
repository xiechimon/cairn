---
类别: 复用依赖时并行运行 pnpm，自动依赖校验重装 node_modules 导致正在运行的测试丢包
首次来源: #1514 (2026-10-24)
级别: 3
防护: 复用依赖的本轮验证命令显式设置 `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`，复制完成后再启动检查
拦截: 1
复发: 0
备注: pnpm 12 不读取尝试过的 npm_config 开关；改用其 PNPM_CONFIG 开关后 typecheck/lint/spec:parse 通过。属于 agent 外部命令调度，仓内类型或 lint 无法约束，未改全局配置或锁文件
---
