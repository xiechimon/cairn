---
类别: 用 `pkill -f <模式>` 收后台 vite，模式命中自己所在的 shell 命令行，把整条命令连同后续步骤一起杀掉
首次来源: Claude 线程 (2026-10-23)
级别: 5
防护: 记忆：起后台进程时记 PID（`echo $! > pidfile`），按 PID 收，不用 `pkill -f`；直接起 `node_modules/.bin/vite`，不经 pnpm 包一层
拦截: 0
复发: 0
备注: 属 agent 自身 shell 操作，仓库闸看不到
---
