// #684 失联超时兜底（chief 步无人认领 / 执行机失联的可见性面）：
// #631 只闭环了「认领后失败」路径；daemon 死亡后 pending 步永挂、claimed 步
// 心跳停更永挂——线程 activeRun 卡死、零反馈（用户实测：10-03 零回复零 toast）。
// 本文件钉 sweep 判定的全部边界：超龄 × 机器在线态 × 步状态 × 步 kind，
// 以及落库行/会话流事件与 #631 链的对接形状（chief_turn_error → toast）。
// 机器在线位直写 DB（生产置位路径 wake SSE 断连面归 machine-wire 测试）。

import type { ClaimedStep } from '@pacman/shared';
import { chiefTurnErrorContentSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  chiefMessage,
  chief as chiefTable,
  chiefThread,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { CHIEF_ABANDONED_STEP_MS, failAbandonedChiefSteps } from '../src/services/chief.js';
import { PIN_OFFLINE_GRACE_MS } from '../src/services/dispatch-timeouts.js';
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

function chiefRowOf(w: World) {
  return w.s.db.select().from(chiefTable).where(eq(chiefTable.teamId, w.teamId)).get()!;
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

function turnErrorMessage(w: World): string | null {
  const row = turnErrorRow(w);
  if (!row) return null;
  const parsed = chiefTurnErrorContentSchema.safeParse(JSON.parse(row.content as string));
  return parsed.success ? parsed.data.message : null;
}

describe('#684 chief 失联超时兜底（failAbandonedChiefSteps）', () => {
  test('pending 超龄 + 零在线机器：全链落位（步 failed + chief_turn_error 行 + activeRun 清 + 会话流 message 事件）', async () => {
    const w = await sendChiefTurn();
    const { events } = tapConvStream(w.s, w.threadId);
    expect(threadRowOf(w).activeRun).not.toBeNull(); // 发送后回合挂起

    // 锚步自身 createdAt（sentAt 取样早于落库数毫秒，直接用会被阈值余量吃掉）。
    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + CHIEF_ABANDONED_STEP_MS + 1);

    expect(stepRowOf(w).status).toBe('failed');
    const thread = threadRowOf(w);
    expect(thread.activeRun).toBeNull(); // #631 收尾语义：回合不再卡「进行中」
    expect(thread.lastTurnAt).not.toBeNull();
    const message = turnErrorMessage(w);
    expect(message).not.toBeNull();
    expect(message).toContain('没有在线机器'); // 失败原因含可操作指引
    // 会话流 message 事件携带失败行原形（web toast 挂在此事件上，#631 链）。
    const row = turnErrorRow(w)!;
    const ev = events.find(
      (e): e is { type: string; message: unknown } => (e as { type?: string }).type === 'message',
    );
    if (ev === undefined) throw new Error('no message event on the conversation stream');
    expect((ev.message as { id: string }).id).toBe(row.id);
    expect((ev.message as { role: string }).role).toBe('system');
  });

  test('pending 未超龄 → 不动（无行、activeRun 保持）', async () => {
    const w = await sendChiefTurn();
    failAbandonedChiefSteps(w.s.svc, w.sentAt + 30_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
    expect(threadRowOf(w).activeRun).not.toBeNull();
  });

  test('pending 超龄但机器在线 → 不误杀（合法排队）', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const machineId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, machineId, true);
    failAbandonedChiefSteps(w.s.svc, w.sentAt + CHIEF_ABANDONED_STEP_MS * 5);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('claimed + 机器离线 + 心跳停更超时 → 失败（daemon 中途死亡面）', async () => {
    const w = await sendChiefTurn();
    const token = await enrollMachine(w.s, w.teamId);
    const claimed = await claimStep(w.s, token);
    expect(claimed.step.id).toBe(w.stepId);
    // daemon 死亡形态：机器离线（wake SSE 断连面）+ 心跳停更（认领时刻即最后心跳）。
    setMachineOnline(w.s, claimed.step.machineId!, false);
    // 锚 claim 时刻（lastHeartbeatAt = claimedAt，均晚于 sentAt）。
    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).lastHeartbeatAt! + CHIEF_ABANDONED_STEP_MS + 1);

    expect(stepRowOf(w).status).toBe('failed');
    expect(threadRowOf(w).activeRun).toBeNull();
    expect(turnErrorMessage(w)).toContain('失联');
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
    failAbandonedChiefSteps(w.s.svc, heartbeatedAt + 30_000);
    expect(stepRowOf(w).status).toBe('claimed');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('#864 T3 钉选机器离线 + 别的机器在线 + 超宽限：回合按失败收尾，文案点名钉选机', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId); // 钉选机：注册但离线
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    w.s.db
      .update(chiefTable)
      .set({ machineId: pinnedId })
      .where(eq(chiefTable.teamId, w.teamId))
      .run();
    // 团队里另有在线机器——判据必须是「钉的那台不在」，不是「团队没机器」。
    await enrollMachine(w.s, w.teamId);
    const otherId = w.s.db
      .select()
      .from(machineTable)
      .all()
      .find((m) => m.id !== pinnedId)!.id;
    setMachineOnline(w.s, otherId, true);

    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + PIN_OFFLINE_GRACE_MS + 1);

    expect(stepRowOf(w).status).toBe('failed');
    expect(threadRowOf(w).activeRun).toBeNull();
    expect(chiefRowOf(w).machineId).toBe(pinnedId); // 不静默改派
    const message = turnErrorMessage(w);
    expect(message).toContain('归属机「sweep-mbp」');
    expect(message).toContain('离线超过 10 分钟');
  });

  test('#864 T3 钉选机器离线 + 未超宽限 → 不动（给机器回来的窗口）', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    w.s.db
      .update(chiefTable)
      .set({ machineId: pinnedId })
      .where(eq(chiefTable.teamId, w.teamId))
      .run();

    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 60_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('#864 T3 钉选机器在线 → 不动（回合等它认领）', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    w.s.db
      .update(chiefTable)
      .set({ machineId: pinnedId })
      .where(eq(chiefTable.teamId, w.teamId))
      .run();

    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + PIN_OFFLINE_GRACE_MS * 5);

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
    failAbandonedChiefSteps(w.s.svc, now);
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, 'step-worker-x')).get()!;
    expect(row.status).toBe('pending');
  });

  // #895 失败文案路由（spec 21 §与 T3 的关系）：主力机缺省链把「显式钉选」
  // 的失败路径从 todo 钉选来源扩到 chief.machineId 来源——出口必须指向真实
  // 存在的出口（T6 律：报机器 + 报修法）。
  test('#895 主力机离线超宽限的失败文案带出口（改 chief 设置的主力机）', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    w.s.db
      .update(chiefTable)
      .set({ machineId: pinnedId })
      .where(eq(chiefTable.teamId, w.teamId))
      .run();

    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + PIN_OFFLINE_GRACE_MS + 1);

    expect(stepRowOf(w).status).toBe('failed');
    const message = turnErrorMessage(w);
    expect(message).toContain('改 chief 设置的主力机');
  });

  test('scheduler tick 接线：tick(now) 驱动 sweep（真实宿主路径）', async () => {
    const w = await sendChiefTurn();
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });
    scheduler.tick(stepRowOf(w).createdAt + CHIEF_ABANDONED_STEP_MS + 1);
    expect(stepRowOf(w).status).toBe('failed');
    expect(turnErrorRow(w)).toBeDefined();
  });
});

describe('#881 钉选机器在线但 runtime 闸挡（failAbandonedChiefSteps 的钉选分支）', () => {
  // 失败方式（先于实现固化）：chief 线程钉到在线机器、但该机 enabledRuntimes
  // 不含绑定 Agent 的 runtime → buildChiefClaim 的 runtime 闸恒 false + 钉选
  // 过滤令唯有该机可见 → 回合无期 pending。#864 只收了「离线」半边。

  test('钉选在线 + 闸挡（claude-code 档 × 只开 pi 的机器）+ 超宽限：回合按失败收尾，文案点名机器与 runtime', async () => {
    const w = await sendChiefTurn('你好', 'claude-code');
    await enrollMachine(w.s, w.teamId); // 钉选机：enroll 缺省只开 pi
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    w.s.db
      .update(chiefTable)
      .set({ machineId: pinnedId })
      .where(eq(chiefTable.teamId, w.teamId))
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

    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + PIN_OFFLINE_GRACE_MS + 1);

    expect(stepRowOf(w).status).toBe('failed');
    expect(threadRowOf(w).activeRun).toBeNull();
    expect(chiefRowOf(w).machineId).toBe(pinnedId); // 不静默改派
    const message = turnErrorMessage(w);
    expect(message).toContain('归属机「sweep-mbp」');
    expect(message).toContain('claude-code');
    expect(message).toContain('改 chief 设置的主力机');
  });

  test('钉选在线 + 闸挡 + 宽限内：不动（给「正在开 runtime」留窗口）', async () => {
    const w = await sendChiefTurn('你好', 'claude-code');
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    w.s.db
      .update(chiefTable)
      .set({ machineId: pinnedId })
      .where(eq(chiefTable.teamId, w.teamId))
      .run();

    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 60_000);

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
      .update(chiefTable)
      .set({ machineId: pinnedId })
      .where(eq(chiefTable.teamId, w.teamId))
      .run();

    failAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + PIN_OFFLINE_GRACE_MS * 5);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });
});
