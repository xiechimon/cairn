import type { ClaimedStep } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { machine as machineTable, routingRule, team as teamTable } from '../src/db/schema.js';
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
    body: { teamId, name: 'route-mbp', cliVersion: '9.9.9' },
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
      body: { teamId: w.teamId, name: 'other-mbp', cliVersion: '9.9.9' },
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
});
