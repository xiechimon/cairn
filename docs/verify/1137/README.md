# #1137 — GitHub webhook → todo → orchestrate 事件入口 tracer

- probe：`docs/verify/1137/drive-1137.mjs`（bootServer 形态，`githubFetch`
  注入 mock，零真实出站——与 `apps/server/test/webhook.test.ts` 同一测试
  世界；HTTP 走真 Hono `app.request`，落库/派发走真 SQLite）
- 运行日：2026-10-12。复跑：`cd apps/server && pnpm exec tsx
  <repo>/docs/verify/1137/drive-1137.mjs <outDir>`（需在 apps/server 内跑
  ——bare `drizzle-orm` 从该包解析；probe 只读仓内源码，不写运行态）。
- 判读：`result.json` checks **12/12 全 PASS**；三段 tracer 逐段对账见下表。

## tracer 三段（result.json 对账表）

| 段 | 实物（result.json 路径） | 值 |
|---|---|---|
| 请求 | `request.created` | 202 `{result:'created', deliveryId, todoId, threadId}`（封套过 shared `webhookReceiverResponseSchema`，测试 A2 同源） |
| 落库 | `persist.todo` | 1 行：`sourceKind='github-issue'`、`sourceRef='github:octo/alpha#7'`、`phase='todo'`；`persist.webhookToken` = `tokenHash`（sha256，非明文）+ `lastUsedAt` 已回写 |
| 派发 | `dispatch.chiefThread / chiefMessage / step` | 1 线程 + 1 条首消息（内嵌 issue 正文）+ 1 条 `kind='chief'`、`status='pending'` 步 |
| 出站 | `request.githubFetchCalls` | `/repos/octo/alpha/issues/7` + `/repos/octo/alpha/labels`（importGithubIssue 真 import 链过 mock） |

## 失败路径（drive 覆盖面 + 测试套件）

| 场景 | drive 实物 | 测试用例 |
|---|---|---|
| 错 token | `request.wrongToken` = 401 | E1 |
| 重复投递（同 delivery 60s 窗） | `request.duplicate` = 202 `{result:'duplicate'}`，todo/线程无双建 | B1 |
| 非 issues 事件（ping） | `request.ping` = 202 `{result:'ignored'}` | C1 |

完整失败面（吊销 token、payload repo 不匹配、label 非触发、载荷形坏、
持久闸 409 收敛、token-auth 豁免段边界等 15 例）在
`apps/server/test/webhook.test.ts`（18 用例，`webhook-vitest.txt` = 逐项
输出：18/18 PASS）。

## 回归（regression-vitest.txt）

`webhook / wire / token-auth / github-issues / orchestration-source /
delivery-surface` 六套件 **107/107 PASS**（verbose 全量输出在
`regression-vitest.txt`，逐用例 ✓）。

## 架构位（源码指针）

- receiver 路由：`apps/server/src/routes-webhook.ts`（`POST /api/webhook/github/:token`）
- 事件处理：`apps/server/src/services/webhook.ts`（分诊/去重/载荷闸/repo 映射）
- token 面：`apps/server/src/services/webhook-tokens.ts`（签发/哈希验证/吊销）+ drizzle `0036` migration
- orchestrate 单出口：`apps/server/src/services/orchestrate.ts`（自 routes-todos 提取，REST 与 webhook 共用）
- token-auth 豁免：`apps/server/src/lib/token-auth.ts`（仅投递面段精确豁免，管理面仍在 Bearer 闸后）
