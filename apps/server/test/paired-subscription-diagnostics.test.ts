import { beforeAll, describe, expect, test } from 'vitest';
import { bootServer, type TestServer } from './helpers.js';

const OWNER = 'paired-diagnostics-owner-token-0123456789abcdef';
const ownerHeaders = { authorization: `Bearer ${OWNER}` };

function call(
  s: TestServer,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  return Promise.resolve(
    s.app.request(path, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }),
  );
}

async function pairDevice(s: TestServer): Promise<{ token: string }> {
  const issued = await call(s, 'POST', '/api/remote/pairing', { headers: ownerHeaders });
  expect(issued.status).toBe(201);
  const { code } = (await issued.json()) as { code: string };
  const paired = await call(s, 'POST', '/api/remote/pair', { body: { code, name: 'tablet' } });
  expect(paired.status).toBe(201);
  return (await paired.json()) as { token: string };
}

describe('paired devices reach read-only subscription diagnostics', () => {
  let s: TestServer;
  let deviceHeaders: Record<string, string>;

  beforeAll(async () => {
    s = bootServer({ authToken: OWNER });
    const paired = await pairDevice(s);
    deviceHeaders = { authorization: `Bearer ${paired.token}` };
  });

  test.each([
    ['claude-subscriptions', 'verify', undefined],
    ['claude-subscriptions', 'upstream-models', undefined],
    ['claude-subscriptions', 'test', { model: 'claude-sonnet-5-5' }],
    ['devin-subscriptions', 'verify', undefined],
    ['devin-subscriptions', 'upstream-models', undefined],
    ['antigravity-subscriptions', 'verify', undefined],
    ['antigravity-subscriptions', 'upstream-models', undefined],
  ])(
    '%s/:cid/%s with a device token -> past the gate (404 on the missing row, not 403)',
    async (family, action, body) => {
      const res = await call(s, 'POST', `/api/teams/${s.team.id}/${family}/missing-sub/${action}`, {
        headers: deviceHeaders,
        ...(body === undefined ? {} : { body }),
      });
      expect(res.status).toBe(404);
    },
  );

  test.each([
    ['POST', 'claude-subscriptions'],
    ['PATCH', 'claude-subscriptions/missing-sub'],
    ['DELETE', 'claude-subscriptions/missing-sub'],
    ['POST', 'claude-subscriptions/missing-sub/enable'],
    ['POST', 'claude-subscriptions/missing-sub/disable'],
    ['POST', 'devin-subscriptions'],
    ['PATCH', 'devin-subscriptions/missing-sub'],
    ['DELETE', 'devin-subscriptions/missing-sub'],
    ['POST', 'antigravity-subscriptions'],
    ['PATCH', 'antigravity-subscriptions/missing-sub'],
    ['DELETE', 'antigravity-subscriptions/missing-sub'],
    ['POST', 'providers'],
    ['PATCH', 'providers/missing-provider'],
    ['DELETE', 'providers/missing-provider'],
    ['POST', 'providers/missing-provider/test'],
    ['GET', 'providers/missing-provider/upstream-models'],
  ])('%s /api/teams/:t/%s with a device token -> 403 owner-only', async (method, path) => {
    const res = await call(s, method, `/api/teams/${s.team.id}/${path}`, {
      headers: deviceHeaders,
      body: method === 'POST' || method === 'PATCH' ? {} : undefined,
    });
    expect(res.status).toBe(403);
  });

  test('the owner token still reaches the diagnostics (control)', async () => {
    for (const action of ['verify', 'upstream-models']) {
      const res = await call(
        s,
        'POST',
        `/api/teams/${s.team.id}/claude-subscriptions/missing-sub/${action}`,
        { headers: ownerHeaders },
      );
      expect(res.status).toBe(404);
    }
  });
});
