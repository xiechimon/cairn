import { CHIEF_TOOLS_REMOVED_UNDER_D60 } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { agent, build, routingRule, step, todo } from '../src/db/schema.js';
import { agentForStep } from '../src/services/dispatch-eligibility.js';
import { runRoutingMigration } from '../src/services/routing-migration.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { AGENT_ID, H, registerChiefHarness, relay } from './chief-harness.js';

registerChiefHarness();

beforeEach(() => {
  H.s.db.update(agent).set({ provider: null, modelId: null }).run();
  runRoutingMigration(H.s.db);
  setRoutingRulesEnabled(true);
});
afterEach(() => setRoutingRulesEnabled(false));

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
  test('boot creates no persona agents', () => {
    expect(H.s.db.select().from(agent).where(eq(agent.teamId, H.teamId)).all()).toHaveLength(2);
    expect(
      H.s.db
        .select()
        .from(agent)
        .all()
        .filter((row) => row.persona !== null),
    ).toEqual([]);
  });

  test('a Coordinator turn opens a thread as one session step on the default rule', async () => {
    const id = seedTodo('open-me');
    const out = (await relay('open_thread', { todoId: id })) as { buildId: string };
    const steps = H.s.db.select().from(step).where(eq(step.buildId, out.buildId)).all();
    expect(steps.map((row) => row.kind)).toEqual(['session']);
    expect(H.s.db.select().from(build).where(eq(build.id, out.buildId)).get()?.withPlan).toBe(
      false,
    );
    const todoRow = H.s.db.select().from(todo).where(eq(todo.id, id)).get()!;
    expect(agentForStep(H.s.db, todoRow, 'session')).toMatchObject({
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
          assignment: { build: { agentId: AGENT_ID } },
          subtodos: [{ title: 't', spec: 's', agentId: AGENT_ID }],
        }),
      ).rejects.toMatchObject({
        status: 410,
        message: expect.stringMatching(new RegExp(`${name} was removed under D60`)),
      });
      expect(H.s.db.select().from(build).all()).toHaveLength(0);
    },
  );
});
