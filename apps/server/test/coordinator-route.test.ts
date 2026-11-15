import type { ClaimedStep } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { coordinatorApiKey, coordinatorProviders } from '../src/coordinator/credentials.js';
import { machine as machineTable, routingRule, team as teamTable } from '../src/db/schema.js';
import { setCoordinatorServerContextEnabled } from '../src/services/coordinator-context.js';
import { coordinatorRoute } from '../src/services/coordinator-route.js';
import { resolveChiefStepCredentials } from '../src/services/credentials.js';
import { createProvider } from '../src/services/providers.js';
import { bootServer, issueApiKey, seedRoute, type TestServer } from './helpers.js';

const BYOK_KEY = 'sk-ant-api-test-byok';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

interface World {
  s: TestServer;
  teamId: string;
  threadId: string;
  token: string;
  machineId: string;
}

async function world(opts: { rule?: boolean } = {}): Promise<World> {
  const s = bootServer({ claimHoldMs: 100 });
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const key = await issueApiKey(s);
  const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId, name: 'route-mbp', cliVersion: '9.9.9' }),
  });
  const { token } = (await enrolled.json()) as { token: string };
  const machineId = s.db.select().from(machineTable).get()!.id;
  s.db
    .update(machineTable)
    .set({ enabledRuntimes: ['pi', 'claude-code'] })
    .where(eq(machineTable.id, machineId))
    .run();
  if (opts.rule !== false) {
    seedRoute(s, 'coordinator', { provider: 'stub-gw', modelId: 'stub-model', machineId });
  }
  const sent = await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
    body: { content: 'hello' },
  });
  if (opts.rule === false) {
    expect(sent.status).toBe(409);
    return { s, teamId, threadId: '', token, machineId };
  }
  expect(sent.status).toBe(201);
  const { thread } = (await sent.json()) as { thread: { id: string } };
  return { s, teamId, threadId: thread.id, token, machineId };
}

function allowPaidClaude(w: World) {
  w.s.db
    .update(teamTable)
    .set({ claudeUsage: 'allow-paid' })
    .where(eq(teamTable.id, w.teamId))
    .run();
}

function addAnthropicKey(w: World, providerId = 'anthropic', apiKey: string | null = BYOK_KEY) {
  createProvider(
    { db: w.s.db, box: w.s.secretBox },
    {
      teamId: w.teamId,
      body: {
        providerId,
        label: 'Anthropic',
        baseUrl: 'https://api.anthropic.com',
        api: 'anthropic-messages',
        ...(apiKey !== null ? { apiKey } : {}),
        models: [
          { id: 'claude-sonnet-5-5', name: 'Sonnet' },
          { id: 'claude-haiku-5-5', name: 'Haiku' },
        ],
      },
      createdBy: w.s.user.id,
    },
  );
}

function addKeyless(w: World, providerId: string, modelId: string) {
  createProvider(
    { db: w.s.db, box: w.s.secretBox },
    {
      teamId: w.teamId,
      body: {
        providerId,
        label: providerId,
        baseUrl: 'http://127.0.0.1:8798/v1',
        api: 'openai-completions',
        models: [{ id: modelId, name: modelId }],
      },
      createdBy: w.s.user.id,
    },
  );
  seedRoute(w.s, 'coordinator', { provider: providerId, modelId, machineId: w.machineId });
}

async function claim(w: World): Promise<ClaimedStep | null> {
  const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', { cred: w.token, body: {} });
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step;
}

describe('the coordinator route (D70 C5, now read from the coordinator routing rule)', () => {
  test('a coordinator rule onto a keyed Anthropic provider: the chief claim and its credentials follow the rule', async () => {
    const w = await world();
    addAnthropicKey(w);
    allowPaidClaude(w);
    seedRoute(w.s, 'coordinator', {
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
      machineId: w.machineId,
    });
    const claimed = await claim(w);
    expect(claimed?.agent).toMatchObject({ provider: 'anthropic', modelId: 'claude-haiku-5-5' });
    const bundle = resolveChiefStepCredentials({ db: w.s.db, box: w.s.secretBox }, w.threadId);
    expect(bundle.provider).toMatchObject({
      providerId: 'anthropic',
      apiKey: BYOK_KEY,
      modelId: 'claude-haiku-5-5',
    });
  });

  test('the rule is the only source: without a coordinator rule the chat is refused and a keyed Anthropic provider seeds nothing', async () => {
    const w = await world({ rule: false });
    addAnthropicKey(w);
    expect(w.s.db.select().from(routingRule).all()).toEqual([]);
    expect(await claim(w)).toBeNull();
  });

  test('a rule whose provider has no key claims on the rule model but carries no API key', async () => {
    const w = await world();
    addAnthropicKey(w, 'anthropic', null);
    allowPaidClaude(w);
    seedRoute(w.s, 'coordinator', {
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      machineId: w.machineId,
    });
    expect((await claim(w))?.agent).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
    });
    const bundle = resolveChiefStepCredentials({ db: w.s.db, box: w.s.secretBox }, w.threadId);
    expect(bundle.provider).toMatchObject({ providerId: 'anthropic', apiKey: null });
  });

  test('a rule onto a keyed Anthropic provider is not claimed while the team is subscription-only', async () => {
    const w = await world();
    addAnthropicKey(w);
    seedRoute(w.s, 'coordinator', {
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
      machineId: w.machineId,
    });
    expect(await claim(w)).toBeNull();
  });

  test('a rule onto a gateway with non-Claude model names is claimed as written', async () => {
    const w = await world();
    createProvider(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.teamId,
        body: {
          providerId: 'company-gateway',
          label: 'Gateway',
          baseUrl: 'https://gw.example.com/v1',
          api: 'anthropic-messages',
          apiKey: 'gw-key',
          models: [{ id: 'sonnet', name: 'sonnet' }],
        },
        createdBy: w.s.user.id,
      },
    );
    seedRoute(w.s, 'coordinator', {
      provider: 'company-gateway',
      modelId: 'sonnet',
      machineId: w.machineId,
    });
    expect((await claim(w))?.agent).toMatchObject({
      provider: 'company-gateway',
      modelId: 'sonnet',
    });
    const bundle = resolveChiefStepCredentials({ db: w.s.db, box: w.s.secretBox }, w.threadId);
    expect(bundle.provider).toMatchObject({ providerId: 'company-gateway', modelId: 'sonnet' });
  });

  test('a rule pinned to another machine is not claimed by this one', async () => {
    const w = await world();
    const key = await issueApiKey(w.s);
    const enrolled = await call(w.s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: readyMachine({ teamId: w.teamId, name: 'other-mbp', cliVersion: '9.9.9' }),
    });
    const other = (await enrolled.json()) as { token: string; machineId: string };
    seedRoute(w.s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: other.machineId,
    });
    expect(await claim(w)).toBeNull();
    const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: other.token,
      body: {},
    });
    const body = (await res.json()) as { step: ClaimedStep | null };
    expect(body.step?.agent).toMatchObject({ provider: 'stub-gw', modelId: 'stub-model' });
  });

  test('coordinatorRoute: a keyed non-Anthropic provider is the route without allow-paid', async () => {
    const w = await world();
    setCoordinatorServerContextEnabled(true);
    createProvider(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.teamId,
        body: {
          providerId: 'vani',
          label: 'Vani',
          baseUrl: 'https://vani.example.com/v1',
          api: 'openai-completions',
          apiKey: 'vani-key',
          models: [{ id: 'deepseek/deepseek-v4.1-flash', name: 'flash' }],
        },
        createdBy: w.s.user.id,
      },
    );
    seedRoute(w.s, 'coordinator', {
      provider: 'vani',
      modelId: 'deepseek/deepseek-v4.1-flash',
      machineId: w.machineId,
    });
    expect(coordinatorRoute(w.s.db, w.teamId)).toMatchObject({
      provider: 'vani',
      modelId: 'deepseek/deepseek-v4.1-flash',
    });
    setCoordinatorServerContextEnabled(false);
  });

  test('coordinatorRoute: a keyed Anthropic provider is the default route and writes no rule', async () => {
    const w = await world({ rule: false });
    setCoordinatorServerContextEnabled(true);
    addAnthropicKey(w);
    allowPaidClaude(w);
    expect(coordinatorRoute(w.s.db, w.teamId)).toMatchObject({ provider: 'anthropic' });
    expect(
      w.s.db.select().from(routingRule).where(eq(routingRule.use, 'coordinator')).all(),
    ).toEqual([]);
    setCoordinatorServerContextEnabled(false);
  });

  test('coordinatorRoute: a keyed Anthropic provider needs allow-paid', async () => {
    const w = await world();
    setCoordinatorServerContextEnabled(true);
    addAnthropicKey(w);
    seedRoute(w.s, 'coordinator', {
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
      machineId: w.machineId,
    });
    expect(coordinatorRoute(w.s.db, w.teamId)).toBeNull();
    allowPaidClaude(w);
    expect(coordinatorRoute(w.s.db, w.teamId)).not.toBeNull();
    setCoordinatorServerContextEnabled(false);
  });

  test('coordinatorRoute: a Claude model behind an OpenAI-compatible gateway needs allow-paid', async () => {
    const w = await world();
    setCoordinatorServerContextEnabled(true);
    createProvider(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.teamId,
        body: {
          providerId: 'claude-gateway',
          label: 'Gateway',
          baseUrl: 'https://gw.example.com/v1',
          api: 'openai-completions',
          apiKey: 'gw-key',
          models: [{ id: 'claude-sonnet-5-5', name: 'sonnet' }],
        },
        createdBy: w.s.user.id,
      },
    );
    seedRoute(w.s, 'coordinator', {
      provider: 'claude-gateway',
      modelId: 'claude-sonnet-5-5',
      machineId: w.machineId,
    });
    expect(coordinatorRoute(w.s.db, w.teamId)).toBeNull();
    allowPaidClaude(w);
    expect(coordinatorRoute(w.s.db, w.teamId)).not.toBeNull();
    setCoordinatorServerContextEnabled(false);
  });

  test('coordinatorProviders: a paid Claude compaction rule falls back to the router without allow-paid', async () => {
    const w = await world();
    setCoordinatorServerContextEnabled(true);
    addAnthropicKey(w);
    createProvider(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.teamId,
        body: {
          providerId: 'vani',
          label: 'Vani',
          baseUrl: 'https://vani.example.com/v1',
          api: 'openai-completions',
          apiKey: 'vani-key',
          models: [{ id: 'deepseek/deepseek-v4.1-flash', name: 'flash' }],
        },
        createdBy: w.s.user.id,
      },
    );
    seedRoute(w.s, 'coordinator', {
      provider: 'vani',
      modelId: 'deepseek/deepseek-v4.1-flash',
      machineId: w.machineId,
    });
    seedRoute(w.s, 'compaction', {
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
      machineId: w.machineId,
    });
    const deps = { db: w.s.db, box: w.s.secretBox };
    expect(coordinatorProviders(deps, w.teamId)?.summary.provider).toBe('vani');
    allowPaidClaude(w);
    expect(coordinatorProviders(deps, w.teamId)?.summary.provider).toBe('anthropic');
    setCoordinatorServerContextEnabled(false);
  });
  test('coordinatorRoute: a keyless custom endpoint drives the Coordinator with no key', async () => {
    const w = await world();
    setCoordinatorServerContextEnabled(true);
    addKeyless(w, 'local-llm', 'fake-model');
    expect(coordinatorRoute(w.s.db, w.teamId)).toMatchObject({
      provider: 'local-llm',
      modelId: 'fake-model',
    });
    const deps = { db: w.s.db, box: w.s.secretBox };
    expect(coordinatorProviders(deps, w.teamId)?.router.config).toMatchObject({
      providerId: 'local-llm',
      baseUrl: 'http://127.0.0.1:8798/v1',
    });
    expect(coordinatorApiKey(deps, w.teamId, 'local-llm')).toBeNull();
    setCoordinatorServerContextEnabled(false);
  });

  test.each([
    ['z-ai', 'glm-5.3'],
    ['deepseek', 'deepseek-chat'],
    ['zai', 'glm-5.3'],
  ])(
    'coordinatorRoute: a keyless %s row is still refused, as a preset or built-in vendor id',
    async (providerId, modelId) => {
      const w = await world();
      setCoordinatorServerContextEnabled(true);
      addKeyless(w, providerId, modelId);
      expect(coordinatorRoute(w.s.db, w.teamId)).toBeNull();
      setCoordinatorServerContextEnabled(false);
    },
  );

  test('coordinatorRoute: a keyless endpoint serving a Claude model needs allow-paid', async () => {
    const w = await world();
    setCoordinatorServerContextEnabled(true);
    addKeyless(w, 'local-claude-proxy', 'claude-sonnet-5-5');
    expect(coordinatorRoute(w.s.db, w.teamId)).toBeNull();
    allowPaidClaude(w);
    expect(coordinatorRoute(w.s.db, w.teamId)).not.toBeNull();
    setCoordinatorServerContextEnabled(false);
  });
  test('a coordinator rule saved as the runtime pi reaches the Runner as the provider that stores the model', async () => {
    const w = await world();
    createProvider(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.teamId,
        body: {
          providerId: 'vani',
          label: 'Vani',
          baseUrl: 'https://vani.example.com/v1',
          api: 'openai-completions',
          apiKey: 'vani-key',
          models: [{ id: 'deepseek/deepseek-v4.1-flash', name: 'flash' }],
        },
        createdBy: w.s.user.id,
      },
    );
    seedRoute(w.s, 'coordinator', {
      provider: 'pi',
      modelId: 'deepseek/deepseek-v4.1-flash',
      machineId: w.machineId,
    });
    expect((await claim(w))?.agent).toMatchObject({
      provider: 'vani',
      modelId: 'deepseek/deepseek-v4.1-flash',
    });
    const bundle = resolveChiefStepCredentials({ db: w.s.db, box: w.s.secretBox }, w.threadId);
    expect(bundle.provider).toMatchObject({ providerId: 'vani', apiKey: 'vani-key' });
  });

  test('coordinatorProviders: a compaction rule saved as pi resolves to the provider that stores the model', async () => {
    const w = await world();
    setCoordinatorServerContextEnabled(true);
    addKeyless(w, 'local-llm', 'fake-model');
    createProvider(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.teamId,
        body: {
          providerId: 'summary-gw',
          label: 'Summary',
          baseUrl: 'https://sum.example.com/v1',
          api: 'openai-completions',
          apiKey: 'sum-key',
          models: [{ id: 'small-summary', name: 'small' }],
        },
        createdBy: w.s.user.id,
      },
    );
    seedRoute(w.s, 'compaction', {
      provider: 'pi',
      modelId: 'small-summary',
      machineId: w.machineId,
    });
    const deps = { db: w.s.db, box: w.s.secretBox };
    expect(coordinatorProviders(deps, w.teamId)?.summary.provider).toBe('summary-gw');
    setCoordinatorServerContextEnabled(false);
  });
});
