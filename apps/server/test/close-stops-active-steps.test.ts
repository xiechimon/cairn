// #1445 关闭（closed）一张还有活动步的卡，必须先停掉那一步。此前 close 只写
// phase：todo 落 closed，build 的 pending 步原样留着；claimCandidates 不看
// todo 相位，机器下一次认领照领不误——给一张已取消的卡干活。三条入口都中：
// chief / MCP 的 close_todos（transitionTodos）与看板 / 详情的 PATCH
// phase=closed。失败方式（先于实现固化）：
// 1. close_todos 关 queued 卡：pending 步仍可被在线机器认领。
// 2. PATCH phase=closed 关 queued 卡：同上。
// 3. 关一张 claimed 步在跑的卡（planning）：机器零通知、继续跑；就算后来报
//    done(stopped)，applyStoppedStep 的 gate 回落会把卡从 closed 翻回 todo。
// 4. 存量僵尸（修复前已关的卡还挂着 pending 步）：没有任何扫尾去停它。
// 5. 失联扫尾把已关卡的 claimed 步释放回 pending——又变回可领。
// 6. 控制组：未关闭的 queued 卡的 pending 步，扫尾照旧不动。
// 7. stop-and-done（#1247）的预定还在途时关卡：回报落账按预定把卡从 closed
//    写成 done。
// 8. #1447 起 queued 住执行中，canBoardDrop 放行 queued→todo；raw PATCH 把
//    queued 卡挪回待开始不经 /reset，pending 步原样留着，机器照领。
// 9. 关一张 claimed 步在跑的卡、回报到达前又重开：gate 回落把重开后的相位
//    覆盖掉。
// 10. raw PATCH 把 planning / building 卡挪回待开始：claimed 步零通知、继续跑。
// 11. #1451 raw PATCH 把执行中的卡标完成（看板走 stop-and-done，不经这里）：
//     queued 的 pending 步照领；planning 的 claimed 步零通知、继续跑。
// 12. #1451 chief / MCP complete_todos 把 building 卡标完成（漏斗的
//     building→done 边本为拆卡父收口而设）：claimed 步零通知、继续跑。
// 13. 修复后的回报落账不得把卡从 done 挪走；无活动步的 done（review 源）
//     不发任何停止。
// 14. keep 预定丢失（进程重启）后回报到达：卡已被标完成 / 挪回待开始，gate
//     回落仍把它写回 confirm。
// 15. 失联扫尾对已完成的卡同样放行：残留 pending 步不停，失联 claimed 步被
//     释放回 pending、又能被领。
// 16. #1453 停止在途时步先正常跑完、回报 success：completeStep 照常推相位——
//     closed / done 卡的 confirm、review 边不合法，回报 409、daemon journal
//     每次重启重报；挪回待开始的卡被推进 confirm；无方案文档的 plan 步给
//     已离开执行中的卡补排重写步，机器照领。
// 17. 同一竞态的其余形态：closed 卡的 merge 步成功（closed→done 非法边）、
//     review 步带 blocking 成功（closed→planning 非法边）均回报 409；
//     done 卡的 build 步零改动成功被产物闸记成失败、改写 build.errorMessage；
//     关卡后重开、重跑（新 build）时旧 build 的步迟到成功把卡推进 confirm；
//     stop-and-done 预定 done 在途时 build 步先跑完，卡进 review 而非 done。

import { type MachineDoneBody, STOP_MESSAGE } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  plan as planTable,
  project as projectTable,
  step as stepTable,
  stopPending as stopPendingTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  applyStoppedStep,
  prepareStopForDone,
  sweepAbandonedBuildSteps,
} from '../src/services/builds.js';
import { type ChiefToolDeps, transitionTodos } from '../src/services/chief-tools.js';
import { claimStep, finishStep } from '../src/services/machines.js';
import { bootServer, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface World {
  s: TestServer;
  teamId: string;
  todoId: string;
  buildId: string;
  stepId: string;
  machineId: string;
  base: number;
}

function machineDepsOf(s: TestServer) {
  return { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir };
}

/** 一张卡 + 它的 build + 一个 plan 步；agent 绑一台在线 pi 机器，步若 pending
 *  即可被这台机器认领（claimStep 的正向控制见 6）。 */
function makeWorld(opts: {
  phase: 'queued' | 'planning' | 'building' | 'review' | 'closed';
  stepStatus: 'pending' | 'claimed' | 'done';
  stepKind?: 'plan' | 'build' | 'merge' | 'review';
  /** claimed 步的心跳 / 领取时刻距今（缺省 = 新鲜，扫尾不碰）。 */
  claimedAgo?: number;
  machineOnline?: boolean;
}): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  const teamId = s.team.id;
  const suffix = Math.random().toString(36).slice(2);
  const todoId = `todo-${suffix}`;
  const buildId = `build-${suffix}`;
  const stepId = `step-${suffix}`;
  const machineId = `machine-${suffix}`;
  s.db
    .insert(projectTable)
    .values({ id: `proj-${suffix}`, name: 'close', teamId })
    .run();
  s.db
    .insert(machineTable)
    .values({
      id: machineId,
      teamId,
      name: machineId,
      online: opts.machineOnline ?? true,
      maxConcurrent: 8,
      enabledRuntimes: ['pi'],
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: `agent-${suffix}`,
      teamId,
      displayName: 'close-agent',
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
      projectId: `proj-${suffix}`,
      title: 'close target',
      phase: opts.phase,
      phaseAt: base,
      seqNum: 1,
      assignment: { plan: { agentId: `agent-${suffix}` }, build: { agentId: `agent-${suffix}` } },
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
      triggerSource: 'user',
      createdAt: base - 60_000,
    })
    .run();
  const claimedAt = base - (opts.claimedAgo ?? 1_000);
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: opts.stepKind ?? 'plan',
      status: opts.stepStatus,
      ...(opts.stepStatus === 'claimed'
        ? { machineId, claimedAt, lastHeartbeatAt: claimedAt }
        : {}),
      createdAt: base - 60_000,
    })
    .run();
  return { s, teamId, todoId, buildId, stepId, machineId, base };
}

const chiefActor = { kind: 'agent' as const, name: '总管' };
const chiefDepsOf = (w: World) => ({ ...w.s.svc, box: w.s.secretBox }) as unknown as ChiefToolDeps;
const stepStatus = (w: World) =>
  w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!.status;
const todoPhase = (w: World) =>
  w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!.phase;
const claim = (w: World) =>
  claimStep(machineDepsOf(w.s), w.machineId, w.teamId, 10, 'http://localhost');

describe('#1445 关闭 queued 卡即停 pending 步', () => {
  test('close_todos（chief / MCP 同漏斗）：步 stopped，机器领不到', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    const out = transitionTodos(chiefDepsOf(w), w.teamId, [w.todoId], 'closed', chiefActor);
    expect(out.transitioned).toEqual([w.todoId]);
    expect(todoPhase(w)).toBe('closed');
    // 主症状先断：在线归属机对一张已关卡领不到任何步。
    expect(await claim(w)).toBeNull();
    expect(stepStatus(w)).toBe('stopped');
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!.errorMessage,
    ).toBe(STOP_MESSAGE);
  });

  test('PATCH phase=closed：步 stopped，机器领不到', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'closed' });
    expect(res.status).toBe(200);
    expect(todoPhase(w)).toBe('closed');
    expect(await claim(w)).toBeNull();
    expect(stepStatus(w)).toBe('stopped');
  });
});

describe('#1445 关闭在跑的卡（claimed 步）', () => {
  test('委托停：stopPending 就位 + 机器收到 stop；回报 stopped 后卡仍是 closed', () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    const events: { type: string }[] = [];
    w.s.machineHub.subscribe(w.teamId, (ev) => {
      if ('type' in ev) events.push(ev as { type: string });
    });
    const out = transitionTodos(chiefDepsOf(w), w.teamId, [w.todoId], 'closed', chiefActor);
    expect(out.transitioned).toEqual([w.todoId]);
    const pending = w.s.db.select().from(stopPendingTable).all();
    expect(pending.map((p) => p.stepId)).toEqual([w.stepId]);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
    // 机器回报 done(stopped) 的落账面：不按 gate 回落把卡翻回 todo。
    applyStoppedStep(w.s.svc, w.stepId);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('closed');
  });
});

describe('#1445 失联扫尾不放过已关卡的步', () => {
  test('存量：已关卡还挂着 pending 步 → 扫尾停掉；未关的 queued 卡不动（控制组）', async () => {
    const zombie = makeWorld({ phase: 'closed', stepStatus: 'pending' });
    sweepAbandonedBuildSteps(zombie.s.svc, zombie.base);
    expect(stepStatus(zombie)).toBe('stopped');
    expect(todoPhase(zombie)).toBe('closed');
    expect(await claim(zombie)).toBeNull();

    const live = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    sweepAbandonedBuildSteps(live.s.svc, live.base);
    expect(stepStatus(live)).toBe('pending');
    expect(await claim(live)).not.toBeNull(); // 正向控制：这套世界里 pending 步确实可领
  });

  test('已关卡的失联 claimed 步：停掉，不释放回 pending', () => {
    const w = makeWorld({
      phase: 'closed',
      stepStatus: 'claimed',
      claimedAgo: 60 * 60_000,
      machineOnline: false,
    });
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('closed');
  });
});

describe('#1445 关卡清掉在途的 stop-and-done 预定', () => {
  test('预定 done 在途时关卡：回报落账后卡仍是 closed', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    expect(prepareStopForDone(w.s.svc, w.todoId)).toEqual({ state: 'stopping' });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'closed' });
    expect(res.status).toBe(200);
    applyStoppedStep(w.s.svc, w.stepId);
    expect(todoPhase(w)).toBe('closed');
  });
});

describe('#1447 / #1486 raw PATCH 不能把 queued 卡挪回待开始', () => {
  test('queued → todo：409 指向 /reset，卡与 pending 步原样', async () => {
    // #1447 曾让这条 PATCH 停步并落 todo；#1486 起已开始的卡只能经 /reset 挪回。
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'todo' });
    expect(res.status).toBe(409);
    expect(todoPhase(w)).toBe('queued');
    expect(stepStatus(w)).toBe('pending');
  });

  test('控制组：不改相位的 PATCH（含同相位 queued）不碰 pending 步', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    for (const body of [{ title: 'renamed' }, { phase: 'queued' }]) {
      const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, body);
      expect(res.status).toBe(200);
    }
    expect(todoPhase(w)).toBe('queued');
    expect(stepStatus(w)).toBe('pending');
    expect(await claim(w)).not.toBeNull();
  });
});

describe('#1445 卡离开执行中后，停止回报不再改相位', () => {
  test('关闭后、回报前重开：回报落账不覆盖重开后的相位', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    expect(
      (await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'closed' })).status,
    ).toBe(200);
    expect(
      (await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'review' })).status,
    ).toBe(200);
    applyStoppedStep(w.s.svc, w.stepId);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('review');
  });

  test('raw PATCH planning → todo：409 指向 /reset，不发停止（#1486）', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    const events: { type: string }[] = [];
    w.s.machineHub.subscribe(w.teamId, (ev) => {
      if ('type' in ev) events.push(ev as { type: string });
    });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'todo' });
    expect(res.status).toBe(409);
    expect(w.s.db.select().from(stopPendingTable).all()).toEqual([]);
    expect(events.some((e) => e.type === 'stop')).toBe(false);
    expect(todoPhase(w)).toBe('planning');
  });
});

describe('#1451 把执行中的卡标完成也停活动步', () => {
  const stopEvents = (w: World) => {
    const events: { type: string }[] = [];
    w.s.machineHub.subscribe(w.teamId, (ev) => {
      if ('type' in ev) events.push(ev as { type: string });
    });
    return events;
  };

  test('raw PATCH queued → done：步 stopped，机器领不到', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'done' });
    expect(res.status).toBe(200);
    expect(todoPhase(w)).toBe('done');
    expect(await claim(w)).toBeNull();
    expect(stepStatus(w)).toBe('stopped');
  });

  test('raw PATCH planning → done：委托停 claimed 步，回报后卡仍是 done', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    const events = stopEvents(w);
    const res = await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase: 'done' });
    expect(res.status).toBe(200);
    expect(
      w.s.db
        .select()
        .from(stopPendingTable)
        .all()
        .map((p) => p.stepId),
    ).toEqual([w.stepId]);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
    applyStoppedStep(w.s.svc, w.stepId);
    expect(todoPhase(w)).toBe('done');
  });

  test('complete_todos 标 building 卡完成：委托停 claimed 步，回报后卡仍是 done', () => {
    const w = makeWorld({ phase: 'building', stepStatus: 'claimed', stepKind: 'build' });
    const events = stopEvents(w);
    const out = transitionTodos(chiefDepsOf(w), w.teamId, [w.todoId], 'done', chiefActor);
    expect(out.transitioned).toEqual([w.todoId]);
    expect(
      w.s.db
        .select()
        .from(stopPendingTable)
        .all()
        .map((p) => p.stepId),
    ).toEqual([w.stepId]);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
    applyStoppedStep(w.s.svc, w.stepId);
    expect(todoPhase(w)).toBe('done');
  });

  test('控制组：review → done（无活动步）不发停止', async () => {
    const patched = makeWorld({ phase: 'review', stepStatus: 'done', stepKind: 'build' });
    const patchEvents = stopEvents(patched);
    const res = await req(patched.s.app, 'PATCH', `/api/todos/${patched.todoId}`, {
      phase: 'done',
    });
    expect(res.status).toBe(200);
    expect(todoPhase(patched)).toBe('done');
    expect(patchEvents.some((e) => e.type === 'stop')).toBe(false);

    const completed = makeWorld({ phase: 'review', stepStatus: 'done', stepKind: 'build' });
    const completeEvents = stopEvents(completed);
    const out = transitionTodos(
      chiefDepsOf(completed),
      completed.teamId,
      [completed.todoId],
      'done',
      {
        kind: 'user',
        name: '我',
      },
    );
    expect(out.transitioned).toEqual([completed.todoId]);
    expect(completeEvents.some((e) => e.type === 'stop')).toBe(false);
    expect(completed.s.db.select().from(stopPendingTable).all()).toEqual([]);
  });
});

describe('#1451 预定丢失与失联扫尾：已完成同已关闭', () => {
  test.each(['done', 'todo'] as const)(
    'keep 预定丢失后回报到达：卡已是 %s，不被 gate 回落改写',
    (phase) => {
      const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
      // 本 build 已有一个 done 的 plan 步 → gate 回落目标 = confirm。
      w.s.db
        .insert(stepTable)
        .values({
          id: `${w.stepId}-done`,
          buildId: w.buildId,
          kind: 'plan',
          status: 'done',
          createdAt: w.base - 120_000,
        })
        .run();
      // 直写相位、不经 stopActiveStepsAfterExit = 进程重启丢了 keep 预定。
      w.s.db.update(todoTable).set({ phase }).where(eq(todoTable.id, w.todoId)).run();
      applyStoppedStep(w.s.svc, w.stepId);
      expect(stepStatus(w)).toBe('stopped');
      expect(todoPhase(w)).toBe(phase);
    },
  );

  test('已完成卡的残留 pending 步：扫尾停掉', async () => {
    const w = makeWorld({ phase: 'queued', stepStatus: 'pending' });
    w.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, w.todoId)).run();
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('done');
    expect(await claim(w)).toBeNull();
  });

  test('已完成卡的失联 claimed 步：停掉，不释放回 pending', () => {
    const w = makeWorld({
      phase: 'building',
      stepStatus: 'claimed',
      stepKind: 'build',
      claimedAgo: 60 * 60_000,
      machineOnline: false,
    });
    w.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, w.todoId)).run();
    sweepAbandonedBuildSteps(w.s.svc, w.base);
    expect(stepStatus(w)).toBe('stopped');
    expect(todoPhase(w)).toBe('done');
  });
});

describe('#1453 停止在途时步先跑完：不推进、不补排已离开执行中的卡', () => {
  const success = (extra: Partial<MachineDoneBody> = {}): MachineDoneBody => ({
    status: 'success',
    ...extra,
  });
  const report = (w: World, body: MachineDoneBody) =>
    finishStep(machineDepsOf(w.s), w.machineId, w.stepId, body);
  const withPlanDoc = (w: World) =>
    w.s.db
      .insert(planTable)
      .values({
        id: `plan-${w.buildId}`,
        buildId: w.buildId,
        content: '# plan',
        stepId: null,
        createdAt: w.base,
      })
      .run();
  const move = async (w: World, phase: string) =>
    expect((await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase })).status).toBe(200);

  test('closed 卡的 plan 步成功回报（有方案文档）：回报不抛，步 done，卡仍 closed', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    withPlanDoc(w);
    await move(w, 'closed');
    await expect(report(w, success())).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('closed');
  });

  test('done 卡的 build 步成功回报：回报不抛，卡仍 done', async () => {
    const w = makeWorld({ phase: 'building', stepStatus: 'claimed', stepKind: 'build' });
    await move(w, 'done');
    await expect(report(w, success({ hasChanges: true }))).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('done');
  });

  test('关闭后重新打开回待开始的卡的 plan 步成功回报：卡仍 todo，不进 confirm', async () => {
    // #1486 起进行中的卡不能 PATCH 回待开始；仍能落到「待开始 + 步在跑」的路
    // 是先关闭、再重新打开（closed → todo）。
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    withPlanDoc(w);
    await move(w, 'closed');
    await move(w, 'todo');
    await expect(report(w, success())).resolves.toBeUndefined();
    expect(todoPhase(w)).toBe('todo');
  });

  test('closed 卡的 plan 步成功回报（无方案文档）：不补排重写步，机器领不到', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    await move(w, 'closed');
    await expect(report(w, success())).resolves.toBeUndefined();
    const steps = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all();
    expect(steps.map((r) => r.status)).toEqual(['done']);
    expect(await claim(w)).toBeNull();
  });

  test('控制组：planning 卡的 plan 步成功回报照常进 confirm', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    withPlanDoc(w);
    await expect(report(w, success())).resolves.toBeUndefined();
    expect(todoPhase(w)).toBe('confirm');
  });
});

describe('#1453 同一竞态的其余形态', () => {
  const report = (w: World, body: MachineDoneBody) =>
    finishStep(machineDepsOf(w.s), w.machineId, w.stepId, body);
  const move = async (w: World, phase: string) =>
    expect((await req(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { phase })).status).toBe(200);
  const buildError = (w: World) =>
    w.s.db.select().from(buildTable).where(eq(buildTable.id, w.buildId)).get()!.errorMessage;

  test('closed 卡的 merge 步成功回报：回报不抛，卡仍 closed', async () => {
    const w = makeWorld({ phase: 'review', stepStatus: 'claimed', stepKind: 'merge' });
    await move(w, 'closed');
    await expect(report(w, { status: 'success' })).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('closed');
  });

  test('closed 卡的 review 步带 blocking 成功回报：回报不抛，不入队重规划', async () => {
    const w = makeWorld({ phase: 'review', stepStatus: 'claimed', stepKind: 'review' });
    await move(w, 'closed');
    const findings = {
      conclusion: 'blocking',
      findings: [{ id: '1', severity: 'blocking' as const, summary: 'x' }],
    };
    await expect(report(w, { status: 'success', findings })).resolves.toBeUndefined();
    expect(todoPhase(w)).toBe('closed');
    const steps = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, w.buildId)).all();
    expect(steps.map((r) => r.status)).toEqual(['done']);
  });

  test('done 卡的 build 步零改动成功回报：步 done，不被产物闸记成失败', async () => {
    const w = makeWorld({ phase: 'building', stepStatus: 'claimed', stepKind: 'build' });
    await move(w, 'done');
    await expect(report(w, { status: 'success', hasChanges: false })).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(buildError(w)).toBeNull();
    expect(todoPhase(w)).toBe('done');
  });

  test('关卡后重开并重跑（新 build）：旧 build 的步迟到成功不推进卡', async () => {
    const w = makeWorld({ phase: 'planning', stepStatus: 'claimed' });
    w.s.db
      .insert(planTable)
      .values({ id: `plan-${w.buildId}`, buildId: w.buildId, content: '# plan', createdAt: w.base })
      .run();
    await move(w, 'closed');
    // 重开 + 重跑 = 新 build 成为 latest，卡回到 planning。
    w.s.db
      .insert(buildTable)
      .values({
        id: `${w.buildId}-rerun`,
        todoId: w.todoId,
        withPlan: true,
        prevPhase: 'todo',
        triggerSource: 'user',
        createdAt: w.base,
      })
      .run();
    w.s.db
      .update(todoTable)
      .set({ phase: 'planning', latestBuildId: `${w.buildId}-rerun` })
      .where(eq(todoTable.id, w.todoId))
      .run();
    await expect(report(w, { status: 'success' })).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('planning');
  });

  test('stop-and-done 预定 done 在途时 build 步先跑完：卡落 done，不进 review', async () => {
    const w = makeWorld({ phase: 'building', stepStatus: 'claimed', stepKind: 'build' });
    const res = await req(w.s.app, 'POST', `/api/todos/${w.todoId}/stop-and-done`, {});
    expect(res.status).toBe(200);
    expect(todoPhase(w)).toBe('building');
    await expect(report(w, { status: 'success', hasChanges: true })).resolves.toBeUndefined();
    expect(stepStatus(w)).toBe('done');
    expect(todoPhase(w)).toBe('done');
  });
});
