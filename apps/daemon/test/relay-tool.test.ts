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
