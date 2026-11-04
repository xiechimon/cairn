# eval-project

团队内部的 Agent 编排服务。

## 快速开始

```sh
pnpm install
pnpm dev
```

浏览器打开 http://localhost:5173。

## 目录结构

- `apps/server` — Hono REST/SSE 服务
- `apps/daemon` — 执行守护进程
- `apps/web` — React 前端
- `packages/shared` — 共享协议与类型
