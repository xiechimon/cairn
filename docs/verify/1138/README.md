# #1138 agent 级并发闸 — live 栈验证证据

probe = `drive-1138-agent-concurrency.mjs`（纯 live 栈 + 假机器 wire，零 daemon
零 LLM 零浏览器——步只领不执行，provider 指向不可达端口；#1065 同族）。
**12/12 PASS**（2026-10-11，隔离栈 8791/5273，scratch PACMAN_HOME 全新库）。

## 判据族与证据文件

| 族 | 判据 | 证据 |
|---|---|---|
| D 写面 | PATCH 0/51 → 400；1 → 落库（REST 记录 + SQLite 行双真值）；未设置 Agent 读 null | `result.json` D1–D3、`agent-rows.json` |
| G 闸判 | A(cap=1) 首步在跑 → 二步留 pending 不进 claim；同批 B 候选照领（候选级 skip 无队头阻塞）；他机 claim 同被挡（agent 池跨机器、机器闸开着仍不发 = 两闸各自 gate） | `result.json` G1–G5、`step-rows.json` |
| C 空位即领 | A1 done → 终态 + finishStep 团队 wake → 挂起中的 claim 即刻领走 A2 | `result.json` C1–C2 |
| R 零值回归 | PATCH null 清回不限 → A2 在跑时新步照领（不设上限行为完全不变） | `result.json` R1–R2 |

claim 的「被挡」判别形态 = 长轮询真形态：挂起中的 claim 在预算内不返回
（`G4: {"hung":true}`、G5 仍挂起）——daemon 侧的观感就是「claim 不发步」；
wake 后同一条挂起 claim 即刻返回 A2（C1 的 `woken.body.step.step.id` = A2）。

## 复跑配方

```sh
# worktree 车道：栈与脚本都从 worktree 路径跑
VERIFY_REPO_ROOT=<worktree> node <worktree>/.claude/skills/verify-pacman/scripts/launch.mjs
node <worktree>/.claude/skills/verify-pacman/scripts/drive-1138-agent-concurrency.mjs
node <worktree>/.claude/skills/verify-pacman/scripts/cleanup.mjs
```

## 单元/受影响面

`apps/server/test/agent-concurrency.test.ts`（先红后绿，8/8：上限即闸 /
分池不队头阻塞 / 零值回归 / 空位即领 / 跨机归账 / chief 不占槽 / review
meta 归账 / PATCH 写面）；受影响面 9 文件 103 测试 + shared records 56 全绿。
