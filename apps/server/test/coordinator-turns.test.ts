import { buildOrchestratePrompt, CHIEF_TURN_ERROR_KIND } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  chiefMessage,
  chiefThread,
  machine as machineTable,
  step as stepTable,
  stopPending,
} from '../src/db/schema.js';
import { CHIEF_TURN_MAX_MS, sweepOverlongChiefTurns } from '../src/services/chief-turns.js';
import { CORRECTION_PROMPT } from '../src/services/merge-gate/correction.js';
import { createScheduler } from '../src/services/scheduler.js';
import { H, registerChiefHarness } from './chief-harness.js';
import { postProject, req } from './helpers.js';

registerChiefHarness();

interface Orchestration {
  todoId: string;
  state: 'queued' | 'running' | 'failed';
  error: string | null;
}

async function postTodo(projectId: string, title: string): Promise<string> {
  const res = await req(H.s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title,
    spec: `> ${title}`,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function orchestrate(todoId: string): Promise<string> {
  const res = await req(H.s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
  expect(res.status).toBe(201);
  return ((await res.json()) as { message: { id: string } }).message.id;
}

async function orchestrationOf(): Promise<Orchestration | null | undefined> {
  const page = (await (await req(H.s.app, 'GET', `/api/teams/${H.teamId}/coordinator`)).json()) as {
    thread: { orchestration?: Orchestration | null };
  };
  const list = (await (
    await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief/threads`)
  ).json()) as { orchestration?: Orchestration | null }[];
  expect(list[0]?.orchestration).toEqual(page.thread.orchestration);
  return page.thread.orchestration;
}

function setStep(id: string, set: Partial<typeof stepTable.$inferInsert>) {
  H.s.db.update(stepTable).set(set).where(eq(stepTable.id, id)).run();
}

describe('thread.orchestration describes the latest orchestrate turn', () => {
  test('a queued orchestration reports its task', async () => {
    const todoId = await postTodo(H.projectId, 'first');
    await orchestrate(todoId);
    expect(await orchestrationOf()).toEqual({ todoId, state: 'queued', error: null });
  });

  test('a claimed orchestration is running', async () => {
    const todoId = await postTodo(H.projectId, 'first');
    const stepId = await orchestrate(todoId);
    setStep(stepId, { status: 'claimed', claimedAt: Date.now() });
    expect(await orchestrationOf()).toEqual({ todoId, state: 'running', error: null });
  });

  test('a failed orchestration carries the turn error', async () => {
    const todoId = await postTodo(H.projectId, 'first');
    const stepId = await orchestrate(todoId);
    setStep(stepId, { status: 'failed', finishedAt: Date.now() });
    H.s.db
      .insert(chiefMessage)
      .values({
        id: `chief-err-${stepId}`,
        threadId: H.threadId,
        role: 'system',
        content: JSON.stringify({ kind: CHIEF_TURN_ERROR_KIND, message: 'model unavailable' }),
        createdAt: Date.now(),
      })
      .run();
    expect(await orchestrationOf()).toEqual({
      todoId,
      state: 'failed',
      error: 'model unavailable',
    });
  });

  test('a finished orchestration and a later ordinary turn both report null', async () => {
    const todoId = await postTodo(H.projectId, 'first');
    const stepId = await orchestrate(todoId);
    setStep(stepId, { status: 'done', finishedAt: Date.now() });
    expect(await orchestrationOf()).toBeNull();
    setStep(stepId, { status: 'pending' });
    await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/messages`, { content: 'hi' });
    expect(await orchestrationOf()).toBeNull();
  });

  test('two orchestrations in a row: the latest wins', async () => {
    const first = await postTodo(H.projectId, 'first');
    const second = await postTodo(H.projectId, 'second');
    await orchestrate(first);
    await orchestrate(second);
    expect(await orchestrationOf()).toEqual({ todoId: second, state: 'queued', error: null });
  });

  test('a correction-prefixed orchestration is still recognised', async () => {
    const todoId = await postTodo(H.projectId, 'first');
    const prompt = `${CORRECTION_PROMPT}\n\n${buildOrchestratePrompt({ id: todoId, seqNum: 1, spec: 'x', sourceKind: null, sourceRef: null })}`;
    H.s.db
      .insert(stepTable)
      .values({
        id: 'step-correction',
        buildId: H.threadId,
        kind: 'chief',
        status: 'pending',
        prompt,
        createdAt: Date.now(),
      })
      .run();
    expect(await orchestrationOf()).toEqual({ todoId, state: 'queued', error: null });
  });
});

describe('overlong chief turns are stopped so one turn cannot block the thread', () => {
  function seedClaimed(id: string, claimedAt: number, lastHeartbeatAt: number) {
    H.s.db
      .insert(machineTable)
      .values({ id: `machine-${id}`, teamId: H.teamId, name: id, online: true })
      .run();
    H.s.db
      .insert(stepTable)
      .values({
        id,
        buildId: H.threadId,
        kind: 'chief',
        status: 'claimed',
        machineId: `machine-${id}`,
        prompt: 'stuck',
        claimedAt,
        lastHeartbeatAt,
        createdAt: claimedAt,
      })
      .run();
    H.s.db
      .update(chiefThread)
      .set({ activeRun: { phase: 'chief' } })
      .where(eq(chiefThread.id, H.threadId))
      .run();
  }

  test('a heartbeating turn past the cap gets a stop request, a younger one does not', () => {
    const now = 10_000_000;
    seedClaimed('young', now - CHIEF_TURN_MAX_MS + 1000, now);
    sweepOverlongChiefTurns(H.s.svc, now);
    expect(H.s.db.select().from(stopPending).all()).toEqual([]);
    sweepOverlongChiefTurns(H.s.svc, now + 2000);
    const pending = H.s.db.select().from(stopPending).all();
    expect(pending.map((r) => [r.conversationId, r.stepId])).toEqual([[H.threadId, 'young']]);
    expect(H.s.db.select().from(stepTable).where(eq(stepTable.id, 'young')).get()?.status).toBe(
      'claimed',
    );
  });

  test('a turn past the cap with a stale heartbeat is stopped on the server and frees the thread', () => {
    const now = 10_000_000;
    seedClaimed('hung', now - CHIEF_TURN_MAX_MS - 1, now - 10 * 60_000);
    H.s.db
      .insert(stepTable)
      .values({
        id: 'next',
        buildId: H.threadId,
        kind: 'chief',
        status: 'pending',
        prompt: 'queued behind',
        createdAt: now,
      })
      .run();
    sweepOverlongChiefTurns(H.s.svc, now);
    expect(H.s.db.select().from(stepTable).where(eq(stepTable.id, 'hung')).get()?.status).toBe(
      'stopped',
    );
    expect(H.s.db.select().from(stepTable).where(eq(stepTable.id, 'next')).get()?.status).toBe(
      'pending',
    );
  });
  test('the scheduler tick runs the watchdog', () => {
    const now = Date.now();
    seedClaimed('ticked', now - CHIEF_TURN_MAX_MS - 1, now);
    const scheduler = createScheduler(H.s.svc, { tickMs: 60_000 });
    scheduler.tick(now);
    scheduler.stop();
    expect(
      H.s.db
        .select()
        .from(stopPending)
        .all()
        .map((r) => r.stepId),
    ).toEqual(['ticked']);
  });
});

describe('rewind never cuts another project out of the shared transcript', () => {
  async function send(content: string, projectId?: string) {
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/messages`, {
      content,
      ...(projectId !== undefined ? { projectId } : {}),
    });
    expect(res.status).toBe(201);
    const id = ((await res.json()) as { message: { id: string } }).message.id;
    setStep(id, { status: 'done', finishedAt: Date.now() });
    H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
    return id;
  }

  function rewind(messageId: string) {
    return req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads/${H.threadId}/rewind`, {
      messageId,
    });
  }

  test('a later turn of another project refuses the rewind and names it', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const anchor = await send('plan demo', H.projectId);
    await send('plan the site', site);
    const res = await rewind(anchor);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('cairn-site');
    expect(
      H.s.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, H.threadId)).all(),
    ).toHaveLength(2);
  });

  test('a later untagged turn also refuses the rewind', async () => {
    const anchor = await send('plan demo', H.projectId);
    await send('general question');
    expect((await rewind(anchor)).status).toBe(409);
  });

  test('later turns of the same project rewind as before', async () => {
    const anchor = await send('plan demo', H.projectId);
    await send('more on demo', H.projectId);
    const res = await rewind(anchor);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deletedCount: number }).deletedCount).toBe(1);
  });

  test('orchestrations carry their task project, so rewinding across them is refused', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const first = await orchestrate(await postTodo(H.projectId, 'demo task'));
    setStep(first, { status: 'done', finishedAt: Date.now() });
    const second = await orchestrate(await postTodo(site, 'site task'));
    setStep(second, { status: 'done', finishedAt: Date.now() });
    H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, H.threadId)).run();
    const tags = H.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, H.threadId))
      .all()
      .map((m) => m.projectId);
    expect(tags).toEqual([H.projectId, site]);
    const res = await rewind(first);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('cairn-site');
  });

  test('a queued turn refuses the rewind', async () => {
    const anchor = await send('plan demo', H.projectId);
    await req(H.s.app, 'POST', `/api/teams/${H.teamId}/coordinator/messages`, {
      content: 'queued',
      projectId: H.projectId,
    });
    expect((await rewind(anchor)).status).toBe(409);
  });
});
