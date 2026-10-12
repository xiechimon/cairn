# #1261 relay 额度空/限流显性反馈——验证证据

## 覆盖面

| 路径 | 验证形态 | 结果 |
|---|---|---|
| daemon 熔断 + quotaBlock 上报 | 集成：`apps/daemon/test/runner-quota-breaker.test.ts`（6 用例） | 6/6 PASS |
| server 挂起/退避/释放/停止 + 读面投影 | 集成：`apps/server/test/quota-wait.test.ts`（5 用例） | 5/5 PASS |
| 分类器四桶 + Retry-After 解析 | 单元：`packages/shared/test/task-failure.test.ts` | PASS（357 shared 全绿） |
| 板面横幅/卡芯片/详情 chip（有/无信号两路径） | e2e fixture：`apps/web/e2e/quota-wait-board.spec.ts`（4 用例，E2E_PORT=8429） | 4/4 PASS |
| 全链 live（断粮→挂起→恢复→续跑） | 定制 probe：`.claude/skills/verify-pacman/scripts/drive-1261-quota-wait.mjs` | 14/14 × 2 遍（live-run1/ live-run2/） |

## live probe 判读（两遍同形）

- 栈：`launch.mjs` 隔离栈（计划 8802/5282——launch 时点 8802/8803 均有瞬态占用者
  （lsof 空窗），按 brief「撞了顺延」落在 18997/18998；探针不读死端口，经
  `VERIFY_RUN_DIR/ports.json` 取栈坐标）。
- 断粮腿：两任务同路 relay（stub 429 + `Retry-After: 5`）→ daemon 认领即熔断
  （`quota circuit breaker` 行 ×2、auto_retry=0、storm=0）→ 步 `waiting_quota`
  挂起（todo 保持 building、build.errorMessage 空、`quotaBlock.retryAfterMs=5000`）
  → 板面横幅（SSE live-push，建任务→横幅 6-20s，远低于 3 分钟验收线）+ 两卡
  「等额度」芯片 + 详情头 chip/进度行 + 每任务一条 `quota_wait` 通知。
- 恢复腿：stub 翻 200 → probeAt（Retry-After 5s + tick）到期 sweep 释放 → wake →
  daemon 再认领 continue session 跑完 → 两步 done、todo 进 review、横幅退场
  （翻转→done 10-14s，全程无人工操作）。

## 探针实测坑（重跑者注意）

1. stub ok 轮必须按**请求体末条消息角色**应答（`tool` → 纯文本收尾，否则 → 写类
   工具调用）：按请求序号奇偶轮应答在两任务并发续跑时会串到对方会话（B 拿到纯
   文本轮 → 零改动被产物闸判死）。
2. 详情进度行断言锚 `[data-testid="live-row"] .chat-streaming-label`；等额度标签
   必须排在活动相位**之前**（挂起期 act 是断粮前轮的陈旧信号——「正在连接模型」
   跨整段静默期说谎，两跑两形复现后修的优先级）。
3. 通知行断言要按本轮 todoId 过滤（隔离栈库跨探针运行累积）。
4. `parseRetryAfterMs` 词法要「retry-after」关键字在文——HTTP 头值是裸秒数，消费
   时拼回头形再解析（首轮实跑 retryAfterMs 缺席的根因）。

## 复跑配方

```sh
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY='*' VERIFY_PORT=<free> VERIFY_WEB_PORT=<free> \
  node .claude/skills/verify-pacman/scripts/launch.mjs
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  NO_PROXY='*' DAEMON_HOME=/tmp/pacman-1261-dh \
  node .claude/skills/verify-pacman/scripts/drive-1261-quota-wait.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```
