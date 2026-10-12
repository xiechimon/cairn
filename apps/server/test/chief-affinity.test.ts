// #895 单机编排默认策略 A4（spec 21）：未钉 chief 线程的会话亲和闸——T2
// （#863 worker 步亲和）的对称补全。chief 会话文件（pi sessionDir）是执行
// 机本地资产，未钉线程「自动」的真实语义是「每轮可能换机」；亲和把自动从
// 「每轮可能换机」修成「粘住会话机、机器消失才换」。失败方式（先于实现
// 固化，仓测试纪律）：
// 1. 换机常态化：会话机在线时他机 claim 必须空手（步留 pending 等它领）；
//    会话机自己领到 + continue 载荷（换机降级归 daemon T1 标记，server 不
//    预判）。
// 2. 永挂：会话机离线他机仍不领 → 步永挂 → 必须放行。
// 3. 幽灵归属：会话机行被删 → 同上放行。
// 4. 闸死锁：会话机在线但 runtime 闸关（chief 绑定 agent 的 runtime 它开
//    不了）→ 它不是有效候选人 → 放行。
// 5. 钉选死锁：线程钉了机器（显式钉选，含主力机来源）→ 钉选盖过亲和
//    （钉选 SQL 过滤下唯有钉选机可见，亲和再挡 = 唯一可见者被挡死）。
// 6. 过宽：未开会话（首轮）无会话文件依赖 → 不亲和，任意机即领（现状
//    FIFO 回归钉）。
// 7. 队头阻塞：他机跳过亲和步后照领其它线程的首轮步（跳过只作用于当前
//    候选）。
// 8. 亲和跟链尾：多回合中途换机后，亲和位 = 最新会话步的机器。

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import { bootServer, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface ChiefAffinityWorld {
  s: TestServer;
  teamId: string;
  threadId: string;
  targetStepId: string;
  /** 会话机（prior session 步的 machineId）。 */
  machineAId: string;
  /** 他机（亲和测试的观察者/竞争者）。 */
  machineBId: string;
  /** 历史会话 done 步 id（按 createdAt 序）。 */
  priorStepIds: string[];
}

interface WorldOpts {
  /** 会话机在线位（缺省 true）。 */
  ownerOnline?: boolean;
  /** 会话机 runtime 开关（缺省 ['pi']；chief 绑定 agent = stub-gw → pi 档）。 */
  ownerRuntimes?: string[];
  /** thread.pinnedMachineId（缺省 null = 未钉）。 */
  /** 总管主力机（chief.machineId，#1259 后 chief 步归属单源）。 */
  chiefHome?: string; // 预留给后续主力机场景的 world 槽位
  /** thread.sessionId（缺省 'sess-A'；'' = 未开会话首轮）。 */
  sessionId?: string;
  /** 历史会话链（缺省单条：A/sess-A）；按序插入 done 步。 */
  priorSessions?: { machineId: string | null; sessionId: string }[];
}

/** 直插 world：绑定 agent 的 chief 行 + 线程（未钉 + 会话位可调）+ 会话机 A
 * + 他机 B + 历史会话 done 步 + 目标 pending chief 步。机器在线位直写 DB
 * （生产置位路径 = presence/wake SSE，归 machine-wire 测试）。 */
function makeWorld(opts: WorldOpts = {}): ChiefAffinityWorld {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  const teamId = s.team.id;
  const suffix = Math.random().toString(36).slice(2);
  const threadId = `chief-${suffix}`;
  const targetStepId = `step-target-${suffix}`;
  const machineAId = `machine-a-${suffix}`;
  const machineBId = `machine-b-${suffix}`;
  const agentId = `agent-${suffix}`;
  s.db
    .insert(agentTable)
    .values({
      id: agentId,
      teamId,
      displayName: 'affinity-chief-agent',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  s.db
    .insert(chiefTable)
    .values({
      id: `chief-${s.user.id}-${teamId}`,
      userId: s.user.id,
      teamId,
      agentId,
      charter: '',
      ...(opts.chiefHome !== undefined ? { machineId: opts.chiefHome } : {}),
      createdAt: base,
    })
    .run();
  s.db
    .insert(machineTable)
    .values({
      id: machineAId,
      teamId,
      name: `owner-${suffix}`,
      online: opts.ownerOnline ?? true,
      enabledRuntimes: opts.ownerRuntimes ?? ['pi'],
    })
    .run();
  s.db
    .insert(machineTable)
    .values({
      id: machineBId,
      teamId,
      name: `other-${suffix}`,
      online: true,
      enabledRuntimes: ['pi'],
    })
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: threadId,
      chiefId: `chief-${s.user.id}-${teamId}`,
      userId: s.user.id,
      teamId,
      title: 'affinity target',
      createdAt: base - 600_000,
      updatedAt: base - 600_000,
      sessionRuntime: 'pi',
      sessionId: opts.sessionId ?? 'sess-A',
      sessionOpenedAt: base - 600_000,
      pendingSessionResumeAt: null,
      toolDefHashes: {},
      toolResultHashes: {},
      activeRun: null,
    })
    .run();
  const priorSessions = opts.priorSessions ?? [{ machineId: machineAId, sessionId: 'sess-A' }];
  const priorStepIds: string[] = [];
  priorSessions.forEach((p, i) => {
    const id = `step-prior-${suffix}-${i}`;
    priorStepIds.push(id);
    s.db
      .insert(stepTable)
      .values({
        id,
        buildId: threadId,
        kind: 'chief',
        status: 'done',
        machineId: p.machineId,
        sessionId: p.sessionId,
        createdAt: base - 500_000 + i * 1_000,
      })
      .run();
  });
  s.db
    .insert(stepTable)
    .values({
      id: targetStepId,
      buildId: threadId,
      kind: 'chief',
      status: 'pending',
      machineId: null,
      createdAt: base - 60_000,
    })
    .run();
  return { s, teamId, threadId, targetStepId, machineAId, machineBId, priorStepIds };
}

function machineDepsOf(w: ChiefAffinityWorld) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
    skillsDir: w.s.skillsDir,
  };
}

function claimAs(w: ChiefAffinityWorld, machineId: string) {
  return claimStep(machineDepsOf(w), machineId, w.teamId, 10, 'http://localhost');
}

describe('#895 A4 chief 步会话亲和（tryClaim chief 候选环，T2 对称）', () => {
  test('核心：会话机在线 → 他机空手、步留 pending；会话机领到 + continue 载荷', async () => {
    const w = makeWorld();
    // 失败方式 1：B 若抢走 = 换机常态化（chief 会话上下文丢失成为默认路径）。
    expect(await claimAs(w, w.machineBId)).toBeNull();
    const got = await claimAs(w, w.machineAId);
    expect(got?.step.id).toBe(w.targetStepId);
    expect(got?.step.machineId).toBe(w.machineAId);
    expect(got?.session).toEqual({ action: 'continue', sessionId: 'sess-A' });
  });

  test('会话机离线 → 他机领到；载荷仍 continue（daemon 回退 + T1 注记契约不破）', async () => {
    const w = makeWorld({ ownerOnline: false });
    // 失败方式 2：不放行 = 步永挂（亲和是软偏好，机器消失即刻放行，不等
    // T3 宽限——未钉线程不因亲和产生新的无界等待）。
    const got = await claimAs(w, w.machineBId);
    expect(got?.step.id).toBe(w.targetStepId);
    expect(got?.session).toEqual({ action: 'continue', sessionId: 'sess-A' });
  });

  test('会话机行被删（机器注销）→ 他机领到（幽灵归属不放行 = 步永挂）', async () => {
    const w = makeWorld();
    w.s.db.delete(machineTable).where(eq(machineTable.id, w.machineAId)).run();
    const got = await claimAs(w, w.machineBId);
    expect(got?.step.id).toBe(w.targetStepId);
  });

  test('闸死锁：会话机在线但 runtime 关（chief 步跑 pi、会话机只开 claude-code）→ 他机领到', async () => {
    const w = makeWorld({ ownerRuntimes: ['claude-code'] });
    // 失败方式 4：会话机自己过不了 claim 闸 → 它不是有效候选人，亲和不得
    // 挡死唯一能跑的机器。
    const got = await claimAs(w, w.machineBId);
    expect(got?.step.id).toBe(w.targetStepId);
  });

  test('主力机盖过亲和：总管主力机设了 B → 唯有 B 可见该步（亲和不再挡）', async () => {
    const w = makeWorld();
    w.s.db
      .update(chiefTable)
      .set({ machineId: w.machineBId })
      .where(eq(chiefTable.id, `chief-${w.s.user.id}-${w.teamId}`))
      .run();
    // #1259：主力机 SQL 过滤下只有 B 能见该步；亲和若对 B 也生效（会话
    // 机 A 在线）= 唯一可见者被挡死 → 步永挂。
    const foreign = await claimAs(w, w.machineAId);
    expect(foreign).toBeNull(); // 会话机 A 反而领不到——主力机是硬约束
    const got = await claimAs(w, w.machineBId);
    expect(got?.step.id).toBe(w.targetStepId);
    expect(got?.session).toEqual({ action: 'continue', sessionId: 'sess-A' });
  });

  test('过宽负例：未开会话（首轮）→ 任意机即领 + new session（现状 FIFO 回归）', async () => {
    const w = makeWorld({ sessionId: '', priorSessions: [] });
    const got = await claimAs(w, w.machineBId);
    expect(got?.step.id).toBe(w.targetStepId);
    expect(got?.session).toEqual({ action: 'new', sessionId: null });
  });

  test('无队头阻塞：他机跳过亲和步后照领其它线程的首轮步；会话机随后领亲和步', async () => {
    const w = makeWorld();
    const suffix = Math.random().toString(36).slice(2);
    // 第二条线程：首轮（无会话），步 createdAt 晚于亲和步。
    const threadId2 = `chief-${suffix}`;
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId2,
        chiefId: `chief-${w.s.user.id}-${w.teamId}`,
        userId: w.s.user.id,
        teamId: w.teamId,
        title: 'second thread',
        createdAt: Date.now() - 40_000,
        updatedAt: Date.now() - 40_000,
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: Date.now() - 40_000,
        pendingSessionResumeAt: null,
        toolDefHashes: {},
        toolResultHashes: {},
        activeRun: null,
      })
      .run();
    const laterStepId = `step-later-${suffix}`;
    w.s.db
      .insert(stepTable)
      .values({
        id: laterStepId,
        buildId: threadId2,
        kind: 'chief',
        status: 'pending',
        machineId: null,
        createdAt: Date.now() - 30_000,
      })
      .run();

    // 失败方式 7：B 跳过亲和步（会话机 A 在线）但不饿死——领到更晚的步。
    const gotB = await claimAs(w, w.machineBId);
    expect(gotB?.step.id).toBe(laterStepId);

    // A 随后领到亲和步（FIFO：亲和步 createdAt 更早）。
    const gotA = await claimAs(w, w.machineAId);
    expect(gotA?.step.id).toBe(w.targetStepId);
  });

  test('亲和跟链尾：中途换机后亲和位 = 最新会话步的机器（不是首步机）', async () => {
    // 会话链：A 跑了第一回合（sess-A），B 跑了第二回合（sess-B）——B 持有
    // 最新会话（thread.sessionId = 链尾值，finishChiefTurn 回写律）。
    const w = makeWorld({
      sessionId: 'sess-B',
      priorSessions: [
        { machineId: null, sessionId: 'sess-A' },
        { machineId: null, sessionId: 'sess-B' },
      ],
    });
    w.s.db
      .update(stepTable)
      .set({ machineId: w.machineAId })
      .where(eq(stepTable.id, w.priorStepIds[0]!))
      .run();
    w.s.db
      .update(stepTable)
      .set({ machineId: w.machineBId })
      .where(eq(stepTable.id, w.priorStepIds[1]!))
      .run();

    // 失败方式 8：亲和若认首步机 A → A 领走 = 续接 sess-B 必失败（文件在 B）。
    expect(await claimAs(w, w.machineAId)).toBeNull();
    const got = await claimAs(w, w.machineBId);
    expect(got?.step.id).toBe(w.targetStepId);
    expect(got?.session).toEqual({ action: 'continue', sessionId: 'sess-B' });
  });
});
