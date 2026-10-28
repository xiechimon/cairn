import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { agent, build, machine, message, plan, step, todo } from '../src/db/schema.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { bootServer, insertMachine, postProject, req } from './helpers.js';

const REJECTED_PREFIX = 'split-proposal-rejected:v1\n';
const goodItems = () => [
  { title: 'First', spec: 'ordinary first task', agentId: 'worker' },
  { title: 'Second', spec: 'ordinary second task', agentId: 'worker', blockedBy: [1] },
];

function badItems(failure: string) {
  const items = goodItems();
  if (failure === 'missing-agent') items[0]!.agentId = 'ghost';
  if (failure === 'cycle') items[0]!.blockedBy = [2];
  if (failure === 'out-of-range') items[1]!.blockedBy = [3];
  if (failure === 'fractional') items[1]!.blockedBy = [1.5];
  return items;
}

async function world(policy: 'human' | 'shadow' | 'auto') {
  const s = bootServer();
  const machineId = insertMachine(s, { name: 'proposal-machine' });
  s.db
    .update(machine)
    .set({ online: true, enabledRuntimes: ['pi'] })
    .run();
  s.db
    .insert(agent)
    .values({ id: 'worker', teamId: s.team.id, displayName: 'Worker', machineId, provider: 'pi' })
    .run();
  const projectId = await postProject(s.app);
  if (policy !== 'human')
    expect(
      (await req(s.app, 'PATCH', `/api/projects/${projectId}`, { splitPolicy: policy })).status,
    ).toBe(200);
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Proposal',
    spec: 'ordinary implementation',
  });
  const { id: parentId } = (await created.json()) as { id: string };
  const tool = (name: string, params: Record<string, unknown>) =>
    executeChiefTool(
      { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
      {
        teamId: s.team.id,
        userId: s.user.id,
        chiefId: 'chief-test',
        threadId: 'chief-thread-test',
        chiefAgentId: null,
        conversationId: 'chief-test',
      },
      name,
      params,
    );
  return { s, projectId, parentId, tool };
}

function seedRejected(w: Awaited<ReturnType<typeof world>>) {
  const buildId = 'rejected-build';
  w.s.db
    .insert(build)
    .values({
      id: buildId,
      todoId: w.parentId,
      withPlan: true,
      prevPhase: 'todo',
      triggerSource: 'chief',
      errorMessage: `${REJECTED_PREFIX}agent ghost does not exist`,
      createdAt: 1,
    })
    .run();
  w.s.db
    .insert(plan)
    .values({
      id: 'rejected-plan',
      buildId,
      version: 1,
      content: JSON.stringify(badItems('missing-agent')),
      createdAt: 1,
    })
    .run();
  w.s.db.update(build).set({ planDocId: 'rejected-plan' }).where(eq(build.id, buildId)).run();
  w.s.db
    .update(todo)
    .set({ phase: 'confirm', latestBuildId: buildId, hasPlan: true, lastRunAt: 1 })
    .where(eq(todo.id, w.parentId))
    .run();
  return buildId;
}

for (const policy of ['shadow', 'auto'] as const) {
  test.each(['missing-agent', 'cycle', 'out-of-range', 'fractional'])(
    `${policy} stores a rejected %s proposal at confirm without executable child references`,
    async (failure) => {
      const w = await world(policy);
      try {
        const items = badItems(failure);
        const result = JSON.parse(
          await w.tool('split_todo', { todoId: w.parentId, subtodos: items }),
        ) as { autoStart: boolean; parentBuildId: string; children: unknown[] };
        expect(result.autoStart).toBe(false);
        expect(result.children).toEqual([]);
        expect(w.s.db.select().from(todo).all()).toEqual([
          expect.objectContaining({
            id: w.parentId,
            phase: 'confirm',
            latestBuildId: result.parentBuildId,
          }),
        ]);
        expect(w.s.db.select().from(step).all()).toEqual([]);
        const savedBuild = w.s.db
          .select()
          .from(build)
          .where(eq(build.id, result.parentBuildId))
          .get()!;
        expect(savedBuild.errorMessage).toMatch(/^split-proposal-rejected:v1\n/);
        const savedPlan = w.s.db
          .select()
          .from(plan)
          .where(eq(plan.id, savedBuild.planDocId!))
          .get()!;
        expect(savedPlan.content).toContain(JSON.stringify(items, null, 2));
        expect(savedPlan.content).toContain('split_todo');
        const messages = w.s.db
          .select()
          .from(message)
          .all()
          .map((row) => row.content)
          .join('\n');
        expect(messages).toContain('falls back to human review');
        expect(messages).toContain(
          failure === 'missing-agent' ? 'ghost' : failure === 'cycle' ? 'cycle' : 'range',
        );
      } finally {
        w.s.dispose();
      }
    },
  );
}

test.each(['http', 'chief'] as const)(
  'rejected proposal cannot be confirmed through %s',
  async (entry) => {
    const w = await world('auto');
    try {
      const buildId = seedRejected(w);
      if (entry === 'http') {
        const response = await req(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
          action: 'confirm',
        });
        expect(response.status).toBe(409);
        expect(await response.text()).toContain('split_todo');
      } else {
        await expect(w.tool('confirm_builds', { buildIds: [buildId] })).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining('split_todo'),
        });
      }
      expect(w.s.db.select().from(step).all()).toEqual([]);
      expect(w.s.db.select().from(todo).where(eq(todo.id, w.parentId)).get()!.phase).toBe(
        'confirm',
      );
    } finally {
      w.s.dispose();
    }
  },
);

test.each(['shadow', 'auto'] as const)(
  '%s correction resubmits only the rejected current proposal and preserves its history',
  async (policy) => {
    const w = await world(policy);
    try {
      const rejectedId = seedRejected(w);
      const oldBuild = w.s.db.select().from(build).where(eq(build.id, rejectedId)).get()!;
      const oldPlan = w.s.db.select().from(plan).where(eq(plan.buildId, rejectedId)).get()!;
      const result = JSON.parse(
        await w.tool('split_todo', { todoId: w.parentId, subtodos: goodItems() }),
      ) as { parentBuildId: string; autoStart: boolean; children: { id: string }[] };
      expect(result.parentBuildId).not.toBe(rejectedId);
      expect(result.autoStart).toBe(policy === 'auto');
      expect(result.children).toHaveLength(2);
      expect(w.s.db.select().from(build).where(eq(build.id, rejectedId)).get()).toEqual(oldBuild);
      expect(w.s.db.select().from(plan).where(eq(plan.buildId, rejectedId)).get()).toEqual(oldPlan);
      const parent = w.s.db.select().from(todo).where(eq(todo.id, w.parentId)).get()!;
      expect(parent.latestBuildId).toBe(result.parentBuildId);
      expect(parent.phase).toBe(policy === 'auto' ? 'building' : 'confirm');
      expect(w.s.db.select().from(step).where(eq(step.buildId, rejectedId)).all()).toEqual([]);
      expect(
        (await req(w.s.app, 'POST', `/api/builds/${rejectedId}/steps`, { action: 'confirm' }))
          .status,
      ).toBe(409);
      await expect(w.tool('confirm_builds', { buildIds: [rejectedId] })).rejects.toMatchObject({
        status: 409,
      });
    } finally {
      w.s.dispose();
    }
  },
);

test.each([
  'unmarked',
  'wrong-phase',
  'stale-build',
  'child-present',
  'step-present',
  'wrong-trigger',
  'missing-plan',
])('resubmission rejects %s states without changing existing history', async (state) => {
  const w = await world('auto');
  try {
    const buildId = seedRejected(w);
    if (state === 'unmarked')
      w.s.db.update(build).set({ errorMessage: null }).where(eq(build.id, buildId)).run();
    if (state === 'wrong-phase')
      w.s.db.update(todo).set({ phase: 'planning' }).where(eq(todo.id, w.parentId)).run();
    if (state === 'stale-build')
      w.s.db.update(todo).set({ latestBuildId: null }).where(eq(todo.id, w.parentId)).run();
    if (state === 'child-present')
      w.s.db
        .insert(todo)
        .values({
          id: 'existing-child',
          projectId: w.projectId,
          teamId: w.s.team.id,
          sourceTodo: w.parentId,
          title: 'Existing child',
          seqNum: 2,
          phaseAt: 1,
        })
        .run();
    if (state === 'step-present')
      w.s.db
        .insert(step)
        .values({ id: 'existing-step', buildId, kind: 'build', status: 'done', createdAt: 1 })
        .run();
    if (state === 'wrong-trigger')
      w.s.db.update(build).set({ triggerSource: 'user' }).where(eq(build.id, buildId)).run();
    if (state === 'missing-plan')
      w.s.db.update(build).set({ planDocId: null }).where(eq(build.id, buildId)).run();
    const before = {
      builds: w.s.db.select().from(build).all(),
      plans: w.s.db.select().from(plan).all(),
      todos: w.s.db.select().from(todo).all(),
      steps: w.s.db.select().from(step).all(),
    };
    await expect(
      w.tool('split_todo', { todoId: w.parentId, subtodos: goodItems() }),
    ).rejects.toMatchObject({ status: 409 });
    expect({
      builds: w.s.db.select().from(build).all(),
      plans: w.s.db.select().from(plan).all(),
      todos: w.s.db.select().from(todo).all(),
      steps: w.s.db.select().from(step).all(),
    }).toEqual(before);
  } finally {
    w.s.dispose();
  }
});

test.each(['missing-agent', 'cycle', 'out-of-range', 'fractional'])(
  'human preserves the existing hard rejection for %s',
  async (failure) => {
    const w = await world('human');
    try {
      await expect(
        w.tool('split_todo', { todoId: w.parentId, subtodos: badItems(failure) }),
      ).rejects.toMatchObject({ status: failure === 'missing-agent' ? 404 : 400 });
      expect(w.s.db.select().from(build).all()).toEqual([]);
      expect(w.s.db.select().from(plan).all()).toEqual([]);
      expect(w.s.db.select().from(step).all()).toEqual([]);
      expect(w.s.db.select().from(todo).all()).toEqual([
        expect.objectContaining({ id: w.parentId, phase: 'todo' }),
      ]);
    } finally {
      w.s.dispose();
    }
  },
);

test.each(['http', 'chief'] as const)(
  'rejected proposal cannot bypass confirmation through %s ordinary build start',
  async (entry) => {
    const w = await world('auto');
    try {
      seedRejected(w);
      const assignment = { plan: null, build: { agentId: 'worker' } };
      if (entry === 'http') {
        expect(
          (
            await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
              todoIds: [w.parentId],
              assignment,
              withPlan: false,
            })
          ).status,
        ).toBe(409);
      } else {
        await expect(
          w.tool('run_builds', { todoIds: [w.parentId], assignment, withPlan: false }),
        ).rejects.toMatchObject({ status: 409 });
      }
      expect(w.s.db.select().from(step).all()).toEqual([]);
      expect(w.s.db.select().from(build).all()).toHaveLength(1);
    } finally {
      w.s.dispose();
    }
  },
);

test('rejected proposal directs correction to split_todo instead of queuing an ordinary planner revision', async () => {
  const w = await world('auto');
  try {
    const buildId = seedRejected(w);
    const response = await req(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'revision',
      side: 'plan',
      feedback: 'correct the agent',
      clientMessageId: 'revision-1',
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('split_todo');
    expect(w.s.db.select().from(step).all()).toEqual([]);
    expect(w.s.db.select().from(todo).where(eq(todo.id, w.parentId)).get()!.phase).toBe('confirm');
  } finally {
    w.s.dispose();
  }
});

for (const policy of ['human', 'shadow', 'auto'] as const) {
  test.each(['not-an-array', 'not-a-number', 'empty-title', 'blank-title', 'single-child'])(
    `${policy} keeps malformed %s payloads out of persisted proposals`,
    async (format) => {
      const w = await world(policy);
      try {
        const items = goodItems();
        const payload =
          format === 'not-an-array'
            ? [items[0], { ...items[1], blockedBy: 'one' }]
            : format === 'not-a-number'
              ? [items[0], { ...items[1], blockedBy: ['one'] }]
              : format === 'single-child'
                ? [items[0]]
                : [{ ...items[0], title: format === 'blank-title' ? ' ' : '' }, items[1]];
        await expect(
          w.tool('split_todo', { todoId: w.parentId, subtodos: payload }),
        ).rejects.toMatchObject({ status: 400 });
        expect(w.s.db.select().from(build).all()).toEqual([]);
        expect(w.s.db.select().from(plan).all()).toEqual([]);
        expect(w.s.db.select().from(todo).all()).toEqual([
          expect.objectContaining({ id: w.parentId, phase: 'todo' }),
        ]);
      } finally {
        w.s.dispose();
      }
    },
  );
}
