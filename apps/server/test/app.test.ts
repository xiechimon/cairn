import { once } from 'node:events';
import { ATTACHMENT_MAX_BYTES } from '@cairn/shared';
import { serve } from '@hono/node-server';
import { expect, test, vi } from 'vitest';
import { bootServer } from './helpers.js';

const OWNER = 'test-owner-token';
const API_BUDGET = 2 * 1024 * 1024;

const tooLarge = { error: 'request body too large' };

test('rejects an over-budget unauthenticated enrollment before reading JSON', async () => {
  const { app } = bootServer({ authToken: OWNER });
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    controller.enqueue(new TextEncoder().encode('{"name":"runner"}'));
    controller.close();
  });
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(API_BUDGET + 1),
    },
    body: new ReadableStream({ pull }, { highWaterMark: 0 }),
    duplex: 'half',
  };
  const request = new Request('http://localhost/api/machine/enroll/start', init);
  const parseBody = vi.spyOn(request, 'text');
  const response = await app.fetch(request);
  expect.soft(response.status).toBe(413);
  expect.soft(parseBody).not.toHaveBeenCalled();
  expect.soft(pull).not.toHaveBeenCalled();
  expect(await response.json()).toEqual(tooLarge);
});

test('stops an unknown-length request at the budget before invoking the Access verifier', async () => {
  const verifyAccess = vi.fn(async () => ({ kind: 'invalid' as const }));
  const { app } = bootServer({ authToken: OWNER, accessVerifier: verifyAccess });
  const chunk = new Uint8Array(64 * 1024);
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled === 34) {
          controller.close();
          return;
        }
        pulled += 1;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', body, duplex: 'half' };
  const response = await app.request('/api/auth/access', init);
  expect.soft(response.status).toBe(413);
  expect.soft(verifyAccess).not.toHaveBeenCalled();
  expect.soft(pulled).toBe(API_BUDGET / chunk.byteLength + 1);
  expect(await response.json()).toEqual(tooLarge);
});

test('round-trips a maximum-size attachment over HTTP', async () => {
  const { app } = bootServer({ authToken: OWNER });
  let multipartLength = 0;
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    overrideGlobalObjects: false,
    fetch(request, env) {
      if (new URL(request.url).pathname === '/api/uploads/upload') {
        multipartLength = Number(request.headers.get('content-length'));
      }
      return app.fetch(request, env);
    },
  });
  try {
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('missing TCP listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${OWNER}` };
    const grantResponse = await fetch(`${origin}/api/uploads/grant`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'attachment',
        fileName: 'maximum.txt',
        mimeType: 'text/plain',
        size: ATTACHMENT_MAX_BYTES,
      }),
    });
    expect(grantResponse.status).toBe(200);
    const { uploadUrl, grant } = (await grantResponse.json()) as {
      uploadUrl: string;
      grant: string;
    };
    const form = new FormData();
    form.set('grant', grant);
    form.set(
      'file',
      new Blob([new Uint8Array(ATTACHMENT_MAX_BYTES).fill(97)], { type: 'text/plain' }),
      'maximum.txt',
    );
    const uploadResponse = await fetch(`${origin}${uploadUrl}/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    expect(uploadResponse.status).toBe(201);
    expect(multipartLength).toBeGreaterThan(ATTACHMENT_MAX_BYTES);
    expect(multipartLength).toBeLessThan(ATTACHMENT_MAX_BYTES + 64 * 1024);
    const { id } = (await uploadResponse.json()) as { id: string };
    const download = await fetch(`${origin}/api/attachments/${id}`, { headers });
    expect(download.status).toBe(200);
    expect((await download.arrayBuffer()).byteLength).toBe(ATTACHMENT_MAX_BYTES);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
