import {
  CHIEF_TURN_ERROR_KIND,
  type ClaimedStep,
  coordinatorCompactResponseSchema,
  coordinatorContextResponseSchema,
  type MachineDoneBody,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import {
  chiefMessage,
  chiefThread,
  chiefTurnUsage,
  machine as machineTable,
  step as stepTable,
  stopPending,
  tokenUsage,
} from '../src/db/schema.js';
import { enqueueChiefStep } from '../src/services/chief.js';
import {
  CHIEF_COMPACT_MAX_MS,
  CHIEF_COMPACTION,
  IDLE_COMPACTION_DEFAULTS,
  planIdleCompactions,
  sweepOverlongCompactions,
} from '../src/services/chief-compaction.js';
import {
  ASK_PARK_MS,
  createOrGetQuestion,
  holdForQuestion,
} from '../src/services/chief-questions.js';
import {
  CHIEF_TURN_MAX_MS,
  steerChiefMessage,
  sweepOverlongChiefTurns,
} from '../src/services/chief-turns.js';
import { claimStep } from '../src/services/machine-claim.js';
import { finishStep } from '../src/services/machines.js';
import { H, registerChiefHarness, toolDeps } from './chief-harness.js';
import { bindAllAgents, insertMachine, req } from './helpers.js';

registerChiefHarness();

const SESSION = 'pi-session-1';
const T0 = Date.now() - 3_600_000;
const IDLE = IDLE_COMPACTION_DEFAULTS.idleMs;

function deps() {
  return {
    ...H.s.svc,
    box: H.s.secretBox,
    reposDir: H.s.reposDir,
    attachmentsDir: H.s.attachmentsDir,
  };
}

function world(features: string[] = ['chief-compact']): string {
  const machineId = insertMachine(H.s);
  H.s.db
    .update(machineTable)
    .set({ capabilities: { mcpServers: [], skills: [], features } })
    .where(eq(machineTable.id, machineId))
    .run();
  bindAllAgents(H.s, machineId);
  H.s.db
    .update(chiefThread)
    .set({ sessionId: SESSION, lastTurnAt: T0 })
    .where(eq(chiefThread.id, H.threadId))
    .run();
  message('m-1', 'user', 'status of the billing migration?', T0 - 2000);
  message('m-2', 'assistant', 'It runs on build-07.', T0 - 1000);
  turnUsage('turn-1', 50_000, T0);
  return machineId;
}

function message(id: string, role: 'user' | 'assistant', content: string, at: number): void {
  H.s.db
    .insert(chiefMessage)
    .values({ id, threadId: H.threadId, role, content, createdAt: at })
    .run();
}

function turnUsage(stepId: string, contextTokens: number, at: number): void {
  H.s.db
    .insert(chiefTurnUsage)
    .values({
      stepId,
      threadId: H.threadId,
      model: 'stub-gw/stub-model',
      input: 1000,
      output: 200,
      cacheRead: 9000,
      cacheWrite: 0,
      contextTokens,
      createdAt: at,
    })
    .run();
}

function threadRow() {
  const row = H.s.db.select().from(chiefThread).where(eq(chiefThread.id, H.threadId)).get();
  if (row === undefined) throw new Error('thread missing');
  return row;
}

function chiefSteps() {
  return H.s.db.select().from(stepTable).where(eq(stepTable.buildId, H.threadId)).all();
}

function liveCompactions() {
  return chiefSteps().filter(
    (row) => row.compactOnly && ['pending', 'claimed'].includes(row.status),
  );
}

async function claim(machineId: string): Promise<ClaimedStep | null> {
  return claimStep(toolDeps(), machineId, H.teamId, 0, 'http://localhost');
}

const compacted = (over: Partial<MachineDoneBody> = {}): MachineDoneBody => ({
  status: 'success',
  sessionId: SESSION,
  usage: [{ model: 'stub-gw/stub-model', input: 40_000, output: 900, cacheRead: 0, cacheWrite: 0 }],
  compaction: { compacted: true, tokensBefore: 50_000, tokensAfter: 18_000, summaryTokens: 1500 },
  ...over,
});

async function idleCompactionClaimed(machineId: string): Promise<ClaimedStep> {
  planIdleCompactions(H.s.svc, T0 + IDLE + 1);
  const claimed = await claim(machineId);
  if (claimed === null) throw new Error('nothing claimed');
  return claimed;
}

async function sendMessage(content: string): Promise<string> {
  const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/messages`, {
    content,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: { id: string } }).message.id;
}

describe('idle compaction picks idle Coordinator threads near the threshold', () => {
  test('an idle thread inside the cache window gets one compaction-only step', async () => {
    const machineId = world();
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    planIdleCompactions(H.s.svc, T0 + IDLE + 2);
    expect(liveCompactions()).toHaveLength(1);
    const claimed = await claim(machineId);
    expect(claimed).toMatchObject({
      session: { action: 'continue', sessionId: SESSION },
      chief: { threadId: H.threadId, compactOnly: true, compaction: CHIEF_COMPACTION },
      remoteTools: [],
    });
    expect(claimed?.instruction).toBeUndefined();
    expect(threadRow().activeRun).toBeNull();
  });

  test.each([
    ['before the idle delay', T0 + IDLE - 1],
    ['after the cache window', T0 + IDLE_COMPACTION_DEFAULTS.cacheWindowMs + 1],
  ])('nothing is planned %s', (_label, at) => {
    world();
    planIdleCompactions(H.s.svc, at);
    expect(liveCompactions()).toEqual([]);
  });

  test('nothing is planned below the trigger size', () => {
    world();
    turnUsage('turn-2', IDLE_COMPACTION_DEFAULTS.triggerTokens - 1, T0 + 1);
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    expect(liveCompactions()).toEqual([]);
  });

  test('nothing is planned while a turn is queued or running', async () => {
    const machineId = world();
    await sendMessage('one more thing');
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    expect(liveCompactions()).toEqual([]);
    expect((await claim(machineId))?.chief?.compactOnly).toBeUndefined();
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    expect(liveCompactions()).toEqual([]);
  });

  test('a machine whose CLI does not report chief-compact gets no compaction step', async () => {
    const machineId = world([]);
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    expect(liveCompactions()).toEqual([]);
    H.s.db
      .insert(stepTable)
      .values({
        id: 'old-cli-compact',
        buildId: H.threadId,
        kind: 'chief',
        status: 'pending',
        prompt: JSON.stringify({
          cursor: 'm-2',
          generation: 0,
          sessionId: SESSION,
          reason: 'idle',
        }),
        compactOnly: true,
        createdAt: T0,
      })
      .run();
    expect(await claim(machineId)).toBeNull();
  });
});

describe('a compaction lands only through its binding', () => {
  test('an idle compaction, then a new message: the message turn carries no summary', async () => {
    const machineId = world();
    const compaction = await idleCompactionClaimed(machineId);
    await finishStep(deps(), machineId, compaction.step.id, compacted());
    expect(threadRow()).toMatchObject({
      compactGeneration: 1,
      compactSummary: { coveredThroughMessageId: 'm-2', sessionId: SESSION, tokensAfter: 18_000 },
      sessionId: SESSION,
      lastTurnAt: T0,
      activeRun: null,
    });
    const messageId = await sendMessage('and the ticket number?');
    const turn = await claim(machineId);
    expect(turn).toMatchObject({
      step: { id: messageId },
      session: { action: 'continue', sessionId: SESSION },
      chief: { compaction: CHIEF_COMPACTION },
    });
    expect(turn?.chief?.compactOnly).toBeUndefined();
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    expect(liveCompactions()).toEqual([]);
    expect(
      H.s.db.select().from(tokenUsage).where(eq(tokenUsage.buildId, H.threadId)).get(),
    ).toMatchObject({ input: 40_000 });
    expect(
      H.s.db
        .select()
        .from(chiefTurnUsage)
        .where(eq(chiefTurnUsage.stepId, compaction.step.id))
        .all(),
    ).toEqual([]);
  });

  test('no compaction is paid for while the covered range is unchanged', async () => {
    const machineId = world();
    const compaction = await idleCompactionClaimed(machineId);
    await finishStep(deps(), machineId, compaction.step.id, compacted());
    turnUsage('turn-late', 60_000, Date.now() + 1000);
    planIdleCompactions(H.s.svc, T0 + IDLE * 2);
    expect(liveCompactions()).toEqual([]);
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`);
    expect(res.status).toBe(200);
    expect(coordinatorCompactResponseSchema.parse(await res.json())).toEqual({
      skipped: 'unchanged',
    });
    expect(liveCompactions()).toEqual([]);
  });

  test('a result for a session that was replaced meanwhile is discarded', async () => {
    const machineId = world();
    const compaction = await idleCompactionClaimed(machineId);
    H.s.db
      .update(chiefThread)
      .set({ sessionId: 'pi-session-2' })
      .where(eq(chiefThread.id, H.threadId))
      .run();
    await finishStep(deps(), machineId, compaction.step.id, compacted());
    expect(threadRow()).toMatchObject({ compactGeneration: 0, compactSummary: null });
  });

  test('a result bound to an older generation is discarded', async () => {
    const machineId = world();
    const compaction = await idleCompactionClaimed(machineId);
    const landed = {
      coveredThroughMessageId: 'm-1',
      sessionId: SESSION,
      updatedAt: T0,
      tokensBefore: 1,
      tokensAfter: 1,
      summaryTokens: 1,
    };
    H.s.db
      .update(chiefThread)
      .set({ compactGeneration: 1, compactSummary: landed })
      .where(eq(chiefThread.id, H.threadId))
      .run();
    await finishStep(deps(), machineId, compaction.step.id, compacted());
    expect(threadRow()).toMatchObject({ compactGeneration: 1, compactSummary: landed });
  });

  test('a pending compaction whose binding went stale is dropped at claim', async () => {
    const machineId = world();
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    H.s.db
      .update(chiefThread)
      .set({ sessionId: 'pi-session-2' })
      .where(eq(chiefThread.id, H.threadId))
      .run();
    expect(await claim(machineId)).toBeNull();
    expect(liveCompactions()).toEqual([]);
  });
});

describe('a user message never waits on a summary', () => {
  test('a message that looks like a compaction binding is an ordinary turn', async () => {
    const machineId = world();
    const content = `[compact] ${JSON.stringify({ cursor: 'm-1', generation: 0, sessionId: SESSION, reason: 'manual' })}`;
    const messageId = await sendMessage(content);
    const turn = await claim(machineId);
    expect(turn).toMatchObject({ step: { id: messageId }, instruction: content });
    expect(turn?.chief?.compactOnly).toBeUndefined();
  });

  test('a pending compaction is dropped when the message arrives', async () => {
    const machineId = world();
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    const messageId = await sendMessage('hi again');
    expect(liveCompactions()).toEqual([]);
    expect((await claim(machineId))?.step.id).toBe(messageId);
  });

  test('a running compaction is stopped, not steered into, and its stop does not land', async () => {
    const machineId = world();
    const stop = vi.spyOn(H.s.machineHub, 'stopSignal');
    const compaction = await idleCompactionClaimed(machineId);
    const messageId = await sendMessage('hi again');
    expect(stop).toHaveBeenCalledWith(H.teamId, compaction.step.id);
    expect(
      H.s.db.select().from(stopPending).where(eq(stopPending.stepId, compaction.step.id)).get(),
    ).toBeDefined();
    expect(steerChiefMessage(H.s.svc, H.teamId, H.threadId, messageId)).toEqual({
      steered: false,
    });
    expect(await claim(machineId)).toBeNull();
    await finishStep(deps(), machineId, compaction.step.id, { status: 'stopped' });
    expect(threadRow()).toMatchObject({ compactGeneration: 0, compactSummary: null });
    expect((await claim(machineId))?.step.id).toBe(messageId);
  });
});

describe('a failing compaction stays invisible and capped', () => {
  test('a failure writes no turn error and is not requeued', async () => {
    const machineId = world();
    const compaction = await idleCompactionClaimed(machineId);
    await finishStep(deps(), machineId, compaction.step.id, {
      status: 'failed',
      errorMessage: '429 rate limit exceeded',
    });
    expect(
      H.s.db.select().from(stepTable).where(eq(stepTable.id, compaction.step.id)).get()?.status,
    ).toBe('failed');
    expect(liveCompactions()).toEqual([]);
    expect(
      H.s.db
        .select()
        .from(chiefMessage)
        .where(and(eq(chiefMessage.threadId, H.threadId), eq(chiefMessage.role, 'system')))
        .all()
        .filter((row) => String(row.content).includes(CHIEF_TURN_ERROR_KIND)),
    ).toEqual([]);
    const page = (await (
      await req(H.s.app, 'GET', `/api/teams/${H.teamId}/coordinator`)
    ).json()) as { thread: { lastTurnError: string | null; activeRun: unknown } };
    expect(page.thread).toMatchObject({ lastTurnError: null, activeRun: null });
    expect(threadRow().lastTurnAt).toBe(T0);
  });

  test('two failures over the same range stop further attempts until the range moves', async () => {
    const machineId = world();
    for (let attempt = 0; attempt < 2; attempt++) {
      const compaction = await idleCompactionClaimed(machineId);
      await finishStep(deps(), machineId, compaction.step.id, {
        status: 'failed',
        errorMessage: 'provider 500',
      });
    }
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    expect(liveCompactions()).toEqual([]);
    const manual = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`);
    expect(manual.status).toBe(409);
    message('m-3', 'assistant', 'Daily report: all green.', T0 + 10);
    turnUsage('turn-2', 52_000, T0 + 10);
    planIdleCompactions(H.s.svc, T0 + IDLE + 11);
    expect(liveCompactions()).toHaveLength(1);
  });

  test('nothing to compact is remembered without a retry', async () => {
    const machineId = world();
    const compaction = await idleCompactionClaimed(machineId);
    await finishStep(deps(), machineId, compaction.step.id, {
      status: 'success',
      compaction: { compacted: false, tokensBefore: null, tokensAfter: null, summaryTokens: null },
    });
    planIdleCompactions(H.s.svc, T0 + IDLE + 2);
    expect(liveCompactions()).toEqual([]);
    expect(threadRow()).toMatchObject({ compactGeneration: 0, compactSummary: null });
  });
});

describe('POST /coordinator/compact runs the same path now', () => {
  test('409 while a turn is running', async () => {
    const machineId = world();
    await sendMessage('do the thing');
    expect((await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`)).status).toBe(
      409,
    );
    await claim(machineId);
    expect((await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`)).status).toBe(
      409,
    );
    expect(liveCompactions()).toEqual([]);
  });

  test('200 with the landed summary once the machine has compacted', async () => {
    const machineId = world();
    const pending = req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`);
    await vi.waitFor(() => expect(liveCompactions()).toHaveLength(1));
    const claimed = await claim(machineId);
    expect(claimed?.chief?.compactOnly).toBe(true);
    await finishStep(deps(), machineId, claimed?.step.id ?? '', compacted());
    const res = await pending;
    expect(res.status).toBe(200);
    const body = coordinatorCompactResponseSchema.parse(await res.json());
    expect(body).toEqual({
      summary: { coveredThroughMessageId: 'm-2', generation: 1, updatedAt: expect.any(Number) },
    });
  });

  test('two compact requests share one compaction and both get its summary', async () => {
    const machineId = world();
    const first = req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`);
    await vi.waitFor(() => expect(liveCompactions()).toHaveLength(1));
    const second = req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(liveCompactions()).toHaveLength(1);
    const claimed = await claim(machineId);
    await finishStep(deps(), machineId, claimed?.step.id ?? '', compacted());
    for (const res of await Promise.all([first, second])) {
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ summary: { generation: 1 } });
    }
  });

  test('Stop with only a compaction running is not a turn stop', async () => {
    const machineId = world();
    await idleCompactionClaimed(machineId);
    const res = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${H.threadId}/stop`,
    );
    expect(res.status).toBe(409);
    expect(H.s.db.select().from(stopPending).all()).toEqual([]);
  });

  test('a wake turn also preempts a running compaction', async () => {
    const machineId = world();
    const compaction = await idleCompactionClaimed(machineId);
    enqueueChiefStep(H.s.svc, H.threadId, { prompt: 'gate facts', trigger: 'gate' });
    expect(
      H.s.db.select().from(stopPending).where(eq(stopPending.stepId, compaction.step.id)).get(),
    ).toBeDefined();
  });

  test('a new message during a manual compaction answers 409', async () => {
    const machineId = world();
    const pending = req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`);
    await vi.waitFor(() => expect(liveCompactions()).toHaveLength(1));
    await sendMessage('wait, one more');
    expect((await pending).status).toBe(409);
    expect((await claim(machineId))?.chief?.compactOnly).toBeUndefined();
  });
});

describe('GET /coordinator/context reports the working set', () => {
  test('measured size and cache share from the last turn, summary after landing', async () => {
    const machineId = world();
    const before = coordinatorContextResponseSchema.parse(
      await (await req(H.s.app, 'GET', `/api/teams/${H.teamId}/coordinator/context`)).json(),
    );
    expect(before).toMatchObject({
      budgetTokens: CHIEF_COMPACTION.thresholdTokens,
      usedTokens: 50_000,
      summary: null,
      cacheReadShare: 0.9,
    });
    expect(before.sections.map((s) => s.name)).toEqual([
      'system',
      'tools',
      'brief',
      'index',
      'summary',
      'recent',
    ]);
    const system = before.sections.find((s) => s.name === 'system')?.tokens ?? 0;
    const tools = before.sections.find((s) => s.name === 'tools')?.tokens ?? 0;
    expect(system).toBeGreaterThan(1000);
    expect(tools).toBeGreaterThan(1000);
    expect(before.sections.find((s) => s.name === 'recent')?.tokens).toBe(50_000 - system - tools);
    const compaction = await idleCompactionClaimed(machineId);
    await finishStep(deps(), machineId, compaction.step.id, compacted());
    const after = coordinatorContextResponseSchema.parse(
      await (await req(H.s.app, 'GET', `/api/teams/${H.teamId}/coordinator/context`)).json(),
    );
    expect(after).toMatchObject({
      usedTokens: system + tools + 18_000,
      summary: { coveredThroughMessageId: 'm-2', generation: 1 },
    });
    expect(after.sections.find((s) => s.name === 'summary')?.tokens).toBe(1500);
    expect(after.sections.find((s) => s.name === 'recent')?.tokens).toBe(18_000 - 1500);
  });
});

function dropFeature(machineId: string): void {
  H.s.db
    .update(machineTable)
    .set({ capabilities: { mcpServers: [], skills: [], features: [] } })
    .where(eq(machineTable.id, machineId))
    .run();
}

function insertWake(id: string): void {
  H.s.db
    .insert(stepTable)
    .values({
      id,
      buildId: H.threadId,
      kind: 'chief',
      status: 'pending',
      prompt: '[wake:gate] facts',
      createdAt: Date.now() + 1,
    })
    .run();
}

describe('a compaction the claiming machine cannot run never blocks the thread', () => {
  test('it is dropped at claim without spending an attempt, and the next step runs', async () => {
    const machineId = world();
    const attemptBefore = threadRow().compactAttempt;
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    expect(threadRow().compactAttempt).toEqual({ cursor: 'm-2', count: 1 });
    dropFeature(machineId);
    insertWake('wake-after');
    expect((await claim(machineId))?.step.id).toBe('wake-after');
    expect(liveCompactions()).toEqual([]);
    expect(chiefSteps().filter((row) => row.compactOnly)).toEqual([]);
    expect(threadRow().compactAttempt).toEqual(attemptBefore);
  });

  test('a waiting compact request gets a clear answer instead of a timeout', async () => {
    const machineId = world();
    const pending = req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`);
    await vi.waitFor(() => expect(liveCompactions()).toHaveLength(1));
    dropFeature(machineId);
    expect(await claim(machineId)).toBeNull();
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/cannot compact/i) });
  });
});

describe('an overlong compaction is ended by its own watchdog', () => {
  function age(stepId: string, heartbeatAgo: number): void {
    const now = Date.now();
    H.s.db
      .update(stepTable)
      .set({ claimedAt: now - CHIEF_TURN_MAX_MS - 1, lastHeartbeatAt: now - heartbeatAgo })
      .where(eq(stepTable.id, stepId))
      .run();
  }

  test('the turn watchdog leaves compactions alone and writes no stop card', async () => {
    const machineId = world();
    const compaction = await idleCompactionClaimed(machineId);
    age(compaction.step.id, 10 * 60_000);
    sweepOverlongChiefTurns(H.s.svc);
    expect(
      H.s.db.select().from(stepTable).where(eq(stepTable.id, compaction.step.id)).get()?.status,
    ).toBe('claimed');
    expect(
      H.s.db
        .select()
        .from(chiefMessage)
        .where(eq(chiefMessage.id, `chief-stop-${compaction.step.id}`))
        .get(),
    ).toBeUndefined();
  });

  test('a live overlong compaction is asked to stop', async () => {
    const machineId = world();
    const compaction = await idleCompactionClaimed(machineId);
    age(compaction.step.id, 1000);
    H.s.db
      .update(stepTable)
      .set({ claimedAt: Date.now() - CHIEF_COMPACT_MAX_MS - 1 })
      .where(eq(stepTable.id, compaction.step.id))
      .run();
    sweepOverlongCompactions(H.s.svc);
    expect(
      H.s.db.select().from(stopPending).where(eq(stopPending.stepId, compaction.step.id)).get(),
    ).toBeDefined();
    expect(
      H.s.db.select().from(stepTable).where(eq(stepTable.id, compaction.step.id)).get()?.status,
    ).toBe('claimed');
  });

  test('an abandoned overlong compaction is ended and its compact request answered', async () => {
    const machineId = world();
    const pending = req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/compact`);
    await vi.waitFor(() => expect(liveCompactions()).toHaveLength(1));
    const claimed = await claim(machineId);
    age(claimed?.step.id ?? '', 10 * 60_000);
    sweepOverlongCompactions(H.s.svc);
    const res = await pending;
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/timed out/i) });
    expect(
      H.s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.id, claimed?.step.id ?? ''))
        .get()?.status,
    ).toBe('stopped');
    expect(liveCompactions()).toEqual([]);
  });
});

describe('a parked ask_user question and idle compaction', () => {
  async function park(): Promise<void> {
    createOrGetQuestion(
      { db: H.s.db },
      {
        threadId: H.threadId,
        requestId: 'ask-q',
        questions: [{ header: 'scope', question: 'Which pages?', options: [] }],
      },
    );
    H.s.db
      .update(chiefMessage)
      .set({ createdAt: T0 - ASK_PARK_MS - 1 })
      .where(eq(chiefMessage.id, 'ask-q'))
      .run();
    const held = await holdForQuestion(
      { db: H.s.db },
      { threadId: H.threadId, requestId: 'ask-q', holdMs: 0 },
    );
    expect(held?.status).toBe('cancelled');
  }

  test('a thread waiting only on a parked question counts as idle and is compacted', async () => {
    const machineId = world();
    await park();
    planIdleCompactions(H.s.svc, T0 + IDLE + 1);
    expect(liveCompactions()).toHaveLength(1);
    expect((await claim(machineId))?.chief?.compactOnly).toBe(true);
  });

  test('answering the parked question stops the compaction and its resume turn runs next', async () => {
    const machineId = world();
    await park();
    const compaction = await idleCompactionClaimed(machineId);
    const res = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${H.threadId}/questions/ask-q/answer`,
      { answers: [{ header: 'scope', text: 'only the board' }] },
    );
    expect(res.status).toBe(200);
    expect(
      H.s.db.select().from(stopPending).where(eq(stopPending.stepId, compaction.step.id)).get(),
    ).toBeDefined();
    expect(await claim(machineId)).toBeNull();
    await finishStep(deps(), machineId, compaction.step.id, { status: 'stopped' });
    const resumed = await claim(machineId);
    expect(resumed?.chief?.compactOnly).toBeUndefined();
    expect(resumed?.instruction).toContain('only the board');
    expect(resumed?.session).toEqual({ action: 'continue', sessionId: SESSION });
    expect(threadRow()).toMatchObject({ compactGeneration: 0, compactSummary: null });
  });
});
