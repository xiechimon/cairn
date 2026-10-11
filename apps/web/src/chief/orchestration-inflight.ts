// 「该任务有一轮编排在飞」判定（#1216）：开始/保存并开始/重跑 都只发
// POST /todos/:id/orchestrate——相位不动（编排落位不写相位，#640），chief
// 回合要过 claim→模型→run_builds 才把卡推进 queued。这个窗口里卡片此前
// 零在飞标识、开始钮照亮，实测用户连点出重复线程（生产库同卡 3–5 条
// 「开始任务 #N」线程）。判定 = chiefThreads 读面里标题等于
// orchestrateThreadTitle(seqNum)（shared 单源，与 server 落库标题逐字节
// 同形）且回合在飞（turnQueue 排队投影非空 = 步未被认领；activeRun 非空 =
// 已认领在跑——与 chief 抽屉「排队中/处理中」同一对在飞信号，#1108/#739）。
// 数据面 = 既有 ['chiefThreads'] 查询（ChiefRoot 常挂，SSE step/message 事件
// 失效重取），本模块只做纯推导；fixture 面查询不启用 → undefined → 恒无
// 在飞，DOM 零变化。

import { type ChiefThread, orchestrateThreadTitle } from '@pacman/shared';

/** 线程的一轮回合是否在飞（排队待认领 或 已被认领在跑）。 */
export function threadTurnInFlight(thread: ChiefThread): boolean {
  return thread.turnQueue != null || thread.activeRun != null;
}

/** 该 seqNum 任务当前在飞的编排线程（多条命中取最新创建——历史上连点出的
 *  重复线程会同时在飞，任一在飞即算在飞；返回行供「查看会话」深链）。 */
export function inflightOrchestrationFor(
  threads: readonly ChiefThread[] | undefined,
  seqNum: number,
): ChiefThread | null {
  if (threads === undefined) return null;
  const title = orchestrateThreadTitle(seqNum);
  let best: ChiefThread | null = null;
  for (const thread of threads) {
    if (thread.title !== title || !threadTurnInFlight(thread)) continue;
    if (best === null || thread.createdAt > best.createdAt) best = thread;
  }
  return best;
}
