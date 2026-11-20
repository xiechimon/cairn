import { GITHUB_WEBHOOK_DELIVERY_LIMIT } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { githubConnection as githubConnectionTable } from '../src/db/schema.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { githubFake } from './fakes/github.js';
import { bootServer, req, type TestServer } from './helpers.js';

const OWNER = 'xiechimon';
const REPO = 'xiechimon/cairn';
const TOKEN = 'ghp_webhook_test_token';

const servers: TestServer[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) s.dispose();
});

function seedConnection(s: TestServer): void {
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    { teamId: s.team.id, login: OWNER, accessToken: TOKEN, scope: 'read:user repo' },
  );
}

async function makeWorld() {
  const gh = githubFake(REPO);
  const s = bootServer({ githubFetch: gh.impl });
  servers.push(s);
  seedConnection(s);
  return { s, gh };
}

function deliver(
  s: TestServer,
  token: string,
  opts: { event?: string; deliveryId?: string; cairnDeliveryId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.event !== undefined) headers['x-github-event'] = opts.event;
  if (opts.deliveryId !== undefined) headers['x-github-delivery'] = opts.deliveryId;
  if (opts.cairnDeliveryId !== undefined) headers['x-cairn-delivery'] = opts.cairnDeliveryId;
  return Promise.resolve(
    s.app.request(`/api/webhook/github/${token}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body ?? { action: 'labeled' }),
    }),
  );
}

interface DeliveryBody {
  result: string;
  deliveryId?: string;
  detail?: string;
}

async function delivered(res: Response): Promise<DeliveryBody> {
  return (await res.json()) as DeliveryBody;
}

async function mint(s: TestServer): Promise<{ webhookUrl: string; token: string; masked: string }> {
  const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/github/webhook`);
  expect(res.status).toBe(200);
  return (await res.json()) as { webhookUrl: string; token: string; masked: string };
}

function connectionRow(s: TestServer) {
  return s.db
    .select()
    .from(githubConnectionTable)
    .where(eq(githubConnectionTable.teamId, s.team.id))
    .get();
}

describe('token management', () => {
  test('mint returns the plaintext once and persists hash + masked on the connection', async () => {
    const { s } = await makeWorld();
    const first = await mint(s);
    expect(first.token).toMatch(/^cairn-wh-[0-9a-f]{48}$/);
    expect(first.webhookUrl).toContain(`/api/webhook/github/${first.token}`);
    expect(first.masked).toBe(`${first.token.slice(0, 12)}…${first.token.slice(-4)}`);
    const row = connectionRow(s);
    expect(row?.webhookTokenHash).toBe(sha256Hex(first.token));
    expect(row?.webhookMasked).toBe(first.masked);
    expect(row?.webhookDeliveries).toEqual([]);
    const second = await mint(s);
    expect(second.token).not.toBe(first.token);
    expect(connectionRow(s)?.webhookTokenHash).toBe(sha256Hex(second.token));
    const status = await req(s.app, 'GET', `/api/teams/${s.team.id}/github/connection`);
    const body = (await status.json()) as Record<string, unknown>;
    expect(body.webhookMasked).toBe(second.masked);
    expect(body.webhookTokenHash).toBeUndefined();
    expect(body.webhookDeliveries).toBeUndefined();
  });

  test('mint without a github connection answers 404; revoke clears the token columns', async () => {
    const gh = githubFake(REPO);
    const s = bootServer({ githubFetch: gh.impl });
    servers.push(s);
    const noConnection = await req(s.app, 'POST', `/api/teams/${s.team.id}/github/webhook`);
    expect(noConnection.status).toBe(404);
    seedConnection(s);
    const { token } = await mint(s);
    const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/github/webhook`);
    expect(res.status).toBe(204);
    const row = connectionRow(s);
    expect(row?.webhookTokenHash).toBeNull();
    expect(row?.webhookMasked).toBeNull();
    expect(row?.webhookDeliveries).toBeNull();
    expect(row?.webhookLastUsedAt).toBeNull();
    const revoked = await deliver(s, token, { event: 'issues', deliveryId: 'd-revoked' });
    expect(revoked.status).toBe(401);
  });
});

describe('receiveGithubWebhook', () => {
  test('every event is acknowledged 202 ignored and no task is created', async () => {
    const { s } = await makeWorld();
    const { token } = await mint(s);
    for (const [event, deliveryId] of [
      ['ping', 'd-ping'],
      ['issues', 'd-issues'],
      ['push', 'd-push'],
      [undefined, 'd-none'],
    ] as const) {
      const res = await deliver(s, token, { event, deliveryId });
      expect(res.status).toBe(202);
      const body = await delivered(res);
      expect(body.result).toBe('ignored');
      expect(body.deliveryId).toBe(deliveryId);
    }
    expect(connectionRow(s)?.webhookDeliveries).toEqual(['d-ping', 'd-issues', 'd-push', 'd-none']);
    expect(connectionRow(s)?.webhookLastUsedAt).not.toBeNull();
  });

  test('the same X-GitHub-Delivery answers duplicate', async () => {
    const { s } = await makeWorld();
    const { token } = await mint(s);
    const first = await deliver(s, token, { event: 'issues', deliveryId: 'd-dup' });
    expect((await delivered(first)).result).toBe('ignored');
    const second = await deliver(s, token, { event: 'issues', deliveryId: 'd-dup' });
    expect(second.status).toBe(202);
    expect((await delivered(second)).result).toBe('duplicate');
    expect(connectionRow(s)?.webhookDeliveries).toEqual(['d-dup']);
  });

  test('unknown token answers 401 and a rotated token retires the old one', async () => {
    const { s } = await makeWorld();
    const unknown = await deliver(s, `cairn-wh-${'0'.repeat(48)}`, {
      event: 'issues',
      deliveryId: 'd-x',
    });
    expect(unknown.status).toBe(401);
    const first = await mint(s);
    const second = await mint(s);
    const oldToken = await deliver(s, first.token, { event: 'issues', deliveryId: 'd-old' });
    expect(oldToken.status).toBe(401);
    const newToken = await deliver(s, second.token, { event: 'issues', deliveryId: 'd-new' });
    expect(newToken.status).toBe(202);
    expect((await delivered(newToken)).result).toBe('ignored');
  });

  test('a delivery id is stored and echoed truncated to 128 chars', async () => {
    const { s } = await makeWorld();
    const { token } = await mint(s);
    const longId = `d-${'x'.repeat(300)}`;
    const res = await deliver(s, token, { event: 'issues', deliveryId: longId });
    expect(res.status).toBe(202);
    const truncated = longId.slice(0, 128);
    expect((await delivered(res)).deliveryId).toBe(truncated);
    expect(connectionRow(s)?.webhookDeliveries).toEqual([truncated]);
  });

  test('delivered ids are remembered to the delivery cap', async () => {
    const { s } = await makeWorld();
    const { token } = await mint(s);
    const history = Array.from({ length: GITHUB_WEBHOOK_DELIVERY_LIMIT }, (_, i) => `d-${i}`);
    for (const deliveryId of history) {
      await deliver(s, token, { event: 'issues', deliveryId });
    }
    await deliver(s, token, { event: 'issues', deliveryId: 'd-newest' });
    const kept = connectionRow(s)?.webhookDeliveries ?? [];
    expect(kept).toHaveLength(GITHUB_WEBHOOK_DELIVERY_LIMIT);
    expect(kept).not.toContain('d-0');
    expect(kept).toContain('d-newest');
  });

  test('an oversized body is refused before the token check', async () => {
    const gh = githubFake(REPO);
    const s = bootServer({ githubFetch: gh.impl });
    servers.push(s);
    const res = await s.app.request(`/api/webhook/github/cairn-wh-${'0'.repeat(48)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(300 * 1024) }),
    });
    expect(res.status).toBe(413);
  });
});
