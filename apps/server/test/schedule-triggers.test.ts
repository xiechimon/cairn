import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { schedule as scheduleTable, step, todo } from '../src/db/schema.js';
import { completeStep, enqueueStep, listSteps, startBuilds } from '../src/services/builds.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule } from '../src/services/schedules.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, insertMachine, postProject, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
function boot(opts?: Parameters<typeof bootServer>[0]) {
  const s = bootServer(opts);
  insertMachine(s);
  servers.push(s);
  return s;
}
afterEach(() => {
  while (servers.length > 0) servers.pop()?.dispose();
});

async function makeTodo(s: TestServer, title: string) {
  const projectId = await postProject(s.app, `proj-${title}`);
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title,
    spec: 'run',
  });
  const { id } = (await res.json()) as { id: string };
  return { projectId, todoId: id };
}

function hook(s: TestServer, token: string, deliveryId?: string) {
  return s.app.request(`/api/webhook/schedule/${token}`, {
    method: 'POST',
    headers: deliveryId !== undefined ? { 'x-cairn-delivery': deliveryId } : {},
  });
}

function stored(s: TestServer, id: string) {
  return s.db.select().from(scheduleTable).where(eq(scheduleTable.id, id)).get();
}

function routineSteps(s: TestServer, scheduleId: string) {
  return s.db.select().from(step).where(eq(step.scheduleId, scheduleId)).all();
}

function quarterAligned(ms: number): number {
  return Math.floor(ms / 900_000) * 900_000;
}

describe('webhook schedule intake (seq 31)', () => {
  test('creating a webhook schedule returns a one-time token and a delivery fires a routine run', async () => {
    const s = boot();
    const { todoId } = await makeTodo(s, 'hooked');
    const created = await req(s.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'webhook',
      prompt: 'on hook',
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      id: string;
      nextRunAt: number | null;
      webhookMasked: string | null;
      webhookToken?: string;
      webhookUrl?: string;
    };
    expect(body.webhookToken).toMatch(/^cairn-wh-/);
    expect(body.webhookUrl).toContain(`/api/webhook/schedule/${body.webhookToken}`);
    expect(body.webhookMasked).toBeTruthy();
    expect(body.webhookMasked).not.toBe(body.webhookToken);
    expect(body.nextRunAt).toBeNull();

    const res = await hook(s, body.webhookToken as string, 'del-1');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ result: 'fired', deliveryId: 'del-1' });
    const row = stored(s, body.id);
    expect(row?.webhookDeliveries).toEqual(['del-1']);
    expect(row?.webhookLastUsedAt).not.toBeNull();
    expect(row?.nextRunAt).not.toBeNull();

    const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
    await scheduler.tick();
    expect(routineSteps(s, body.id)).toHaveLength(1);
    expect(stored(s, body.id)).toMatchObject({
      nextRunAt: null,
      lastRunStatus: 'started',
    });
  });

  test('a replayed delivery id answers duplicate and never fires a second run', async () => {
    const s = boot();
    const { todoId } = await makeTodo(s, 'hooked-dup');
    const created = await req(s.app, 'POST', '/api/schedules', { todoId, kind: 'webhook' });
    const body = (await created.json()) as { id: string; webhookToken: string };
    expect((await hook(s, body.webhookToken, 'del-9')).status).toBe(202);
    const replay = await hook(s, body.webhookToken, 'del-9');
    expect(await replay.json()).toEqual({ result: 'duplicate', deliveryId: 'del-9' });
    const burst = await hook(s, body.webhookToken, 'del-10');
    expect(await burst.json()).toEqual({ result: 'fired', deliveryId: 'del-10' });
    expect(stored(s, body.id)?.webhookDeliveries).toEqual(['del-9', 'del-10']);

    const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
    await scheduler.tick();
    expect(routineSteps(s, body.id)).toHaveLength(1);
  });

  test('a disabled webhook schedule answers ignored and writes nothing', async () => {
    const s = boot();
    const { todoId } = await makeTodo(s, 'hooked-off');
    const created = await req(s.app, 'POST', '/api/schedules', { todoId, kind: 'webhook' });
    const body = (await created.json()) as { id: string; webhookToken: string };
    expect(
      (
        await req(s.app, 'PATCH', `/api/schedules/${body.id}`, {
          enabled: false,
        })
      ).status,
    ).toBe(200);
    const res = await hook(s, body.webhookToken, 'del-off');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ result: 'ignored', deliveryId: 'del-off' });
    expect(stored(s, body.id)).toMatchObject({
      nextRunAt: null,
      webhookLastUsedAt: null,
      webhookDeliveries: [],
    });
  });

  test('a webhook schedule on an archived todo answers ignored', async () => {
    const s = boot();
    const { todoId } = await makeTodo(s, 'hooked-arch');
    const created = await req(s.app, 'POST', '/api/schedules', { todoId, kind: 'webhook' });
    const body = (await created.json()) as { id: string; webhookToken: string };
    s.db.update(todo).set({ archivedAt: Date.now() }).where(eq(todo.id, todoId)).run();
    const res = await hook(s, body.webhookToken, 'del-arch');
    expect(await res.json()).toEqual({ result: 'ignored', deliveryId: 'del-arch' });
    expect(stored(s, body.id)?.nextRunAt).toBeNull();
  });

  test('an unknown webhook token is 401', async () => {
    const s = boot();
    const res = await hook(s, 'cairn-wh-not-a-real-token', 'del-x');
    expect(res.status).toBe(401);
  });

  test('the webhook path answers without the session token while other api routes stay walled', async () => {
    const s = boot({ authToken: 'hook-secret' });
    const authed = (method: string, path: string, body: unknown) =>
      s.app.request(path, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer hook-secret',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    const project = await authed('POST', '/api/projects', { name: 'hooked-auth' });
    const { id: projectId } = (await project.json()) as { id: string };
    const created = await authed('POST', `/api/projects/${projectId}/todos`, {
      title: 'hooked-auth',
      spec: 'run',
    });
    const { id: todoId } = (await created.json()) as { id: string };
    expect(
      (
        await s.app.request('/api/schedules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ todoId, kind: 'webhook' }),
        })
      ).status,
    ).toBe(401);
    const record = createSchedule(
      s.svc,
      { todoId, kind: 'webhook', teamId: s.team.id, createdBy: s.user.id },
      { webhookToken: 'cairn-wh-svc-token-for-auth-test' },
    );
    const res = await hook(s, 'cairn-wh-svc-token-for-auth-test', 'del-auth');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ result: 'fired', deliveryId: 'del-auth' });
    expect(stored(s, record.id)?.nextRunAt).not.toBeNull();
  });
});

describe('missed-run window (seq 31)', () => {
  test('a once schedule created already-overdue still fires on the next tick', async () => {
    const s = boot();
    const { projectId, todoId } = await makeTodo(s, 'late-once');
    const at = quarterAligned(Date.now() - 60 * 60_000);
    const created = await req(s.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'once',
      at,
      tz: 'UTC',
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string };
    const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
    await scheduler.tick();
    expect(routineSteps(s, body.id)).toHaveLength(1);
    expect(stored(s, body.id)).toMatchObject({ nextRunAt: null, lastRunStatus: 'started' });
    void projectId;
  });

  test('a once schedule whose window lapsed is skipped and never fires', async () => {
    const s = boot();
    const { todoId } = await makeTodo(s, 'lost-once');
    const at = quarterAligned(Date.now() - 13 * 60 * 60_000);
    const created = await req(s.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'once',
      at,
      tz: 'UTC',
    });
    const body = (await created.json()) as { id: string };
    s.db
      .update(scheduleTable)
      .set({ createdAt: at - 60_000, nextRunAt: at })
      .where(eq(scheduleTable.id, body.id))
      .run();
    const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
    await scheduler.tick();
    expect(routineSteps(s, body.id)).toHaveLength(0);
    expect(stored(s, body.id)).toMatchObject({
      nextRunAt: null,
      lastRunStatus: 'skipped',
      lastRunError: 'missed the run window',
    });
  });

  test('a recurring schedule past its window rolls forward and records the skipped run', async () => {
    const s = boot();
    const { todoId } = await makeTodo(s, 'lost-daily');
    const created = await req(s.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'cron',
      cron: '0 8 * * *',
      tz: 'UTC',
    });
    const body = (await created.json()) as { id: string };
    const overdue = Date.now() - 13 * 60 * 60_000;
    s.db
      .update(scheduleTable)
      .set({ createdAt: overdue - 86_400_000, nextRunAt: overdue })
      .where(eq(scheduleTable.id, body.id))
      .run();
    const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
    await scheduler.tick();
    expect(routineSteps(s, body.id)).toHaveLength(0);
    const row = stored(s, body.id);
    expect(row).toMatchObject({ lastRunStatus: 'skipped' });
    expect(row?.nextRunAt).not.toBeNull();
    expect(row?.nextRunAt as number).toBeGreaterThan(Date.now());
  });

  test('a narrower missedRunWindowMs skips a run the default window would still catch', async () => {
    const s = boot();
    const { todoId } = await makeTodo(s, 'narrow-once');
    const at = quarterAligned(Date.now() - 2 * 60 * 60_000);
    const created = await req(s.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'once',
      at,
      tz: 'UTC',
      missedRunWindowMs: 60 * 60_000,
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string };
    s.db
      .update(scheduleTable)
      .set({ createdAt: at - 60_000, nextRunAt: at })
      .where(eq(scheduleTable.id, body.id))
      .run();
    const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
    await scheduler.tick();
    expect(routineSteps(s, body.id)).toHaveLength(0);
    expect(stored(s, body.id)?.lastRunStatus).toBe('skipped');
  });
});

describe('event schedule dispatch (seq 31)', () => {
  test('an event schedule claims a run only once its todo build goes quiet', async () => {
    const s = boot();
    const { projectId, todoId } = await makeTodo(s, 'eventful');
    const created = await req(s.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'event',
      triggerSpec: { topic: 'todo.build.completed' },
      prompt: 'after the build',
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; nextRunAt: number | null };
    expect(body.nextRunAt).toBeNull();

    const [started] = startBuilds(s.svc, { projectId, todoIds: [todoId] });
    const buildId = started?.id as string;
    const first = listSteps(s.svc, buildId)[0]?.id as string;
    const second = enqueueStep(s.svc, buildId, 'session', s.team.id).id;
    setTodoPhase(s.svc, todoId, 'building');
    completeStep(s.svc, first);
    expect(stored(s, body.id)?.nextRunAt).toBeNull();
    completeStep(s.svc, second);
    expect(stored(s, body.id)?.nextRunAt).not.toBeNull();

    const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
    await scheduler.tick();
    expect(routineSteps(s, body.id)).toHaveLength(1);
    expect(stored(s, body.id)).toMatchObject({
      nextRunAt: null,
      lastRunStatus: 'started',
    });
  });

  test('an event schedule ignores another todo going quiet', async () => {
    const s = boot();
    const { todoId } = await makeTodo(s, 'watched');
    const other = await makeTodo(s, 'other');
    const created = await req(s.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'event',
      triggerSpec: { topic: 'todo.build.completed' },
    });
    const body = (await created.json()) as { id: string };
    const [started] = startBuilds(s.svc, {
      projectId: other.projectId,
      todoIds: [other.todoId],
    });
    setTodoPhase(s.svc, other.todoId, 'building');
    completeStep(s.svc, listSteps(s.svc, started?.id as string)[0]?.id as string);
    expect(stored(s, body.id)?.nextRunAt).toBeNull();
  });

  test('a routine run settling never re-triggers its own event schedule', async () => {
    const s = boot();
    const { projectId, todoId } = await makeTodo(s, 'self-watch');
    const created = await req(s.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'event',
      triggerSpec: { topic: 'todo.build.completed' },
    });
    const body = (await created.json()) as { id: string };
    const [started] = startBuilds(s.svc, { projectId, todoIds: [todoId] });
    setTodoPhase(s.svc, todoId, 'building');
    completeStep(s.svc, listSteps(s.svc, started?.id as string)[0]?.id as string);
    expect(stored(s, body.id)?.nextRunAt).not.toBeNull();

    const scheduler = createScheduler(s.svc, { tickMs: 15_000 });
    await scheduler.tick();
    const routine = routineSteps(s, body.id);
    expect(routine).toHaveLength(1);
    setTodoPhase(s.svc, todoId, 'building');
    completeStep(s.svc, routine[0]?.id as string);
    expect(stored(s, body.id)?.nextRunAt).toBeNull();
  });

  test('a disabled event schedule does not claim on build quiet', async () => {
    const s = boot();
    const { projectId, todoId } = await makeTodo(s, 'muted-event');
    const created = await req(s.app, 'POST', '/api/schedules', {
      todoId,
      kind: 'event',
      triggerSpec: { topic: 'todo.build.completed' },
    });
    const body = (await created.json()) as { id: string };
    await req(s.app, 'PATCH', `/api/schedules/${body.id}`, { enabled: false });
    const [started] = startBuilds(s.svc, { projectId, todoIds: [todoId] });
    setTodoPhase(s.svc, todoId, 'building');
    completeStep(s.svc, listSteps(s.svc, started?.id as string)[0]?.id as string);
    expect(stored(s, body.id)?.nextRunAt).toBeNull();
  });
});
