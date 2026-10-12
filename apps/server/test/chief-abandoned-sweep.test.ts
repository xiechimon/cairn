// #684 失联超时兜底 + #1257 无人认领挂起（chief 步的 infra 事件面）：
// #631 只闭环了「认领后失败」路径；#1257 起无人认领的 pending 回合挂起等
// 机器（机器回来走既有 claim 循环自动续跑），claimed 心跳停更且机器离线
// 释放回 pending（联系不上不杀）。本文件钉 sweep 判定的全部边界：超龄 ×
// 机器在线态 × 步状态 × 步 kind，以及落库行/会话流事件的对接形状。
// 机器在线位直写 DB（生产置位路径 wake SSE 断连面归 machine-wire 测试）。

import type { ClaimedStep } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  chiefMessage,
  chiefThread,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { CHIEF_ABANDONED_STEP_MS, sweepAbandonedChiefSteps } from '../src/services/chief.js';
import { createScheduler } from '../src/services/scheduler.js';
import { bootServer, issueApiKey, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-chief-sweep';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface World {
  s: TestServer;
  teamId: string;
  threadId: string;
  stepId: string;
  sentAt: number;
}

/** 绑定 Agent + 发一条 chief 消息 → 线程 + pending 步（机器面全部缺席）。
 *  #881：provider 可覆写（'claude-code' = runtime 闸判的反例位）。 */
async function sendChiefTurn(content = '你好', provider = 'stub-gw'): Promise<World> {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId,
      displayName: 'sweep-agent',
      description: '调度',
      modelId: 'stub-model',
      provider,
    })
    .run();
  const patchRes = await call(s.app, 'PATCH', `/api/teams/${teamId}/chief`, {
    body: { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  });
  expect(patchRes.status).toBe(200);
  const sentAt = Date.now();
  const msgRes = await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
    body: { content },
  });
  expect(msgRes.status).toBe(201);
  const { thread } = (await msgRes.json()) as { thread: { id: string } };
  const stepRow = s.db.select().from(stepTable).where(eq(stepTable.buildId, thread.id)).get()!;
  return { s, teamId, threadId: thread.id, stepId: stepRow.id, sentAt };
}

/** 注册一台机器并返回其 token（不认领、不置在线）。 */
async function enrollMachine(s: TestServer, teamId: string): Promise<string> {
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId, name: 'sweep-mbp', cliVersion: '0.1.0' },
  });
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** 认领当前 pending chief 步（真 claim 端点：置 claimed/machineId/心跳位）。 */
async function claimStep(s: TestServer, token: string): Promise<ClaimedStep> {
  const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const body = (await res.json()) as { step: ClaimedStep | null };
  if (!body.step) throw new Error('no step claimed');
  return body.step;
}

/** 机器在线位直写（sweep 的唯一消费位）。 */
function setMachineOnline(s: TestServer, machineId: string, online: boolean): void {
  s.db.update(machineTable).set({ online }).where(eq(machineTable.id, machineId)).run();
}

/** 会话流事件捕获桩（钉 web SSE 契约：message 事件携带失败行原形）。 */
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

function threadRowOf(w: World) {
  return w.s.db.select().from(chiefThread).where(eq(chiefThread.id, w.threadId)).get()!;
}

function stepRowOf(w: World) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
}

/** #631 失败行读取（id = chief-err-<stepId>，幂等 upsert 键）。 */
function turnErrorRow(w: World) {
  return w.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.id, `chief-err-${w.stepId}`))
    .get();
}

describe('#684 chief 失联超时兜底（sweepAbandonedChiefSteps）', () => {
  test('pending 超龄 + 零在线机器：挂起等机器（#1257：不判死，activeRun 保持、零失败痕迹）', async () => {
    const w = await sendChiefTurn();
    const { events } = tapConvStream(w.s, w.threadId);
    expect(threadRowOf(w).activeRun).not.toBeNull(); // 发送后回合挂起

    // 锚步自身 createdAt（sentAt 取样早于落库数毫秒，直接用会被阈值余量吃掉）。
    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + CHIEF_ABANDONED_STEP_MS * 10);

    expect(stepRowOf(w).status).toBe('pending');
    const thread = threadRowOf(w);
    expect(thread.activeRun).not.toBeNull(); // 挂起可见性由 pending 队列面承担
    expect(turnErrorRow(w)).toBeUndefined(); // 不产失败行（#1257：infra 事件）
    expect(events).toHaveLength(0); // 不推终态事件
  });

  test('pending 未超龄 → 不动（无行、activeRun 保持）', async () => {
    const w = await sendChiefTurn();
    sweepAbandonedChiefSteps(w.s.svc, w.sentAt + 30_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
    expect(threadRowOf(w).activeRun).not.toBeNull();
  });

  test('pending 超龄但机器在线 → 不误杀（合法排队）', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const machineId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, machineId, true);
    sweepAbandonedChiefSteps(w.s.svc, w.sentAt + CHIEF_ABANDONED_STEP_MS * 5);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('claimed + 机器离线 + 心跳停更超时 → 释放回 pending（#1257：联系不上不杀，机器回来续跑回合）', async () => {
    const w = await sendChiefTurn();
    const token = await enrollMachine(w.s, w.teamId);
    const claimed = await claimStep(w.s, token);
    expect(claimed.step.id).toBe(w.stepId);
    // daemon 死亡形态：机器离线（wake SSE 断连面）+ 心跳停更（认领时刻即最后心跳）。
    setMachineOnline(w.s, claimed.step.machineId!, false);
    const { events } = tapConvStream(w.s, w.threadId);
    const woken = w.s.svc.machineHub.waitWake(w.teamId, 50);
    // 锚 claim 时刻（lastHeartbeatAt = claimedAt，均晚于 sentAt）。
    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).lastHeartbeatAt! + CHIEF_ABANDONED_STEP_MS + 1);

    const row = stepRowOf(w);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull(); // 认领原子位复位，他机/本机可重领
    expect(threadRowOf(w).activeRun).not.toBeNull(); // 回合仍挂起等续跑
    expect(turnErrorRow(w)).toBeUndefined(); // 不产失败行
    // 会话流 step 事件携带 pending 态（与 worker 释放同形）+ wake 唤醒认领循环。
    const ev = events.find(
      (e): e is { type: string; step: unknown } => (e as { type?: string }).type === 'step',
    );
    if (ev === undefined) throw new Error('no step event on the conversation stream');
    expect((ev.step as { status: string }).status).toBe('pending');
    await expect(woken).resolves.toBe(true);
  });

  test('claimed + 机器离线但心跳新鲜 → 不动（重连窗口）', async () => {
    const w = await sendChiefTurn();
    const token = await enrollMachine(w.s, w.teamId);
    const claimed = await claimStep(w.s, token);
    setMachineOnline(w.s, claimed.step.machineId!, false);
    // 心跳刚打过（步运行中 daemon 仍活着——仅推送通道瞬断）。
    const heartbeatedAt = w.sentAt + 5_000;
    w.s.db
      .update(stepTable)
      .set({ lastHeartbeatAt: heartbeatedAt })
      .where(eq(stepTable.id, w.stepId))
      .run();
    sweepAbandonedChiefSteps(w.s.svc, heartbeatedAt + 30_000);
    expect(stepRowOf(w).status).toBe('claimed');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('#1257 钉选机器离线 + 别的机器在线 + 超宽限：回合挂起等机器（不判死、不静默改派）', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId); // 钉选机：注册但离线
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    w.s.db
      .update(chiefThread)
      .set({ pinnedMachineId: pinnedId })
      .where(eq(chiefThread.id, w.threadId))
      .run();
    // 团队里另有在线机器——判据必须是「钉的那台不在」，不是「团队没机器」。
    await enrollMachine(w.s, w.teamId);
    const otherId = w.s.db
      .select()
      .from(machineTable)
      .all()
      .find((m) => m.id !== pinnedId)!.id;
    setMachineOnline(w.s, otherId, true);

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 700_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(threadRowOf(w).activeRun).not.toBeNull(); // 回合挂起可见
    expect(threadRowOf(w).pinnedMachineId).toBe(pinnedId); // 不静默改派
    expect(turnErrorRow(w)).toBeUndefined(); // 不产失败行
  });

  test('#864 T3 钉选机器离线 + 未超宽限 → 不动（给机器回来的窗口）', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    w.s.db
      .update(chiefThread)
      .set({ pinnedMachineId: pinnedId })
      .where(eq(chiefThread.id, w.threadId))
      .run();

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 60_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('#864 T3 钉选机器在线 → 不动（回合等它认领）', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    w.s.db
      .update(chiefThread)
      .set({ pinnedMachineId: pinnedId })
      .where(eq(chiefThread.id, w.threadId))
      .run();

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 3_000_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('worker 步超龄零在线 → 不在本 sweep 面（scope = chief）', async () => {
    const w = await sendChiefTurn();
    const now = Date.now();
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-worker-x',
        buildId: 'build-non-chief',
        kind: 'plan',
        machineId: null,
        status: 'pending',
        prompt: 'worker task',
        createdAt: now - CHIEF_ABANDONED_STEP_MS * 5,
      })
      .run();
    sweepAbandonedChiefSteps(w.s.svc, now);
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, 'step-worker-x')).get()!;
    expect(row.status).toBe('pending');
  });

  test('scheduler tick 接线：tick(now) 驱动 sweep（真实宿主路径；#1257 挂起不判死）', async () => {
    const w = await sendChiefTurn();
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });
    scheduler.tick(stepRowOf(w).createdAt + CHIEF_ABANDONED_STEP_MS * 10);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
    scheduler.stop();
  });
});

describe('#881 钉选机器在线但 runtime 闸挡（sweepAbandonedChiefSteps 的钉选分支）', () => {
  // 失败方式（先于实现固化）：chief 线程钉到在线机器、但该机 enabledRuntimes
  // 不含绑定 Agent 的 runtime → buildChiefClaim 的 runtime 闸恒 false + 钉选
  // 过滤令唯有该机可见 → 回合无期 pending。#864 只收了「离线」半边。

  test('钉选在线 + 闸挡（claude-code 档 × 只开 pi 的机器）+ 超宽限：回合挂起等机器（#1257：不判死，开 runtime 后续跑）', async () => {
    const w = await sendChiefTurn('你好', 'claude-code');
    await enrollMachine(w.s, w.teamId); // 钉选机：enroll 缺省只开 pi
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    w.s.db
      .update(chiefThread)
      .set({ pinnedMachineId: pinnedId })
      .where(eq(chiefThread.id, w.threadId))
      .run();
    // 团队里另有能跑 claude-code 的在线机器——判据是「钉的那台开不了」。
    await enrollMachine(w.s, w.teamId);
    const otherRow = w.s.db
      .select()
      .from(machineTable)
      .all()
      .find((m) => m.id !== pinnedId)!;
    setMachineOnline(w.s, otherRow.id, true);
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['pi', 'claude-code'] })
      .where(eq(machineTable.id, otherRow.id))
      .run();

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 700_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(threadRowOf(w).activeRun).not.toBeNull(); // 回合挂起可见
    expect(threadRowOf(w).pinnedMachineId).toBe(pinnedId); // 不静默改派
    expect(turnErrorRow(w)).toBeUndefined(); // 不产失败行
  });

  test('钉选在线 + 闸挡 + 宽限内：不动（给「正在开 runtime」留窗口）', async () => {
    const w = await sendChiefTurn('你好', 'claude-code');
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    w.s.db
      .update(chiefThread)
      .set({ pinnedMachineId: pinnedId })
      .where(eq(chiefThread.id, w.threadId))
      .run();

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 60_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('钉选在线 + runtime 开：不动（回合等它认领，闸判负例）', async () => {
    const w = await sendChiefTurn('你好', 'claude-code');
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['pi', 'claude-code'] })
      .where(eq(machineTable.id, pinnedId))
      .run();
    w.s.db
      .update(chiefThread)
      .set({ pinnedMachineId: pinnedId })
      .where(eq(chiefThread.id, w.threadId))
      .run();

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 3_000_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });
});
