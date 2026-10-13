// #706 失联扫尾 + #862 T1 跨机续跑 + #1257 无人认领挂起：sweepAbandoned
// BuildSteps——失联 claimed 步释放回 pending 供归属机重领（new-session 降级由
// daemon 侧 transcript 标记）；无人认领的 pending 步挂起等机器（#1257：infra
// 事件，机器回来走既有 claim 循环自动续跑，板面「等机器」chip 由 todos.ts
// waitingOnOf 派生），不再判死 build。#1259 起步的机器去处 = agent 归属机
// （钉选退役）。判定（超龄 × 在线态 × 步状态 × 步 kind）+ 落账面 + 事件面
// （会话流 step 事件，不另起通知面）。机器在线位直写 DB（生产置位路径 wake
// SSE 断连面归 machine-wire 测试）。

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { BUILD_ABANDONED_STEP_MS, sweepAbandonedBuildSteps } from '../src/services/builds.js';
import { claimStep } from '../src/services/machines.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface BuildWorld {
  s: TestServer;
  teamId: string;
  todoId: string;
  buildId: string;
  stepId: string;
  machineId: string;
  agentId: string | null;
  base: number;
}

/** 直插 world：project + building 相 todo + build + build 步 + 一台机器。
 * withAgent = 指派带模型的 Agent（认领路径用：tryClaim 要求 assignment 槽有
 * 模型位；机器开 pi runtime）。 */
function makeWorld(step: {
  status: 'pending' | 'claimed';
  kind?: 'plan' | 'build' | 'merge' | 'review' | 'chief' | 'verify';
  createdAgo: number;
  heartbeatAgo?: number | null;
  machineOnline?: boolean;
  withAgent?: boolean;
  /** #881：Agent provider（缺省 null = pi 档；'claude-code' = 闸判用的
   *  runtime 反例位——机器没开对应 runtime 才构成「钉选在线但被挡」）。 */
  agentProvider?: string;
  /** #881：本机 enabledRuntimes 覆写（缺省维持 withAgent ? ['pi'] : 列缺省）。 */
  machineRuntimes?: string[];
  /** #1259：pin 选项改写为 **agent 归属机**绑定（'self' = 本 world 机器、
   *  'ghost' = 团队里不存在的 id、其它字符串 = 原样落 agent.machineId）。
   *  归属机在 agent 上——pin 给出时强制带 agent；withAgent 未给 pin = 绑
   *  本 world 机器（绑定模型下可领的缺省形态）。 */
  pin?: 'self' | 'ghost' | (string & {});
}): BuildWorld {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  const teamId = s.team.id;
  const todoId = `todo-${Math.random().toString(36).slice(2)}`;
  const buildId = `build-${Math.random().toString(36).slice(2)}`;
  const stepId = `step-${Math.random().toString(36).slice(2)}`;
  const machineId = `machine-${Math.random().toString(36).slice(2)}`;
  const withAgent = step.withAgent === true || step.pin !== undefined;
  const agentId = withAgent ? `agent-${Math.random().toString(36).slice(2)}` : null;
  s.db.insert(projectTable).values({ id: 'proj-sweep', name: 'sweep', teamId }).run();
  s.db
    .insert(machineTable)
    .values({
      id: machineId,
      teamId,
      name: 'sweep-box',
      online: step.machineOnline ?? false,
      ...(step.machineRuntimes !== undefined
        ? { enabledRuntimes: step.machineRuntimes }
        : step.withAgent
          ? { enabledRuntimes: ['pi'] }
          : {}),
    })
    .run();
  if (agentId !== null) {
    s.db
      .insert(agentTable)
      .values({
        id: agentId,
        teamId,
        displayName: 'sweep-agent',
        modelId: 'stub-model',
        machineId:
          step.pin === undefined || step.pin === 'self'
            ? machineId
            : step.pin === 'ghost'
              ? 'machine-gone'
              : step.pin,
        ...(step.agentProvider !== undefined ? { provider: step.agentProvider } : {}),
      })
      .run();
  }
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId,
      projectId: 'proj-sweep',
      title: 'sweep target',
      phase: 'building',
      phaseAt: base - step.createdAgo,
      seqNum: 1,
      ...(agentId !== null ? { assignment: { plan: null, build: { agentId } } } : {}),
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base - step.createdAgo,
    })
    .run();
  const createdAt = base - step.createdAgo;
  const claimedAt = step.status === 'claimed' ? createdAt : null;
  // 缺省心跳 = claim 置位值（生产 claim 面同形）；B-C7 形态即此值 + 机器在线。
  const heartbeat =
    step.heartbeatAgo === undefined
      ? claimedAt
      : step.heartbeatAgo === null
        ? null
        : base - step.heartbeatAgo;
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: step.kind ?? 'build',
      status: step.status,
      machineId: step.status === 'claimed' ? machineId : null,
      createdAt,
      claimedAt,
      lastHeartbeatAt: step.status === 'claimed' ? heartbeat : null,
    })
    .run();
  return { s, teamId, todoId, buildId, stepId, machineId, agentId, base };
}

function stepRowOf(w: BuildWorld) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
}

function todoRowOf(w: BuildWorld) {
  return w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
}

function agentRowOf(w: BuildWorld) {
  if (w.agentId === null) throw new Error('world has no agent');
  return w.s.db.select().from(agentTable).where(eq(agentTable.id, w.agentId)).get()!;
}
function buildRowOf(w: BuildWorld) {
  return w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!;
}

/** 会话流 step 事件捕获桩（钉 web SSE 契约：step 事件携带终态行）。 */
function tapConvStream(s: TestServer, conversationId: string): { events: object[] } {
  const events: object[] = [];
  s.convHub.subscribe(conversationId, {
    nextSeq: () => 1,
    send: (payload: object) => {
      events.push(payload);
      return Promise.resolve();
    },
  });
  return { events };
}

function stepEventOf(events: object[], stepId: string): { status: string } {
  const ev = events.find(
    (e): e is { type: string; step: unknown } => (e as { type?: string }).type === 'step',
  );
  if (ev === undefined) throw new Error('no step event on the conversation stream');
  if ((ev.step as { id: string }).id !== stepId) throw new Error('step event for another step');
  return ev.step as { status: string };
}

/** 追加一台在线机器（#864：「团队有别的在线机器、但钉的那台不在」这一形态的
 *  另一半——没有它就无法把「零在线」与「钉选离线」两条判据分开）。 */
function addOnlineMachine(w: BuildWorld, name = 'mea'): string {
  const id = `machine-${Math.random().toString(36).slice(2)}`;
  w.s.db.insert(machineTable).values({ id, teamId: w.teamId, name, online: true }).run();
  return id;
}

/** claim 面要 MachineDeps（svc 只有 BuildDeps 位，box/目录面补齐）。 */
function machineDepsOf(w: BuildWorld) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
  };
}

describe('#862 T1 失联 claimed 步释放（sweepAbandonedBuildSteps）', () => {
  test('claimed 心跳停更超阈值 + 机器离线：释放回 pending（机位清空、相位不动、无失败痕迹）+ 会话流 step 事件 + wake 唤醒认领循环', async () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });
    const { events } = tapConvStream(w.s, w.buildId);
    const woken = w.s.svc.machineHub.waitWake(w.teamId, 50);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    const row = stepRowOf(w);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    // 非失败路径：todo 相位不动、build 无 errorMessage（与机器报失败同漏斗不混）。
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(stepEventOf(events, w.stepId).status).toBe('pending');
    // 他机 75s 长轮询不等满：释放即 wake，同队等待者立即重认领。
    await expect(woken).resolves.toBe(true);
  });

  test('B-C7：claimed 自领取零心跳进展超阈值 + 机器在线：同样释放（server 标了 claimed 但机器侧零执行，步可被他机/本机重领）', () => {
    // heartbeat 缺省 = claim 置位值（从未推进）+ 机器在线 = B-C7 移交竞态形。
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      machineOnline: true,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(stepRowOf(w).machineId).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('释放后归属机可重领：别机空手（#1259 归属机闸）、归属机上线后领到同一步', async () => {
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
      withAgent: true,
    });
    const meaId = `machine-mea-${Math.random().toString(36).slice(2)}`;
    w.s.db
      .insert(machineTable)
      .values({ id: meaId, teamId: w.teamId, name: 'mea', online: true, enabledRuntimes: ['pi'] })
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending');

    // 归属机闸：别机（mea）领不到归属机是 w.machineId 的步。
    const other = await claimStep(machineDepsOf(w), meaId, w.teamId, 10, 'http://localhost');
    expect(other).toBeNull();
    // 归属机（上线后）重领同一步。
    w.s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, w.machineId)).run();
    const claimed = await claimStep(
      machineDepsOf(w),
      w.machineId,
      w.teamId,
      10,
      'http://localhost',
    );
    if (claimed === null) throw new Error('released step was not reclaimable by home machine');
    expect(claimed.step.id).toBe(w.stepId);
    expect(claimed.step.machineId).toBe(w.machineId);
    // 会话面：无历史 session → 新会话开工；daemon 侧回退标记见 runner-resume-note 测试。
    expect(claimed.session.action).toBe('new');
  });

  test('释放后认领带历史会话：prior session 在位 → continue 载荷（#1259 归属机恒同机，会话文件恒在——回退标记成历史）', async () => {
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
      withAgent: true,
    });
    // 同 build 更早的 done 步带 sessionId = 历史会话（server 侧 continue 判定源）。
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-prior-${Math.random().toString(36).slice(2)}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        machineId: w.machineId,
        sessionId: 'sess-old',
        createdAt: w.base - 600_000,
      })
      .run();
    sweepAbandonedBuildSteps(w.s.svc, w.base);

    w.s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, w.machineId)).run();
    const claimed = await claimStep(
      machineDepsOf(w),
      w.machineId,
      w.teamId,
      10,
      'http://localhost',
    );
    if (claimed === null) throw new Error('released step was not reclaimable');
    expect(claimed.session).toEqual({ action: 'continue', sessionId: 'sess-old' });
  });

  test('pending 超龄 + 团队零在线机器：挂起等机器（#1257：无人认领是 infra 事件，不进 failed）', () => {
    const w = makeWorld({ status: 'pending', createdAgo: 300_000 });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('释放后仍无在线机器 → 挂起（#1257：释放不是无期等待的失败收尾，机器回来即续跑）', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending');

    sweepAbandonedBuildSteps(w.s.svc, w.base + 600_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('释放后有在线机器 → 继续排队不杀', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });
    w.s.db
      .insert(machineTable)
      .values({
        id: `machine-mea-${Math.random().toString(36).slice(2)}`,
        teamId: w.teamId,
        name: 'mea',
        online: true,
      })
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending');
    sweepAbandonedBuildSteps(w.s.svc, w.base + 600_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('负例：心跳新鲜的 claimed 步不动（在线/离线皆可）', () => {
    const online = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      heartbeatAgo: 10_000,
      machineOnline: true,
    });
    const offline = makeWorld({
      status: 'claimed',
      createdAgo: 300_000,
      heartbeatAgo: 10_000,
    });

    sweepAbandonedBuildSteps(online.s.svc, online.base);
    sweepAbandonedBuildSteps(offline.s.svc, offline.base);

    // 心跳年龄是活判据：新鲜 = 长步仍在跑，不命中任何判据。
    expect(stepRowOf(online).status).toBe('claimed');
    expect(stepRowOf(offline).status).toBe('claimed');
    expect(buildRowOf(online).errorMessage).toBeNull();
  });

  test('负例：pending 且团队有在线机器 = 合法排队不碰', () => {
    const w = makeWorld({ status: 'pending', createdAgo: 300_000, machineOnline: true });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('负例：pending 未超龄 → 不动', () => {
    const w = makeWorld({ status: 'pending', createdAgo: 10_000 });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
  });

  test('负例：在线机器上曾有心跳后停更的 claimed 步 = 歧义态不动', () => {
    // 执行/推送通道部分存活的楔子态：不动，等 presence 过期走离线判据。
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 600_000,
      heartbeatAgo: 300_000,
      machineOnline: true,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('claimed');
  });

  test('幂等：终态步跳过；chief 步不在本面', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-chief-other',
        buildId: 'chief-thread-1',
        kind: 'chief',
        status: 'claimed',
        machineId: w.machineId,
        createdAt: w.base - 300_000,
        claimedAt: w.base - 300_000,
        lastHeartbeatAt: w.base - 300_000,
      })
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending');
    const chief = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, 'step-chief-other'))
      .get()!;
    expect(chief.status).toBe('claimed'); // chief 面归 chief.ts 扫尾
  });

  test('阈值与 #684 同节奏（120 秒，不自造新节奏）', () => {
    expect(BUILD_ABANDONED_STEP_MS).toBe(120_000);
  });

  test('scheduler tick 接线：tick(now) 驱动 sweep（真实宿主路径）', () => {
    const w = makeWorld({ status: 'claimed', createdAgo: 300_000, heartbeatAgo: 300_000 });
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });

    scheduler.tick(w.base);
    expect(stepRowOf(w).status).toBe('pending');
    scheduler.stop();
  });
});

describe('#1257 归属机离线的无人认领挂起（sweepAbandonedBuildSteps 的归属机形态）', () => {
  test('归属机离线 + 团队有别的在线机器：宽限内不碰（合法等待）', () => {
    const w = makeWorld({ status: 'pending', createdAgo: 90_000, pin: 'self' });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('归属机离线 + 别的机器在线 + 超龄：挂起等机器（#1257：不按失败收尾，归属机回来自动续跑——板面「等机器」chip 透出）', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 600_000 + 1_000,
      pin: 'self',
    });
    const otherId = addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    // 挂起不是失败：步留 pending、todo 相位不动、build 无 errorMessage。
    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    // 归属绑定在位（不静默改派：归属的语义就是确定性，#1259）。
    expect(agentRowOf(w).machineId).toBe(w.machineId);
    // 持续挂起：再扫一轮仍不动。
    sweepAbandonedBuildSteps(w.s.svc, w.base + 60_000);
    expect(stepRowOf(w).status).toBe('pending');
    // 别的在线机器本可跑这条步——归属机闸恒拒（换机不可见），等机器是真等。
    expect(otherId).not.toBe(w.machineId);
  });

  test('归属机离线 + 团队零在线机器：同样挂起（可见性由「等机器」chip 承担，不进 failed）', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 600_000 + 1_000,
      pin: 'self',
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('未设归属机：同样挂起（补设即解锁；板面「等机器」chip 透出，无期静默不成立）', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 600_000 + 1_000,
      withAgent: true,
      machineOnline: true,
    });
    // 归属机置空 = 迁移漏网/手工清库形态：claim 面恒拒（归属机闸），等补设。
    w.s.db.update(agentTable).set({ machineId: null }).where(eq(agentTable.id, w.agentId!)).run();
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('未设归属机：不动（等待补设，恒 pending）', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 90_000,
      withAgent: true,
      machineOnline: true,
    });
    w.s.db.update(agentTable).set({ machineId: null }).where(eq(agentTable.id, w.agentId!)).run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  // 「归属机行缺失」形态已被结构消灭：agent.machineId 带 FK（references
  // machine.id），悬空 id 插不进去、有绑定 agent 的机器删不掉（删机保护
  // 见 routes-resources 机器面测试）。sweep 的 homeRow === undefined 分支
  // 降为防御位（残留库/导入面）。

  test('归属机在线：不动（步等它认领，合法排队）', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 90_000,
      machineOnline: true,
      pin: 'self',
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
  });

  test('归属机是另一台在线机器：不动（本机不能抢——归属机闸恒拒，步等归属机）', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 1_800_000,
      withAgent: true,
      machineOnline: true,
    });
    const otherId = addOnlineMachine(w);
    w.s.db
      .update(agentTable)
      .set({ machineId: otherId })
      .where(eq(agentTable.id, w.agentId!))
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
  });

  test('释放后重等：锚在步的最后活动（心跳），释放后持续挂起（#1257：不判死，等归属机回归）', () => {
    // 入队 20 分钟前，但机器 130 秒前才失联（心跳停更刚过 T1 的 120 秒释放线）。
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 1_200_000,
      heartbeatAgo: 130_000,
      pin: 'self',
    });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepRowOf(w).status).toBe('pending'); // T1 释放

    sweepAbandonedBuildSteps(w.s.svc, w.base + 1_000);
    expect(stepRowOf(w).status).toBe('pending');

    sweepAbandonedBuildSteps(w.s.svc, w.base + 600_000);
    expect(stepRowOf(w).status).toBe('pending'); // 挂起：机器回来即续跑
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('归属机离线但步心跳新鲜（claimed 在跑）：不动（claimed 面判据不变）', () => {
    const w = makeWorld({
      status: 'claimed',
      createdAgo: 1_200_000,
      heartbeatAgo: 10_000,
      pin: 'self',
    });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('claimed');
  });
});

describe('#881 归属机在线但 runtime 闸挡（#1257 挂起语义）', () => {
  // 归属机在线但 enabledRuntimes 不含本步 runtime → claim 侧
  // runtimeGatePasses 恒 false + 归属机闸令唯有该机可见 → 步挂起等 runtime
  // （机器在、闸开前轮不到它领）。#1257：挂起不判死，开 runtime 后自动续跑
  // （PATCH 热写秒级生效，chip 即改即愈）。

  test('归属机在线 + 闸挡（claude-code 步 × 只开 pi 的机器）+ 超龄：挂起等机器（#1257：开 runtime 后自动续跑，不按失败收尾）', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 601_000,
      machineOnline: true,
      withAgent: true,
      agentProvider: 'claude-code',
      machineRuntimes: ['pi'],
      pin: 'self',
    });
    // 团队里另有能跑 claude-code 的在线机器——归属机闸恒拒（归属不换机），
    // 挂起等的是归属机自己开 runtime。
    const otherId = addOnlineMachine(w);
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['pi', 'claude-code'] })
      .where(eq(machineTable.id, otherId))
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    // 归属机在位（归属语义 = 确定性，静默换机违背它）。
    expect(agentRowOf(w).machineId).toBe(w.machineId);
    // 持续挂起。
    sweepAbandonedBuildSteps(w.s.svc, w.base + 60_000);
    expect(stepRowOf(w).status).toBe('pending');
  });

  test('归属机在线 + 闸挡：不动（runtime 开关 PATCH 热写，开闸即自动续领）', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 90_000,
      machineOnline: true,
      withAgent: true,
      agentProvider: 'claude-code',
      machineRuntimes: ['pi'],
      pin: 'self',
    });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('归属机在线 + runtime 开 + 满载：不动（步在它队列里排队，合法——闸判负例）', () => {
    // 满载 = 真排队不动（#1257 挂起语义下在线不领一律等，无楔住判死面）。
    const w = makeWorld({
      status: 'pending',
      createdAgo: 1_800_000,
      machineOnline: true,
      withAgent: true,
      agentProvider: 'claude-code',
      machineRuntimes: ['pi', 'claude-code'],
      pin: 'self',
    });
    // 满载：归属机的并发位被在跑步占满（makeWorld 机器缺省 maxConcurrent=3）。
    for (let i = 0; i < 3; i++) {
      const loadStepId = `step-load-${i}-${Math.random().toString(36).slice(2)}`;
      w.s.db
        .insert(stepTable)
        .values({
          id: loadStepId,
          buildId: w.buildId,
          kind: 'build',
          status: 'claimed',
          machineId: w.machineId,
          claimedAt: w.base - 60_000,
          lastHeartbeatAt: w.base,
          createdAt: w.base,
        })
        .run();
    }

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('review 步同判（agentId 走 prompt meta 头行，provider 重算同源）：闸挡同样挂起', () => {
    const w = makeWorld({
      status: 'pending',
      kind: 'review',
      createdAgo: 601_000,
      machineOnline: true,
      withAgent: true,
      agentProvider: 'claude-code',
      machineRuntimes: ['pi'],
      pin: 'self',
    });
    // review 步的 Agent 不走 assignment 槽，agentId 在 prompt meta 头行（M7 #330）。
    w.s.db
      .update(stepTable)
      .set({ prompt: `{"kind":"review","agentId":"${w.agentId}","gate":"review"}\n审核任务` })
      .where(eq(stepTable.id, w.stepId))
      .run();
    // assignment 槽清空：证明判据吃的是 review meta 而非 assignment。
    w.s.db
      .update(todoTable)
      .set({ assignment: { plan: null, build: null } })
      .where(eq(todoTable.id, w.todoId))
      .run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('未指派 Agent 的步不进本判（未指派 = 无人可领的另一族缝，不是闸挡）', () => {
    const w = makeWorld({
      status: 'pending',
      createdAgo: 1_200_000,
      machineOnline: true,
      machineRuntimes: ['pi'],
    });
    addOnlineMachine(w);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    // 机器在线 → 「零在线」判不中；无 Agent → 归属机判族无从计算 → 不动。
    // （未指派步无人可领的缝另行登记，不在本票收口。）
    expect(stepRowOf(w).status).toBe('pending');
  });
});

describe('#1284 verify 步 sweep（sweepAbandonedBuildSteps 补 verify kind）', () => {
  test('claimed verify 步心跳过期 + 机器离线：释放回 pending（机位清空、相位不动、无失败痕迹）+ 会话流 step 事件', async () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
    });
    const { events } = tapConvStream(w.s, w.buildId);
    const woken = w.s.svc.machineHub.waitWake(w.teamId, 50);

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    const row = stepRowOf(w);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
    expect(stepEventOf(events, w.stepId).status).toBe('pending');
    await expect(woken).resolves.toBe(true);
  });

  test('B-C7 同形：claimed verify 步零心跳进展超阈值 + 机器在线：同样释放', () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      machineOnline: true,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(stepRowOf(w).machineId).toBeNull();
    expect(todoRowOf(w).phase).toBe('building');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('负例：心跳新鲜的 claimed verify 步不动', () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      heartbeatAgo: 10_000,
      machineOnline: true,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('claimed');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });

  test('负例：done verify 步不动（终态——sweep 只扫 pending/claimed）', () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
    });
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, w.stepId)).run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('done');
  });

  test('负例：failed verify 步不动（终态——sweep 只扫 pending/claimed）', () => {
    const w = makeWorld({
      status: 'claimed',
      kind: 'verify',
      createdAgo: 300_000,
      heartbeatAgo: 300_000,
    });
    w.s.db.update(stepTable).set({ status: 'failed' }).where(eq(stepTable.id, w.stepId)).run();

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('failed');
  });

  test('负例：pending verify 步超龄 + 团队零在线：挂起等机器不动（#1257）', () => {
    const w = makeWorld({
      status: 'pending',
      kind: 'verify',
      createdAgo: 300_000,
    });

    sweepAbandonedBuildSteps(w.s.svc, w.base);

    expect(stepRowOf(w).status).toBe('pending');
    expect(buildRowOf(w).errorMessage).toBeNull();
  });
});
