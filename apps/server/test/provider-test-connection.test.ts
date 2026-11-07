import { providerTestResultSchema } from '@cairn/shared';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PROVIDER_TEST_LIMIT } from '../src/services/provider-test.js';
import { bootServer, req, type TestServer } from './helpers.js';

const KEY = 'sk-live-0123456789abcdefghij0123456789ABCDEF';
const TOKEN = 'cairn-owner-token-for-tests';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

type Reply = { status: number; body: unknown } | 'hang' | Error;

function sse(events: { event?: string; data: unknown }[]): string {
  return `${events
    .map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(e.data)}\n\n`)
    .join('')}data: [DONE]\n\n`;
}

function completion(model: string): string {
  const chunk = (delta: object, finish: string | null, usage?: object) => ({
    data: {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage === undefined ? {} : { usage }),
    },
  });
  return sse([
    chunk({ role: 'assistant', content: 'pong' }, null),
    chunk({}, 'stop', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ]);
}

function anthropicCompletion(model: string): string {
  return sse([
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    },
    {
      event: 'content_block_start',
      data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'pong' },
      },
    },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 1 },
      },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);
}

function stubFetch(reply: (call: Call) => Reply) {
  const calls: Call[] = [];
  const fetch = ((input: unknown, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const headers = new Headers(init?.headers ?? request?.headers);
    const call: Call = {
      url: request?.url ?? String(input),
      method: init?.method ?? request?.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(call);
    const r = reply(call);
    if (r instanceof Error) return Promise.reject(r);
    if (r === 'hang') {
      const signal = init?.signal ?? request?.signal;
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    }
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return Promise.resolve(
      new Response(text, {
        status: r.status,
        headers: {
          'content-type':
            text.startsWith('data:') || text.startsWith('event:')
              ? 'text/event-stream'
              : 'application/json',
        },
      }),
    );
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const ok = (model: string) => stubFetch(() => ({ status: 200, body: completion(model) }));

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
  test('probes the cheapest configured model through the pi stack with max_tokens <= 8 and reports only the result summary', async () => {
    const { fetch, calls } = ok('small-2026');
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const res = await req(s.app, 'POST', testPath(s, id), {});
    expect(res.status).toBe(200);
    const text = await res.text();
    const result = providerTestResultSchema.parse(JSON.parse(text));
    expect(result.status).toBe('ok');
    expect(result.probe).toMatchObject({
      requestedModel: 'small',
      echoedModel: 'small-2026',
      httpStatus: 200,
      error: null,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://gw.example.com/v1/chat/completions');
    const sent = JSON.parse(calls[0]?.body ?? '{}');
    expect(sent.model).toBe('small');
    expect(sent.max_tokens ?? sent.max_completion_tokens).toBeLessThanOrEqual(8);
    expect(text).not.toContain(KEY);
    expect(text.toLowerCase()).not.toContain('authorization');
  });

  test('an explicit model in the body overrides the cheapest-model choice, even when it is not configured', async () => {
    const { fetch, calls } = ok('other');
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const res = await req(s.app, 'POST', testPath(s, id), { model: 'other' });
    expect(((await res.json()) as { probe: { requestedModel: string } }).probe.requestedModel).toBe(
      'other',
    );
    expect(JSON.parse(calls[0]?.body ?? '{}').model).toBe('other');
  });

  test('an OpenAI-compatible provider with authHeader off still authenticates with its native Bearer header', async () => {
    const { fetch, calls } = ok('small');
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s, { authHeader: false });
    await req(s.app, 'POST', testPath(s, id), {});
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  test('compat.maxTokensField is honoured by the probe request', async () => {
    const { fetch, calls } = ok('small');
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s, { compat: { maxTokensField: 'max_completion_tokens' } });
    await req(s.app, 'POST', testPath(s, id), {});
    const sent = JSON.parse(calls[0]?.body ?? '{}');
    expect(sent.max_completion_tokens).toBeLessThanOrEqual(8);
    expect(sent.max_tokens).toBeUndefined();
  });

  test('anthropic providers use /v1/messages with the native x-api-key', async () => {
    const { fetch, calls } = stubFetch(() => ({
      status: 200,
      body: anthropicCompletion('claude-x'),
    }));
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
    expect(calls[0]?.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages(\?|$)/);
    expect(calls[0]?.headers['x-api-key']).toBe(KEY);
  });

  test('an upstream success whose model string echoes the key is scrubbed from the summary', async () => {
    const { fetch } = ok(`small-${KEY}`);
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const text = await (await req(s.app, 'POST', testPath(s, id), {})).text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).probe.echoedModel).toContain('[REDACTED]');
  });

  test('an explicit model that contains the key is scrubbed from requestedModel', async () => {
    const { fetch } = ok('x');
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const text = await (await req(s.app, 'POST', testPath(s, id), { model: `m-${KEY}` })).text();
    expect(text).not.toContain(KEY);
  });

  test('HTTP 200 carrying an application-level error is a failure, not an ok', async () => {
    const { fetch } = stubFetch(() => ({
      status: 200,
      body: { error: { message: `gateway failed for ${KEY}` } },
    }));
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const text = await (await req(s.app, 'POST', testPath(s, id), {})).text();
    const result = providerTestResultSchema.parse(JSON.parse(text));
    expect(result.status).toBe('failed');
    expect(result.probe.error).not.toBeNull();
    expect(text).not.toContain(KEY);
  });

  test('a non-JSON success body is a failure, not an ok', async () => {
    const { fetch } = stubFetch(() => ({ status: 200, body: '<html>captive portal</html>' }));
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const result = providerTestResultSchema.parse(
      await (await req(s.app, 'POST', testPath(s, id), {})).json(),
    );
    expect(result.status).toBe('failed');
  });

  test('upstream error bodies that echo the key are scrubbed, by literal and by pattern', async () => {
    const other = 'sk-ant-api03-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
    const { fetch } = stubFetch(() => ({
      status: 401,
      body: {
        error: {
          message: `Incorrect API key provided: ${KEY}; saw Bearer abc.def.ghi and ${other}`,
        },
      },
    }));
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const text = await (await req(s.app, 'POST', testPath(s, id), {})).text();
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
    const { fetch } = stubFetch(() => ({
      status: 500,
      body: `oops ${short} ${'y'.repeat(5000)}`,
    }));
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s, { apiKey: short });
    const text = await (await req(s.app, 'POST', testPath(s, id), {})).text();
    expect(text).not.toContain(short);
    expect(text.length).toBeLessThan(1500);
    expect(JSON.parse(text).probe.error.type).toBe('server');
  });

  test('an unreachable provider is a network failure and its error text is scrubbed', async () => {
    const { fetch } = stubFetch(() => new Error(`ECONNREFUSED https://gw.example.com?k=${KEY}`));
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    const text = await (await req(s.app, 'POST', testPath(s, id), {})).text();
    expect(text).not.toContain(KEY);
    const result = providerTestResultSchema.parse(JSON.parse(text));
    expect(result.status).toBe('failed');
    expect(result.probe.error?.type).toBe('network');
    expect(result.probe.httpStatus).toBeNull();
  });

  test('a hanging provider times out and reports a timeout error', async () => {
    const { fetch } = stubFetch(() => 'hang');
    const s = bootServer({ providerTestFetch: fetch, providerTestTimeoutMs: 30 });
    const { id } = await addProvider(s);
    const result = providerTestResultSchema.parse(
      await (await req(s.app, 'POST', testPath(s, id), {})).json(),
    );
    expect(result.status).toBe('failed');
    expect(result.probe.error?.type).toBe('timeout');
    expect(result.probe.httpStatus).toBeNull();
  });

  test('a provider with no stored key reports no_key and makes no outbound request', async () => {
    const { fetch, calls } = stubFetch(() => 'hang');
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

  test('a provider with no models configured reports no_model and sends nothing', async () => {
    const { fetch, calls } = stubFetch(() => 'hang');
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s, { models: [] });
    const result = (await (await req(s.app, 'POST', testPath(s, id), {})).json()) as {
      probe: { error: { type: string } };
    };
    expect(result.probe.error.type).toBe('no_model');
    expect(calls).toHaveLength(0);
  });

  test('an unknown provider id is 404', async () => {
    const s = bootServer({ providerTestFetch: stubFetch(() => 'hang').fetch });
    const res = await req(s.app, 'POST', testPath(s, 'missing'), {});
    expect(res.status).toBe(404);
  });

  test('a caller who is not the owner is refused with 403 and nothing is sent', async () => {
    const { fetch, calls } = stubFetch(() => 'hang');
    const s = bootServer({ providerTestFetch: fetch });
    const { id } = await addProvider(s);
    s.db.run(sql`INSERT INTO user (id, displayName) VALUES ('earlier-user', 'Earlier')`);
    s.db.run(sql`UPDATE user SET rowid = 100000 WHERE id != 'earlier-user'`);
    const res = await req(s.app, 'POST', testPath(s, id), {});
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  test('without the bearer token the endpoint answers 401 and sends nothing', async () => {
    const { fetch, calls } = stubFetch(() => 'hang');
    const s = bootServer({ providerTestFetch: fetch, authToken: TOKEN });
    const res = await req(s.app, 'POST', testPath(s, 'any'), {});
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('each provider is limited separately; the extra call gets 429', async () => {
    const { fetch, calls } = ok('small');
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
    const { fetch } = stubFetch(() => ({ status: 401, body: `denied ${KEY}` }));
    const s = bootServer({ providerTestFetch: fetch, logger });
    const { id } = await addProvider(s);
    const res = await req(s.app, 'POST', testPath(s, id), {});
    expect(res.status).toBe(200);
    expect(lines.join('\n')).not.toContain(KEY);
    expect(JSON.stringify(logged)).not.toContain(KEY);
  });
});
