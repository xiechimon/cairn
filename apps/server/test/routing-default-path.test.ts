import { CHIEF_TOOLS_REMOVED_UNDER_D60 } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import { build, routingRule, step, todo, workPolicy } from '../src/db/schema.js';
import { seedDefaultRouting } from '../src/services/routing-migration.js';
import { routeForStep } from '../src/services/routing-rules.js';
import { H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

beforeEach(() => {
  H.s.db.delete(routingRule).run();
  H.s.db.delete(workPolicy).run();
  seedDefaultRouting(H.s.db);
});

function seedTodo(id: string) {
  H.s.db
    .insert(todo)
    .values({
      id,
      teamId: H.teamId,
      projectId: H.projectId,
      title: 'Export the board',
      spec: 'Add an export.',
      phase: 'todo',
      phaseAt: 1,
      seqNum: 1,
    })
    .run();
  return id;
}

describe('the default path after the migration', () => {
  test('a Coordinator turn opens a thread as one session step on the default rule', async () => {
    const id = seedTodo('open-me');
    const out = (await relay('open_thread', { todoId: id })) as { buildId: string };
    const steps = H.s.db.select().from(step).where(eq(step.buildId, out.buildId)).all();
    expect(steps.map((row) => row.kind)).toEqual(['session']);
    expect(H.s.db.select().from(build).where(eq(build.id, out.buildId)).get()?.withPlan).toBe(
      false,
    );
    const todoRow = H.s.db.select().from(todo).where(eq(todo.id, id)).get()!;
    expect(routeForStep(H.s.db, todoRow, 'session')).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
    expect(
      H.s.db
        .select()
        .from(routingRule)
        .all()
        .map((row) => row.use),
    ).toEqual(['session']);
  });

  test.each(Object.keys(CHIEF_TOOLS_REMOVED_UNDER_D60))(
    '%s answers 410 removed under D60 and changes nothing',
    async (name) => {
      const id = seedTodo('keep-me');
      await expect(
        relay(name, {
          todoIds: [id],
          todoId: id,
          subtodos: [{ title: 't', spec: 's' }],
        }),
      ).rejects.toMatchObject({
        status: 410,
        message: expect.stringMatching(new RegExp(`${name} was removed under D60`)),
      });
      expect(H.s.db.select().from(build).all()).toHaveLength(0);
    },
  );
});
