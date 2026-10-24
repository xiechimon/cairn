---
类别: 根脚本直接启动 tsx CLI，在禁止监听本地 socket 的环境中因 IPC 失败
首次来源: #1514 (2026-10-24)
级别: 1
防护: 根脚本使用 `node --import tsx` 加载器；导出测试经 `node --import tsx src/trajectory-export-cli.ts` 执行，与根脚本同一加载方式
拦截: 1
复发: 0
备注: 负对照：旧 tsx CLI 在 createIpcServer 报 EPERM，Node 加载器不建立该 IPC，根命令相关测试通过
---
