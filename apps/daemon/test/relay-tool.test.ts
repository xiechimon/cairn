import { describe, expect, test } from 'vitest';
import { MachineApiError, MachineClient } from '../src/machine-client.js';

function stubFetch(responses: { status: number; body: unknown }[]): {
  fetchImpl: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    calls.push({ url, init: init ?? {} });
    const rsp = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return new Response(JSON.stringify(rsp.body), {
      status: rsp.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('MachineClient.relayTool (remoteTools relay client half)', () => {
  test('success: POST {name, params} + Bearer → returns text', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { text: '{"ok":true}' } }]);
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    const out = await client.relayTool('step-1', 'create_todo', {
      projectId: 'p',
      title: 't',
      spec: 's',
    });
    expect(out).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://s/api/machine/tool/step-1');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      name: 'create_todo',
      params: { projectId: 'p', title: 't', spec: 's' },
    });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  test('a tool call id is sent with the call, and an explicit timeout replaces the default one', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { text: 'ok' } }]);
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    await client.relayTool(
      'step-1',
      'browser_navigate',
      { url: 'https://example.test' },
      {
        toolCallId: 'call-9',
        timeoutMs: 60_000,
      },
    );
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      name: 'browser_navigate',
      params: { url: 'https://example.test' },
      toolCallId: 'call-9',
    });
    await client.relayTool('step-1', 'create_todo', {});
    expect(JSON.parse(calls[1]!.init.body as string)).not.toHaveProperty('toolCallId');
  });

  test('a slow answer is not cut off at the default timeout when a longer one is given', async () => {
    const slow = (async (_input: unknown, init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (init?.signal?.aborted) throw new Error('aborted');
      return new Response(JSON.stringify({ text: 'late' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = new MachineClient({
      serverUrl: 'http://s',
      getToken: () => 'tok',
      fetchImpl: slow,
    });
    await expect(
      client.relayTool('s', 'request_takeover', {}, { timeoutMs: 10 }),
    ).rejects.toThrow();
    expect(await client.relayTool('s', 'request_takeover', {}, { timeoutMs: 5_000 })).toBe('late');
  });

  test('non-replaySafe 4xx rejection → throws MachineApiError on the first try without retry', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 400, body: { error: 'bad params' } }]);
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    let err: unknown;
    try {
      await client.relayTool('step-1', 'create_todo', {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MachineApiError);
    expect((err as MachineApiError).message).toContain('bad params');
    expect(calls).toHaveLength(1);
  });

  test('replaySafe 4xx rejection → also not retried (only 5xx/transient retried)', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 404, body: { error: 'not found' } }]);
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    await expect(
      client.relayTool('step-1', 'todos', {}, { replaySafe: true }),
    ).rejects.toBeInstanceOf(MachineApiError);
    expect(calls).toHaveLength(1);
  });
});
