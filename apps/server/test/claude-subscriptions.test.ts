import { readdirSync, readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bootServer, req } from './helpers.js';

const TOKEN =
  'sk-ant-oat01-subscription-test-private-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

afterEach(() => vi.unstubAllGlobals());

describe('Claude subscription connections', () => {
  test('seals independent connections and never returns or logs the token', async () => {
    const logs: string[] = [];
    const s = bootServer({
      logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
    });
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const responses: string[] = [];
    for (const label of ['Personal', 'Work']) {
      const response = await req(s.app, 'POST', path, {
        label,
        token: TOKEN,
        expiresAt: 1_900_000_000_000,
      });
      expect(response.status).toBe(201);
      responses.push(await response.text());
    }
    const rows = s.db.all<{ tokenCipher: string }>(
      sql`SELECT tokenCipher FROM claude_subscription`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.tokenCipher).not.toBe(rows[1]?.tokenCipher);
    for (const row of rows) {
      expect(row.tokenCipher).not.toBe(TOKEN);
      expect(s.secretBox.open(row.tokenCipher)).toBe(TOKEN);
    }
    const list = await req(s.app, 'GET', path);
    responses.push(await list.text());
    expect(JSON.parse(responses[2] ?? '')).toHaveLength(2);
    expect(responses.join('')).not.toContain(TOKEN);
    expect(logs.join('')).not.toContain(TOKEN);
  });

  test('verification makes one minimal stubbed call and hides upstream failures', async () => {
    const logs: string[] = [];
    const s = bootServer({
      logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
    });
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchStub);
    expect(await (await req(s.app, 'POST', `${path}/${id}/verify`)).json()).toEqual({ ok: true });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, options] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(new Headers(options.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(options.body))).toMatchObject({
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    fetchStub.mockResolvedValue(new Response(TOKEN, { status: 401 }));
    const rejected = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(await rejected.json()).toEqual({ ok: false });
    fetchStub.mockRejectedValue(new Error(`upstream ${TOKEN}`));
    const failed = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(await failed.json()).toEqual({ ok: false });
    expect(logs.join('')).not.toContain(TOKEN);
    expect(
      (await req(s.app, 'POST', `/api/teams/other/claude-subscriptions/${id}/verify`)).status,
    ).toBe(404);
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  test('invalid input and foreign connection ids reveal no credentials', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    expect((await req(s.app, 'POST', path, { label: 'Empty', token: '' })).status).toBe(400);
    expect(
      (await req(s.app, 'POST', path, { label: 'Bad expiry', token: TOKEN, expiresAt: 'tomorrow' }))
        .status,
    ).toBe(400);
    expect((await req(s.app, 'POST', `${path}/missing/verify`)).status).toBe(404);
  });
});

test.each([
  'tiny',
  'sk-ant-oat01-short',
  `sk-ant-oat01-${'a'.repeat(50)}`,
  'x'.repeat(100),
  `${TOKEN}!`,
])('rejects malformed subscription token without echoing input %#', async (token) => {
  const logs: string[] = [];
  const s = bootServer({
    logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
  });
  const response = await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
    label: 'Invalid',
    token,
  });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain(token);
  expect(logs.join('')).not.toContain(token);
});

test('server provider verification uses only the designated daemon backend bridge', () => {
  const directory = new URL('../src/', import.meta.url);
  for (const path of readdirSync(directory, { recursive: true, encoding: 'utf8' })) {
    if (!path.endsWith('.ts')) continue;
    const source = readFileSync(new URL(path, directory), 'utf8');
    const imports = source.match(/from ['"][^'"]*daemon\/src\/[^'"]+['"]/g) ?? [];
    expect(imports, path).toEqual(
      path === 'services/claude-subscriptions.ts'
        ? ["from '../../../daemon/src/backend/claude-subscription.js'"]
        : [],
    );
  }
});

test('a foreign team connection cannot be deleted through the current team path', async () => {
  const s = bootServer();
  s.db.run(sql`INSERT INTO team (id, name, createdAt) VALUES ('foreign', 'Foreign', 1)`);
  s.db.run(
    sql`INSERT INTO claude_subscription (id, teamId, label, tokenCipher, createdAt) VALUES ('foreign-connection', 'foreign', 'Foreign', ${s.secretBox.seal(TOKEN)}, 1)`,
  );
  const response = await req(
    s.app,
    'DELETE',
    `/api/teams/${s.team.id}/claude-subscriptions/foreign-connection`,
  );
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(TOKEN);
  expect(
    s.db.all(sql`SELECT id FROM claude_subscription WHERE id = 'foreign-connection'`),
  ).toHaveLength(1);
});

test('accepts a correctly prefixed token at the minimum length without returning it', async () => {
  const s = bootServer();
  const token = `sk-ant-oat01-${'b'.repeat(51)}`;
  expect(token).toHaveLength(64);
  const response = await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions`, {
    label: 'Boundary',
    token,
  });
  expect(response.status).toBe(201);
  expect(await response.text()).not.toContain(token);
});
