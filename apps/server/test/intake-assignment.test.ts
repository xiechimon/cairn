import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import { agent, build, step, todo } from '../src/db/schema.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import { AGENT_ID, AGENT2_ID, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';

registerChiefHarness();
afterEach(() => H.s.dispose());

async function assignedTodo(preset: boolean) {
  const record = (await relay('create_todo', {
    projectId: H.projectId,
    title: 'Intake assignment',
    spec: 'Preserve the requested agent',
  })) as { id: string };
  const assignment = {
    ...(preset ? { source: 'intake-label' as const } : {}),
    plan: { agentId: AGENT_ID },
    build: { agentId: AGENT_ID },
  };
  H.s.db.update(todo).set({ assignment }).where(eq(todo.id, record.id)).run();
  return { ...record, assignment };
}

for (const caller of ['Coordinator', 'MCP']) {
  for (const withPlan of [true, false]) {
    test(`${caller} run_builds preserves an intake-label preset withPlan=${withPlan}`, async () => {
      const record = await assignedTodo(true);
      const args = {
        todoIds: [record.id],
        withPlan,
        assignment: { plan: { agentId: AGENT2_ID }, build: { agentId: AGENT2_ID } },
      };
      if (caller === 'Coordinator') await relay('run_builds', args);
      else
        await executeMcpTool(
          toolDeps(),
          { teamId: H.teamId, user: H.s.user, grants: new Set() },
          'run_builds',
          args,
        );
      expect(H.s.db.select().from(todo).where(eq(todo.id, record.id)).get()?.assignment).toEqual({
        ...record.assignment,
        ...(caller === 'Coordinator' ? { review: null, verify: null } : {}),
      });
      expect(
        H.s.db
          .select()
          .from(step)
          .all()
          .map((row) => row.kind),
      ).toEqual([withPlan ? 'plan' : 'build']);
    });
  }

  for (const status of ['inactive', 'archived']) {
    test(`${caller} refuses a ${status} preset agent before starting builds`, async () => {
      const record = await assignedTodo(true);
      H.s.db.update(agent).set({ status }).where(eq(agent.id, AGENT_ID)).run();
      const args = { todoIds: [record.id] };
      const call =
        caller === 'Coordinator'
          ? relay('run_builds', args)
          : executeMcpTool(
              toolDeps(),
              { teamId: H.teamId, user: H.s.user, grants: new Set() },
              'run_builds',
              args,
            );
      await expect(call).rejects.toThrow(/agent/);
      expect(H.s.db.select().from(build).all()).toHaveLength(0);
      expect(H.s.db.select().from(todo).where(eq(todo.id, record.id)).get()?.assignment).toEqual(
        record.assignment,
      );
    });
  }
}

test('Coordinator retry reassigns a previously built todo without a label preset', async () => {
  const record = await assignedTodo(false);
  await relay('run_builds', {
    todoIds: [record.id],
    withPlan: false,
    assignment: { build: { agentId: AGENT_ID } },
  });
  H.s.db.update(step).set({ status: 'failed' }).run();
  H.s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, record.id)).run();
  await relay('run_builds', {
    todoIds: [record.id],
    withPlan: false,
    assignment: { build: { agentId: AGENT2_ID } },
  });
  expect(
    H.s.db.select().from(todo).where(eq(todo.id, record.id)).get()?.assignment?.build?.agentId,
  ).toBe(AGENT2_ID);
  expect(H.s.db.select().from(build).all()).toHaveLength(2);
});

test('Coordinator refuses splitting or closing an intake preset and tells it to build as is', async () => {
  const parent = await assignedTodo(true);
  await expect(
    relay('split_todo', {
      todoId: parent.id,
      subtodos: [{ title: 'First', spec: 'First part', agentId: AGENT2_ID }],
    }),
  ).rejects.toThrow(/intake-label-split-refused.*Build .* as is/);
  await expect(relay('close_todos', { todoIds: [parent.id] })).rejects.toThrow(
    /intake-label-split-refused.*Build .* as is/,
  );
  expect(H.s.db.select().from(todo).all()).toHaveLength(1);
  expect(H.s.db.select().from(todo).where(eq(todo.id, parent.id)).get()?.phase).toBe('todo');
});

test('Coordinator refuses unlinked create_todo while a Project has a pending intake preset', async () => {
  const parent = await assignedTodo(true);
  await expect(
    relay('create_todo', {
      projectId: H.projectId,
      title: 'Child',
      spec: 'Part of the intake task',
    }),
  ).rejects.toThrow(/intake-label-split-refused.*Build .* as is/);
  expect(H.s.db.select().from(todo).all()).toHaveLength(1);
  await relay('run_builds', {
    todoIds: [parent.id],
    withPlan: false,
    assignment: { build: { agentId: AGENT2_ID } },
  });
  expect(H.s.db.select().from(todo).where(eq(todo.id, parent.id)).get()?.assignment).toMatchObject(
    parent.assignment,
  );
});

test('an intake preset preserves plan and build while a Coordinator retry changes the reviewer', async () => {
  const record = await assignedTodo(true);
  await relay('run_builds', {
    todoIds: [record.id],
    withPlan: false,
    assignment: { review: { agentId: AGENT_ID } },
  });
  H.s.db.update(step).set({ status: 'failed' }).run();
  H.s.db.update(todo).set({ phase: 'failed' }).where(eq(todo.id, record.id)).run();
  await relay('run_builds', {
    todoIds: [record.id],
    withPlan: false,
    assignment: { review: { agentId: AGENT2_ID } },
  });
  const assignment = H.s.db.select().from(todo).where(eq(todo.id, record.id)).get()?.assignment;
  expect(assignment).toMatchObject(record.assignment);
  expect(assignment?.review?.agentId).toBe(AGENT2_ID);
});

for (const phase of ['done', 'closed'] as const) {
  test(`a ${phase} intake preset does not block creating new tasks`, async () => {
    const parent = await assignedTodo(true);
    H.s.db.update(todo).set({ phase }).where(eq(todo.id, parent.id)).run();
    await relay('create_todo', {
      projectId: H.projectId,
      title: 'New work',
      spec: 'Independent work',
    });
    expect(H.s.db.select().from(todo).all()).toHaveLength(2);
  });
}

test('closing a mixed batch refuses before changing any task', async () => {
  const normal = await assignedTodo(false);
  const preset = await assignedTodo(true);
  await expect(relay('close_todos', { todoIds: [normal.id, preset.id] })).rejects.toThrow(
    /intake-label-split-refused/,
  );
  expect(
    H.s.db
      .select()
      .from(todo)
      .all()
      .map((row) => row.phase),
  ).toEqual(['todo', 'todo']);
});

test('closing missing tasks retains skipped results', async () => {
  expect(await relay('close_todos', { todoIds: ['missing-task'] })).toEqual({
    transitioned: [],
    skipped: ['missing-task'],
  });
});
