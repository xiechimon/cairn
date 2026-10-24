---
类别: 测试直接展开 GitHub 端口的 unknown 应答体，运行时测试通过编译却失败
首次来源: #1405 P4-0 (2026-10-24)
级别: 1
防护: 保留 GateRaw.body 的 unknown 边界，夹具通过 comparePages 的有类型 extra 参数覆写字段；pnpm typecheck 拦截未知体展开
拦截: 1
复发: 0
备注: 真实负对照：展开 res.body 报 TS2698；改用 extra 参数后通过，未放宽端口类型
---
