// 排队投影（#1108）：pending 步「在排队、位次、等谁」的读侧派生——builds
// 面的 steps 查询与 chief 面的线程投影两个读面共用一台计算器，位次与等待
// 对象只有一套口径。
//
// 为什么单列一个叶子模块：builds.ts（steps 读面）与 chief.ts（threads 投影）
// 两个消费方都要这份派生，而 machines.ts → chief.ts 已有单向 import——值
// import 会把环拉直成真环；与 dispatch-timeouts.ts 建叶同一个由（零业务
// 依赖的叶子让「一个口径一个模块」在代码层可见）。
//
// 位次口径（#1259 归属机版，与 claim 实际序对齐的诚实近似，注释即判据）：
// - 步的去处 = agent 归属机（agentForStep 单源解析）：归属机 M 的步，可见
//   集 = 同样归属 M 的 pending 步，按 createdAt 位次——即该机真实认领次序
//   （machines.ts tryClaim 的候选循环同序）。
// - 归属机未设（agent.machineId null）：没有机器可见该步——位次照算（同
//   「无归属机」池），等待对象 = null（sweep 的未设归属机分支负责可见失败，
//   排队面不编造机器）。
// - chief 回合步：去处 = 绑定 Agent 的归属机（#1260 总管降级——chief 无
//   第二答案），同口径。
// 已知近似（不修，登记）：无 Agent 的死步（#1104 修复后转 Fail）与 runtime
// 闸挡的步也计入位次——它们「在队列里」从用户视角为真，排障入口在失败漏斗
// 不在位次里扣。

import type { StepQueueBlocked, StepQueueInfo } from '@pacman/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, build, chief, chiefThread, machine, step, todo } from '../db/schema.js';
import {
  agentForStep,
  agentIdForStep,
  missingCapabilities,
  runtimeGatePasses,
} from './dispatch-eligibility.js';

/** 投影目标步的最小形状（调用方从各自读面取齐）。 */
export interface QueueTargetStep {
  id: string;
  createdAt: number;
  /** 该步的归属机（worker = agent.machineId；chief = 绑定 Agent 的
   *  machineId，#1260）；null = 无归属（任何机器不可见）。 */
  homeMachineId: string | null;
  /** #1257 额度挂起面（step 行位；缺省 = 未挂起）：挂起中的排队行呈现
   * 「等额度」而非「等空闲机器」。 */
  holdReason?: string | null;
  holdUntil?: number | null;
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
      // #1251 blocked 位的 Agent 解析材料（agentIdForStep 三参 + 行存在查询）。
      kind: step.kind,
      prompt: step.prompt,
      // #1493 降级后本步按备选的 provider 过 runtime 闸（claim 面同判据）。
      fallback: step.fallback,
      todoRow: todo,
    })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'pending'), eq(todo.teamId, teamId)))
    .all();
  const workerQueue = workerRows.map((r) => ({
    ...r,
    home: agentForStep(db, r.todoRow, r.kind, r.prompt)?.machineId ?? null,
  }));
  // buildId = chief thread id（conv 等式，CONTEXT.md）。chief 步的归属 =
  // 绑定 Agent 的归属机（#1260）；未绑定 Agent 的 chief 步 join 缺席——
  // 不入队投影（claim 面同样不可见，sweep 负责可见失败）。
  const chiefRows = db
    .select({
      id: step.id,
      createdAt: step.createdAt,
      threadId: step.buildId,
      home: agent.machineId,
      holdReason: step.holdReason,
      holdUntil: step.holdUntil,
      chiefId: chiefThread.chiefId,
    })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .innerJoin(chief, eq(chiefThread.chiefId, chief.id))
    .innerJoin(agent, eq(chief.agentId, agent.id))
    .where(and(eq(step.status, 'pending'), eq(step.kind, 'chief'), eq(chiefThread.teamId, teamId)))
    .all();
  const queue = [...workerQueue, ...chiefRows].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );

  // 该机 claimed 步数 / machine 行（waitingFor 快照；按需缓存——调用方行集
  // 分布稀，n 次查询封顶 n 个被等待机器）。#1260：chief 步占槽——口径与
  // machineRunningCount 同源（machines.ts 的容量闸同数）。
  const claimedCountCache = new Map<string, number>();
  const claimedCount = (machineId: string): number => {
    const hit = claimedCountCache.get(machineId);
    if (hit !== undefined) return hit;
    const n = db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
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

  /** pending 成因（#1251，ADR 0018 决策 4.4；#1259 起机器去处 = agent
   * 归属机，钉选退役——成因判据从「钉选机/全队」收口到「归属机」单机）：
   *  - machine-offline：归属机不在线 / 未设归属机（补设即领——等待有用）。
   *  - capability-missing：归属机在线且 runtime 闸开，但缺该 Agent 声明的
   *    能力——装 X 才解锁（missing = 归属机的缺项清单）。
   *  不进本判：runtime 闸挡（既有已知缝，呈现面维持现状——能力闸不越权
   *  代言 runtime 成因）；agent 无 modelId（不可派发族归 claim 失败面）。 */
  function blockedFor(
    target: QueueTargetStep,
    row: (typeof queue)[number],
  ): StepQueueBlocked | undefined {
    if (target.homeMachineId === null) {
      // 无归属机：任何机器不可领（claim 面归属机闸恒拒）——补设即领。
      return { kind: 'machine-offline', missing: [] };
    }
    const home = teamMachines.find((m) => m.id === target.homeMachineId);
    if (home === undefined || !home.online) {
      return { kind: 'machine-offline', missing: [] };
    }
    const agentRow = agentForRow(row);
    const provider =
      ('fallback' in row ? row.fallback?.model?.provider : undefined) ?? agentRow?.provider;
    if (agentRow?.modelId != null && runtimeGatePasses(home, provider)) {
      const missing = missingCapabilities(home, agentRow);
      if (missing.length > 0) return { kind: 'capability-missing', missing };
    }
    return undefined;
  }

  /** 按行投影：目标不在队列（非 pending——调用方读面与投影器构造之间的竞窗
   *  里步被领走）→ null，呈现面回落「不在排队」。 */
  function project(target: QueueTargetStep): StepQueueInfo | null {
    const queueRow = queue.find((r) => r.id === target.id);
    if (queueRow === undefined) return null;
    // 同归属机池 = 该机可见集（tryClaim 候选循环同集）；无归属步只在「无
    // 归属机」池里互排（任何机器都不可见它们）。
    const pool = queue.filter((r) => r.home === target.homeMachineId);
    const position = pool.findIndex((r) => r.id === target.id) + 1;
    if (position === 0) return null; // 理论不达（queueRow 已判）；防御位。
    let waitingFor: StepQueueInfo['waitingFor'] = null;
    if (target.homeMachineId !== null) {
      const row = machineRowOf(target.homeMachineId);
      if (row !== undefined) {
        waitingFor = {
          machineId: row.id,
          name: row.name,
          running: claimedCount(row.id),
          capacity: row.maxConcurrent,
        };
      }
      // 行缺失（机器被删）：waitingFor 保持 null——残值语义同离线失败路径
      // （失败漏斗点名机器），排队面不编造对象。
    }
    // #1257 额度挂起：退避中的排队行带 hold（reason + 下次尝试时刻）。
    const hold: StepQueueInfo['hold'] =
      target.holdReason === 'quota' && target.holdUntil != null
        ? { reason: 'quota', retryAt: target.holdUntil }
        : undefined;
    // #1251 pending 成因位（blockedFor 判据注释见上）：缺席 = 正常排队。
    // 与 hold 可并存（额度挂起是步级退避，成因是机器级事实）；呈现优先级
    // 归 web queueLabel（hold 先——步级挂起带下次尝试时刻，更具体）。
    const blocked = blockedFor(target, queueRow);
    return {
      position,
      waitingFor,
      ...(hold !== undefined ? { hold } : {}),
      ...(blocked !== undefined ? { blocked } : {}),
    };
  }

  /** 线程的活动 pending 回合步（threads 投影取位面）：该线程 pending chief
   *  步的 createdAt 尾条（并发多 pending 步在同线程不成立——回合串行入队；
   *  尾条是防御位）。无 pending 步 → null。 */
  function pendingChiefOf(threadId: string): QueueTargetStep | null {
    const rows = chiefRows.filter((r) => r.threadId === threadId);
    const last = rows[rows.length - 1];
    if (last === undefined) return null;
    return {
      id: last.id,
      createdAt: last.createdAt,
      homeMachineId: last.home,
      holdReason: last.holdReason,
      holdUntil: last.holdUntil,
    };
  }

  return { project, pendingChiefOf };
}
