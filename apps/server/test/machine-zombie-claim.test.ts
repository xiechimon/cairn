// #1065 僵尸认领：claim 长轮询 hold 中请求方死亡（daemon 被杀 → 连接断）后，
// 服务端遗留的 waitWake 不得替死机跑第二次 tryClaim。#1025 探针实测窗口 ≤75s
// （新步入队 wake → 死机 waiter 先醒先领 → 步落死机、响应无处投递 → 卡到
// sweep 失败收尾），机理与实栈复现配方 = docs/verify/1025/README.md。
// 失败方式（先于实现固化，仓测试纪律）：
// 1. 死机认领（主症状）：hold 中请求 abort → 新步入队 wake → 僵尸 waiter 续跑
//    领给死机。修后 claim 返 null、步留 pending、活机照领。
// 2. 醒后断（竞序变体）：wake 先 resolve、abort 后到 → waitWake 已 settle，
//    拦截只剩 claimStep 出口的 abort 复查——两个挂点缺一即漏。
// 3. waiter 残留：abort 后 waitWake 不得占位到 hold 到期（≤75s）——abort 即
//    settle(false) 并摘除 waiter（观察面 = claim 在 abort 后即时返回）。
// 4. 首领窗口：请求到达时连接已死 → 第一次 tryClaim 同样不得领（响应无处
//    投递的孤儿窗口同型）。
// 5. 活机误伤：signal 未 abort 时 wake/timeout 两路径行为不变——只测拒绝侧
//    等于没测。
// 6. 路由接线缺失：service 修了但路由不透传请求 signal → 生产面无效（生产
//    触发面 = @hono/node-server 连接断时 abort Request signal；测试同构最小
//    形 = app.request + 自带 signal 的 Request）。

import { machineClaimResponseSchema, machineEnrollResponseSchema } from '@pacman/shared';
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
import { claimStep } from '../src/services/machines.js';
import { bootServer, issueApiKey, postProject, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

/** 远超断言窗：abort 生效与否决定 claim 是即时返回（修后）还是挂满 hold（旧
 * 行为 = 测试内永不返回，settleSoon 报红而非干等 5s）。 */
const HOLD_MS = 5_000;

/** settle 哨兵：claim 必须在 ms 内返回，否则红（僵尸 waiter 挂满 hold 的可观察面）。 */
async function settleSoon<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}（${ms}ms 内未返回）`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer);
  }
}

interface World {
  s: TestServer;
  teamId: string;
  buildId: string;
  /** 死机（hold 中请求 abort 的认领方）。 */
  machineAId: string;
  /** 活机（双向验收的领侧观察者）。 */
  machineBId: string;
  /** 入队新 pending 步 + 唤醒（生产 = enqueue → wake 同一同步轮，02 §5.4）。 */
  enqueueStep(): string;
  /** 只插行不唤醒（钉 timeout 路径：hold 到期重试第二次 tryClaim 的旧语义）。 */
  insertStep(): string;
}

// 机器行恒 online = true：#1065 判据绑**请求存活态**而非 machine.online 位——
// daemon 被杀后 SSE onAbort 的 markOffline 与 claim 长轮询是异步竞速，且
// tryClaim 本就不消费 online 位（旧代码死机也能领，正是本票现象）。
function makeWorld(): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const base = Date.now();
  const suffix = Math.random().toString(36).slice(2);
  const teamId = s.team.id;
  const buildId = `build-${suffix}`;
  const machineAId = `machine-a-${suffix}`;
  const machineBId = `machine-b-${suffix}`;
  for (const [id, name] of [
    [machineAId, 'dead-daemon'],
    [machineBId, 'live-daemon'],
  ] as const) {
    s.db
      .insert(machineTable)
      .values({ id, teamId, name, online: true, enabledRuntimes: ['pi'] })
      .run();
  }
  // #1259：agent 绑活机 B——A（死机位）在归属机闸下恒不可见，abort 语义
  // 的测试对象改为「B 自己的请求死了不得替它领」。
  s.db
    .insert(agentTable)
    .values({
      id: `agent-${suffix}`,
      teamId,
      displayName: 'zombie-agent',
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: machineBId,
    })
    .run();
  s.db
    .insert(projectTable)
    .values({ id: `proj-${suffix}`, name: 'zombie', teamId })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: `todo-${suffix}`,
      teamId,
      projectId: `proj-${suffix}`,
      title: 'zombie target',
      phase: 'building',
      phaseAt: base,
      seqNum: 1,
      assignment: { plan: null, build: { agentId: `agent-${suffix}` } },
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId: `todo-${suffix}`,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base - 600_000,
    })
    .run();
  let seq = 0;
  const insert = () => {
    const id = `step-${suffix}-${seq}`;
    seq += 1;
    s.db
      .insert(stepTable)
      .values({
        id,
        buildId,
        kind: 'build',
        status: 'pending',
        machineId: null,
        createdAt: base + seq,
      })
      .run();
    return id;
  };
  return {
    s,
    teamId,
    buildId,
    machineAId,
    machineBId,
    enqueueStep: () => {
      const id = insert();
      s.machineHub.wake(teamId);
      return id;
    },
    insertStep: insert,
  };
}

function machineDepsOf(w: World) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
  };
}

function stepRow(w: World, id: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, id)).get()!;
}

describe('#1065 僵尸认领（service 面：claimStep 绑请求存活态）', () => {
  test('hold 中 abort → 新步入队 wake：死请求不领，步留 pending，归属机新请求照领', async () => {
    const w = makeWorld();
    const ctrl = new AbortController();
    // #1259：abort 语义打在合格机器（归属机 B）自己身上才有牙——A 在归属机
    // 闸下本就恒不可见，拿它测不到 abort 面。
    const claim = claimStep(
      machineDepsOf(w),
      w.machineBId,
      w.teamId,
      HOLD_MS,
      'http://localhost',
      ctrl.signal,
    );
    await Promise.resolve(); // 第一次 tryClaim（无步）+ waiter 注册已同步完成
    ctrl.abort(); // daemon 被杀 = 连接断 = 请求 signal abort
    const stepId = w.enqueueStep();
    const out = await settleSoon(
      claim,
      300,
      'claim 未随 abort 即时返回（waiter 残留到 hold 到期）',
    );
    expect(out).toBeNull();
    const row = stepRow(w, stepId);
    expect(row.machineId).toBeNull(); // 步没被死机领走
    expect(row.status).toBe('pending');
    // 活侧：同一步由不带 signal 的新请求照领（双向验收）；别机（A）恒空手
    // （归属机闸，附证）。
    const foreign = await settleSoon(
      claimStep(machineDepsOf(w), w.machineAId, w.teamId, 10, 'http://localhost'),
      1_000,
      '别机 claim 未返回',
    );
    expect(foreign).toBeNull();
    const live = await settleSoon(
      claimStep(machineDepsOf(w), w.machineBId, w.teamId, 10, 'http://localhost'),
      1_000,
      '活机 claim 未返回',
    );
    expect(live?.step.machineId).toBe(w.machineBId);
  });

  test('wake 先醒、abort 后到：claimStep 出口复查拦截，死机不领', async () => {
    const w = makeWorld();
    const ctrl = new AbortController();
    const claim = claimStep(
      machineDepsOf(w),
      w.machineBId,
      w.teamId,
      HOLD_MS,
      'http://localhost',
      ctrl.signal,
    );
    await Promise.resolve();
    const stepId = w.enqueueStep(); // wake 同步 resolve 僵尸 waiter（continuation 尚未跑）
    ctrl.abort(); // 后到：waitWake 已 settle，拦截只剩 claimStep 出口复查
    const out = await settleSoon(claim, 300, 'claim 未在 wake+abort 后返回');
    expect(out).toBeNull();
    expect(stepRow(w, stepId).machineId).toBeNull();
  });

  test('请求到达时已死（首领窗口）：不 tryClaim，直接空手', async () => {
    const w = makeWorld();
    const ctrl = new AbortController();
    ctrl.abort();
    const stepId = w.enqueueStep();
    const out = await claimStep(
      machineDepsOf(w),
      w.machineBId,
      w.teamId,
      10,
      'http://localhost',
      ctrl.signal,
    );
    expect(out).toBeNull();
    expect(stepRow(w, stepId).machineId).toBeNull();
  });

  test('活机带未 abort 的 signal：wake 即领（拒绝侧不误伤领侧）', async () => {
    const w = makeWorld();
    const ctrl = new AbortController();
    const claim = claimStep(
      machineDepsOf(w),
      w.machineBId,
      w.teamId,
      HOLD_MS,
      'http://localhost',
      ctrl.signal,
    );
    await Promise.resolve();
    w.enqueueStep();
    const out = await settleSoon(claim, 300, '活机 claim 未随 wake 返回');
    expect(out?.step.machineId).toBe(w.machineBId);
  });

  test('无 signal / hold 到期：第二次 tryClaim 照跑（r3 §1.5 旧语义不变）', async () => {
    const w = makeWorld();
    const claim = claimStep(machineDepsOf(w), w.machineBId, w.teamId, 20, 'http://localhost');
    await Promise.resolve();
    const stepId = w.insertStep(); // 不唤醒：只有 hold 到期的重试能看到它
    const out = await settleSoon(claim, 1_000, 'timeout 路径未返回');
    expect(out?.step.machineId).toBe(w.machineBId);
    expect(stepRow(w, stepId).status).toBe('claimed');
  });
});

describe('#1065 路由接线（claim 路由透传请求 signal）', () => {
  test('hold 中连接断 → 新步入队：死机路由不领，活机路由照领', async () => {
    const s = bootServer({ claimHoldMs: HOLD_MS });
    disposables.push(() => s.dispose());
    s.db
      .insert(agentTable)
      .values({
        id: 'agent-route',
        teamId: s.team.id,
        displayName: 'route-agent',
        provider: 'stub-gw',
        modelId: 'stub-model',
      })
      .run();
    // 两台机各用一把 key（同 key 重注册 = 同 machineId，r3 §1.2）。
    const enroll = async (name: string) => {
      const key = await issueApiKey(s);
      const res = await s.app.request('/api/machine/enroll', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: s.team.id, name, cliVersion: '0.1.0' }),
      });
      expect(res.status).toBe(200);
      return machineEnrollResponseSchema.parse(await res.json());
    };
    const _machineA = await enroll('dead-daemon');
    const machineB = await enroll('live-daemon');
    // #1259：agent 绑 B（合格机）——abort 语义打在 B 自己的死请求上；A 在
    // 归属机闸下恒不可见，留作「别机空手」附证。
    const projectId = await postProject(s.app);
    const todoRes = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: '路由接线目标',
      spec: '写一行探针到 README.md',
    });
    const todoId = ((await todoRes.json()) as { id: string }).id;

    // 合格机先发 claim（挂起在 hold 上，无 pending 步），随后它的连接死。
    s.db
      .update(agentTable)
      .set({ machineId: machineB.machineId })
      .where(eq(agentTable.id, 'agent-route'))
      .run();
    const ctrl = new AbortController();
    const claimReq = new Request('http://localhost/api/machine/tasks/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${machineB.token}`, 'content-type': 'application/json' },
      body: '{}',
      signal: ctrl.signal,
    });
    const resPromise = Promise.resolve(s.app.request(claimReq));
    await Promise.resolve(); // 路由已进入 claimStep 的 waitWake
    ctrl.abort(); // 连接断（生产 = node-server 对 Request signal abort）
    // 新步入队（首步 kind=plan + wake 同一同步轮）。
    const buildRes = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId: 'agent-route' }, build: { agentId: 'agent-route' } },
      withPlan: true,
    });
    expect(buildRes.status).toBe(201);
    const res = await settleSoon(resPromise, 300, '路由 claim 未随 abort 即时返回');
    expect(res.status).toBe(200);
    const body = machineClaimResponseSchema.parse(await res.json());
    expect(body.step).toBeNull(); // 死请求的长轮询没替它把首步领走

    // 活侧：B 的新请求照领（双向验收）。
    const claimB = await settleSoon(
      Promise.resolve(
        s.app.request('/api/machine/tasks/claim', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${machineB.token}`,
            'content-type': 'application/json',
          },
          body: '{}',
        }),
      ),
      1_000,
      '活机路由 claim 未返回',
    );
    expect(claimB.status).toBe(200);
    const bodyB = machineClaimResponseSchema.parse(await claimB.json());
    expect(bodyB.step?.step.machineId).toBe(machineB.machineId);
  });
});
