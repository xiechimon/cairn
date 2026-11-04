import type { ClaimedStep } from '@cairn/shared';
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

async function enrollMachine(s: TestServer, teamId: string): Promise<string> {
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId, name: 'sweep-mbp', cliVersion: '0.1.0' },
  });
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function claimStep(s: TestServer, token: string): Promise<ClaimedStep> {
  const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const body = (await res.json()) as { step: ClaimedStep | null };
  if (!body.step) throw new Error('no step claimed');
  return body.step;
}

function setMachineOnline(s: TestServer, machineId: string, online: boolean): void {
  s.db.update(machineTable).set({ online }).where(eq(machineTable.id, machineId)).run();
}

function bindChiefAgent(s: TestServer, machineId: string): void {
  s.db.update(agentTable).set({ machineId }).where(eq(agentTable.id, AGENT_ID)).run();
}

function chiefAgentRowOf(s: TestServer) {
  return s.db.select().from(agentTable).where(eq(agentTable.id, AGENT_ID)).get()!;
}

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

function turnErrorRow(w: World) {
  return w.s.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.id, `chief-err-${w.stepId}`))
    .get();
}

describe('#684 chief lost-contact timeout fallback (sweepAbandonedChiefSteps)', () => {
  test('pending past age + zero online machines: suspended waiting for a machine (#1257: no death verdict, activeRun kept, zero failure trace)', async () => {
    const w = await sendChiefTurn();
    const { events } = tapConvStream(w.s, w.threadId);
    expect(threadRowOf(w).activeRun).not.toBeNull();

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + CHIEF_ABANDONED_STEP_MS * 10);

    expect(stepRowOf(w).status).toBe('pending');
    const thread = threadRowOf(w);
    expect(thread.activeRun).not.toBeNull();
    expect(turnErrorRow(w)).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  test('pending not past age -> untouched (no row, activeRun kept)', async () => {
    const w = await sendChiefTurn();
    sweepAbandonedChiefSteps(w.s.svc, w.sentAt + 30_000);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
    expect(threadRowOf(w).activeRun).not.toBeNull();
  });

  test('pending past age but machine online -> not falsely killed (legal queueing)', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const machineId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, machineId, true);
    sweepAbandonedChiefSteps(w.s.svc, w.sentAt + CHIEF_ABANDONED_STEP_MS * 5);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('claimed + machine offline + stale heartbeat timed out -> released back to pending (#1257: not killed when unreachable, machine returning resumes the turn)', async () => {
    const w = await sendChiefTurn();
    const token = await enrollMachine(w.s, w.teamId);
    bindChiefAgent(w.s, w.s.db.select().from(machineTable).limit(1).all()[0]!.id);
    const claimed = await claimStep(w.s, token);
    expect(claimed.step.id).toBe(w.stepId);
    setMachineOnline(w.s, claimed.step.machineId!, false);
    const { events } = tapConvStream(w.s, w.threadId);
    const woken = w.s.svc.machineHub.waitWake(w.teamId, 50);
    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).lastHeartbeatAt! + CHIEF_ABANDONED_STEP_MS + 1);

    const row = stepRowOf(w);
    expect(row.status).toBe('pending');
    expect(row.machineId).toBeNull();
    expect(threadRowOf(w).activeRun).not.toBeNull();
    expect(turnErrorRow(w)).toBeUndefined();
    const ev = events.find(
      (e): e is { type: string; step: unknown } => (e as { type?: string }).type === 'step',
    );
    if (ev === undefined) throw new Error('no step event on the conversation stream');
    expect((ev.step as { status: string }).status).toBe('pending');
    await expect(woken).resolves.toBe(true);
  });

  test('claimed + machine offline but fresh heartbeat -> untouched (reconnect window)', async () => {
    const w = await sendChiefTurn();
    const token = await enrollMachine(w.s, w.teamId);
    bindChiefAgent(w.s, w.s.db.select().from(machineTable).limit(1).all()[0]!.id);
    const claimed = await claimStep(w.s, token);
    setMachineOnline(w.s, claimed.step.machineId!, false);
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

  test('#1257 home machine offline + another machine online + past age: turn suspended waiting for a machine (no death verdict, no silent reassignment)', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    bindChiefAgent(w.s, pinnedId);
    await enrollMachine(w.s, w.teamId);
    const otherId = w.s.db
      .select()
      .from(machineTable)
      .all()
      .find((m) => m.id !== pinnedId)!.id;
    setMachineOnline(w.s, otherId, true);

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 700_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(threadRowOf(w).activeRun).not.toBeNull();
    expect(chiefAgentRowOf(w.s).machineId).toBe(pinnedId);
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('home machine offline: untouched (suspended waiting for a machine, machine returning resumes it)', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    bindChiefAgent(w.s, pinnedId);

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 60_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('home machine online -> untouched (turn waits for it to claim)', async () => {
    const w = await sendChiefTurn();
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    bindChiefAgent(w.s, pinnedId);

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 3_000_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('worker step past age with zero online -> not in this sweep surface (scope = chief)', async () => {
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

  test('scheduler tick wiring: tick(now) drives the sweep (real host path; #1257 suspension does not decide death)', async () => {
    const w = await sendChiefTurn();
    const scheduler = createScheduler(w.s.svc, { tickMs: 60_000 });
    scheduler.tick(stepRowOf(w).createdAt + CHIEF_ABANDONED_STEP_MS * 10);
    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
    scheduler.stop();
  });
});

describe('#881 home machine online but blocked by the runtime gate (sweepAbandonedChiefSteps, #1257 suspension semantics)', () => {
  test('home machine online + gate blocked (claude-code tier x pi-only machine) + past age: turn suspended waiting for a machine (#1257: no death verdict, resumes after runtime enabled)', async () => {
    const w = await sendChiefTurn('你好', 'claude-code');
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    bindChiefAgent(w.s, pinnedId);
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
    expect(threadRowOf(w).activeRun).not.toBeNull();
    expect(chiefAgentRowOf(w.s).machineId).toBe(pinnedId);
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('home machine online + gate blocked: untouched (runtime flag PATCH writes hot, enabling resumes it)', async () => {
    const w = await sendChiefTurn('你好', 'claude-code');
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    bindChiefAgent(w.s, pinnedId);

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 60_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });

  test('home machine online + runtime on: untouched (turn waits for it to claim, gate counterexample)', async () => {
    const w = await sendChiefTurn('你好', 'claude-code');
    await enrollMachine(w.s, w.teamId);
    const pinnedId = w.s.db.select().from(machineTable).limit(1).all()[0]!.id;
    setMachineOnline(w.s, pinnedId, true);
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: ['pi', 'claude-code'] })
      .where(eq(machineTable.id, pinnedId))
      .run();
    bindChiefAgent(w.s, pinnedId);

    sweepAbandonedChiefSteps(w.s.svc, stepRowOf(w).createdAt + 3_000_000);

    expect(stepRowOf(w).status).toBe('pending');
    expect(turnErrorRow(w)).toBeUndefined();
  });
});
