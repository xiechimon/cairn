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

    test(`${caller} refuses a mixed build batch with an empty intake preset withPlan=${withPlan}`, async () => {
      const normal = await assignedTodo(false);
      const preset = await assignedTodo(true);
      const assignment = { source: 'intake-label' as const, plan: null, build: null };
      H.s.db.update(todo).set({ assignment }).where(eq(todo.id, preset.id)).run();
      const args = {
        todoIds: [normal.id, preset.id],
        withPlan,
        assignment: { plan: { agentId: AGENT2_ID }, build: { agentId: AGENT2_ID } },
      };
      const call =
        caller === 'Coordinator'
          ? relay('run_builds', args)
          : executeMcpTool(
              toolDeps(),
              { teamId: H.teamId, user: H.s.user, grants: new Set() },
              'run_builds',
              args,
            );
      await expect(call).rejects.toMatchObject({
        status: 409,
        message:
          'intake-label-assignment-failed: Restore the requested intake agent preset before dispatching this task.',
      });
      expect(H.s.db.select().from(build).all()).toHaveLength(0);
      expect(H.s.db.select().from(step).all()).toHaveLength(0);
      expect(H.s.db.select().from(todo).where(eq(todo.id, preset.id)).get()?.assignment).toEqual(
        assignment,
      );
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

test('a pending intake preset does not block the Coordinator from creating other tasks', async () => {
  const parent = await assignedTodo(true);
  await relay('create_todo', {
    projectId: H.projectId,
    title: 'Independent',
    spec: 'Unrelated work in the same Project',
  });
  expect(H.s.db.select().from(todo).all()).toHaveLength(2);
  expect(H.s.db.select().from(todo).where(eq(todo.id, parent.id)).get()?.assignment).toMatchObject(
    parent.assignment,
  );
});

test('the Coordinator may close an intake preset once it has a build', async () => {
  const parent = await assignedTodo(true);
  await relay('run_builds', { todoIds: [parent.id], withPlan: false });
  await relay('close_todos', { todoIds: [parent.id] });
  expect(H.s.db.select().from(todo).where(eq(todo.id, parent.id)).get()?.phase).toBe('closed');
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

test('deleting a mixed batch refuses an unbuilt intake preset before deleting any task', async () => {
  const normal = await assignedTodo(false);
  const preset = await assignedTodo(true);
  await expect(relay('delete_todos', { todoIds: [normal.id, preset.id] })).rejects.toMatchObject({
    status: 409,
    message: expect.stringMatching(/intake-label-split-refused.*Build .* as is/),
  });
  expect(
    H.s.db
      .select()
      .from(todo)
      .all()
      .map((row) => row.id),
  ).toEqual([normal.id, preset.id]);
});

test('deleting a batch allows ordinary tasks and intake presets that have a build', async () => {
  const normal = await assignedTodo(false);
  const preset = await assignedTodo(true);
  await relay('run_builds', { todoIds: [preset.id], withPlan: false });
  expect(await relay('delete_todos', { todoIds: [normal.id, preset.id] })).toEqual({
    deleted: [normal.id, preset.id],
  });
  expect(H.s.db.select().from(todo).all()).toHaveLength(0);
});
