import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { bootServer, req } from './helpers.js';

const TOKEN =
  'sk-ant-oat01-subscription-test-private-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

const fixtureDirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => {
  for (const dir of fixtureDirs.splice(0)) releaseTestTempDir(dir);
});

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

  test('verification runs the real claude binary once and hides upstream failures', async () => {
    const logs: string[] = [];
    const s = bootServer({
      logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
    });
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const dir = makeTestTempDir('claude-subscriptions-');
    fixtureDirs.push(dir);
    const runs = join(dir, 'runs');
    const binary = join(dir, 'claude');
    const script = (body: string) =>
      writeFileSync(binary, `#!/bin/sh\necho run >> "${runs}"\n${body}\n`, { mode: 0o755 });
    vi.stubEnv('CLAUDE_BIN', binary);
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    script('exit 0');
    expect(await (await req(s.app, 'POST', `${path}/${id}/verify`)).json()).toEqual({ ok: true });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    script(`echo "401 ${TOKEN}" >&2\nexit 1`);
    const rejected = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(await rejected.json()).toEqual({ ok: false, reason: 'auth' });
    clock.mockReturnValue(Date.now() + 10_000);
    vi.stubEnv('CLAUDE_BIN', join(dir, 'missing'));
    const failed = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(await failed.json()).toEqual({ ok: false, reason: 'unavailable' });
    expect(logs.join('')).not.toContain(TOKEN);
    expect(
      (await req(s.app, 'POST', `/api/teams/other/claude-subscriptions/${id}/verify`)).status,
    ).toBe(404);
    expect(readFileSync(runs, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(fetchStub).not.toHaveBeenCalled();
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

test('server source does not import daemon source', () => {
  const directory = new URL('../src/', import.meta.url);
  for (const path of readdirSync(directory, { recursive: true, encoding: 'utf8' })) {
    if (!path.endsWith('.ts')) continue;
    const source = readFileSync(new URL(path, directory), 'utf8');
    const imports = source.match(/from ['"][^'"]*daemon\/src\/[^'"]+['"]/g) ?? [];
    expect(imports, path).toEqual([]);
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

test('verification limits concurrent and repeated calls per connection for ten seconds', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const logs: string[] = [];
  const s = bootServer({ logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }) });
  const path = `/api/teams/${s.team.id}/claude-subscriptions`;
  const ids: string[] = [];
  for (const label of ['Personal', 'Work']) {
    const response = await req(s.app, 'POST', path, { label, token: TOKEN });
    expect(response.status).toBe(201);
    ids.push(((await response.json()) as { id: string }).id);
  }
  const dir = makeTestTempDir('claude-subscriptions-');
  fixtureDirs.push(dir);
  const runs = join(dir, 'runs');
  const hold = join(dir, 'hold');
  const release = join(dir, 'release');
  const fail = join(dir, 'fail');
  const binary = join(dir, 'claude');
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      `echo run >> "${runs}"`,
      `if [ -f "${hold}" ]; then while [ ! -f "${release}" ]; do sleep 0.05; done; fi`,
      `if [ -f "${fail}" ]; then echo "401 ${TOKEN}" >&2; exit 1; fi`,
      'exit 0',
    ].join('\n'),
    { mode: 0o755 },
  );
  const runCount = () =>
    existsSync(runs) ? readFileSync(runs, 'utf8').trim().split('\n').length : 0;
  vi.stubEnv('CLAUDE_BIN', binary);
  writeFileSync(hold, '');
  const first = req(s.app, 'POST', `${path}/${ids[0]}/verify`);
  await vi.waitFor(() => expect(runCount()).toBe(1));
  rmSync(hold);
  const limited = await req(s.app, 'POST', `${path}/${ids[0]}/verify`);
  expect(limited.status).toBe(429);
  const message = await limited.text();
  expect(message).toContain('10 seconds');
  expect(message).not.toContain(TOKEN);
  expect(runCount()).toBe(1);
  expect((await req(s.app, 'POST', `${path}/${ids[1]}/verify`)).status).toBe(200);
  writeFileSync(release, '');
  expect((await first).status).toBe(200);
  now += 9_999;
  expect((await req(s.app, 'POST', `${path}/${ids[0]}/verify`)).status).toBe(429);
  expect(runCount()).toBe(2);
  now += 1;
  writeFileSync(fail, '');
  const failed = await req(s.app, 'POST', `${path}/${ids[0]}/verify`);
  expect(failed.status).toBe(200);
  expect(await failed.json()).toEqual({ ok: false, reason: 'auth' });
  expect((await req(s.app, 'POST', `${path}/${ids[0]}/verify`)).status).toBe(429);
  expect((await req(s.app, 'POST', `${path}/missing/verify`)).status).toBe(404);
  expect(
    (await req(s.app, 'POST', `/api/teams/other/claude-subscriptions/${ids[0]}/verify`)).status,
  ).toBe(404);
  expect(runCount()).toBe(3);
  expect(logs.join('')).not.toContain(TOKEN);
});
