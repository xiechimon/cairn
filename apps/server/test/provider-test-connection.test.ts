import { providerTestResultSchema } from '@cairn/shared';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { FetchLike } from '../src/lib/github.js';
import { PROVIDER_TEST_LIMIT } from '../src/services/provider-test.js';
import { bootServer, req, type TestServer } from './helpers.js';

const KEY = 'sk-live-0123456789abcdefghij0123456789ABCDEF';
const TOKEN = 'cairn-owner-token-for-tests';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Reply = { status: number; body: unknown; delayMs?: number } | 'hang' | Error;

function stubFetch(replies: Record<string, Reply>) {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body,
    });
    const reply = replies[`${init?.method ?? 'GET'} ${new URL(url).pathname}`];
    if (reply === undefined) throw new Error(`unexpected request ${url}`);
    if (reply instanceof Error) return Promise.reject(reply);
    if (reply === 'hang') {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: () => null },
      json: () => Promise.resolve(JSON.parse(text)),
      text: () => Promise.resolve(text),
    });
  };
  return { fetch, calls };
}

async function addProvider(
  s: TestServer,
  over: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers`, {
    providerId: 'gw',
    label: 'Gateway',
    baseUrl: 'https://gw.example.com/v1',
    api: 'openai-completions',
    apiKey: KEY,
    models: [
      { id: 'big', name: 'big', cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 } },
      { id: 'small', name: 'small', cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
    ],
    ...over,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

function testPath(s: TestServer, id: string): string {
  return `/api/teams/${s.team.id}/providers/${id}/test`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('provider test connection', () => {
  test('lists models, probes the cheapest configured model with max_tokens <= 8 and reports only the result summary', async () => {
    const { fetch, calls } = stubFetch({
      'GET /v1/models': { status: 200, body: { data: [{ id: 'big' }, { id: 'small' }] } },
      'POST /v1/chat/completions': { status: 200, body: { model: 'small-2026', choices: [] } },
    });
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const res = await req(s.app, 'POST', testPath(s, id), {});
    expect(res.status).toBe(200);
    const text = await res.text();
    const result = providerTestResultSchema.parse(JSON.parse(text));
    expect(result.status).toBe('ok');
    expect(result.listing).toMatchObject({ httpStatus: 200, modelCount: 2, error: null });
    expect(result.probe).toMatchObject({
      requestedModel: 'small',
      echoedModel: 'small-2026',
      httpStatus: 200,
      error: null,
    });
    expect(result.probe.latencyMs).toBeGreaterThanOrEqual(0);
    const probe = calls.find((c) => c.method === 'POST');
    expect(JSON.parse(probe?.body ?? '{}').max_tokens).toBeLessThanOrEqual(8);
    expect(JSON.parse(probe?.body ?? '{}').model).toBe('small');
    expect(text).not.toContain(KEY);
    expect(text.toLowerCase()).not.toContain('authorization');
  });

  test('an explicit model in the body overrides the cheapest-model choice', async () => {
    const { fetch, calls } = stubFetch({
      'GET /v1/models': { status: 200, body: { data: [] } },
      'POST /v1/chat/completions': { status: 200, body: { model: 'big' } },
    });
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const res = await req(s.app, 'POST', testPath(s, id), { model: 'big' });
    expect(((await res.json()) as { probe: { requestedModel: string } }).probe.requestedModel).toBe(
      'big',
    );
    expect(JSON.parse(calls.find((c) => c.method === 'POST')?.body ?? '{}').model).toBe('big');
  });

  test('anthropic providers use /v1/messages with x-api-key when authHeader is off', async () => {
    const { fetch, calls } = stubFetch({
      'GET /v1/models': { status: 200, body: { data: [{ id: 'claude-x' }] } },
      'POST /v1/messages': { status: 200, body: { model: 'claude-x' } },
    });
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s, {
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
      authHeader: false,
      models: [{ id: 'claude-x', name: 'claude-x' }],
    });
    const res = await req(s.app, 'POST', testPath(s, id), {});
    expect(((await res.json()) as { status: string }).status).toBe('ok');
    const probe = calls.find((c) => c.method === 'POST');
    expect(probe?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(probe?.headers['x-api-key']).toBe(KEY);
    expect(probe?.headers.authorization).toBeUndefined();
  });

  test('a provider without /models still gets its probe and reports the listing failure separately', async () => {
    const { fetch } = stubFetch({
      'GET /v1/models': { status: 404, body: { error: { message: 'no such route' } } },
      'POST /v1/chat/completions': { status: 200, body: { model: 'small' } },
    });
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const result = (await (await req(s.app, 'POST', testPath(s, id), {})).json()) as {
      status: string;
      listing: { httpStatus: number; error: { type: string } };
    };
    expect(result.status).toBe('ok');
    expect(result.listing.httpStatus).toBe(404);
    expect(result.listing.error.type).toBe('not_found');
  });

  test('upstream error bodies that echo the key are scrubbed, by literal and by pattern', async () => {
    const other = 'sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
    const { fetch } = stubFetch({
      'GET /v1/models': { status: 401, body: { error: { message: `bad key ${KEY}` } } },
      'POST /v1/chat/completions': {
        status: 401,
        body: {
          error: {
            message: `Incorrect API key provided: ${KEY}; saw Bearer abc.def.ghi and ${other}`,
          },
        },
      },
    });
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const res = await req(s.app, 'POST', testPath(s, id), {});
    const text = await res.text();
    const result = providerTestResultSchema.parse(JSON.parse(text));
    expect(result.status).toBe('failed');
    expect(result.probe.httpStatus).toBe(401);
    expect(result.probe.error?.type).toBe('auth');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(other);
    expect(text).not.toContain('abc.def.ghi');
    expect(result.probe.error?.message).toContain('[REDACTED]');
  });

  test('a short key that is not pattern-shaped is still removed by literal match, and long bodies are truncated', async () => {
    const short = 'hunter2hunter2';
    const { fetch } = stubFetch({
      'GET /v1/models': { status: 500, body: 'x'.repeat(5000) },
      'POST /v1/chat/completions': { status: 500, body: `oops ${short} ${'y'.repeat(5000)}` },
    });
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s, { apiKey: short });
    const text = await (await req(s.app, 'POST', testPath(s, id), {})).text();
    expect(text).not.toContain(short);
    expect(text.length).toBeLessThan(1500);
    expect(JSON.parse(text).probe.error.type).toBe('server');
  });

  test('network failures that mention the key in the message are scrubbed', async () => {
    const { fetch } = stubFetch({
      'GET /v1/models': new Error(`connect failed for ${KEY}`),
      'POST /v1/chat/completions': new Error(`ECONNREFUSED https://gw.example.com?k=${KEY}`),
    });
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const text = await (await req(s.app, 'POST', testPath(s, id), {})).text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).probe.error.type).toBe('network');
  });

  test('a hanging provider times out and reports a timeout error', async () => {
    const { fetch } = stubFetch({
      'GET /v1/models': 'hang',
      'POST /v1/chat/completions': 'hang',
    });
    const s = bootServer({ providerTestFetch: fetch, providerTestTimeoutMs: 30 });
    const { id } = await addProvider(s);
    const result = (await (await req(s.app, 'POST', testPath(s, id), {})).json()) as {
      status: string;
      listing: { error: { type: string } };
      probe: { error: { type: string }; httpStatus: number | null };
    };
    expect(result.status).toBe('failed');
    expect(result.listing.error.type).toBe('timeout');
    expect(result.probe.error.type).toBe('timeout');
    expect(result.probe.httpStatus).toBeNull();
  });

  test('a non-JSON success body is an invalid_response, not an ok', async () => {
    const { fetch } = stubFetch({
      'GET /v1/models': { status: 200, body: '<html>captive portal</html>' },
      'POST /v1/chat/completions': { status: 200, body: '<html>captive portal</html>' },
    });
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const result = (await (await req(s.app, 'POST', testPath(s, id), {})).json()) as {
      status: string;
      probe: { error: { type: string } };
    };
    expect(result.status).toBe('failed');
    expect(result.probe.error.type).toBe('invalid_response');
  });

  test('a provider with no stored key reports no_key and makes no outbound request', async () => {
    const { fetch, calls } = stubFetch({});
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s, { apiKey: null });
    const result = (await (await req(s.app, 'POST', testPath(s, id), {})).json()) as {
      status: string;
      probe: { error: { type: string } };
    };
    expect(result.status).toBe('failed');
    expect(result.probe.error.type).toBe('no_key');
    expect(calls).toHaveLength(0);
  });

  test('a provider with no models configured or listed reports no_model and sends no probe', async () => {
    const { fetch, calls } = stubFetch({
      'GET /v1/models': { status: 200, body: { data: [] } },
    });
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s, { models: [] });
    const result = (await (await req(s.app, 'POST', testPath(s, id), {})).json()) as {
      probe: { error: { type: string } };
    };
    expect(result.probe.error.type).toBe('no_model');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  test('an unknown provider id is 404', async () => {
    const s = bootServer({ providerTestFetch: stubFetch({}).fetch });
    const res = await req(s.app, 'POST', testPath(s, 'missing'), {});
    expect(res.status).toBe(404);
  });

  test('a caller who is not the owner is refused with 403 and nothing is sent', async () => {
    const { fetch, calls } = stubFetch({});
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    s.db.run(sql`INSERT INTO user (id, displayName) VALUES ('earlier-user', 'Earlier')`);
    s.db.run(sql`UPDATE user SET rowid = 100000 WHERE id != 'earlier-user'`);
    const res = await req(s.app, 'POST', testPath(s, id), {});
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test('without the bearer token the endpoint answers 401 and sends nothing', async () => {
    const { fetch, calls } = stubFetch({});
    const s = bootServer({ providerTestFetch: fetch, authToken: TOKEN });
    const res = await req(s.app, 'POST', testPath(s, 'any'), {});
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('each provider is limited separately; the extra call gets 429', async () => {
    const { fetch, calls } = stubFetch({
      'GET /v1/models': { status: 200, body: { data: [] } },
      'POST /v1/chat/completions': { status: 200, body: { model: 'small' } },
    });
    const s = bootServer({ providerTestFetch: fetch });
    const first = await addProvider(s);
    const second = await addProvider(s, { providerId: 'gw2' });
    for (let i = 0; i < PROVIDER_TEST_LIMIT; i++) {
      expect((await req(s.app, 'POST', testPath(s, first.id), {})).status).toBe(200);
    }
    const before = calls.length;
    expect((await req(s.app, 'POST', testPath(s, first.id), {})).status).toBe(429);
    expect(calls).toHaveLength(before);
    expect((await req(s.app, 'POST', testPath(s, second.id), {})).status).toBe(200);
  });

  test('the key never reaches the logger or the console during a failing test run', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      capture(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      capture(String(chunk));
      return true;
    });
    const logged: unknown[] = [];
    const sink = (obj: unknown, msg?: string) => logged.push(obj, msg);
    const logger = { error: sink, warn: sink, info: sink, debug: sink } as never;
    const { fetch } = stubFetch({
      'GET /v1/models': new Error(`boom ${KEY}`),
      'POST /v1/chat/completions': { status: 401, body: `denied ${KEY}` },
    });
    const s = bootServer({ providerTestFetch: fetch, logger });
    const { id } = await addProvider(s);
    const res = await req(s.app, 'POST', testPath(s, id), {});
    expect(res.status).toBe(200);
    expect(lines.join('\n')).not.toContain(KEY);
    expect(JSON.stringify(logged)).not.toContain(KEY);
  });
});
