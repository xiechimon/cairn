// 派发超时与挂起策略（#864 T3 + #881 + #1257）：额度挂起的退避档位与步
// 活动锚。#1259 起机器归属单源 = agent 归属机（钉选退役）；#1257 起「无人
// 认领」恒挂起不判死——原离线宽限失败漏斗（PIN_OFFLINE_GRACE_MS 一族）随
// 之退役：等机器走板面 waitingOn chip（todos.ts 读侧派生），机器回来自动
// 续跑。
//
// 为什么单列一个叶子模块：这条策略同时管 worker 步（builds.ts 的
// sweepAbandonedBuildSteps）、chief 回合（chief.ts 的 sweepAbandonedChiefSteps）
// 与 claim 面（machines.ts 的 #1257 挂起写位），而 machines.ts ↔ builds.ts /
// chief.ts 之间已有环（machines 正向 import 两家），值 import 会把环拉直成真
// 环。零依赖的叶子让「一个策略一个数」在代码层可见。
//
// 存活门限语义（#1257，照 Multica runtime_sweeper.go）：
// - 无人认领是 infra 事件：pending 步挂起等机器（「等机器」可见态 = todo
//   waitingOn chip），机器回来走既有 claim 循环自动续跑，不进 failed。
// - 超时只杀「已证明病了」的（claimed 后零心跳进展 → 释放重领），不杀
//   「联系不上的」（机器离线 + 心跳停更 → 释放回 pending 等回归）。
// - 额度用完是配额事件（classifyStepFailure → quota）：步挂起等额度
//   （退避到期重领，额度仍在 → 再挂起），不重试不判死。
// - relay 流断（classifyStepFailure → network）在 daemon 侧续跑重试
//   （runner，最多 3 次）；耗尽仍断才按失败收尾。

/** 步的最后活动时刻：心跳 → 领取 → 入队（释放保留 claimedAt/lastHeartbeatAt
 * 作死亡时刻审计，故释放后的 pending 步锚在失联时刻）。 */
export function stepActivityAt(row: {
  lastHeartbeatAt: number | null;
  claimedAt: number | null;
  createdAt: number;
}): number {
  return row.lastHeartbeatAt ?? row.claimedAt ?? row.createdAt;
}

// —— #1257 额度挂起退避—————————————————————————————————————————————————————

/** 额度挂起的重领退避档位（按 holdCount 取，末档封顶）：挂起不是失败、也
 *  不是热轮询——每次重领即一次「额度恢复了吗」的真实探测，退避挡住的是
 *  探测频率。60s → 5min → 15min：首档给「刚打满马上就充」的常见形态一个
 *  快回环，末档封顶防长挂期间的探测堆积。额度恢复后第一次重领即正常跑完
 *  （探测成功路径无退避参与）。 */
export const QUOTA_HOLD_BACKOFF_MS: readonly [number, number, number] = [60_000, 300_000, 900_000];

/** 第 n 次（1 起）额度挂起的退避时长（末档封顶）。 */
export function quotaHoldBackoffMs(holdCount: number): number {
  const idx = Math.min(Math.max(holdCount, 1), QUOTA_HOLD_BACKOFF_MS.length) - 1;
  return QUOTA_HOLD_BACKOFF_MS[idx]!;
}

/** 额度挂起行文案（会话流 system 行 + step 队列面共用）：原因原文（含
 *  哪一路 relay 的错误事实）+ 下次尝试时间——「什么时候恢复」不可知，可见
 *  的诚实口径是「我们什么时候再试」。 */
export function quotaHoldNote(message: string, retryAt: number): string {
  const when = new Date(retryAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `等额度：模型额度用尽，已挂起等待恢复（${message}）。下次尝试 ${when}，额度恢复后将自动继续，无需人工重跑。`;
}
