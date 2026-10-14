# #1303 chief 未读徽标

同一条探针 `drive-1303-chief-unread.mjs`，隔离 verify 栈（web 5273 / api 8791，假机器 wire，零 daemon 零 LLM）。`--expect=old` 在行为改动之前，`--expect=new` 在本分支源码上重新 launch 之后。两边都是 13/13。

```sh
node .claude/skills/verify-pacman/scripts/cleanup.mjs
node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1303-chief-unread.mjs --expect=old
# 改完源码后 server 无 watch，必须 cleanup + launch 再跑：
node .claude/skills/verify-pacman/scripts/drive-1303-chief-unread.mjs --expect=new
```

## 判读

| 检查 | before (`before/result.json`) | after (`after/result.json`) |
| --- | --- | --- |
| 一个线程两条 assistant 文本 | 未读集长度 1，徽标 `1` | 同左 |
| tooltip | 只有 `⌘J` | `1 个总管会话有未读` |
| 打开抽屉再最小化 | 徽标仍 `1`，`readAt` 仍空 | 同左（本票不改这条路径） |
| 8 天闲置，tick 由 `[wake:wake]` 步证明已跑 | `readAt` 仍空 | `readAt` 被写成 tick 时刻，离开未读集 |
| wake 收尾 | snippet = wake 文本，`readAt` 空，线程进未读 | snippet 同文，`readAt` 非空，不进未读 |
| 100 个未读 chief 线程 | 徽标文本 `100` | 徽标文本 `99+`，tooltip 写 `100 个总管会话有未读` |

截图：`before/03-board-badge-1.png`、`before/12-badge-cap.png`、`after/04-tooltip-count-1.png`、`after/12-badge-cap.png`、`after/15-tooltip-cap.png`。
