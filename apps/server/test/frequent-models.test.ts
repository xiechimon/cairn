import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { routingRule, todo as todoTable } from '../src/db/schema.js';
import {
  listRoutingSettings,
  profileForStep,
  routeForStep,
} from '../src/services/routing-rules.js';
import { writeTopModels } from '../src/services/top-models.js';
import {
  AGENT2_ID,
  H,
  ownerTodo,
  registerChiefHarness,
  relay,
  seedMachineReport,
} from './chief-harness.js';
import { insertMachine, req, seedRoute } from './helpers.js';

registerChiefHarness();

function frequent(...models: { provider: string; modelId: string; thinkingLevel?: 'high' }[]) {
  writeTopModels(
    H.s.db,
    H.teamId,
    models.map((m) => ({ ...m, thinkingLevel: m.thinkingLevel ?? null })),
  );
}

function todoRow(id: string) {
  return H.s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()!;
}

describe('the Coordinator picks a task model from the frequently used models', () => {
  test('create_todo with a frequent model stores it on the request and every session step runs it', async () => {
    frequent(
      { provider: 'stub-gw', modelId: 'fast-model' },
      { provider: 'strong-gw', modelId: 'deep-model', thinkingLevel: 'high' },
    );
    const created = (await relay('create_todo', {
      ...ownerTodo('重构整个调度器'),
      model: 'deep-model',
    })) as { id: string };
    const row = todoRow(created.id);
    expect(row.request?.model).toEqual({
      provider: 'strong-gw',
      modelId: 'deep-model',
      thinkingLevel: 'high',
    });
    for (const kind of ['plan', 'build', 'session', 'verify'] as const) {
      expect(routeForStep(H.s.db, row, kind)).toMatchObject({
        provider: 'strong-gw',
        modelId: 'deep-model',
        thinkingLevel: 'high',
      });
    }
    expect(profileForStep(H.s.db, row, 'session')).toMatchObject({
      provider: 'strong-gw',
      modelId: 'deep-model',
      routed: false,
    });
  });

  test('the project task model field is refused; the task pick still routes', async () => {
    frequent({ provider: 'strong-gw', modelId: 'deep-model' });
    const refused = await req(H.s.app, 'PATCH', `/api/projects/${H.projectId}`, {
      modelOverrides: {
        session: { provider: 'proj-gw', modelId: 'proj-model', thinkingLevel: null },
      },
    });
    expect(refused.status).toBe(400);
    const created = (await relay('create_todo', {
      ...ownerTodo('写文档'),
      model: 'deep-model',
    })) as { id: string };
    expect(routeForStep(H.s.db, todoRow(created.id), 'build')).toMatchObject({
      provider: 'strong-gw',
      modelId: 'deep-model',
    });
  });

  test('a model outside the frequent list is refused and no task is created', async () => {
    frequent({ provider: 'stub-gw', modelId: 'fast-model' });
    await expect(
      relay('create_todo', { ...ownerTodo('写文档'), model: 'other-model' }),
    ).rejects.toThrow(/fast-model/);
    expect(H.s.db.select().from(todoTable).all()).toEqual([]);
  });

  test('without a pick the task keeps the team route', async () => {
    frequent({ provider: 'strong-gw', modelId: 'deep-model' });
    const created = (await relay('create_todo', ownerTodo('写文档'))) as { id: string };
    expect(todoRow(created.id).request?.model).toBeUndefined();
    expect(routeForStep(H.s.db, todoRow(created.id), 'build')).toMatchObject({
      provider: 'stub-gw',
      modelId: 'stub-model-2',
    });
  });

  test('the models tool marks the frequent models', async () => {
    seedMachineReport('exec-1', {
      installed: true,
      hostname: 'exec-host-1',
      models: [
        { id: 'claude-opus-5-5', name: 'claude-opus-5-5' },
        { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' },
      ],
    });
    frequent({ provider: 'claude-code', modelId: 'claude-sonnet-5-5' });
    const rows = (await relay('models', {})) as { modelId: string; frequent?: boolean }[];
    const marked = rows.filter((row) => row.frequent === true).map((row) => row.modelId);
    expect(marked).toEqual(['claude-sonnet-5-5']);
  });
});

describe('tasks default to the Coordinator model', () => {
  test('without a team task rule, task steps run the stored Coordinator model and settings say so', () => {
    H.s.db.delete(routingRule).where(eq(routingRule.use, 'session')).run();
    seedRoute(H.s, 'coordinator', { provider: 'coord-gw', modelId: 'coord-model' });
    expect(routeForStep(H.s.db, { teamId: H.teamId }, 'build')).toMatchObject({
      provider: 'coord-gw',
      modelId: 'coord-model',
    });
    expect(listRoutingSettings(H.s.db, H.teamId, true).sessionDefault).toEqual({
      reason: 'coordinator',
      provider: 'coord-gw',
      modelId: 'coord-model',
    });
  });

  test('changing the Coordinator model moves a stored task rule with it and keeps its machine', async () => {
    const machineId = insertMachine(H.s);
    seedRoute(H.s, 'session', { id: AGENT2_ID, provider: 'old-gw', modelId: 'old', machineId });
    const res = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/routing-rules/coordinator`, {
      provider: 'coord-gw',
      modelId: 'coord-model',
      thinkingLevel: 'high',
    });
    expect(res.status).toBe(200);
    expect(routeForStep(H.s.db, { teamId: H.teamId }, 'build')).toMatchObject({
      id: AGENT2_ID,
      provider: 'coord-gw',
      modelId: 'coord-model',
      thinkingLevel: 'high',
      machineId,
    });
  });
});
