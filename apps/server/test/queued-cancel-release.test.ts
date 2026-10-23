// #1219 失败场景（先于实现固化，AGENTS.md 测试规则 3）。现象链（2026-10-11
// 看板实测）：chief cancel_builds 打在 queued build 上是裸 UPDATE——build
// errorMessage + pending 步 failed，**todo 不离 queued**（僵尸卡：零可领步、
// 无事件无 wake）；此后 run_builds 的 queued→queued 断言 409，chief 整队
// 停摆只能重开新卡承接，新卡 build 又钉在同一台不领步的机器上排队，循环。
// 失败方式枚举：
// 1. cancel 打在 queued build（pending 步）：要求 = 走 stop 漏斗——步 stopped
//    + todo 回落 prevPhase + build errorMessage「已取消」+ 再 run_builds 成功
//    且新步可被在线机器秒领（验收：改前 409+停摆、改后顺利认领，成对输出）。
// 2. cancel 打在 claimed 步 build：要求 = stop 委托面（stopPending 单槽 +
//    machine stream stop 事件）——claimed 步继续占并发位的「failed 卡残留
//    占位」不复存在。
// 3. cancel 打在无活动步的 build（僵尸形/已终态）：要求 = 幂等释放——todo
//    离开 queued（回落）+ errorMessage 兜底 + 事件面，不再留占位。
// 4. 存量僵尸（已部署态）：定时/启动 reconcile（sweepZombieQueuedTodos）修复
//    「queued 且 latest build 无 pending/claimed 步」的 todo。
// 5. 钉选机在线、runtime 闸开、有空闲并发位、pending 步超宽限未被领
//    （#1053 串行 daemon 长跑实测形态）：要求 = 宽限后可见失败（点名机器
//    与出口），步失败收尾、todo → failed。
// 6. 控制组：钉选机满载（claimed 数达 cap）→ 合法排队不失败。
// 7. 控制组：宽限内活 queued 步不动；正常 queued→building 认领路径不变。
// 8. chief cancel_builds 404 校验同 confirm/merge 面（requireTeamBuild 同律）。

import { type ClaimedStep, type Phase, STOP_MESSAGE } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  stopPending as stopPendingTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  cancelBuild,
  sweepAbandonedBuildSteps,
  sweepZombieQueuedTodos,
} from '../src/services/builds.js';
import { claimStep } from '../src/services/machines.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { bindAllAgents, bootServer, type TestServer } from './helpers.js';

registerChiefHarness();

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

function machineDepsOf(s: TestServer) {
  return { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir };
}

/** 在线机器（pi runtime，harness agent provider=stub-gw → pi 档）。 */
function insertMachine(s: TestServer, id: string, opts: { cap?: number; online?: boolean } = {}) {
  s.db
    .insert(machineTable)
    .values({
      id,
      teamId: s.team.id,
      name: id,
      online: opts.online ?? true,
      maxConcurrent: opts.cap ?? 8,
      enabledRuntimes: ['pi'],
    })
    .run();
}

// —— 1/8：chief cancel_builds → run_builds 全链（验收主场景）—————————————

describe('#1219 chief cancel→重派全链', () => {
  test('cancel queued build：todo 回落 + 再 run_builds 成功 + 新步秒级被认领', async () => {
    insertMachine(H.s, 'machine-rerun');
    bindAllAgents(H.s, 'machine-rerun'); // #1259：本测试认领机 = machine-rerun
    const todoRec = (await relay('create_todo', {
      projectId: H.projectId,
      title: '被取消后重派',
      spec: 's',
    })) as { id: string };
    const started = (await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { build: { agentId: AGENT_ID } },
    })) as { builds: { id: string }[] };
    const buildId = started.builds[0]!.id;

    const cancelled = (await relay('cancel_builds', { buildIds: [buildId] })) as {
      cancelled: string[];
    };
    expect(cancelled.cancelled).toEqual([buildId]);

    // 取消落账：步 stopped（非 failed——裸 UPDATE 旧形）+ todo 离开 queued。
    const stepRow = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).get()!;
    expect(stepRow.status).toBe('stopped');
    const todoRow = H.s.db.select().from(todoTable).where(eq(todoTable.id, todoRec.id)).get()!;
    expect(todoRow.phase).not.toBe('queued'); // 僵尸占位 = 恰好是这个「不离 queued」
    const buildRow = H.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toBe(STOP_MESSAGE);

    // 再 run_builds：改前 409 queued→queued（停摆），改后顺利重建。
    const rerun = (await relay('run_builds', {
      todoIds: [todoRec.id],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    })) as { builds: { id: string }[] };
    expect(rerun.builds).toHaveLength(1);

    // 新步可被在线机器秒级认领（验收「顺利认领」）。harness 世界里有更早的
    // pending chief 步（FIFO 先领它）——循环认领直到目标 build 的步出现。
    const target = rerun.builds[0]!.id;
    let claimedTarget: ClaimedStep | null = null;
    for (let i = 0; i < 5 && claimedTarget === null; i++) {
      const c = await claimStep(
        machineDepsOf(H.s),
        'machine-rerun',
        H.s.team.id,
        10,
        'http://localhost',
      );
      if (c !== null && c.step.buildId === target) claimedTarget = c;
    }
    expect(claimedTarget).not.toBeNull();
  });

  test('cancel_builds 跨团队/未知 build → 404（confirm/merge 同律）', async () => {
    await expect(relay('cancel_builds', { buildIds: ['build-nope'] })).rejects.toThrow(
      'build build-nope',
    );
  });
});

// —— 2/3：cancel 三形态的漏斗单测 ——————————————————————————————————————

describe('#1219 cancelBuild 漏斗（claimed 委托 / 僵尸幂等释放）', () => {
  interface World {
    s: TestServer;
    teamId: string;
    todoId: string;
    buildId: string;
    stepId: string;
    machineId: string;
    base: number;
  }
  function makeWorld(step: { status: 'pending' | 'claimed' | 'failed'; phase?: Phase }): World {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const base = Date.now();
    const teamId = s.team.id;
    const todoId = `todo-${Math.random().toString(36).slice(2)}`;
    const buildId = `build-${Math.random().toString(36).slice(2)}`;
    const stepId = `step-${Math.random().toString(36).slice(2)}`;
    const machineId = `machine-${Math.random().toString(36).slice(2)}`;
    s.db.insert(projectTable).values({ id: 'proj-c', name: 'cancel', teamId }).run();
    insertMachine(s, machineId);
    s.db
      .insert(agentTable)
      .values({
        id: 'agent-c',
        teamId,
        displayName: 'cancel-agent',
        provider: 'stub-gw',
        modelId: 'stub-model',
        machineId,
      })
      .run();
    s.db
      .insert(todoTable)
      .values({
        id: todoId,
        teamId,
        projectId: 'proj-c',
        title: 'cancel target',
        phase: step.phase ?? 'queued',
        phaseAt: base,
        seqNum: 1,
        assignment: { plan: { agentId: 'agent-c' }, build: { agentId: 'agent-c' } },
        latestBuildId: buildId,
      })
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId,
        withPlan: true,
        prevPhase: 'todo',
        triggerSource: 'chief',
        createdAt: base - 300_000,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId,
        kind: 'plan',
        status: step.status,
        ...(step.status === 'claimed'
          ? { machineId, claimedAt: base - 300_000, lastHeartbeatAt: base - 100_000 }
          : {}),
        createdAt: base - 300_000,
      })
      .run();
    return { s, teamId, todoId, buildId, stepId, machineId, base };
  }

  test('claimed 步：stop 委托面（stopPending 单槽 + machine stream stop 事件），不占死并发位', async () => {
    const w = makeWorld({ status: 'claimed' });
    const events: { type: string; stepId?: string }[] = [];
    w.s.machineHub.subscribe(w.teamId, (ev) => {
      if ('type' in ev) events.push(ev as { type: string; stepId?: string });
    });

    const out = cancelBuild(machineDepsOf(w.s), w.buildId);

    expect(out).toBe('delegated');
    // stop_pending 单槽就位（GET /api/machine/stop 拉取-确认，与 requestStop 同律）。
    const pending = w.s.db.select().from(stopPendingTable).all();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.stepId).toBe(w.stepId);
    // 机器面收到 stop 事件。
    expect(events.some((e) => e.type === 'stop')).toBe(true);
    // 步保持 claimed（中断在途，done(stopped) 才落账）——旧裸 UPDATE 的
    // 「零通知、步继续跑到天荒地老占并发位」不复存在。
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    expect(stepRow.status).toBe('claimed');
  });

  test('无活动步（僵尸形）：幂等释放——todo 离开 queued + errorMessage 兜底 + 事件面', () => {
    const w = makeWorld({ status: 'failed', phase: 'queued' });
    const buildBefore = w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!;

    const out = cancelBuild(machineDepsOf(w.s), w.buildId);

    expect(out).toBe('released');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('todo'); // 回落 prevPhase——queued 占位被释放
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!;
    expect(buildRow.errorMessage).toBe(buildBefore.errorMessage ?? STOP_MESSAGE);
    // 二次 cancel 幂等（不再变形）。
    expect(cancelBuild(machineDepsOf(w.s), w.buildId)).toBe('released');
    const todoRow2 = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow2.phase).toBe('todo');
  });

  test('无活动步且 todo 已非 queued（已终态卡）：no-op 不改相位', () => {
    const w = makeWorld({ status: 'failed', phase: 'failed' });
    const out = cancelBuild(machineDepsOf(w.s), w.buildId);
    expect(out).toBe('released');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('failed');
  });

  test('未知 build：not-found 不抛（chief 传陈旧 id 的幂等面）', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    expect(cancelBuild(machineDepsOf(s), 'build-nope')).toBe('not-found');
  });
});

// —— 4：存量僵尸 reconcile ————————————————————————————————————————————

describe('#1219 sweepZombieQueuedTodos 存量僵尸修复', () => {
  test('queued + latest build 无 pending/claimed 步 → 回落释放（含活步控制组）', () => {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const teamId = s.team.id;
    const base = Date.now();
    s.db.insert(projectTable).values({ id: 'proj-z', name: 'zombie', teamId }).run();
    const mk = (suffix: string, opts: { stepStatus: 'failed' | 'stopped' | 'pending' | null }) => {
      const todoId = `todo-z-${suffix}`;
      const buildId = `build-z-${suffix}`;
      s.db
        .insert(todoTable)
        .values({
          id: todoId,
          teamId,
          projectId: 'proj-z',
          title: `zombie ${suffix}`,
          phase: 'queued',
          phaseAt: base,
          seqNum: 1,
          assignment: { plan: { agentId: 'agent-z' }, build: { agentId: 'agent-z' } },
          latestBuildId: buildId,
        })
        .run();
      s.db
        .insert(buildTable)
        .values({
          id: buildId,
          todoId,
          withPlan: true,
          prevPhase: 'todo',
          triggerSource: 'chief',
          createdAt: base,
        })
        .run();
      if (opts.stepStatus !== null) {
        s.db
          .insert(stepTable)
          .values({
            id: `step-z-${suffix}`,
            buildId,
            kind: 'plan',
            status: opts.stepStatus,
            createdAt: base,
          })
          .run();
      }
      return { todoId, buildId };
    };
    const zombieFailed = mk('failed', { stepStatus: 'failed' });
    const zombieStopped = mk('stopped', { stepStatus: 'stopped' });
    const zombieNoStep = mk('nostep', { stepStatus: null });
    const liveQueued = mk('live', { stepStatus: 'pending' }); // 控制组：活步不动

    sweepZombieQueuedTodos(s.svc, base);

    for (const z of [zombieFailed, zombieStopped, zombieNoStep]) {
      const row = s.db.select().from(todoTable).where(eq(todoTable.id, z.todoId)).get()!;
      expect(row.phase).toBe('todo'); // 释放：回到本轮开始前的面
      const buildRow = s.db.select().from(buildTable).where(eq(buildTable.id, z.buildId)).get()!;
      expect(buildRow.errorMessage).toBe(STOP_MESSAGE);
    }
    const live = s.db.select().from(todoTable).where(eq(todoTable.id, liveQueued.todoId)).get()!;
    expect(live.phase).toBe('queued'); // 活 queued（有 pending 步）不受 reconcile
  });
});

// —— 5/6/7：钉选在线不认领的宽限（sweepAbandonedBuildSteps ④c）——————————

describe('#1219 钉选机在线不认领的宽限', () => {
  interface WedgeWorld {
    s: TestServer;
    teamId: string;
    todoId: string;
    buildId: string;
    stepId: string;
    machineId: string;
    base: number;
  }
  function makeWedgeWorld(opts: {
    ago: number;
    machineCap: number;
    machineLoad: number;
  }): WedgeWorld {
    const s = bootServer();
    disposables.push(() => s.dispose());
    const base = Date.now();
    const teamId = s.team.id;
    const todoId = `todo-w-${Math.random().toString(36).slice(2)}`;
    const buildId = `build-w-${Math.random().toString(36).slice(2)}`;
    const stepId = `step-w-${Math.random().toString(36).slice(2)}`;
    const machineId = `machine-w-${Math.random().toString(36).slice(2)}`;
    s.db.insert(projectTable).values({ id: 'proj-w', name: 'wedge', teamId }).run();
    insertMachine(s, machineId, { cap: opts.machineCap });
    s.db
      .insert(agentTable)
      .values({
        id: 'agent-w',
        teamId,
        displayName: 'wedge-agent',
        provider: 'stub-gw',
        modelId: 'stub-model',
        machineId,
      })
      .run();
    s.db
      .insert(todoTable)
      .values({
        id: todoId,
        teamId,
        projectId: 'proj-w',
        title: 'wedge target',
        phase: 'queued',
        phaseAt: base,
        seqNum: 1,
        assignment: { plan: { agentId: 'agent-w' }, build: { agentId: 'agent-w' } },
        latestBuildId: buildId,
      })
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: buildId,
        todoId,
        withPlan: true,
        prevPhase: 'todo',
        triggerSource: 'chief',
        createdAt: base - opts.ago,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: stepId, buildId, kind: 'plan', status: 'pending', createdAt: base - opts.ago })
      .run();
    // 机器负载：别的 build 的 claimed 步占位（chief 不计数的面不掺和）。
    const loadBuild = `build-load-${Math.random().toString(36).slice(2)}`;
    const loadTodo = `todo-load-${Math.random().toString(36).slice(2)}`;
    s.db
      .insert(todoTable)
      .values({
        id: loadTodo,
        teamId,
        projectId: 'proj-w',
        title: 'load',
        phase: 'building',
        phaseAt: base,
        seqNum: 2,
        assignment: { plan: { agentId: 'agent-w' }, build: { agentId: 'agent-w' } },
        latestBuildId: loadBuild,
      })
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: loadBuild,
        todoId: loadTodo,
        withPlan: false,
        prevPhase: 'todo',
        triggerSource: 'user',
        createdAt: base,
      })
      .run();
    for (let i = 0; i < opts.machineLoad; i++) {
      s.db
        .insert(stepTable)
        .values({
          id: `step-load-${i}-${Math.random().toString(36).slice(2)}`,
          buildId: loadBuild,
          kind: 'build',
          status: 'claimed',
          machineId,
          claimedAt: base - 60_000,
          lastHeartbeatAt: base,
          createdAt: base,
        })
        .run();
    }
    return { s, teamId, todoId, buildId, stepId, machineId, base };
  }

  test('在线 + 闸开 + 有空闲并发位 + 超宽限：挂起等机器（#1257：不判死，daemon 恢复领取即续跑）', () => {
    const w = makeWedgeWorld({
      ago: 660_000,
      machineCap: 8,
      machineLoad: 0,
    });
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    expect(stepRow.status).toBe('pending');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('queued');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!;
    expect(buildRow.errorMessage).toBeNull();
  });

  test('控制组：钉选机满载（claimed 达 cap）→ 合法排队不失败', () => {
    const w = makeWedgeWorld({
      ago: 660_000,
      machineCap: 1,
      machineLoad: 1,
    });
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    expect(stepRow.status).toBe('pending');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('queued');
  });

  test('控制组：宽限内（闸开有闲位但未超时）→ 不动；正常认领路径不变', async () => {
    const w = makeWedgeWorld({ ago: 60_000, machineCap: 8, machineLoad: 0 });
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    expect(stepRow.status).toBe('pending');
    // claimStep 直领（queued→building 路径回归）。
    const claimed = await claimStep(
      machineDepsOf(w.s),
      w.machineId,
      w.teamId,
      10,
      'http://localhost',
    );
    expect(claimed).not.toBeNull();
    expect(claimed!.step.id).toBe(w.stepId);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('planning'); // plan 步认领 → planning（02 §4.2）
  });
});
