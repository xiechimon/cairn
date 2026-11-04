import { todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import { agent, build, message, plan, project, schedule, step, todo } from '../src/db/schema.js';
import * as builds from '../src/services/builds.js';
import { claimStep } from '../src/services/machine-claim.js';
import { upsertMessage } from '../src/services/machine-deps.js';
import { finishStep } from '../src/services/machine-finish-step.js';
import { sweepFailedRetries } from '../src/services/needs-you.js';
import { PhaseTransitionError } from '../src/services/phase.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule, workerScheduleRunHistory } from '../src/services/schedules.js';
import { bootServer, insertMachine, postProject, req } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

async function world(kind: 'once' | 'cron' = 'cron') {
  const s = bootServer();
  const machineId = insertMachine(s);
  s.db
    .insert(agent)
    .values({
      id: 'scheduled-agent',
      teamId: s.team.id,
      displayName: 'Worker',
      provider: 'p',
      modelId: 'm',
      machineId,
    })
    .run();
  const projectId = await postProject(s.app, 'Scheduled continuation');
  const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Check changes',
    spec: 'Keep checking',
  });
  const { id: todoId } = (await response.json()) as { id: string };
  const [started] = builds.startBuilds(s.svc, {
    projectId,
    todoIds: [todoId],
    assignment: { plan: null, build: { agentId: 'scheduled-agent' } },
    withPlan: false,
  });
  const buildId = started!.id;
  const first = s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  s.db
    .update(step)
    .set({ status: 'done', machineId, sessionId: 'previous-session', createdAt: Date.now() - 1000 })
    .where(eq(step.id, first.id))
    .run();
  s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, todoId)).run();
  s.db
    .insert(message)
    .values({
      id: 'previous-response',
      conversationId: buildId,
      role: 'assistant',
      content: 'Earlier result',
      createdAt: Date.now() - 500,
    })
    .run();
  const saved = createSchedule(s.svc, {
    teamId: s.team.id,
    createdBy: `worker:${first.id}`,
    todoId,
    prompt: 'Check again',
    tz: 'UTC',
    ...(kind === 'cron'
      ? { kind, cron: '*/15 * * * *' }
      : { kind, at: Math.ceil((Date.now() + 900_000) / 900_000) * 900_000 }),
  });
  const due = saved.nextRunAt!;
  const stored = () => s.db.select().from(schedule).where(eq(schedule.id, saved.id)).get();
  return {
    ...s,
    machineId,
    projectId,
    todoId,
    buildId,
    first,
    saved,
    due,
    stored,
    scheduler: createScheduler(s.svc, { tickMs: 60_000 }),
  };
}

test('a scheduled wake appends a step, resumes the session and grows the same transcript', async () => {
  const s = await world();
  const steer = vi.spyOn(builds, 'sendBuildSteer');
  await s.scheduler.tick(s.due);
  expect(steer).toHaveBeenCalledOnce();
  expect(s.db.select().from(todo).all()).toHaveLength(1);
  expect(s.db.select().from(build).all()).toHaveLength(1);
  expect(s.db.select().from(todo).get()?.latestBuildId).toBe(s.buildId);
  const steps = s.db.select().from(step).all();
  expect(steps).toHaveLength(2);
  expect(steps[1]).toMatchObject({
    buildId: s.buildId,
    freshSession: false,
    prompt: 'Scheduled follow-up you set earlier:\n\nCheck again',
  });
  const claimed = await claimStep(
    { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
    s.machineId,
    s.team.id,
    1,
    'http://localhost',
  );
  expect(claimed?.session).toMatchObject({ action: 'continue', sessionId: 'previous-session' });
  upsertMessage(s.svc, {
    id: 'scheduled-response',
    conversationId: s.buildId,
    role: 'assistant',
    content: 'New scheduled result',
    createdAt: Date.now(),
  });
  builds.completeStep(s.svc, claimed!.step.id);
  expect(s.stored()).toMatchObject({ lastRunStatus: 'completed' });
  const transcript = (await (
    await req(s.app, 'GET', `/api/conversations/${s.buildId}/messages`)
  ).json()) as { messages: { id: string }[] };
  expect(transcript.messages.map((row) => row.id)).toEqual(
    expect.arrayContaining(['previous-response', 'scheduled-response']),
  );
  const rows = s.db.select().from(message).where(eq(message.conversationId, s.buildId)).all();
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'previous-response' }),
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('schedule-wake'),
      }),
    ]),
  );
  expect(rows.filter((row) => row.role === 'user')).toEqual([]);
});

test.each([
  'connection reset',
  'HTTP 429 rate limit',
  'HTTP 503 service unavailable',
  'Invalid API key',
])('step failure records its message and only pauses permanent errors: %s', async (reason) => {
  const s = await world();
  await s.scheduler.tick(s.due);
  const fired = s.db.select().from(step).all().at(-1)!;
  const nextRunAt = s.stored()!.nextRunAt;
  builds.applyStepFailure(s.svc, fired, reason);
  expect(s.stored()).toMatchObject({ lastRunStatus: 'failed', lastRunError: reason });
  if (reason === 'Invalid API key')
    expect(s.stored()).toMatchObject({ enabled: false, nextRunAt: null, pausedReason: reason });
  else expect(s.stored()).toMatchObject({ enabled: true, nextRunAt, pausedReason: null });
});

test.each(['connection reset', 'Invalid API key'])(
  'fault-injected start does not reject tick and records failure: %s',
  async (reason) => {
    const s = await world();
    vi.spyOn(builds, 'sendBuildSteer').mockRejectedValueOnce(new Error(reason));
    await expect(Promise.resolve(s.scheduler.tick(s.due))).resolves.toBeUndefined();
    expect(s.stored()).toMatchObject({ lastRunStatus: 'failed', lastRunError: reason });
    await sweepFailedRetries(s.svc);
    expect(s.db.select().from(build).all()).toHaveLength(1);
    expect(s.db.select().from(build).all()).toHaveLength(1);
    if (reason === 'connection reset')
      expect(s.stored()).toMatchObject({ enabled: true, nextRunAt: s.due });
    else expect(s.stored()).toMatchObject({ enabled: false, pausedReason: reason });
  },
);

test('overlapping ticks enqueue only one continuation', async () => {
  const s = await world();
  await Promise.all([s.scheduler.tick(s.due), s.scheduler.tick(s.due)]);
  expect(s.db.select().from(build).all()).toHaveLength(1);
  expect(s.db.select().from(step).all()).toHaveLength(2);
});

test('continued runs count toward the worker cap across scheduler restarts', async () => {
  const s = await world();
  const clock = vi.spyOn(Date, 'now');
  for (let index = 0; index < 10; index++) {
    const at = s.due + index * 900_000;
    clock.mockReturnValue(at);
    await createScheduler(s.svc, { tickMs: 60_000 }).tick(at);
    s.db.update(step).set({ status: 'done' }).run();
    s.db.update(todo).set({ phase: 'done' }).where(eq(todo.id, s.todoId)).run();
  }
  expect(workerScheduleRunHistory(s.svc, s.todoId).consecutive).toBe(10);
  await createScheduler(s.svc, { tickMs: 60_000 }).tick(s.due + 10 * 900_000);
  expect(s.stored()).toMatchObject({
    enabled: false,
    pausedReason: expect.stringMatching(/10.*human message/i),
  });
  expect(s.db.select().from(build).all()).toHaveLength(1);
  expect(s.db.select().from(step).all()).toHaveLength(11);
});

test('a locally merged task pauses instead of creating a replacement build', async () => {
  const s = await world();
  s.db
    .update(project)
    .set({ repoKind: 'local', localPath: '/tmp/scheduled-local' })
    .where(eq(project.id, s.projectId))
    .run();
  s.db
    .insert(step)
    .values({
      id: 'landed-merge',
      buildId: s.buildId,
      kind: 'merge',
      status: 'done',
      checkpointCommit: 'a'.repeat(40),
      createdAt: Date.now(),
    })
    .run();
  await s.scheduler.tick(s.due);
  expect(s.stored()).toMatchObject({
    enabled: false,
    pausedReason: expect.stringMatching(/new (build|branch)|merged/i),
  });
  expect(s.db.select().from(build).all()).toHaveLength(1);
});

test('a fired one-shot failure never rearms the schedule', async () => {
  const s = await world('once');
  await s.scheduler.tick(s.due);
  const fired = s.db.select().from(step).all().at(-1)!;
  builds.applyStepFailure(s.svc, fired, 'connection reset');
  expect(s.stored()).toMatchObject({
    enabled: true,
    nextRunAt: null,
    lastRunStatus: 'failed',
    lastRunError: 'connection reset',
  });
});

test.each(['merged', 'closed', 'unreadable'] as const)(
  'a %s GitHub PR does not create a replacement build',
  async (state) => {
    const s = await world();
    s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'example/tasks' })
      .where(eq(project.id, s.projectId))
      .run();
    s.db.update(build).set({ prNumber: 43 }).where(eq(build.id, s.buildId)).run();
    const githubFetch = vi.fn(async () =>
      state === 'unreadable'
        ? new Response('Unavailable', { status: 503 })
        : Response.json({ state: 'closed', merged: state === 'merged' }),
    );
    const scheduler = createScheduler({ ...s.svc, githubFetch }, { tickMs: 60_000 });
    await expect(scheduler.tick(s.due)).resolves.toBeUndefined();
    expect(s.db.select().from(build).all()).toHaveLength(1);
    expect(s.db.select().from(step).all()).toHaveLength(1);
    if (state === 'unreadable')
      expect(s.stored()).toMatchObject({
        enabled: true,
        nextRunAt: s.due,
        lastRunStatus: 'failed',
      });
    else
      expect(s.stored()).toMatchObject({
        enabled: false,
        lastRunStatus: 'failed',
        pausedReason: expect.stringMatching(/merged|new build/i),
      });
  },
);

test('a failed continuation does not prevent another due schedule from starting', async () => {
  const s = await world();
  const healthyResponse = await req(s.app, 'POST', `/api/projects/${s.projectId}/todos`, {
    title: 'Healthy scheduled task',
    spec: 'Keep checking',
  });
  expect(healthyResponse.status, await healthyResponse.clone().text()).toBe(201);
  const { id: healthyId } = todoRecordSchema.parse(await healthyResponse.json());
  createSchedule(s.svc, {
    teamId: s.team.id,
    createdBy: s.user.id,
    todoId: healthyId,
    kind: 'cron',
    cron: '*/15 * * * *',
    tz: 'UTC',
  });
  vi.spyOn(builds, 'sendBuildSteer').mockRejectedValueOnce(new Error('connection reset'));
  const start = vi.spyOn(builds, 'startBuilds');
  await expect(s.scheduler.tick(s.due)).resolves.toBeUndefined();
  expect(start).toHaveBeenCalledOnce();
  expect(
    s.db.select().from(todo).where(eq(todo.id, healthyId)).get()?.latestBuildId,
  ).not.toBeNull();
  expect(s.stored()).toMatchObject({ enabled: true, lastRunStatus: 'failed', nextRunAt: s.due });
});

test('a replaced schedule is not paused by a step from its previous run', async () => {
  const s = await world();
  await s.scheduler.tick(s.due);
  const fired = s.db.select().from(step).all().at(-1)!;
  const replacement = createSchedule(s.svc, {
    teamId: s.team.id,
    createdBy: s.user.id,
    todoId: s.todoId,
    kind: 'cron',
    cron: '*/30 * * * *',
    tz: 'UTC',
  });
  builds.applyStepFailure(s.svc, fired, 'Invalid API key');
  expect(s.db.select().from(schedule).where(eq(schedule.id, replacement.id)).get()).toMatchObject({
    enabled: true,
    lastRunStatus: null,
    pausedReason: null,
  });
});

test.each(['pause', 'review-gate'] as const)(
  '%s while a PR read is pending prevents the wake',
  async (action) => {
    const s = await world();
    s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'example/tasks' })
      .where(eq(project.id, s.projectId))
      .run();
    s.db.update(build).set({ prNumber: 43 }).where(eq(build.id, s.buildId)).run();
    let finishRead: (response: Response) => void = () => {
      throw new Error('PR read has not started');
    };
    const response = new Promise<Response>((resolve) => {
      finishRead = resolve;
    });
    const githubFetch = vi.fn(() => response);
    const scheduler = createScheduler({ ...s.svc, githubFetch }, { tickMs: 60_000 });
    const ticking = scheduler.tick(s.due);
    await vi.waitFor(() => expect(githubFetch).toHaveBeenCalledOnce());
    if (action === 'pause') {
      s.db
        .update(schedule)
        .set({ enabled: false, nextRunAt: null, pausedReason: 'Paused by owner' })
        .where(eq(schedule.id, s.saved.id))
        .run();
    } else {
      s.db.update(todo).set({ phase: 'review' }).where(eq(todo.id, s.todoId)).run();
    }
    finishRead(Response.json({ state: 'open', merged: false }));
    await ticking;
    expect(s.db.select().from(step).all()).toHaveLength(1);
    if (action === 'pause')
      expect(s.stored()).toMatchObject({ enabled: false, pausedReason: 'Paused by owner' });
    else {
      expect(s.stored()).toMatchObject({
        enabled: true,
        nextRunAt: s.due + 900_000,
        lastRunAt: null,
      });
      expect(s.db.select().from(todo).where(eq(todo.id, s.todoId)).get()?.phase).toBe('review');
    }
  },
);

test.each(['pending-stop', 'acknowledged-stop', 'exit-stop'] as const)(
  'a fired one-shot never restarts after %s',
  async (ending) => {
    const s = await world('once');
    await s.scheduler.tick(s.due);
    expect(s.stored()?.nextRunAt).toBeNull();
    const fired = s.db.select().from(step).all().at(-1)!;
    if (ending === 'pending-stop') builds.requestStop(s.svc, s.buildId, { discard: true });
    else if (ending === 'acknowledged-stop') {
      s.db.update(step).set({ status: 'claimed' }).where(eq(step.id, fired.id)).run();
      builds.applyStoppedStep(s.svc, fired.id);
    } else builds.stopActiveStepsAfterExit(s.svc, s.todoId);
    expect(s.stored()).toMatchObject({
      nextRunAt: null,
      lastRunStatus: 'stopped',
      lastRunStepId: fired.id,
    });
    const count = s.db.select().from(step).all().length;
    await s.scheduler.tick(s.due + 3_600_000);
    expect(s.db.select().from(step).all()).toHaveLength(count);
  },
);

test.each(['failure', 'direct-residual'] as const)(
  'a one-shot delivered plan records the %s outcome without refiring',
  async (ending) => {
    const s = await world('once');
    s.db.update(step).set({ kind: 'plan' }).where(eq(step.id, s.first.id)).run();
    await s.scheduler.tick(s.due);
    const fired = s.db.select().from(step).all().at(-1)!;
    s.db
      .insert(plan)
      .values({
        id: 'delivered-plan',
        buildId: s.buildId,
        content: 'Delivered plan',
        createdAt: s.due,
      })
      .run();
    s.db
      .update(todo)
      .set({ phase: 'confirm', phaseAt: s.due + 3_600_000 })
      .where(eq(todo.id, s.todoId))
      .run();
    if (ending === 'failure') builds.applyStepFailure(s.svc, fired, 'Plan stream disconnected');
    else
      expect(builds.noteDeliveredPlanResidual(s.svc, fired, 'Plan stream disconnected')).toBe(true);
    expect(s.stored()).toMatchObject({
      nextRunAt: null,
      lastRunStatus: 'failed',
      lastRunError: 'Plan stream disconnected',
    });
    expect(s.db.select().from(todo).get()?.phase).toBe('confirm');
    await s.scheduler.tick(s.due + 900_000);
    expect(s.db.select().from(step).all()).toHaveLength(2);
  },
);

test('an owner schedule at confirm cancels the old build and starts a build without planning', async () => {
  const s = await world();
  s.db.update(schedule).set({ createdBy: s.user.id }).where(eq(schedule.id, s.saved.id)).run();
  s.db.update(step).set({ kind: 'plan' }).where(eq(step.id, s.first.id)).run();
  s.db.update(todo).set({ phase: 'confirm', phaseAt: s.due }).where(eq(todo.id, s.todoId)).run();
  await s.scheduler.tick(s.due);
  expect(s.db.select().from(build).where(eq(build.id, s.buildId)).get()?.errorMessage).toBe(
    'Cancelled',
  );
  const fresh = s.db.select().from(build).all().at(-1)!;
  expect(fresh).toMatchObject({ withPlan: false, triggerSource: 'schedule', prevPhase: 'confirm' });
  expect(fresh.id).not.toBe(s.buildId);
  expect(s.db.select().from(step).all().at(-1)).toMatchObject({ buildId: fresh.id, kind: 'build' });
});

test.each(['queued', 'todo', 'closed'] as const)(
  'an owner %s phase refusal skips the slot without pausing',
  async (phase) => {
    for (const kind of ['once', 'cron'] as const) {
      const s = await world(kind);
      s.db.update(schedule).set({ createdBy: s.user.id }).where(eq(schedule.id, s.saved.id)).run();
      s.db.update(todo).set({ phase }).where(eq(todo.id, s.todoId)).run();
      await s.scheduler.tick(s.due);
      expect(s.stored()).toMatchObject({
        enabled: true,
        pausedReason: null,
        lastRunStatus: kind === 'once' ? 'skipped' : null,
        lastRunError: kind === 'once' ? expect.any(String) : null,
        nextRunAt: kind === 'once' ? null : s.due + 900_000,
      });
      expect(s.db.select().from(step).all()).toHaveLength(1);
    }
  },
);

test('a transient start failure keeps its slot but cannot retry for five minutes across scheduler instances', async () => {
  const s = await world();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(s.due);
  const steer = vi
    .spyOn(builds, 'sendBuildSteer')
    .mockRejectedValueOnce(new Error('connection reset'));
  await s.scheduler.tick(s.due);
  expect(s.stored()).toMatchObject({ enabled: true, nextRunAt: s.due });
  clock.mockReturnValue(s.due + 299_999);
  await createScheduler(s.svc, { tickMs: 60_000 }).tick(s.due + 299_999);
  expect(steer).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(s.due + 300_000);
  await createScheduler(s.svc, { tickMs: 60_000 }).tick(s.due + 300_000);
  expect(steer).toHaveBeenCalledTimes(2);
});

test.each(['once', 'cron'] as const)(
  'a scheduled %s push-hook completion settles its schedule before queuing a CI fix',
  async (kind) => {
    const s = await world(kind);
    await s.scheduler.tick(s.due);
    const deps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };
    const claimed = await claimStep(deps, s.machineId, s.team.id, 1, 'http://localhost');
    expect(claimed).not.toBeNull();
    await finishStep(deps, s.machineId, claimed!.step.id, {
      status: 'success',
      hasChanges: true,
      pushHookOutput: 'pre-push: lint failed',
    });
    expect(s.db.select().from(step).where(eq(step.id, claimed!.step.id)).get()?.status).toBe(
      'done',
    );
    const steps = s.db.select().from(step).all();
    expect(steps).toHaveLength(3);
    expect(steps.at(-1)).toMatchObject({
      buildId: s.buildId,
      status: 'pending',
      prompt: expect.stringContaining('pre-push: lint failed'),
    });
    if (kind === 'once') expect(s.stored()).toBeUndefined();
    else
      expect(s.stored()).toMatchObject({
        lastRunStatus: 'completed',
        lastRunError: null,
        lastRunStepId: claimed!.step.id,
      });
  },
);

test.each(['once', 'cron'] as const)(
  'an owner %s PhaseTransitionError consumes or advances its refused slot',
  async (kind) => {
    const s = await world(kind);
    s.db.update(schedule).set({ createdBy: s.user.id }).where(eq(schedule.id, s.saved.id)).run();
    const refusal = new PhaseTransitionError('closed', 'queued');
    const steer = vi.spyOn(builds, 'sendBuildSteer').mockRejectedValue(refusal);
    await s.scheduler.tick(s.due);
    expect(s.stored()).toMatchObject({
      enabled: true,
      pausedReason: null,
      nextRunAt: kind === 'once' ? null : s.due + 900_000,
      lastRunStatus: kind === 'once' ? 'skipped' : null,
      lastRunError: kind === 'once' ? refusal.message : null,
    });
    await createScheduler(s.svc, { tickMs: 60_000 }).tick(s.due + 60_000);
    expect(steer).toHaveBeenCalledTimes(1);
  },
);
