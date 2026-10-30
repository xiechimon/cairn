import {
  buildReviewStepPrompt,
  type ClaimedStep,
  WORKER_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS_GITHUB,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  agent,
  build,
  buildFeedback,
  machine,
  message,
  project,
  schedule,
  step,
  todo,
} from '../src/db/schema.js';
import { applyStepFailure, completeStep, messageTodo } from '../src/services/builds.js';
import { sweepFailedRetries } from '../src/services/needs-you.js';
import { createScheduler } from '../src/services/scheduler.js';
import { workerScheduleRunHistory } from '../src/services/schedules.js';
import { setTodoArchived, setTodoPhase } from '../src/services/todos.js';
import { bindAllAgents, bootServer, issueApiKey, postProject, req } from './helpers.js';

const toolNames = [
  'schedule_create',
  'get_schedule',
  'schedule_update',
  'schedule_pause',
  'schedule_clear',
];

afterEach(() => vi.restoreAllMocks());

async function world(kind: 'plan' | 'build' = 'build') {
  const s = bootServer();
  const key = await issueApiKey(s);
  async function machineCall(path: string, body: unknown, token: string) {
    return s.app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  const enrolled = await machineCall(
    '/api/machine/enroll',
    { teamId: s.team.id, name: 'schedule-worker', cliVersion: '0.1.0' },
    key,
  );
  expect(enrolled.status).toBe(200);
  const { token } = (await enrolled.json()) as { token: string };
  s.db
    .insert(agent)
    .values({
      id: 'schedule-agent',
      teamId: s.team.id,
      displayName: 'Worker',
      provider: 'p',
      modelId: 'm',
    })
    .run();
  bindAllAgents(s);
  const projectId = await postProject(s.app, 'Thread schedules');
  const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Inspect changes',
    spec: 'Report changes',
  });
  const { id: todoId } = (await response.json()) as { id: string };
  await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: {
      plan: kind === 'plan' ? { agentId: 'schedule-agent' } : null,
      build: { agentId: 'schedule-agent' },
    },
    withPlan: kind === 'plan',
  });
  async function claim() {
    const response = await machineCall('/api/machine/tasks/claim', {}, token);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { step: ClaimedStep | null };
    expect(payload.step).not.toBeNull();
    return payload.step!;
  }
  const claimed = await claim();
  const relay = (
    name: string,
    params: Record<string, unknown> = {},
    cred = token,
    stepId = claimed.step.id,
  ) => machineCall(`/api/machine/tool/${stepId}`, { name, params }, cred);
  async function run(name: string, params: Record<string, unknown> = {}, stepId = claimed.step.id) {
    const response = await relay(name, params, undefined, stepId);
    expect(response.status, await response.clone().text()).toBe(200);
    const { text } = (await response.json()) as { text: string };
    return JSON.parse(text);
  }
  const stored = () => s.db.select().from(schedule).where(eq(schedule.todoId, todoId)).get()!;
  return { ...s, key, token, projectId, todoId, claimed, claim, relay, run, stored, machineCall };
}

describe('worker thread schedule tools', () => {
  test('both worker tool lists advertise the schedule tools without scope parameters', async () => {
    for (const tools of [WORKER_REMOTE_TOOLS, WORKER_REMOTE_TOOLS_GITHUB]) {
      for (const name of toolNames) {
        const tool = tools.find((tool) => tool.name === name);
        expect(tool, name).toBeDefined();
        expect(JSON.stringify(tool?.parameters)).not.toMatch(/todoId|teamId/);
        expect(tool?.replaySafe === true).toBe(name === 'get_schedule');
      }
    }
    const s = await world();
    expect(s.claimed.remoteTools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(toolNames),
    );
  });

  test('relative cadence creates exactly one own-thread schedule and replacement stays unique', async () => {
    const s = await world();
    const now = Date.parse('2026-10-31T08:02:17Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await s.run('schedule_create', {
        cadence: 'in 15 minutes',
        prompt: '  Inspect changes\nverbatim.  ',
      });
      expect(s.db.select().from(schedule).all()).toHaveLength(1);
      expect(s.stored()).toMatchObject({
        todoId: s.todoId,
        teamId: s.team.id,
        kind: 'once',
        prompt: '  Inspect changes\nverbatim.  ',
        enabled: true,
      });
      expect(s.stored().nextRunAt).toBe(now + 900_000);
      expect(s.stored().createdBy).toBe(`worker:${s.claimed.step.id}`);
      const result = await s.run('get_schedule');
      expect(result).toEqual({
        prompt: s.stored().prompt,
        cadence: `at ${new Date(now + 900_000).toISOString()}`,
        nextRunAt: now + 900_000,
        lastRunAt: null,
        enabled: true,
      });
      await s.run('schedule_create', { cadence: '*/30 * * * *', prompt: 'Replacement' });
      expect(s.db.select().from(schedule).all()).toHaveLength(1);
      expect(s.stored()).toMatchObject({
        kind: 'cron',
        cron: '*/30 * * * *',
        prompt: 'Replacement',
      });
    } finally {
      clock.mockRestore();
    }
  });

  test('missing schedule reads null and update/pause/clear do not create one', async () => {
    const s = await world();
    expect(await s.run('get_schedule')).toBeNull();
    for (const name of ['schedule_update', 'schedule_pause', 'schedule_clear']) {
      expect(
        (
          await s.relay(name, {
            ...(name === 'schedule_update' ? { prompt: 'Update' } : { reason: 'Stop' }),
          })
        ).status,
      ).toBe(404);
    }
    expect(s.db.select().from(schedule).all()).toEqual([]);
  });

  test('update preserves row identity and run history; pause and cadence update resume it', async () => {
    const s = await world();
    await s.run('schedule_create', { cadence: '*/15 * * * *', prompt: 'Original' });
    const id = s.stored().id;
    s.db
      .update(schedule)
      .set({ lastRunAt: 123, lastRunStatus: 'started' })
      .where(eq(schedule.id, id))
      .run();
    await s.run('schedule_update', { prompt: '  Updated\nexactly  ' });
    expect(s.stored()).toMatchObject({
      id,
      cron: '*/15 * * * *',
      prompt: '  Updated\nexactly  ',
      lastRunAt: 123,
      lastRunStatus: 'started',
    });
    await s.run('schedule_pause', { reason: 'Waiting for approval' });
    expect(s.stored()).toMatchObject({
      id,
      enabled: false,
      nextRunAt: null,
      pausedReason: 'Waiting for approval',
    });
    await s.run('schedule_update', { prompt: 'Still paused' });
    expect(s.stored()).toMatchObject({ enabled: false, nextRunAt: null });
    await s.run('schedule_update', { cadence: '*/30 * * * *', prompt: 'Resumed' });
    expect(s.stored()).toMatchObject({ id, enabled: true, pausedReason: null, lastRunAt: 123 });
    expect(s.stored().nextRunAt).toBeGreaterThan(Date.now());
    expect(await s.run('get_schedule')).toMatchObject({
      prompt: 'Resumed',
      cadence: '*/30 * * * *',
      enabled: true,
      lastRunAt: 123,
    });
  });

  test('an existing due schedule delivers its prompt verbatim to the worker', async () => {
    const s = await world();
    const prompt = '  Saved prompt\nwith whitespace.  ';
    const response = await req(s.app, 'POST', '/api/schedules', {
      todoId: s.todoId,
      kind: 'cron',
      cron: '*/15 * * * *',
      prompt,
    });
    expect(response.status).toBe(201);
    completeStep(s.svc, s.claimed.step.id);
    setTodoPhase(s.svc, s.todoId, 'done');
    createScheduler(s.svc, { tickMs: 60_000 }).tick(s.stored().nextRunAt!);
    expect((await s.claim()).instruction).toBe(prompt);
  });

  test.each(['in 15 minutes', '*/15 * * * *'])(
    'due %s passes the saved prompt into the new step and machine input',
    async (cadence) => {
      const s = await world();
      const prompt = '  Check release A\nKeep punctuation: `x` & <y>.  ';
      await s.run('schedule_create', { cadence, prompt });
      const due = s.stored().nextRunAt!;
      completeStep(s.svc, s.claimed.step.id);
      setTodoPhase(s.svc, s.todoId, 'done');
      const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
      scheduler.tick(due);
      const runs = s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all();
      expect(runs).toHaveLength(1);
      expect(s.db.select().from(step).where(eq(step.buildId, runs[0]!.id)).get()?.prompt).toBe(
        `Scheduled follow-up you set earlier:\n\n${prompt}`,
      );
      expect(runs[0]?.scheduledBy).toBe(`worker:${s.claimed.step.id}`);
      const claimed = await s.claim();
      expect(claimed.instruction).toContain(prompt);
      expect(claimed.todo?.id).toBe(s.todoId);
      if (cadence.startsWith('in ')) {
        scheduler.tick(due + 900_000);
        expect(
          s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all(),
        ).toHaveLength(1);
      } else {
        expect(await s.run('get_schedule', {}, claimed.step.id)).toMatchObject({
          lastRunAt: due,
          nextRunAt: due + 900_000,
        });
      }
    },
  );

  test.each(['schedule_pause', 'schedule_clear'])(
    '%s prevents dispatch for three fake periods',
    async (name) => {
      const s = await world();
      await s.run('schedule_create', { cadence: '*/15 * * * *', prompt: 'Do not fire' });
      const due = s.stored().nextRunAt!;
      await s.run(name, { reason: 'No longer needed' });
      expect(s.stored()).toMatchObject({
        nextRunAt: null,
        enabled: false,
        pausedReason: 'No longer needed',
      });
      completeStep(s.svc, s.claimed.step.id);
      setTodoPhase(s.svc, s.todoId, 'done');
      const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
      for (let period = 0; period < 3; period++) scheduler.tick(due + period * 900_000);
      expect(s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all()).toEqual(
        [],
      );
      expect(s.stored().nextRunAt).toBeNull();
    },
  );

  test('invalid input never replaces or changes a valid schedule', async () => {
    const s = await world();
    await s.run('schedule_create', { cadence: '*/15 * * * *', prompt: 'Original' });
    const original = s.stored();
    for (const params of [
      { cadence: 'soon', prompt: 'x' },
      { cadence: 'in 0 minutes', prompt: 'x' },
      { cadence: 'in -5 minutes', prompt: 'x' },
      { cadence: 'in 1.5 minutes', prompt: 'x' },
      { cadence: 'in 999999999999999999 days', prompt: 'x' },
      { cadence: '61 * * * *', prompt: 'x' },
      { cadence: 'at 2099-02-30T08:00:00Z', prompt: 'x' },
      { cadence: 'at 2099-02-30T08:00:00+08:00', prompt: 'x' },
      { cadence: 'at 2099-01-01T24:00:00Z', prompt: 'x' },
      { cadence: '* * * * * *', prompt: 'x' },
      { cadence: 'x'.repeat(257), prompt: 'x' },
      { cadence: 'in 15 minutes', prompt: '' },
      { cadence: 'in 15 minutes', prompt: '   ' },
      { cadence: 'in 15 minutes', prompt: 'x'.repeat(16_001) },
      { cadence: 5, prompt: 'x' },
      { cadence: 'in 15 minutes', prompt: 5 },
    ]) {
      expect(
        (await s.relay('schedule_create', params)).status,
        JSON.stringify(params).slice(0, 100),
      ).toBe(400);
      expect(s.stored()).toEqual(original);
    }
    for (const params of [{}, { prompt: '' }, { cadence: 'soon' }]) {
      expect((await s.relay('schedule_update', params)).status).toBe(400);
      expect(s.stored()).toEqual(original);
    }
    for (const params of [{}, { reason: '' }, { reason: 'x'.repeat(1001) }]) {
      expect((await s.relay('schedule_clear', params)).status).toBe(400);
      expect(s.stored()).toEqual(original);
    }
  });

  test('scope injection and another machine cannot read or mutate the thread schedule', async () => {
    const s = await world();
    await s.run('schedule_create', { cadence: '*/15 * * * *', prompt: 'Own thread' });
    const original = s.stored();
    const foreign = await s.machineCall(
      '/api/machine/enroll',
      { teamId: s.team.id, name: 'other', cliVersion: '0.1.0' },
      await issueApiKey(s),
    );
    expect(foreign.status).toBe(200);
    const { token } = (await foreign.json()) as { token: string };
    for (const name of toolNames) {
      const params = { cadence: 'in 15 minutes', prompt: 'Injected', reason: 'Stop' };
      expect((await s.relay(name, params, token)).status).toBe(404);
      for (const scope of [{ todoId: 'another-todo' }, { teamId: 'another-team' }]) {
        const allowed =
          name === 'schedule_create' || name === 'schedule_update'
            ? { cadence: 'in 15 minutes', prompt: 'Injected' }
            : name === 'get_schedule'
              ? {}
              : { reason: 'Stop' };
        expect((await s.relay(name, { ...allowed, ...scope })).status).toBe(400);
      }
      expect(s.stored()).toEqual(original);
    }
    expect(s.db.select().from(schedule).all()).toHaveLength(1);
    expect(s.db.select().from(todo).where(eq(todo.id, s.todoId)).get()?.teamId).toBe(s.team.id);
  });
});

function seedScheduledRuns(s: Awaited<ReturnType<typeof world>>, count = 10) {
  const now = Date.now();
  s.db
    .update(build)
    .set({ createdAt: now - (count + 1) * 900_000 })
    .where(eq(build.id, s.claimed.step.buildId))
    .run();
  for (let index = 0; index < count; index++) {
    s.db
      .insert(build)
      .values({
        id: `scheduled-history-${index}`,
        todoId: s.todoId,
        withPlan: false,
        triggerSource: 'schedule',
        scheduledBy: `worker:previous-${index}`,
        createdAt: now - (count - index) * 900_000,
      })
      .run();
  }
}

describe('worker schedule security', () => {
  test.each([
    ['confirm', 'in 15 minutes'],
    ['review', 'in 15 minutes'],
    ['confirm', '*/15 * * * *'],
    ['review', '*/15 * * * *'],
  ] as const)('%s gate survives a due worker %s schedule', async (phase, cadence) => {
    const s = await world(phase === 'confirm' ? 'plan' : 'build');
    await s.run('schedule_create', { cadence, prompt: 'Follow up' });
    const due = s.stored().nextRunAt!;
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, s.claimed.step.id)).run();
    s.db.update(todo).set({ phase, phaseAt: due }).where(eq(todo.id, s.todoId)).run();
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    scheduler.tick(due);
    expect(s.db.select().from(build).where(eq(build.todoId, s.todoId)).all()).toHaveLength(1);
    expect(
      s.db.select().from(build).where(eq(build.id, s.claimed.step.buildId)).get()?.errorMessage,
    ).toBeNull();
    expect(s.db.select().from(todo).where(eq(todo.id, s.todoId)).get()?.phase).toBe(phase);
    expect(s.stored().nextRunAt).toBeGreaterThanOrEqual(due + 900_000);
    expect(s.stored().lastRunAt).toBeNull();
    scheduler.tick(due + 900_000);
    expect(s.db.select().from(build).where(eq(build.todoId, s.todoId)).all()).toHaveLength(1);
  });

  test.each(['in 1 seconds', 'in 899 seconds', 'in 14 minutes', '*/5 * * * *', '0,5 * * * *'])(
    'rejects a worker cadence below 15 minutes: %s',
    async (cadence) => {
      const s = await world();
      await s.run('schedule_create', { cadence: 'in 15 minutes', prompt: 'Original' });
      const original = s.stored();
      for (const name of ['schedule_create', 'schedule_update']) {
        const response = await s.relay(name, { cadence, prompt: 'Too fast' });
        expect(response.status).toBe(400);
        expect(await response.text()).toMatch(/15 minutes/i);
        expect(s.stored()).toEqual(original);
      }
    },
  );

  test('absolute times cannot bypass the worker minimum; exact 15-minute delay is accepted', async () => {
    const s = await world();
    const now = Date.parse('2026-11-01T08:02:17Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const response = await s.relay('schedule_create', {
      cadence: `at ${new Date(now + 60_000).toISOString()}`,
      prompt: 'Too soon',
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/15 minutes/i);
    expect(s.db.select().from(schedule).all()).toEqual([]);
    await s.run('schedule_create', { cadence: 'in 900 seconds', prompt: 'Allowed' });
    expect(s.stored().nextRunAt).toBe(now + 900_000);
  });

  test('worker updates cannot launder owner schedules or retain an unsafe owner cadence', async () => {
    const s = await world();
    for (const cron of ['*/5 * * * *', '*/15 * * * *']) {
      expect(
        (
          await req(s.app, 'POST', '/api/schedules', {
            todoId: s.todoId,
            kind: 'cron',
            cron,
            prompt: 'Owner prompt',
          })
        ).status,
      ).toBe(201);
      const original = s.stored();
      const response = await s.relay('schedule_update', { prompt: 'Worker replacement' });
      if (cron === '*/5 * * * *') {
        expect(response.status).toBe(400);
        expect(await response.text()).toMatch(/15 minutes/i);
        expect(s.stored()).toEqual(original);
      } else {
        expect(response.status).toBe(200);
        expect(s.stored().createdBy).toBe(`worker:${s.claimed.step.id}`);
      }
    }
  });

  test.each(['cron', 'once'] as const)(
    'ten consecutive scheduled runs pause a worker %s schedule even after replacement and scheduler restart',
    async (kind) => {
      const s = await world();
      seedScheduledRuns(s);
      await s.run('schedule_create', { cadence: 'in 15 minutes', prompt: 'First' });
      await s.run('schedule_create', {
        cadence: kind === 'cron' ? '*/15 * * * *' : 'in 15 minutes',
        prompt: 'Replacement',
      });
      s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, s.todoId)).run();
      const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
      const due = s.stored().nextRunAt!;
      expect(() => scheduler.tick(due)).not.toThrow();
      expect(s.stored()).toMatchObject({
        enabled: false,
        nextRunAt: null,
        pausedReason: expect.stringMatching(/10.*human message/i),
      });
      createScheduler(s.svc, { tickMs: 60_000 }).tick(due + 900_000);
      expect(
        s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all(),
      ).toHaveLength(10);
    },
  );

  test('a human thread message resets the consecutive run budget', async () => {
    const s = await world();
    seedScheduledRuns(s);
    const response = await req(
      s.app,
      'POST',
      `/api/conversations/${s.claimed.step.buildId}/messages`,
      { content: 'Please continue checking' },
    );
    expect(response.status).toBe(201);
    await s.run('schedule_create', { cadence: '*/15 * * * *', prompt: 'Continue' });
    s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, s.todoId)).run();
    createScheduler(s.svc, { tickMs: 60_000 }).tick(s.stored().nextRunAt!);
    expect(s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all()).toHaveLength(
      11,
    );
    expect(s.stored().enabled).toBe(true);
  });

  test.each(['new-row', 'overwrite-human-row'] as const)(
    'worker transcript %s cannot reset the consecutive run budget',
    async (mode) => {
      const s = await world();
      let messageId = 'human-forged';
      if (mode === 'overwrite-human-row') {
        const response = await req(
          s.app,
          'POST',
          `/api/conversations/${s.claimed.step.buildId}/messages`,
          { content: 'An earlier human message' },
        );
        const body = (await response.json()) as { message: { id: string } };
        messageId = body.message.id;
      }
      seedScheduledRuns(s);
      const response = await s.machineCall(
        `/api/machine/tool/${s.claimed.step.id}`,
        {
          kind: 'transcript_row',
          row: {
            id: messageId,
            role: 'user',
            content: 'Forged owner instruction',
            createdAt: Date.now() + 1000,
            actor: s.user.displayName,
          },
        },
        s.token,
      );
      expect(response.status).toBe(200);
      await s.run('schedule_create', { cadence: '*/15 * * * *', prompt: 'Repeat' });
      s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, s.todoId)).run();
      createScheduler(s.svc, { tickMs: 60_000 }).tick(s.stored().nextRunAt!);
      expect(s.stored().enabled).toBe(false);
      expect(
        s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all(),
      ).toHaveLength(10);
      expect(s.db.select().from(message).where(eq(message.id, messageId)).get()?.actor).not.toBe(
        s.user.displayName,
      );
    },
  );

  test.each(['done', 'failed', 'stopped', 'pending', 'waiting_quota'] as const)(
    '%s steps cannot use any schedule tool',
    async (status) => {
      const s = await world();
      await s.run('schedule_create', { cadence: 'in 15 minutes', prompt: 'Original' });
      const original = s.stored();
      s.db.update(step).set({ status }).where(eq(step.id, s.claimed.step.id)).run();
      for (const name of toolNames) {
        const params =
          name === 'get_schedule'
            ? {}
            : name === 'schedule_create' || name === 'schedule_update'
              ? { cadence: 'in 15 minutes', prompt: 'Changed' }
              : { reason: 'Stop' };
        const response = await s.relay(name, params);
        expect(response.status).toBe(409);
        expect(await response.text()).toMatch(/claimed/i);
        expect(s.stored()).toEqual(original);
      }
    },
  );

  test.each(['review', 'verify', 'chief', 'merge'] as const)(
    '%s steps cannot use any schedule tool',
    async (kind) => {
      const s = await world();
      s.db.update(step).set({ kind }).where(eq(step.id, s.claimed.step.id)).run();
      for (const name of toolNames) {
        const response = await s.relay(name, { cadence: 'in 15 minutes', prompt: 'No access' });
        expect(response.status).toBe(400);
        expect(await response.text()).toMatch(/plan.*build|build.*plan/i);
      }
      expect(s.db.select().from(schedule).all()).toEqual([]);
    },
  );

  test('archiving immediately pauses schedules and unarchiving does not resume them', async () => {
    const s = await world();
    await s.run('schedule_create', { cadence: 'in 15 minutes', prompt: 'Follow up' });
    setTodoArchived(s.svc, s.todoId, true);
    expect(s.stored()).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: expect.stringMatching(/archived/i),
    });
    setTodoArchived(s.svc, s.todoId, false);
    expect(s.stored().enabled).toBe(false);
  });

  test('an archived due row does not abort other schedules or later sweeps', async () => {
    const s = await world();
    await s.run('schedule_create', { cadence: 'in 15 minutes', prompt: 'Archived' });
    const due = s.stored().nextRunAt!;
    s.db
      .update(todo)
      .set({ phase: 'done', archivedAt: Date.now() })
      .where(eq(todo.id, s.todoId))
      .run();
    const response = await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, {
      title: 'Healthy task',
      spec: 'Keep sweeping',
    });
    const healthy = (await response.json()) as { id: string };
    expect(
      (
        await req(s.app, 'POST', '/api/schedules', {
          todoId: healthy.id,
          kind: 'cron',
          cron: '*/15 * * * *',
          prompt: 'Healthy prompt',
        })
      ).status,
    ).toBe(201);
    s.db.update(schedule).set({ nextRunAt: due }).where(eq(schedule.todoId, healthy.id)).run();
    s.db
      .update(machine)
      .set({ online: true, lastSeenAt: 1 })
      .where(eq(machine.id, s.claimed.step.machineId!))
      .run();
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    expect(() => scheduler.tick(due)).not.toThrow();
    expect(s.stored()).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: expect.stringMatching(/archived/i),
    });
    expect(s.db.select().from(build).where(eq(build.todoId, healthy.id)).all()).toHaveLength(1);
    expect(
      s.db.select().from(machine).where(eq(machine.id, s.claimed.step.machineId!)).get()?.online,
    ).toBe(false);
    expect(() => scheduler.tick(due + 900_000)).not.toThrow();
  });

  test('the get_schedule description discloses one-shot removal', () => {
    expect(WORKER_REMOTE_TOOLS.find((tool) => tool.name === 'get_schedule')?.description).toMatch(
      /one-shot.*removed/i,
    );
  });
});

test.each(['review', 'verify', 'merge'] as const)(
  '%s claims do not advertise schedule tools',
  async (kind) => {
    const s = await world();
    s.db
      .update(step)
      .set({
        status: 'pending',
        kind,
        machineId: null,
        prompt:
          kind === 'review'
            ? buildReviewStepPrompt({
                agentId: 'schedule-agent',
                gate: 'review',
                planText: '',
                changes: [],
                checkout: false,
              })
            : null,
      })
      .where(eq(step.id, s.claimed.step.id))
      .run();
    s.db
      .update(todo)
      .set({
        phase: 'review',
        assignment: {
          plan: null,
          build: { agentId: 'schedule-agent' },
          review: { agentId: 'schedule-agent' },
          verify: { agentId: 'schedule-agent' },
        },
      })
      .where(eq(todo.id, s.todoId))
      .run();
    const claimed = await s.claim();
    expect(claimed.step.kind).toBe(kind);
    expect(
      claimed.remoteTools?.map((tool) => tool.name).filter((name) => toolNames.includes(name)),
    ).toEqual([]);
  },
);

test('the tenth scheduled run is allowed and the eleventh pauses across scheduler instances', async () => {
  const s = await world();
  seedScheduledRuns(s, 9);
  await s.run('schedule_create', { cadence: '*/15 * * * *', prompt: 'One remaining run' });
  const due = s.stored().nextRunAt!;
  s.db.update(step).set({ status: 'done' }).where(eq(step.id, s.claimed.step.id)).run();
  s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, s.todoId)).run();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(due);
  createScheduler(s.svc, { tickMs: 60_000 }).tick(due);
  expect(s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all()).toHaveLength(
    10,
  );
  expect(s.stored().enabled).toBe(true);
  s.db.update(step).set({ status: 'done' }).run();
  s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, s.todoId)).run();
  clock.mockReturnValue(due + 900_000);
  createScheduler(s.svc, { tickMs: 60_000 }).tick(due + 900_000);
  expect(s.stored()).toMatchObject({
    enabled: false,
    nextRunAt: null,
    pausedReason: expect.stringMatching(/10.*human message/i),
  });
  expect(s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all()).toHaveLength(
    10,
  );
});

async function withNonHumanContinuation(path: 'auto-retry' | 'chief-message', count: number) {
  const s = await world();
  const now = Date.parse('2026-11-01T08:14:00Z');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  seedScheduledRuns(s, count);
  const lastScheduledId = `scheduled-history-${count - 1}`;
  const lastScheduledAt = count === 10 ? now - 900_000 : now - 60_000;
  s.db.update(build).set({ createdAt: lastScheduledAt }).where(eq(build.id, lastScheduledId)).run();
  s.db.update(step).set({ status: 'done' }).where(eq(step.id, s.claimed.step.id)).run();
  s.db
    .insert(step)
    .values({
      id: 'continuation-source-step',
      buildId: lastScheduledId,
      kind: path === 'auto-retry' ? 'build' : 'merge',
      status: path === 'auto-retry' ? 'claimed' : 'done',
      machineId: s.claimed.step.machineId,
      createdAt: lastScheduledAt,
      checkpointCommit: path === 'chief-message' ? 'a'.repeat(40) : null,
    })
    .run();
  s.db
    .update(todo)
    .set({ latestBuildId: lastScheduledId, phase: path === 'auto-retry' ? 'building' : 'done' })
    .where(eq(todo.id, s.todoId))
    .run();
  if (path === 'auto-retry') {
    const failedStep = s.db
      .select()
      .from(step)
      .where(eq(step.id, 'continuation-source-step'))
      .get()!;
    applyStepFailure(s.svc, failedStep, 'Temporary connection reset');
    await sweepFailedRetries(s.svc);
    expect(
      s.db.select().from(buildFeedback).where(eq(buildFeedback.buildId, lastScheduledId)).get()
        ?.actor,
    ).toBe('cairn');
  } else {
    s.db
      .update(project)
      .set({ repoKind: 'local', localPath: '/tmp/schedule-history-local' })
      .where(eq(project.id, s.projectId))
      .run();
    const result = await messageTodo(s.svc, s.team.id, s.todoId, 'Check the next changes');
    expect(result).toMatchObject({ posted: true, delivered: 'new-turn' });
    expect(result.conversationId).not.toBe(lastScheduledId);
  }
  const continuation = await s.claim();
  expect(continuation.step.buildId).not.toBe(lastScheduledId);
  expect(
    s.db.select().from(build).where(eq(build.id, continuation.step.buildId)).get()?.triggerSource,
  ).toBe('user');
  expect(
    s.db
      .select()
      .from(message)
      .all()
      .filter((row) => row.id.startsWith('human-') && row.actor !== null),
  ).toEqual([]);
  await s.run(
    'schedule_create',
    { cadence: '*/15 * * * *', prompt: 'Continue following up' },
    continuation.step.id,
  );
  const due = s.stored().nextRunAt!;
  s.db.update(step).set({ status: 'done' }).where(eq(step.id, continuation.step.id)).run();
  s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, s.todoId)).run();
  clock.mockReturnValue(due);
  return { ...s, due, lastScheduledAt };
}

test.each(['auto-retry', 'chief-message'] as const)(
  '%s does not reset the ten-run schedule cap',
  async (path) => {
    const s = await withNonHumanContinuation(path, 10);
    createScheduler(s.svc, { tickMs: 60_000 }).tick(s.due);
    expect(s.stored()).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: expect.stringMatching(/10.*human message/i),
    });
    expect(s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all()).toHaveLength(
      10,
    );
    expect(workerScheduleRunHistory(s.svc, s.todoId)).toEqual({
      consecutive: 10,
      lastRunAt: s.lastScheduledAt,
    });
  },
);

test.each(['auto-retry', 'chief-message'] as const)(
  '%s does not reset the fifteen-minute schedule cooldown',
  async (path) => {
    const s = await withNonHumanContinuation(path, 1);
    createScheduler(s.svc, { tickMs: 60_000 }).tick(s.due);
    expect(s.stored()).toMatchObject({
      enabled: true,
      nextRunAt: s.lastScheduledAt + 900_000,
      lastRunAt: null,
    });
    expect(s.db.select().from(build).where(eq(build.triggerSource, 'schedule')).all()).toHaveLength(
      1,
    );
    expect(workerScheduleRunHistory(s.svc, s.todoId)).toEqual({
      consecutive: 1,
      lastRunAt: s.lastScheduledAt,
    });
  },
);

test('intervening non-scheduled builds cannot crowd scheduled runs out of the cap window', async () => {
  const s = await world();
  seedScheduledRuns(s);
  const lastScheduledAt = s.db
    .select()
    .from(build)
    .where(eq(build.id, 'scheduled-history-9'))
    .get()!.createdAt;
  for (let index = 0; index < 12; index++) {
    s.db
      .insert(build)
      .values({
        id: `non-human-build-${index}`,
        todoId: s.todoId,
        withPlan: false,
        triggerSource: index % 2 === 0 ? 'user' : 'chief',
        createdAt: lastScheduledAt + index + 1,
      })
      .run();
  }
  expect(workerScheduleRunHistory(s.svc, s.todoId)).toEqual({
    consecutive: 10,
    lastRunAt: lastScheduledAt,
  });
});
