import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { routingRule, todo as todoTable } from '../src/db/schema.js';
import {
  listRoutingSettings,
  profileForStep,
  routeForStep,
} from '../src/services/routing-rules.js';
import {
  createDoubaoSubscription,
  disableDoubaoSubscription,
} from '../src/services/doubao-subscriptions.js';
import { createProvider } from '../src/services/providers.js';
import { readTopModels, writeTopModels } from '../src/services/top-models.js';
import {
  AGENT2_ID,
  H,
  ownerTodo,
  registerChiefHarness,
  relay,
  seedMachineReport,
} from './chief-harness.js';
import { insertClaudeSubscription, insertMachine, req, seedRoute } from './helpers.js';

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

function provider(providerId: string, ...models: string[]) {
  createProvider(
    { db: H.s.db, box: H.s.secretBox },
    {
      teamId: H.teamId,
      createdBy: H.userId,
      body: {
        providerId,
        label: providerId,
        baseUrl: `http://127.0.0.1:9/${providerId}`,
        api: 'openai-completions',
        models: models.map((id) => ({ id, name: id })),
      },
    },
  );
}

function doubaoMachine() {
  return insertMachine(H.s, {
    name: 'mac-mini',
    capabilities: {
      mcpServers: [],
      skills: [],
      executor: 'host',
      doubao: {
        installed: true,
        authenticated: true,
        platformSupported: true,
        version: '2.38.4',
        probedAt: Date.now(),
        models: [{ id: 'auto', name: 'Auto' }],
      },
    },
  });
}

describe('the Coordinator picks a task model from the configured models', () => {
  test('a named Mac mini runs a qualified Doubao model outside the sole favorite', async () => {
    const machineId = doubaoMachine();
    createDoubaoSubscription({ db: H.s.db }, H.teamId, { label: 'Doubao', runnerId: machineId });
    frequent({ provider: 'devin', modelId: 'swe-2-1-medium' });
    const favorites = readTopModels(H.s.db, H.teamId);
    const catalog = (await relay('models', {})) as { provider: string; modelId: string }[];
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'doubao', modelId: 'auto', modelName: 'Auto' }),
      ]),
    );
    const created = (await relay('create_todo', {
      ...ownerTodo('在 Mac mini 上用 Doubao Auto 整理文档'),
      machine: machineId,
      model: 'doubao/auto',
    })) as { id: string; phase: string };
    expect(created.phase).toBe('queued');
    expect(todoRow(created.id).request?.model).toEqual({
      provider: 'doubao',
      modelId: 'auto',
      thinkingLevel: null,
    });
    expect(todoRow(created.id).routeOverride).toEqual({ machineId });
    expect(readTopModels(H.s.db, H.teamId)).toEqual(favorites);
  });

  test('create_todo with a frequent model stores it on the request and every session step runs it', async () => {
    provider('stub-gw', 'fast-model');
    provider('strong-gw', 'deep-model');
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
    provider('strong-gw', 'deep-model');
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

  test('an unknown model is refused and no task is created', async () => {
    provider('stub-gw', 'fast-model');
    frequent({ provider: 'stub-gw', modelId: 'fast-model' });
    await expect(
      relay('create_todo', { ...ownerTodo('写文档'), model: 'other-model' }),
    ).rejects.toThrow(/other-model/);
    expect(H.s.db.select().from(todoTable).all()).toEqual([]);
  });

  test('configured providers with the same bare model are both discoverable; bare selection is ambiguous', async () => {
    provider('alpha', 'shared');
    provider('vendor', 'shared');
    const rows = (await relay('models', {})) as { provider: string; modelId: string }[];
    expect(
      rows
        .filter((row) => row.modelId === 'shared')
        .map((row) => row.provider)
        .sort(),
    ).toEqual(['alpha', 'vendor']);
    await expect(relay('create_todo', { ...ownerTodo('写文档'), model: 'shared' })).rejects.toThrow(
      /ambiguous/i,
    );
    expect(H.s.db.select().from(todoTable).all()).toEqual([]);
  });

  test('qualified names win over bare names containing a slash and preserve the full model ID', async () => {
    provider('alpha', 'shared', 'vendor/shared');
    provider('vendor', 'shared');
    const selected = (await relay('create_todo', {
      ...ownerTodo('写文档'),
      model: 'vendor/shared',
    })) as { id: string };
    expect(todoRow(selected.id).request?.model).toEqual({
      provider: 'vendor',
      modelId: 'shared',
      thinkingLevel: null,
    });
    const slash = (await relay('create_todo', {
      ...ownerTodo('整理文档'),
      model: 'alpha/vendor/shared',
    })) as { id: string };
    expect(todoRow(slash.id).request?.model).toEqual({
      provider: 'alpha',
      modelId: 'vendor/shared',
      thinkingLevel: null,
    });
  });

  test('a disabled Doubao subscription cannot authorize a stale reported model or favorite', async () => {
    const machineId = doubaoMachine();
    const sub = createDoubaoSubscription({ db: H.s.db }, H.teamId, {
      label: 'Doubao',
      runnerId: machineId,
    });
    disableDoubaoSubscription({ db: H.s.db }, H.teamId, sub.id);
    frequent({ provider: 'doubao', modelId: 'auto' });
    await expect(
      relay('create_todo', {
        ...ownerTodo('写文档'),
        machine: machineId,
        model: 'doubao/auto',
      }),
    ).rejects.toThrow();
    expect(H.s.db.select().from(todoTable).all()).toEqual([]);
  });

  test('without a pick the task keeps the team route', async () => {
    provider('strong-gw', 'deep-model');
    frequent({ provider: 'strong-gw', modelId: 'deep-model' });
    const created = (await relay('create_todo', ownerTodo('写文档'))) as { id: string };
    expect(todoRow(created.id).request?.model).toBeUndefined();
    expect(routeForStep(H.s.db, todoRow(created.id), 'build')).toMatchObject({
      provider: 'stub-gw',
      modelId: 'stub-model-2',
    });
  });

  test('the models tool marks the frequent models', async () => {
    insertClaudeSubscription(H.s);
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
