import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  conversationBranch,
  DEFAULT_AUTONOMY_SETTINGS,
  type DocumentDiffFile,
  needsYouQuerySchema,
  type Phase,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  agent,
  autonomousMergeAdmission,
  build,
  plan,
  project,
  steerPending,
  step,
  stopPending,
  todo,
  tokenUsage,
} from '../src/db/schema.js';
import {
  applyStepFailure,
  applyStoppedStep,
  completeStep,
  prepareStopForDone,
  requestStop,
  sweepAbandonedBuildSteps,
  sweepZombieQueuedTodos,
} from '../src/services/builds.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { projectAtInFlightCap } from '../src/services/issue-intake.js';
import { claimStep, fetchStop, finishStep } from '../src/services/machines.js';
import { deleteProject } from '../src/services/projects.js';
import { inFlightIssues } from '../src/services/scheduling/sweep.js';
import { deleteTodo, resetTodo } from '../src/services/todos.js';
import { bootServer, insertMachine, req } from './helpers.js';

const files: DocumentDiffFile[] = [{ path: 'retained.ts', additions: 1, deletions: 0, hunks: [] }];

function world(
  phase: Phase = 'building',
  status: 'claimed' | 'pending' | 'waiting_quota' | 'done' = 'claimed',
) {
  const s = bootServer();
  const machineId = insertMachine(s);
  const now = Date.now();
  s.db.insert(project).values({ id: 'project-archive', teamId: s.team.id, name: 'Archive' }).run();
  s.db
    .insert(agent)
    .values({
      id: 'agent-archive',
      teamId: s.team.id,
      displayName: 'Builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId,
    })
    .run();
  s.db
    .insert(todo)
    .values({
      id: 'todo-archive',
      teamId: s.team.id,
      projectId: 'project-archive',
      title: 'Archive',
      phase,
      phaseAt: now,
      seqNum: 1,
      latestBuildId: 'build-archive',
      hasChanges: true,
      assignment: { plan: null, build: { agentId: 'agent-archive' } },
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'build-archive',
      todoId: 'todo-archive',
      withPlan: false,
      prevPhase: 'todo',
      triggerSource: 'user',
      createdAt: now,
      changes: files,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'step-archive',
      buildId: 'build-archive',
      kind: 'build',
      status,
      machineId: status === 'claimed' ? machineId : null,
      claimedAt: now,
      lastHeartbeatAt: now,
      createdAt: now,
    })
    .run();
  const deps = {
    ...s.svc,
    box: s.secretBox,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
  };
  return { s, machineId, deps, now };
}

async function action(s: ReturnType<typeof bootServer>, name: 'archive' | 'unarchive') {
  const response = await req(s.app, 'POST', `/api/todos/todo-archive/${name}`);
  expect(response.status).toBe(200);
  return response.json();
}

describe('archive is independent of task phase', () => {
  test.each([
    'todo',
    'queued',
    'planning',
    'confirm',
    'building',
    'review',
    'failed',
    'done',
    'closed',
  ] as const)('%s archives and unarchives without changing phase or phase time', async (phase) => {
    const { s, now } = world(phase, 'done');
    const archived = await action(s, 'archive');
    expect(archived).toMatchObject({
      phase,
      phaseAt: now,
      archivedAt: expect.any(Number),
      hasChanges: true,
    });
    expect(await action(s, 'archive')).toEqual(archived);
    expect(await action(s, 'unarchive')).toMatchObject({
      phase,
      phaseAt: now,
      archivedAt: null,
      hasChanges: true,
    });
    expect((await req(s.app, 'GET', '/api/todos/todo-archive')).status).toBe(200);
  });

  test.each(['stopped', 'success', 'failed'] as const)(
    'running archive keeps changes and lands an actionable phase after a late %s report',
    async (status) => {
      const { s, machineId, deps } = world();
      const events: unknown[] = [];
      s.machineHub.subscribe(s.team.id, (event) => events.push(event));
      await action(s, 'archive');
      expect(events).toContainEqual({ type: 'stop', stepId: 'step-archive' });
      expect(s.db.select().from(step).where(eq(step.id, 'step-archive')).get()?.status).toBe(
        'claimed',
      );
      expect(
        s.db
          .select({ archiveStop: step.archiveStop })
          .from(step)
          .where(eq(step.id, 'step-archive'))
          .get(),
      ).toEqual({ archiveStop: 'requested' });
      expect(fetchStop(deps, { id: machineId }, 'step-archive')).toEqual({ discard: false });
      await finishStep(deps, machineId, 'step-archive', {
        status,
        hasChanges: true,
        errorMessage: status === 'failed' ? 'Late failure' : undefined,
      });
      expect(s.db.select().from(step).where(eq(step.id, 'step-archive')).get()?.status).toBe(
        'stopped',
      );
      expect(
        await (await req(s.app, 'GET', '/api/builds/build-archive/changes')).json(),
      ).toMatchObject({ files });
      expect(await action(s, 'unarchive')).toMatchObject({
        phase: 'todo',
        archivedAt: null,
        hasChanges: true,
      });
    },
  );

  test.each([false, true])(
    'a stopped build returns to confirm and accepts composer revisions (Undo before report: %s)',
    async (undoFirst) => {
      const { s, machineId, deps, now } = world();
      s.db
        .insert(step)
        .values({
          id: 'delivered-plan',
          buildId: 'build-archive',
          kind: 'plan',
          status: 'done',
          createdAt: now - 1,
        })
        .run();
      s.db
        .insert(plan)
        .values({
          id: 'plan-archive',
          buildId: 'build-archive',
          content: '# Plan',
          createdAt: now - 1,
        })
        .run();
      await action(s, 'archive');
      if (undoFirst) await action(s, 'unarchive');
      await finishStep(deps, machineId, 'step-archive', { status: 'stopped' });
      const restored = undoFirst
        ? await (await req(s.app, 'GET', '/api/todos/todo-archive')).json()
        : await action(s, 'unarchive');
      expect(restored).toMatchObject({ phase: 'confirm', archivedAt: null });
      const revision = await req(s.app, 'POST', '/api/builds/build-archive/steps', {
        action: 'revision',
        side: 'plan',
        feedback: 'Continue with the retained work',
        clientMessageId: 'archive-revision',
      });
      expect(revision.status).toBe(202);
      expect(
        s.db
          .select()
          .from(step)
          .all()
          .some((row) => row.kind === 'plan' && row.status === 'pending'),
      ).toBe(true);
    },
  );

  test.each(['pending', 'waiting_quota'] as const)(
    'archive stops every %s step and lands an actionable phase',
    async (status) => {
      const { s, deps, machineId, now } = world('queued', status);
      s.db
        .insert(step)
        .values({
          id: 'second-step',
          buildId: 'build-archive',
          kind: 'review',
          status,
          createdAt: now + 1,
        })
        .run();
      expect(await action(s, 'archive')).toMatchObject({ phase: 'todo' });
      expect(
        s.db
          .select()
          .from(step)
          .all()
          .map((row) => row.status),
      ).toEqual(['stopped', 'stopped']);
      sweepZombieQueuedTodos(s.svc);
      sweepAbandonedBuildSteps(s.svc, now + 300_000);
      expect(await claimStep(deps, machineId, s.team.id, 0, 'http://localhost')).toBeNull();
      expect(await action(s, 'unarchive')).toMatchObject({ phase: 'todo' });
    },
  );

  test('missing tasks return 404 for both actions', async () => {
    const s = bootServer();
    for (const name of ['archive', 'unarchive']) {
      expect((await req(s.app, 'POST', `/api/todos/missing/${name}`)).status).toBe(404);
    }
  });
});

test('parallel claimed steps retain their archive stops after Undo before polling', async () => {
  const { s, machineId, deps, now } = world();
  s.db
    .insert(step)
    .values({
      id: 'parallel-step',
      buildId: 'build-archive',
      kind: 'review',
      status: 'claimed',
      machineId,
      claimedAt: now,
      lastHeartbeatAt: now,
      createdAt: now + 1,
    })
    .run();
  await action(s, 'archive');
  await action(s, 'unarchive');
  expect(
    s.db
      .select({ n: sql<number>`count(*)` })
      .from(step)
      .where(eq(step.archiveStop, 'requested'))
      .get(),
  ).toEqual({ n: 2 });
  expect(fetchStop(deps, { id: machineId }, 'step-archive')).toEqual({ discard: false });
  await finishStep(deps, machineId, 'step-archive', { status: 'stopped' });
  expect(fetchStop(deps, { id: machineId }, 'parallel-step')).toEqual({ discard: false });
  await finishStep(deps, machineId, 'parallel-step', { status: 'stopped' });
  expect(
    s.db
      .select()
      .from(step)
      .all()
      .every((row) => row.archiveStop === null),
  ).toBe(true);
});

test('archived tasks reject execution until unarchived', async () => {
  const { s } = world('todo', 'done');
  await action(s, 'archive');
  const start = await req(s.app, 'POST', '/api/projects/project-archive/builds', {
    todoIds: ['todo-archive'],
    assignment: { plan: null, build: { agentId: 'agent-archive' } },
    withPlan: false,
  });
  expect(start.status).toBe(409);
  expect((await req(s.app, 'POST', '/api/todos/todo-archive/orchestrate')).status).toBe(409);
  await action(s, 'unarchive');
  expect(
    (
      await req(s.app, 'POST', '/api/projects/project-archive/builds', {
        todoIds: ['todo-archive'],
        assignment: { plan: null, build: { agentId: 'agent-archive' } },
        withPlan: false,
      })
    ).status,
  ).toBe(201);
});

test('archive stop and acknowledgement survive a fresh server process after Undo', async () => {
  const { s, machineId } = world();
  await action(s, 'archive');
  await action(s, 'unarchive');
  const directory = mkdtempSync(join(tmpdir(), 'cairn-archive-restart-'));
  try {
    const path = join(directory, 'db.sqlite');
    s.db.run(sql`VACUUM INTO ${path}`);
    const script = `
      import { openDbWithHandle } from './apps/server/src/db/client.ts';
      import { applyStoppedStep } from './apps/server/src/services/builds.ts';
      import { fetchStop } from './apps/server/src/services/machines.ts';
      import { TeamStreamHub } from './apps/server/src/services/events.ts';
      const opened = openDbWithHandle(process.argv[1]);
      const db = opened.db;
      const first = fetchStop({ db }, { id: process.argv[2] }, 'step-archive');
      const second = fetchStop({ db }, { id: process.argv[2] }, 'step-archive');
      applyStoppedStep({ db, hub: new TeamStreamHub(), user: JSON.parse(process.argv[3]) }, 'step-archive');
      process.stdout.write(JSON.stringify({ first, second, task: db.$client.prepare('SELECT phase FROM todo WHERE id = ?').get('todo-archive'), marker: db.$client.prepare('SELECT archiveStop FROM step WHERE id = ?').get('step-archive') }));
      opened.close();
    `;
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          join(import.meta.dirname, '../node_modules/tsx/dist/loader.mjs'),
          '--input-type=module',
          '-e',
          script,
          path,
          machineId,
          JSON.stringify(s.user),
        ],
        { cwd: join(import.meta.dirname, '../../..'), encoding: 'utf8' },
      ),
    );
    expect(result).toEqual({
      first: { discard: false },
      second: { discard: null },
      task: { phase: 'todo' },
      marker: { archiveStop: null },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

test('archive completion keeps session, checkpoint, usage and clears unconsumed steer', async () => {
  const { s, deps, machineId, now } = world();
  s.db
    .insert(steerPending)
    .values({
      conversationId: 'build-archive',
      stepId: 'step-archive',
      content: 'Retained steer',
      createdAt: now,
    })
    .run();
  await action(s, 'archive');
  await finishStep(deps, machineId, 'step-archive', {
    status: 'stopped',
    sessionId: 'retained-session',
    commit: 'a'.repeat(40),
    usage: [{ model: 'stub-model', input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }],
  });
  expect(s.db.select().from(steerPending).all()).toEqual([]);
  expect(s.db.select().from(step).where(eq(step.id, 'step-archive')).get()).toMatchObject({
    sessionId: 'retained-session',
    checkpointCommit: 'a'.repeat(40),
    status: 'stopped',
    archiveStop: null,
  });
  expect(s.db.select().from(tokenUsage).get()).toMatchObject({ input: 10, output: 5 });
});

test.each(['finish', 'abandon'] as const)('regular stop rows are cleared on %s', async (mode) => {
  const { s, deps, now } = world();
  requestStop(deps, 'build-archive', { discard: false });
  if (mode === 'finish') {
    const row = s.db.select().from(step).where(eq(step.id, 'step-archive')).get()!;
    applyStepFailure(deps, row, 'Failure before polling');
  } else {
    if (mode === 'abandon') await action(s, 'archive');
    sweepAbandonedBuildSteps(deps, now + 300_000);
  }
  expect(s.db.select().from(stopPending).all()).toEqual([]);
  expect(
    s.db
      .select({ archiveStop: step.archiveStop })
      .from(step)
      .where(eq(step.id, 'step-archive'))
      .get(),
  ).toEqual({ archiveStop: null });
});

test('another step polling clears stale stop rows without consuming another live step stop', () => {
  const { s, deps, machineId, now } = world();
  s.db
    .insert(step)
    .values({
      id: 'old-step',
      buildId: 'build-archive',
      kind: 'build',
      status: 'stopped',
      createdAt: now - 1,
    })
    .run();
  s.db
    .insert(stopPending)
    .values({ conversationId: 'build-archive', stepId: 'old-step', discard: true, createdAt: now })
    .run();
  expect(fetchStop(deps, { id: machineId }, 'step-archive')).toEqual({ discard: null });
  expect(s.db.select().from(stopPending).all()).toEqual([]);
  s.db
    .insert(step)
    .values({
      id: 'live-step',
      buildId: 'build-archive',
      kind: 'review',
      status: 'claimed',
      machineId,
      createdAt: now,
    })
    .run();
  s.db
    .insert(stopPending)
    .values({ conversationId: 'build-archive', stepId: 'live-step', discard: true, createdAt: now })
    .run();
  expect(fetchStop(deps, { id: machineId }, 'step-archive')).toEqual({ discard: null });
  expect(s.db.select().from(stopPending).get()).toMatchObject({ stepId: 'live-step' });
});

test.each(['confirm', 'review', 'failed'] as const)(
  'archived %s tasks are excluded from attention and team progress',
  async (phase) => {
    const { s } = world(phase, 'done');
    s.db
      .update(project)
      .set({ autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: 'human' } })
      .where(eq(project.id, 'project-archive'))
      .run();
    s.db
      .update(build)
      .set({ errorMessage: 'invalid api key' })
      .where(eq(build.id, 'build-archive'))
      .run();
    const before = needsYouQuerySchema.parse(
      await (await req(s.app, 'GET', '/api/needs-you')).json(),
    );
    expect(before.current).toHaveLength(1);
    await action(s, 'archive');
    expect(await (await req(s.app, 'GET', '/api/needs-you')).json()).toEqual({
      current: [],
      stale: [],
    });
    const progress = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/progress`)
    ).json()) as { todos: { total: number; byPhase: Record<Phase, number> } };
    expect(progress.todos.total).toBe(0);
    expect(progress.todos.byPhase[phase]).toBe(0);
    const tasks = await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/agents/agent-archive/tasks`)
    ).json();
    expect(tasks).toEqual([]);
  },
);

test('archive removes running tasks from agent and phase-filtered lists', async () => {
  const { s } = world('building', 'done');
  const path = `/api/teams/${s.team.id}/agents/agent-archive/tasks`;
  expect(await (await req(s.app, 'GET', path)).json()).toHaveLength(1);
  await action(s, 'archive');
  expect(await (await req(s.app, 'GET', path)).json()).toEqual([]);
  expect(await (await req(s.app, 'GET', '/api/todos')).json()).toEqual([]);
});

test('archived issue tasks release intake capacity but remain in scheduling in-flight issues', async () => {
  const { s, now } = world('building', 'done');
  s.db
    .update(todo)
    .set({ sourceKind: 'github-issue', sourceRef: 'github:owner/repo#1' })
    .where(eq(todo.id, 'todo-archive'))
    .run();
  for (const number of [2, 3]) {
    s.db
      .insert(todo)
      .values({
        id: `archived-${number}`,
        teamId: s.team.id,
        projectId: 'project-archive',
        title: 'Archived issue',
        phase: 'building',
        phaseAt: now,
        archivedAt: now,
        seqNum: number,
        sourceKind: 'github-issue',
        sourceRef: `github:owner/repo#${number}`,
      })
      .run();
  }
  await action(s, 'archive');
  expect(projectAtInFlightCap(s.db, 'project-archive')).toBe(false);
  expect(inFlightIssues(s.db, 'project-archive')).toEqual(new Map([[1, 'github:owner/repo#1']]));
});

test.each(['building', 'review'] as const)(
  'archived %s tasks skip CI grind but keep review reconciliation',
  async (phase) => {
    const { s, deps } = world(phase, 'done');
    s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'owner/repo' })
      .where(eq(project.id, 'project-archive'))
      .run();
    s.db.update(build).set({ prNumber: 42 }).where(eq(build.id, 'build-archive')).run();
    await action(s, 'archive');
    const logs: object[] = [];
    const poller = createCiPoller(deps, {
      githubFetch: async () => new Response('{}', { status: 404 }),
      logger: {
        info: (entry, message) => {
          if (message === 'ci pr-checks sweep') logs.push(entry);
        },
      },
    });
    await poller.sweep();
    expect(logs).toEqual([
      expect.objectContaining({ candidates: 0, reviewCandidates: phase === 'review' ? 1 : 0 }),
    ]);
  },
);

test.each([
  'stop',
  'failure',
  'complete',
  'abandon',
  'reset',
  'delete-task',
  'delete-project',
] as const)('archive stop cleanup survives without triggers through %s', async (path) => {
  const { s, deps, now } = world();
  await action(s, 'archive');
  requestStop(deps, 'build-archive', { discard: false });
  const row = s.db.select().from(step).where(eq(step.id, 'step-archive')).get()!;
  if (path === 'stop') applyStoppedStep(deps, row.id);
  else if (path === 'failure') applyStepFailure(deps, row, 'Late failure');
  else if (path === 'complete') completeStep(deps, row.id);
  else if (path === 'abandon') sweepAbandonedBuildSteps(deps, now + 300_000);
  else if (path === 'reset') resetTodo(deps, 'todo-archive');
  else if (path === 'delete-task') deleteTodo(deps, 'todo-archive');
  else deleteProject(deps, 'project-archive');
  expect(s.db.select().from(stopPending).all()).toEqual([]);
  const remaining = s.db.select().from(step).where(eq(step.id, row.id)).get();
  expect(remaining?.archiveStop ?? null).toBeNull();
  expect(remaining?.status).not.toBe('claimed');
});

test('a regular stop survives release and same-machine reclaim before its late poll', async () => {
  const { s, deps, machineId, now } = world();
  requestStop(deps, 'build-archive', { discard: true });
  sweepAbandonedBuildSteps(deps, now + 300_000);
  expect(s.db.select().from(step).where(eq(step.id, 'step-archive')).get()?.status).toBe('pending');
  expect((await claimStep(deps, machineId, s.team.id, 0, 'http://localhost'))?.step.id).toBe(
    'step-archive',
  );
  expect(fetchStop(deps, { id: machineId }, 'step-archive')).toEqual({ discard: true });
  expect(s.db.select().from(stopPending).all()).toEqual([]);
});

test.each(['stopped', 'success', 'failed'] as const)(
  'archive preserves pending stop-and-mark-done after a %s report',
  async (status) => {
    const { s, deps, machineId } = world();
    expect(prepareStopForDone(deps, 'todo-archive')).toEqual({ state: 'stopping' });
    await action(s, 'archive');
    await finishStep(deps, machineId, 'step-archive', { status, hasChanges: true });
    expect(await action(s, 'unarchive')).toMatchObject({ phase: 'done', archivedAt: null });
  },
);

test.each(['merged', 'closed'] as const)('archived review reconciles a %s PR', async (state) => {
  const { s, deps, now } = world('review', 'done');
  s.db
    .update(project)
    .set({ repoKind: 'github', githubRepo: 'owner/repo' })
    .where(eq(project.id, 'project-archive'))
    .run();
  s.db.update(build).set({ prNumber: 42 }).where(eq(build.id, 'build-archive')).run();
  s.db
    .insert(autonomousMergeAdmission)
    .values({
      buildId: 'build-archive',
      teamId: s.team.id,
      state: 'pending',
      createdAt: now,
      landedAt: null,
    })
    .run();
  await action(s, 'archive');
  const poller = createCiPoller(deps, {
    githubFetch: async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes('/pulls/42')
            ? {
                number: 42,
                state: 'closed',
                merged: state === 'merged',
                merged_at: new Date(now).toISOString(),
                merge_commit_sha: 'a'.repeat(40),
                head: {
                  sha: 'a'.repeat(40),
                  ref: conversationBranch('build-archive'),
                  repo: { id: 1 },
                },
                base: { ref: 'main', repo: { id: 1, default_branch: 'main' } },
              }
            : [],
        ),
        { status: 200 },
      ),
  });
  await poller.sweep(now);
  if (state === 'closed') await poller.sweep(now + 300_000);
  expect(s.db.select().from(todo).where(eq(todo.id, 'todo-archive')).get()).toMatchObject({
    phase: state === 'merged' ? 'done' : 'failed',
    archivedAt: expect.any(Number),
  });
  if (state === 'merged')
    expect(s.db.select().from(autonomousMergeAdmission).get()).toMatchObject({
      state: 'merged',
      landedAt: now,
    });
});

test('a failure handler captured before archive still honors the persisted stop after Undo', async () => {
  const { s, deps } = world();
  const captured = s.db.select().from(step).where(eq(step.id, 'step-archive')).get()!;
  await action(s, 'archive');
  await action(s, 'unarchive');
  applyStepFailure(deps, captured, 'Failure delivered after archive');
  expect(s.db.select().from(todo).where(eq(todo.id, 'todo-archive')).get()).toMatchObject({
    phase: 'todo',
    archivedAt: null,
  });
  expect(s.db.select().from(step).where(eq(step.id, 'step-archive')).get()).toMatchObject({
    status: 'stopped',
    archiveStop: null,
  });
});

test('archived review PR conflicts do not enqueue another build', async () => {
  const { s, deps } = world('review', 'done');
  s.db.update(project).set({ repoKind: 'github', githubRepo: 'owner/repo' }).run();
  s.db.update(build).set({ prNumber: 42 }).run();
  await action(s, 'archive');
  await createCiPoller(deps, {
    githubFetch: async () =>
      new Response(
        JSON.stringify({
          number: 42,
          state: 'open',
          merged: false,
          mergeable_state: 'dirty',
          head: { sha: 'a'.repeat(40), ref: conversationBranch('build-archive'), repo: { id: 1 } },
          base: { ref: 'main', repo: { id: 1, default_branch: 'main' } },
        }),
        { status: 200 },
      ),
  }).sweep();
  expect(s.db.select().from(todo).where(eq(todo.id, 'todo-archive')).get()?.phase).toBe('review');
  expect(s.db.select().from(step).all()).toHaveLength(1);
});
