// 排队投影（#1108）：pending 步「在排队、位次、等谁」的读侧派生——builds
// 面的 steps 查询与 chief 面的线程投影两个读面共用一台计算器，位次与等待
// 对象只有一套口径。
//
// 为什么单列一个叶子模块：builds.ts（steps 读面）与 chief.ts（threads 投影）
// 两个消费方都要这份派生，而 machines.ts → chief.ts 已有单向 import——值
// import 会把环拉直成真环；与 dispatch-timeouts.ts 建叶同一个由（零业务
// 依赖的叶子让「一个口径一个模块」在代码层可见）。
//
// 位次口径（与 claim 实际序对齐的诚实近似，注释即判据）：
// - 钉选步（build.pinnedMachineId / chiefThread.pinnedMachineId 非空 M）：
//   只数「该机可见集」——钉 M 或未钉的 pending 步按 createdAt 位次。这与
//   claimCandidates / claimChiefCandidates 的过滤 + orderBy 完全同集同序
//   （machines.ts），即该机真实的认领次序。
// - 未钉步：全团队 pending 按 createdAt 位次。任何在线机都按 createdAt 领
//   它可见的集——他机的钉选步对该机不可见，全局位次把它们也数进去 = 可能
//   偏悲观（显示「前面 3 个」实际对将认领它的机器只有 1 个在前）。方向上
//   宁可多报不漏报（用户去查那 3 个，查得到真队列）。
// - 等待对象：钉选机器（含 running/capacity 快照）；未钉 = null（等待任何
//   在线机器）。
// 已知近似（不修，登记）：无 Agent 的死步（#1104 修复后转 Fail）与 runtime
// 闸挡的步也计入位次——它们「在队列里」从用户视角为真，排障入口在失败漏斗
// 不在位次里扣。

import type { StepQueueBlocked, StepQueueInfo } from '@pacman/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, build, chief, chiefThread, machine, step, todo } from '../db/schema.js';
import { agentIdForStep, missingCapabilities, runtimeGatePasses } from './dispatch-eligibility.js';

/** 投影目标步的最小形状（调用方从各自读面取齐）。 */
export interface QueueTargetStep {
  id: string;
  createdAt: number;
  /** 该步的钉选机器（worker = build.pinnedMachineId；chief =
   * chiefThread.pinnedMachineId）；null = 未钉。 */
  pinnedMachineId: string | null;
}

/** team 域排队投影器：一次取全 pending 集（worker + chief 两族），调用方按
 *  行 project() / pendingChiefOf()。批量构造、按行查——steps 查询 / threads
 *  列表一次投影不重复扫队列。位次以 createdAt 升序为唯一键（id 平序兜底，
 *  理论不达——同刻落库只在单进程同步写窗内）。 */
export function stepQueueProjector(db: Db, teamId: string) {
  const workerRows = db
    .select({
      id: step.id,
      createdAt: step.createdAt,
      pin: build.pinnedMachineId,
      // #1251 blocked 位的 Agent 解析材料（agentIdForStep 三参 + 行存在查询）。
      kind: step.kind,
      prompt: step.prompt,
      todoRow: todo,
    })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'pending'), eq(todo.teamId, teamId)))
    .all();
  // buildId = chief thread id（conv 等式，CONTEXT.md）。
  const chiefRows = db
    .select({
      id: step.id,
      createdAt: step.createdAt,
      pin: chiefThread.pinnedMachineId,
      threadId: step.buildId,
      chiefId: chiefThread.chiefId,
    })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(and(eq(step.status, 'pending'), eq(step.kind, 'chief'), eq(chiefThread.teamId, teamId)))
    .all();
  const queue = [...workerRows, ...chiefRows].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );

  // 该机 claimed 步数 / machine 行（waitingFor 快照；按需缓存——调用方行集
  // 分布稀，n 次查询封顶 n 个被等待机器）。#1148：只数非 chief 步（chief 不
  // 占并发槽；口径与 machineRunningCount 同源——machines.ts 的容量闸同数）。
  const claimedCountCache = new Map<string, number>();
  const claimedCount = (machineId: string): number => {
    const hit = claimedCountCache.get(machineId);
    if (hit !== undefined) return hit;
    const n = db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed'), ne(step.kind, 'chief')))
      .all().length;
    claimedCountCache.set(machineId, n);
    return n;
  };
  const machineCache = new Map<string, typeof machine.$inferSelect | undefined>();
  const machineRowOf = (machineId: string) => {
    if (!machineCache.has(machineId)) {
      machineCache.set(machineId, db.select().from(machine).where(eq(machine.id, machineId)).get());
    }
    return machineCache.get(machineId);
  };

  // —— #1251 blocked 位（可见 pending reason）的事实面 ————————————————
  // 团队机器一次性取齐（在线判定 + runtime/能力闸判据）；Agent 行按需缓存
  // （worker = 槽位解析 agentIdForStep；chief = chiefId→chief.agentId）。
  // 闸判单源 = dispatch-eligibility（claim/sweep 同一份事实——投影面撒谎的
  // 形态就是「显示能跑但永远没人领」或反之）。fail-open 律同 claim 面：
  // 未上报快照的机器不产出缺项（未知 ≠ 缺失，不编造 blocked）。
  const teamMachines = db.select().from(machine).where(eq(machine.teamId, teamId)).all();
  const agentCache = new Map<string, typeof agent.$inferSelect | null>();
  const agentRowOf = (agentId: string | null): typeof agent.$inferSelect | null => {
    if (agentId === null) return null;
    if (!agentCache.has(agentId)) {
      agentCache.set(agentId, db.select().from(agent).where(eq(agent.id, agentId)).get() ?? null);
    }
    return agentCache.get(agentId) ?? null;
  };

  /** 队列行的 Agent 行（两族各自的解析路径；解析不到 = null，blocked 只出
   *  machine-offline 维——无主步的失败收尾归 #1104 claim 面，不在这里编因）。 */
  function agentForRow(row: (typeof queue)[number]): typeof agent.$inferSelect | null {
    if ('todoRow' in row) {
      return agentRowOf(agentIdForStep(row.todoRow, row.kind, row.prompt));
    }
    const chiefRow = db.select().from(chief).where(eq(chief.id, row.chiefId)).get();
    return agentRowOf(chiefRow?.agentId ?? null);
  }

  /** pending 成因（#1251，ADR 0018 决策 4.4）：
   *  - machine-offline：钉选机不在线 / 团队零在线机器——等待有用（上线即领）。
   *  - capability-missing：在线且 runtime 闸开的机器全部缺能力——等待无用，
   *    装 X 才解锁（missing = 缺得最少那台的缺项清单，id 平序确定性）。
   *  不进本判：runtime 闸挡（既有已知缝，呈现面维持现状——能力闸不越权
   *  代言 runtime 成因）；agent 无 modelId（不可派发族归 claim 失败面）。 */
  function blockedFor(
    target: QueueTargetStep,
    row: (typeof queue)[number],
  ): StepQueueBlocked | undefined {
    if (target.pinnedMachineId !== null) {
      const pinned = teamMachines.find((m) => m.id === target.pinnedMachineId);
      if (pinned === undefined || !pinned.online) {
        return { kind: 'machine-offline', missing: [] };
      }
      const agentRow = agentForRow(row);
      if (agentRow?.modelId != null && runtimeGatePasses(pinned, agentRow.provider)) {
        const missing = missingCapabilities(pinned, agentRow);
        if (missing.length > 0) return { kind: 'capability-missing', missing };
      }
      return undefined;
    }
    const online = teamMachines.filter((m) => m.online);
    if (online.length === 0) return { kind: 'machine-offline', missing: [] };
    const agentRow = agentForRow(row);
    if (agentRow?.modelId == null) return undefined;
    const runtimeOk = online.filter((m) => runtimeGatePasses(m, agentRow.provider));
    if (runtimeOk.length === 0) return undefined;
    const perMachine = runtimeOk
      .map((m) => ({ m, missing: missingCapabilities(m, agentRow) }))
      .filter((x) => x.missing.length > 0);
    if (perMachine.length < runtimeOk.length) return undefined; // 有能力齐的在线机 = 正常排队
    const best = [...perMachine].sort(
      (a, b) => a.missing.length - b.missing.length || (a.m.id < b.m.id ? -1 : 1),
    )[0];
    return best === undefined ? undefined : { kind: 'capability-missing', missing: best.missing };
  }

  /** 按行投影：目标不在队列（非 pending——调用方读面与投影器构造之间的竞窗
   *  里步被领走）→ null，呈现面回落「不在排队」。 */
  function project(target: QueueTargetStep): StepQueueInfo | null {
    const queueRow = queue.find((r) => r.id === target.id);
    if (queueRow === undefined) return null;
    // 钉选步：该机可见集 = 钉 M 或未钉（claimCandidates 同过滤）；未钉步：
    // 全队集（诚实近似见文件头）。
    const pool =
      target.pinnedMachineId === null
        ? queue
        : queue.filter((r) => r.pin === null || r.pin === target.pinnedMachineId);
    const position = pool.findIndex((r) => r.id === target.id) + 1;
    if (position === 0) return null; // 理论不达（queueRow 已判）；防御位。
    let waitingFor: StepQueueInfo['waitingFor'] = null;
    if (target.pinnedMachineId !== null) {
      const row = machineRowOf(target.pinnedMachineId);
      if (row !== undefined) {
        waitingFor = {
          machineId: row.id,
          name: row.name,
          running: claimedCount(row.id),
          capacity: row.maxConcurrent,
        };
      }
      // 行缺失（机器被删）：waitingFor 保持 null——钉残值语义同离线失败路径
      // （失败漏斗点名机器），排队面不编造对象。
    }
    // #1251 pending 成因位（blockedFor 判据注释见上）：缺席 = 正常排队。
    const blocked = blockedFor(target, queueRow);
    return { position, waitingFor, ...(blocked !== undefined ? { blocked } : {}) };
  }

  /** 线程的活动 pending 回合步（threads 投影取位面）：该线程 pending chief
   *  步的 createdAt 尾条（并发多 pending 步在同线程不成立——回合串行入队；
   *  尾条是防御位）。无 pending 步 → null。 */
  function pendingChiefOf(threadId: string): QueueTargetStep | null {
    const rows = chiefRows.filter((r) => r.threadId === threadId);
    const last = rows[rows.length - 1];
    if (last === undefined) return null;
    return { id: last.id, createdAt: last.createdAt, pinnedMachineId: last.pin };
  }

  return { project, pendingChiefOf };
}
