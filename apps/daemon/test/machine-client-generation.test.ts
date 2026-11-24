import { expect, test, vi } from 'vitest';
import { MachineClient } from '../src/machine-client.js';

test('claim clients keep their own generation on every request after same-machine reclaim', async () => {
  const requests: { url: URL; body: unknown }[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.pathname.includes('/upload-urls/')) return Response.json({ uploads: [] });
    if (url.pathname.includes('/tool/')) return Response.json({ ok: true, text: 'ok' });
    if (url.pathname.includes('/stop')) return Response.json({ discard: null });
    if (url.pathname.includes('/steer')) return Response.json({ content: null, ok: true });
    return Response.json({ ok: true });
  });
  const base = new MachineClient({ serverUrl: 'https://server.test', fetchImpl });
  const first = base.forClaim('step', 1);
  const second = base.forClaim('step', 2);
  for (const client of [first, second, first]) {
    await client.heartbeat('step');
    await client.transcriptDelta('step', 'text');
    await client.relayTool('step', 'thread_report', { line: 'report' });
    await client.uploadUrls('step', []);
    await client.steer('step');
    await client.steerAck?.('step');
    await client.stop('step');
    await client.done('step', { status: 'failed', generation: 999, errorMessage: 'fixture' });
  }
  expect(requests.map(({ url }) => url.searchParams.get('generation'))).toEqual([
    ...Array(8).fill('1'),
    ...Array(8).fill('2'),
    ...Array(8).fill('1'),
  ]);
  expect(
    requests.filter(({ url }) => url.pathname.includes('/done/')).map(({ body }) => body),
  ).toEqual(
    [1, 2, 1].map((generation) => ({ status: 'failed', generation, errorMessage: 'fixture' })),
  );
  expect(() => first.forClaim('other', 2)).toThrow('claim');
});
