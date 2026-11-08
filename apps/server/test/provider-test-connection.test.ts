import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bootServer, req, type TestServer } from './helpers.js';

const KEY = 'connection-fixture-secret';
const OTHER_KEY = `sk-ant-api03-${'Z'.repeat(32)}`;

type Call = { url: string; headers: Headers; body: Record<string, unknown> };
type Reply = { status: number; body: string | object };

function completion(model = 'upstream-model'): string {
  return `${[
    {
      choices: [{ index: 0, delta: { role: 'assistant', content: 'pong' }, finish_reason: null }],
    },
    {
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  ]
    .map(
      (chunk) =>
        `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 1, model, ...chunk })}\n\n`,
    )
    .join('')}data: [DONE]\n\n`;
}

function transport(reply: Reply | ((call: Call) => Reply)) {
  const calls: Call[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const call = {
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    };
    calls.push(call);
    const result = typeof reply === 'function' ? reply(call) : reply;
    return new Response(
      typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
      {
        status: result.status,
        headers: {
          'content-type':
            typeof result.body === 'string' && result.body.startsWith('data:')
              ? 'text/event-stream'
              : 'application/json',
        },
      },
    );
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

async function addProvider(s: TestServer, extra: Record<string, unknown> = {}) {
  const response = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers`, {
    providerId: 'connection-fixture',
    label: 'Connection fixture',
    api: 'openai-completions',
    baseUrl: 'https://provider.example/v1',
    authHeader: false,
    apiKey: KEY,
    models: [{ id: 'small', name: 'Small' }],
    ...extra,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return `/api/teams/${s.team.id}/providers/${id}/test`;
}

async function result(s: TestServer, path: string, body: object = {}) {
  const response = await req(s.app, 'POST', path, body);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text.includes(KEY)).toBe(false);
  expect(text.includes(OTHER_KEY)).toBe(false);
  return JSON.parse(text) as { status: string; reason: string | null };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provider connection check', () => {
  test('uses native Bearer auth for OpenAI-compatible api-key credentials', async () => {
    const calls = transport((call) => ({
      status:
        call.headers.get('authorization') === `Bearer ${KEY}` && !call.headers.has('api-key')
          ? 200
          : 401,
      body: completion(),
    }));
    const s = bootServer();
    const data = await result(s, await addProvider(s));
    const envelope = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/providers`)
    ).json()) as { canTestConnection?: boolean };
    expect(envelope.canTestConnection).toBe(true);
    expect(data.status).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('authorization') === `Bearer ${KEY}`).toBe(true);
  });

  test('honours compat.maxTokensField on the actual request', async () => {
    const calls = transport({ status: 200, body: completion() });
    const s = bootServer();
    expect(
      (
        await result(
          s,
          await addProvider(s, { compat: { maxTokensField: 'max_completion_tokens' } }),
        )
      ).status,
    ).toBe('ok');
    expect(calls[0]?.body.max_completion_tokens).toBe(8);
    expect(calls[0]?.body).not.toHaveProperty('max_tokens');
  });

  test.each([
    { body: {} },
    { body: [] },
    { body: { error: { message: 'gateway failed' } } },
    { body: '<html>not a provider</html>' },
  ])('rejects malformed HTTP 200 bodies: $body', async ({ body }) => {
    transport({ status: 200, body });
    const s = bootServer();
    const data = await result(s, await addProvider(s));
    expect(data.status).toBe('failed');
    expect(data.reason).toEqual(expect.any(String));
  });

  test('scrubs a stored key and pattern-shaped credentials in provider errors', async () => {
    transport({
      status: 401,
      body: { error: { message: `denied ${KEY} ${OTHER_KEY} Bearer abc.def.ghi` } },
    });
    const s = bootServer();
    const data = await result(s, await addProvider(s));
    expect(data.status).toBe('failed');
    expect(JSON.stringify(data).includes('abc.def.ghi')).toBe(false);
    expect(data.reason).toEqual(expect.any(String));
    expect(JSON.stringify(data).includes('denied')).toBe(false);
  });

  test('refuses a non-owner with 403 before outbound traffic', async () => {
    const calls = transport({ status: 200, body: completion() });
    const s = bootServer();
    const path = await addProvider(s);
    s.db.run(sql`INSERT INTO user (id, displayName) VALUES ('earlier-user', 'Earlier')`);
    s.db.run(sql`UPDATE user SET rowid = 100000 WHERE id != 'earlier-user'`);
    const envelope = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/providers`)
    ).json()) as { canTestConnection?: boolean };
    expect(envelope.canTestConnection).toBe(false);
    expect((await req(s.app, 'POST', path, {})).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test('returns exactly status and reason, with no model count or upstream metadata', async () => {
    transport({ status: 200, body: completion(`model-${KEY}`) });
    const s = bootServer();
    expect(await result(s, await addProvider(s))).toEqual({ status: 'ok', reason: null });
  });

  test('uses native x-api-key authentication for Anthropic', async () => {
    const calls = transport({
      status: 401,
      body: { error: { type: 'authentication_error', message: 'fixture denial' } },
    });
    const s = bootServer();
    expect(
      (
        await result(
          s,
          await addProvider(s, {
            providerId: 'anthropic',
            api: 'anthropic-messages',
            baseUrl: 'https://api.anthropic.com',
          }),
        )
      ).status,
    ).toBe('failed');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('x-api-key') === KEY).toBe(true);
    expect(calls[0]?.headers.has('authorization')).toBe(false);
  });

  test('honours a saved Bearer override for an Anthropic-compatible gateway', async () => {
    const calls = transport({
      status: 401,
      body: { error: { type: 'authentication_error', message: 'fixture denial' } },
    });
    const s = bootServer();
    await result(s, await addProvider(s, { api: 'anthropic-messages', authHeader: true }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('authorization') === `Bearer ${KEY}`).toBe(true);
    expect(calls[0]?.headers.has('x-api-key')).toBe(false);
  });

  test('reports missing models without an outbound request', async () => {
    const calls = transport({ status: 200, body: completion() });
    const s = bootServer();
    expect((await result(s, await addProvider(s, { models: [] }))).status).toBe('failed');
    expect(calls).toHaveLength(0);
  });

  test('does not echo a provider identifier in a not-found response', async () => {
    const s = bootServer();
    const response = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers/${KEY}/test`, {});
    expect(response.status).toBe(404);
    expect((await response.text()).includes(KEY)).toBe(false);
  });

  test('redacts literal stored credentials even from server-authored reasons', async () => {
    transport({ status: 401, body: { error: { message: 'denied' } } });
    const s = bootServer();
    const data = await result(s, await addProvider(s, { apiKey: 'provider' }));
    expect(data.status).toBe('failed');
    expect(data.reason?.includes('provider')).toBe(false);
    expect(data.reason).toContain('[REDACTED]');
  });

  test('does not require a stored key for a keyless gateway', async () => {
    const calls = transport({ status: 200, body: completion() });
    const s = bootServer();
    expect((await result(s, await addProvider(s, { apiKey: null }))).status).toBe('ok');
    expect(calls).toHaveLength(1);
  });

  test('reports network exceptions without disclosing exception text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`private-model ${KEY}`)));
    const s = bootServer();
    const data = await result(s, await addProvider(s));
    expect(data.status).toBe('failed');
    expect(JSON.stringify(data).includes('private-model')).toBe(false);
  });

  test('stops a hanging request at the configured timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    const s = bootServer({ providerTestTimeoutMs: 30 });
    const data = await result(s, await addProvider(s));
    expect(data.status).toBe('failed');
    expect(data.reason).toContain('in time');
  });

  test('withholds the owner capability from a paired-device credential', async () => {
    const owner = 'fixture-owner-credential';
    const s = bootServer({ authToken: owner });
    const issued = await s.app.request('/api/remote/pairing', {
      method: 'POST',
      headers: { authorization: `Bearer ${owner}` },
    });
    expect(issued.status).toBe(201);
    const { code } = (await issued.json()) as { code: string };
    const paired = await req(s.app, 'POST', '/api/remote/pair', { code, name: 'Fixture phone' });
    expect(paired.status).toBe(201);
    const { token } = (await paired.json()) as { token: string };
    const path = `/api/teams/${s.team.id}/providers`;
    const envelope = await s.app.request(path, { headers: { authorization: `Bearer ${token}` } });
    expect(envelope.status).toBe(200);
    expect(((await envelope.json()) as { canTestConnection: boolean }).canTestConnection).toBe(
      false,
    );
    const denied = await s.app.request(`${path}/missing/test`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(denied.status).toBe(403);
  });

  test('requires the session bearer token before running a check', async () => {
    const calls = transport({ status: 200, body: completion() });
    const s = bootServer({ authToken: 'fixture-session-credential' });
    expect(
      (await req(s.app, 'POST', `/api/teams/${s.team.id}/providers/missing/test`, {})).status,
    ).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('limits each provider to five requests per minute', async () => {
    const calls = transport({ status: 200, body: completion() });
    const s = bootServer();
    const path = await addProvider(s);
    for (let index = 0; index < 5; index++) await result(s, path);
    expect((await req(s.app, 'POST', path, {})).status).toBe(429);
    expect(calls).toHaveLength(5);
  });
});
