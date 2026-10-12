# #1257 验证证据：无人认领挂起 / 等额度 / 流断续跑

双向证据：`before-*.txt` = 旧码上跑的实际失败输出（红）；`after-*.txt` /
`a-*` / `b-*` / `c-*` = 本改动上的通过输出与活栈取证。

## 单测面（先红后绿）

- `before-classifier.txt` — 分类器模块缺位（旧码无 task-failure.ts）。
- `before-quota-hold.txt` — quota 挂起测试 9/12 失败（hold 列/落位/claim 闸
  未实现）。
- `before-network-retry.txt` — runner 流断重试测试 4/6 失败（重试闸未实现）。
- `before-sweep-hang.txt` — sweep 挂起语义翻转后旧码 14 处失败（pending 步
  仍按失败收尾）。
- 全量绿态（跑点见 PR body Verified 节）：shared 355/355、server 999/999、
  daemon 743/743、web 483/483、lint/typecheck/spec:parse 全过。

## 活栈面（verify-pacman 定制 probe）

复跑配方（详见 `.claude/skills/verify-pacman/changelog/2026-10-12-1257.md`）：

```sh
VERIFY_PORT=8802 VERIFY_WEB_PORT=5282 node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1257-hang-retry.mjs   # env 同上
```

三腿（stub LLM 三实例：ok / quota-first / cut-twice）：

- **A 等机器**：`a-board-waiting-machine.png`（板面「等机器」chip）+
  `a-todo-record.json`（REST waitingOn）+ `a-final.json`（daemon 回来后
  plan 步 done + plan.md 落库）。
- **B 等额度**：`b-board-waiting-quota.png`（板面「等额度」chip）+
  `b-hold.json`（step holdReason/holdUntil/holdCount + todo 不落 failed）+
  `b-final.json`（退避到期自动重领、额度恢复自动跑完）。
- **C 流断续跑**：`c-final.json`（两次中段断连 → 第三发成功、步 done）+
  `c-retry-evidence.json`（daemon 重试行）。
