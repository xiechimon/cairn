# #1137 验证证据：GitHub webhook → 建 todo + orchestrate 事件入口 tracer

三段 tracer 证据（live 栈 18/18，探针 `drive-1137-webhook-tracer`）+ 失败路径单测（18/18）+ 受影响面回归（89/89）。

## 栈坐标

- server：`http://127.0.0.1:8791`（verify-pacman launch.mjs 隔离栈，scratch PACMAN_HOME 全新库）
- 真出站一次：`importGithubIssue` 经 gh token 拉 `xiechimon/pacman#1137` 真实 issue 详情 + label 镜像（铺底连接行密文落库，token 不落任何证据文件）
- 铺底：github connection / agent / chief 行经服务模块直达（REST 面无 connection 写入口——oauth 独占；agent 创建被 #1259 归属机闸收紧；铺底非被测面，与 `apps/server/test/webhook.test.ts` 同形 seed）；项目与 webhook token 走真 REST

## 三段判据与对应文件

| 段 | 判据 | 文件 |
|---|---|---|
| 请求段 | 响应 JSON（result/todoId/threadId/deliveryId 回显）+ pino 日志行按 deliveryId 键落 server.log | `01-created.json`、`11-tracer-server-log.txt` |
| 落库段 | todo 行 `sourceKind=github-issue`/`sourceRef=github:xiechimon/pacman#1137` + `webhook_token.lastUsedAt` 回写 + 只存哈希 | `02-todo-row.json`、`03-webhook-token-row.json` |
| 派发段 | `chief_thread` 行（chiefId 绑定）+ 首条 user 消息（含 todo 锚点）+ `step` 行 kind=chief/pending（buildId=threadId） | `04-dispatch-rows.json` |

失败路径（live + 单测双覆盖）：错 token 401（`07-wrong-token.json`）、同 delivery 60s 窗口 duplicate（`05-duplicate-window.json`）、同 issue 重放 sourceRef 持久闸 duplicate（`06-duplicate-sourceref.json`，零副作用：todo 恒 1 行/线程恒 1 条）、ping noop（`08-ping.json`）、非触发 label ignored（`09-ignored-label.json`）、repo 未映射 misconfigured（`10-misconfigured.json`）。

## 复跑配方

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs   # 隔离栈 8791/5273
GH_WEBHOOK_VERIFY_TOKEN="$(gh auth token)" \
  pnpm -C apps/server exec tsx \
  ../../.claude/skills/verify-pacman/scripts/drive-1137-webhook-tracer.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

单测与回归：`webhook-test-output.txt`（18/18）、`regression-test-output.txt`（wire/token-auth/orchestration-source/github-issues/delivery-surface，89/89）。`result.json` 为探针逐条 check 账本。
