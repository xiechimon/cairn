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

describe('MachineClient.shellPrecheck (machine shell precheck wire half)', () => {
  test('W1 200 → POST {command} + Bearer, parses {allowed, runId}', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { allowed: true, runId: 'run-9' } },
    ]);
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    const out = await client.shellPrecheck('step-1', 'echo hi');
    expect(out).toEqual({ allowed: true, runId: 'run-9' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://s/api/machine/shell/step-1');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ command: 'echo hi' });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  test("W2 403 → MachineApiError carries the server's original reason, no retry on first occurrence", async () => {
    const reason = '机器 m1 未开启 shell 访问（机器详情页），无法执行命令';
    const { fetchImpl, calls } = stubFetch([{ status: 403, body: { error: reason } }]);
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    let err: unknown;
    try {
      await client.shellPrecheck('step-1', 'rm -rf /');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MachineApiError);
    expect((err as MachineApiError).status).toBe(403);
    expect((err as MachineApiError).body).toBe(reason);
    expect(calls).toHaveLength(1);
  });

  test('W3 network error → rethrown as-is, no retry (precheck is not idempotent)', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    await expect(client.shellPrecheck('step-1', 'echo hi')).rejects.toBeInstanceOf(TypeError);
    expect(n).toBe(1);
  });
});

describe('MachineClient.shellResult (machine shell write-back wire half)', () => {
  test('W4 200 → POSTs the terminal body to the runId endpoint', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { ok: true } }]);
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    await client.shellResult('run-9', { status: 'done', exitCode: 0, output: 'hi\n' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://s/api/machine/shell/run-9/result');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      status: 'done',
      exitCode: 0,
      output: 'hi\n',
    });
  });

  test('W5 network error → succeeds after retry (server terminal state is idempotent, replay-safe)', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    await client.shellResult('run-9', { status: 'done', exitCode: 0 });
    expect(n).toBe(2);
  }, 10_000);

  test('W6 4xx (409 denied line) → throws on the first try without retry', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 409, body: { error: 'shell run run-9 was denied (no result to report)' } },
    ]);
    const client = new MachineClient({ serverUrl: 'http://s', getToken: () => 'tok', fetchImpl });
    await expect(client.shellResult('run-9', { status: 'done' })).rejects.toBeInstanceOf(
      MachineApiError,
    );
    expect(calls).toHaveLength(1);
  });
});
