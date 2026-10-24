---
类别: React 渲染测试把必填 children 仅放在 createElement 的第三参数
首次来源: #1586 (2026-10-24)
级别: 1
防护: provider 的 children 显式写入受类型检查的 props；线程与任务夹具使用完整类型声明
拦截: 1
复发: 0
备注: 原调用在 pnpm typecheck 报 TS2769；显式 children 后通过，保留组件原本的必填类型
---
