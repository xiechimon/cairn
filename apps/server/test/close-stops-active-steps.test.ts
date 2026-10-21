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

import { STOP_MESSAGE } from '@pacman/shared';
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
import { applyStoppedStep, sweepAbandonedBuildSteps } from '../src/services/builds.js';
import { type ChiefToolDeps, transitionTodos } from '../src/services/chief-tools.js';
import { claimStep } from '../src/services/machines.js';
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
  phase: 'queued' | 'planning' | 'closed';
  stepStatus: 'pending' | 'claimed';
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
      kind: 'plan',
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
