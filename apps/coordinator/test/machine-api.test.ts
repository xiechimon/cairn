import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { httpMachineApi, MachineApiError } from '../src/machine-api.js';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

async function serve(replies: { status: number; body: unknown }[]) {
  const seen: { url: string; auth: string | undefined; body: unknown }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      seen.push({ url: req.url ?? '', auth: req.headers.authorization, body: JSON.parse(raw) });
      const reply = replies.shift() ?? { status: 500, body: {} };
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen };
}

const body = {
  requestId: 'ask-0123456789abcdef',
  questions: [{ header: 'H', question: 'Q?', options: [] }],
};
const pending = { status: 'pending', requestId: body.requestId, answers: null, reason: null };
const answered = {
  status: 'answered',
  requestId: body.requestId,
  answers: [{ header: 'H', text: 'yes' }],
  reason: null,
};

describe('httpMachineApi.askUser', () => {
  it('keeps asking with the same request id while the card is pending, then returns the answer', async () => {
    const { url, seen } = await serve([
      { status: 200, body: pending },
      { status: 200, body: pending },
      { status: 200, body: answered },
    ]);
    const result = await httpMachineApi(url, 'tok').askUser('step-1', body);
    expect(result).toEqual(answered);
    expect(seen.map((s) => s.url)).toEqual(Array(3).fill('/api/machine/ask/step-1'));
    expect(seen.every((s) => s.auth === 'Bearer tok')).toBe(true);
    expect(new Set(seen.map((s) => JSON.stringify(s.body)))).toEqual(
      new Set([JSON.stringify(body)]),
    );
  });

  it('gives up on a 4xx such as a step that is no longer claimed', async () => {
    const { url } = await serve([{ status: 409, body: { error: 'not claimed' } }]);
    await expect(httpMachineApi(url, 'tok').askUser('step-1', body)).rejects.toBeInstanceOf(
      MachineApiError,
    );
  });

  it('retries a 5xx instead of dropping the question', async () => {
    const { url, seen } = await serve([
      { status: 503, body: {} },
      { status: 200, body: answered },
    ]);
    expect(await httpMachineApi(url, 'tok').askUser('step-1', body)).toEqual(answered);
    expect(seen).toHaveLength(2);
  }, 10_000);

  it('stops waiting when the turn is aborted', async () => {
    const { url } = await serve([{ status: 503, body: {} }]);
    const abort = new AbortController();
    const asking = httpMachineApi(url, 'tok').askUser('step-1', body, abort.signal);
    setTimeout(() => abort.abort(), 50);
    await expect(asking).rejects.toThrow();
  }, 10_000);
});
