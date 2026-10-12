# #1251 能力上报 + 派发能力闸 + 可见 pending 成因 —— live 验收

探针：`.claude/skills/verify-pacman/scripts/drive-1251-capability-gate.mjs`
（假机器 wire + 浏览器真点击 + 一段真 daemon 腿；零 LLM）。
结果：`result.json` 15/15 PASS（checks 逐条 ok，无约数）。
归档证据为合入 #1257（pending 挂起律）后的合并树复跑产物——能力挡的 pending
步在新律下不失败收尾，可见成因由 queue.blocked（步级）与 todo waitingOn
（板面）承担；本探针判据面（claim 闸 / 读面 / 真 daemon 上报）两律同形。

## 复跑配方

```sh
# 1. server 侧 MCP 投影词表 fixture（probe 的 UI 腿要拨 figma 要求开关，
#    词表不确定就止步提示重 launch）：
printf '%s' '{"mcpServers":{"figma":{"type":"http","url":"https://mcp.figma.com/mcp"},"ctx":{"type":"stdio","command":"npx","args":["-y","@upstash/context7-mcp"]}}}' \
  > /tmp/pacman-1251-server-mcp.json
# 2. 隔离栈（端口按车道纪律先 lsof 查占用）：
PACMAN_MCP_CONFIG=/tmp/pacman-1251-server-mcp.json \
VERIFY_PORT=8803 VERIFY_WEB_PORT=5283 VERIFY_REPO_ROOT=<worktree> \
  node .claude/skills/verify-pacman/scripts/launch.mjs
# 3. 跑探针（依赖全新库；重验 = cleanup + 重 launch）：
VERIFY_PORT=8803 VERIFY_WEB_PORT=5283 VERIFY_REPO_ROOT=<worktree> \
  node .claude/skills/verify-pacman/scripts/drive-1251-capability-gate.mjs
# 4. 收尾：cleanup.mjs（证据不删）；归档 = cp 进 docs/verify/1251/ 随 PR。
```

## 判读

| 文件 | 实物 |
|---|---|
| `r2-heartbeat-tolerance.json` | 心跳红线：presence 的 capabilities 坏形状三形各 200 {ok:true}，行保留旧值 |
| `g2-machine-fit-blocked.json` / `g2-agent-machine-fit-blocked.png` | machine-fit 三态：缺项机 canRun=false + missing 可读形 + mcpGaps 对账；未上报机 missing=null 且 canRun=true（fail-open）；浏览器权限 tab 机器匹配段同态（开关 ON、红「不可跑」、缺项修法行） |
| `g5-queue-blocked.json` / `g6-queue-blocked-row.png` | steps 读面 queue.blocked = capability-missing + 详情页排队行文案「没有机器满足能力要求（缺 MCP server "figma"）——装齐后下一拍心跳即解锁」 |
| `g8-machine-fit-clear.json` / `g8-agent-machine-fit-clear.png` | presence 补装 figma 后同机即领（修法即时闭环）+ fit 清零态 |
| `g9-machines-capability-annotation.png` | 机器页读标注两态：「MCP 2 · 本机技能 0」计数形 vs「能力清单未上报（旧版 daemon）」 |
| `d1-daemon-log-tail.txt` | 真 daemon 腿日志尾（注册/上线序列行）；SQLite 真值在 result.json 的 D1 detail（probe-mcp 小写归一 + 坏条目跳过 + probe-local-skill） |

## 实测坑（首跑暴露，已修进探针）

1. **截图与 API 判据不同源 = 假证据**：PATCH 成功 → invalidateAll 触发整页重取，
   首跑 g2 截图抢在重取收敛前，拍到点击前旧态（开关 OFF、fit「可跑」）而 API
   判据已 PASS。修法 = 截图前等 UI 收敛（开关 aria-checked=true + 「不可跑」
   判定词 waitFor）。任何「点击后截图」的探针同律。
2. **run_builds 自动 watch 插 chief gate 回合步**（drive-1250 同坑）：空手判定
   与解锁后认领都要能区分「领到 gate 回合（收掉再领）」与「领到被闸步（硬失败）」。
3. **claim 空手证据 = 客户端 5s 截断 + SQLite 步仍 pending 双保险**：server hold
   ≈75s，等满太慢；#1065 保证截断的请求不替死机领步。
4. **机器页路由是 `/app/resources/machines`** 不是 `/app/machines`（首跑超时根因）。
