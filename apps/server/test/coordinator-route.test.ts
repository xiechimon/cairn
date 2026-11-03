import { type ClaimedStep, PROVIDER_PRESET_DEFAULTS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  machine as machineTable,
  routingRule,
  team as teamTable,
} from '../src/db/schema.js';
import { setCoordinatorServerContextEnabled } from '../src/services/coordinator-context.js';
import {
  type CoordinatorRouteFallback,
  setCoordinatorRouteLog,
} from '../src/services/coordinator-route.js';
import { resolveChiefStepCredentials } from '../src/services/credentials.js';
import { createProvider } from '../src/services/providers.js';
import { bootServer, issueApiKey, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-chief-route';
const BYOK_KEY = 'sk-ant-api-test-byok';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

let fallbacks: [string, CoordinatorRouteFallback][] = [];
beforeEach(() => {
  fallbacks = [];
  setCoordinatorRouteLog((teamId, reason) => fallbacks.push([teamId, reason]));
  setCoordinatorServerContextEnabled(true);
});
afterEach(() => setCoordinatorServerContextEnabled(false));

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
}

async function world(): Promise<World> {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId,
      displayName: 'chief',
      description: 'coordinator',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const patched = await call(s.app, 'PATCH', `/api/teams/${teamId}/chief`, {
    body: { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  });
  expect(patched.status).toBe(200);
  const key = await issueApiKey(s);
  const enrolled = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId, name: 'route-mbp', cliVersion: '9.9.9' },
  });
  const { token } = (await enrolled.json()) as { token: string };
  const machineId = s.db.select().from(machineTable).get()!.id;
  s.db
    .update(machineTable)
    .set({ enabledRuntimes: ['pi', 'claude-code'] })
    .where(eq(machineTable.id, machineId))
    .run();
  s.db.update(agentTable).set({ machineId }).where(eq(agentTable.id, AGENT_ID)).run();
  const sent = await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
    body: { content: 'hello' },
  });
  expect(sent.status).toBe(201);
  const { thread } = (await sent.json()) as { thread: { id: string } };
  fallbacks = [];
  setCoordinatorRouteLog((team, reason) => fallbacks.push([team, reason]));
  return { s, teamId, threadId: thread.id, token };
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

async function claim(w: World): Promise<ClaimedStep> {
  const res = await call(w.s.app, 'POST', '/api/machine/tasks/claim', { cred: w.token, body: {} });
  const body = (await res.json()) as { step: ClaimedStep | null };
  if (body.step === null) throw new Error('no step claimed');
  return body.step;
}

describe('the coordinator route (D70 C5)', () => {
  test('with a keyed Anthropic provider, the chief claim runs on it through Pi and a rule is seeded', async () => {
    const w = await world();
    addAnthropicKey(w);
    allowPaidClaude(w);
    const claimed = await claim(w);
    expect(claimed.agent).toMatchObject({ provider: 'anthropic', modelId: 'claude-haiku-5-5' });
    expect(w.s.db.select().from(routingRule).all()).toMatchObject([
      { teamId: w.teamId, use: 'coordinator', provider: 'anthropic', modelId: 'claude-haiku-5-5' },
    ]);
    const bundle = resolveChiefStepCredentials({ db: w.s.db, box: w.s.secretBox }, w.threadId);
    expect(bundle.provider).toMatchObject({
      providerId: 'anthropic',
      apiKey: BYOK_KEY,
      modelId: 'claude-haiku-5-5',
    });
    expect(fallbacks).toEqual([]);
  });

  test('without an API-key provider the chief claim falls back to the bound agent and logs why once', async () => {
    const w = await world();
    const claimed = await claim(w);
    expect(claimed.agent).toMatchObject({ provider: 'stub-gw', modelId: 'stub-model' });
    resolveChiefStepCredentials({ db: w.s.db, box: w.s.secretBox }, w.threadId);
    expect(fallbacks).toEqual([[w.teamId, 'no-api-key-provider']]);
    expect(w.s.db.select().from(routingRule).all()).toEqual([]);
  });

  test('an Anthropic provider without a key does not count, and a rule whose provider lost its key falls back', async () => {
    const w = await world();
    addAnthropicKey(w, 'anthropic', null);
    expect((await claim(w)).agent?.provider).toBe('stub-gw');
    expect(fallbacks).toEqual([[w.teamId, 'no-api-key-provider']]);
    w.s.db
      .insert(routingRule)
      .values({
        id: 'rule-coord',
        teamId: w.teamId,
        use: 'coordinator',
        provider: 'anthropic',
        modelId: 'claude-sonnet-5-5',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const bundle = resolveChiefStepCredentials({ db: w.s.db, box: w.s.secretBox }, w.threadId);
    expect(bundle.provider).toBeNull();
    expect(fallbacks).toContainEqual([w.teamId, 'rule-provider-has-no-key']);
  });

  test('flag off: a keyed provider and a rule change nothing', async () => {
    const w = await world();
    addAnthropicKey(w);
    setCoordinatorServerContextEnabled(false);
    expect((await claim(w)).agent).toMatchObject({ provider: 'stub-gw', modelId: 'stub-model' });
    expect(w.s.db.select().from(routingRule).all()).toEqual([]);
    expect(fallbacks).toEqual([]);
  });

  test('a keyed relay speaking the Anthropic API is never seeded as the Coordinator', async () => {
    const w = await world();
    createProvider(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.teamId,
        body: {
          providerId: 'relay-186',
          label: 'Relay',
          baseUrl: 'https://relay.example.com/v1',
          api: 'anthropic-messages',
          apiKey: 'relay-key',
          models: [{ id: 'glm-5.3', name: 'GLM' }],
        },
        createdBy: w.s.user.id,
      },
    );
    allowPaidClaude(w);
    expect((await claim(w)).agent).toMatchObject({ provider: 'stub-gw', modelId: 'stub-model' });
    expect(w.s.db.select().from(routingRule).all()).toEqual([]);
    expect(fallbacks).toEqual([[w.teamId, 'no-api-key-provider']]);
  });

  test('a hand-written rule to a gateway with non-Claude model names still needs allow-paid', async () => {
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
    w.s.db
      .insert(routingRule)
      .values({
        id: 'rule-gw',
        teamId: w.teamId,
        use: 'coordinator',
        provider: 'company-gateway',
        modelId: 'sonnet',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    expect((await claim(w)).agent).toMatchObject({ provider: 'stub-gw', modelId: 'stub-model' });
    expect(fallbacks).toEqual([[w.teamId, 'paid-claude-not-allowed']]);
  });

  test('a keyed Anthropic provider with no models does not shadow one that has them', async () => {
    const w = await world();
    createProvider(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.teamId,
        body: {
          providerId: 'anthropic-empty',
          label: 'Empty',
          baseUrl: 'https://api.anthropic.com',
          api: 'anthropic-messages',
          apiKey: 'empty-key',
          models: [],
        },
        createdBy: w.s.user.id,
      },
    );
    addAnthropicKey(w);
    allowPaidClaude(w);
    expect((await claim(w)).agent).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
    });
  });

  test('a provider added from the Anthropic preset as filled in is the keyed Coordinator route', async () => {
    const w = await world();
    const preset = PROVIDER_PRESET_DEFAULTS.anthropic;
    if (preset === undefined) throw new Error('the Anthropic preset has no defaults');
    createProvider(
      { db: w.s.db, box: w.s.secretBox },
      {
        teamId: w.teamId,
        body: { providerId: 'anthropic', label: 'Anthropic', ...preset, apiKey: BYOK_KEY },
        createdBy: w.s.user.id,
      },
    );
    allowPaidClaude(w);
    expect((await claim(w)).agent).toMatchObject({
      provider: 'anthropic',
      modelId: 'claude-haiku-5-5',
    });
    expect(fallbacks).toEqual([]);
  });

  test('a keyed provider while the team is subscription-only falls back instead of spending', async () => {
    const w = await world();
    addAnthropicKey(w);
    expect((await claim(w)).agent).toMatchObject({ provider: 'stub-gw', modelId: 'stub-model' });
    expect(fallbacks).toEqual([[w.teamId, 'paid-claude-not-allowed']]);
  });
});
