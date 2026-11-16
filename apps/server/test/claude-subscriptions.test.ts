import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  claudeSubscription,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { bootServer, insertMachine, req, type TestServer } from './helpers.js';

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

describe('the setup token is stored only for the owner session', () => {
  test('anonymous callers are refused, the owner stores it, and no response or list carries it', async () => {
    const s = bootServer({ authToken: 'owner-secret-0123456789abcdef' });
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const anonymous = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    expect([401, 403]).toContain(anonymous.status);
    expect(s.db.all(sql`SELECT id FROM claude_subscription`)).toEqual([]);
    const headers = {
      authorization: 'Bearer owner-secret-0123456789abcdef',
      'content-type': 'application/json',
    };
    const saved = await s.app.request(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'Personal', token: TOKEN }),
    });
    expect(saved.status).toBe(201);
    expect(await saved.text()).not.toContain(TOKEN);
    const list = await s.app.request(path, { headers });
    expect(await list.text()).not.toContain(TOKEN);
  });
});

describe('switching the enabled Claude subscription', () => {
  const tokenOf = (letter: string) => `sk-ant-oat01-${letter.repeat(64)}`;

  function fakeClaude(body: string): string {
    const dir = makeTestTempDir('claude-switch-');
    fixtureDirs.push(dir);
    const binary = join(dir, 'claude');
    writeFileSync(binary, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    vi.stubEnv('CLAUDE_BIN', binary);
    return binary;
  }

  async function twoAccounts() {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const ids: string[] = [];
    for (const [label, letter] of [
      ['First', 'a'],
      ['Second', 'b'],
    ] as const) {
      const response = await req(s.app, 'POST', path, { label, token: tokenOf(letter) });
      expect(response.status).toBe(201);
      ids.push(((await response.json()) as { id: string }).id);
    }
    return { s, path, first: ids[0] as string, second: ids[1] as string };
  }

  const enabledIds = (s: TestServer) =>
    s.db
      .select()
      .from(claudeSubscription)
      .all()
      .filter((row) => row.enabledAt !== null)
      .map((row) => row.id);

  function runningStep(s: TestServer, subscriptionId: string, id = 'run-1') {
    s.db
      .insert(stepTable)
      .values({
        id,
        buildId: `b-${id}`,
        kind: 'build',
        status: 'claimed',
        claimedAt: 5,
        createdAt: 4,
        claudeSubscriptionId: subscriptionId,
      })
      .run();
  }

  test('a verified account becomes the only enabled one, the list shows it and no response carries a token', async () => {
    fakeClaude('exit 0');
    const { s, path, first, second } = await twoAccounts();
    expect(enabledIds(s)).toEqual([first]);
    const response = await req(s.app, 'POST', `${path}/${second}/enable`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ id: second, enabled: true });
    expect(enabledIds(s)).toEqual([second]);
    const list = await (await req(s.app, 'GET', path)).text();
    expect(
      JSON.parse(list).map((row: { id: string; enabled: boolean }) => [row.id, row.enabled]),
    ).toEqual(
      expect.arrayContaining([
        [first, false],
        [second, true],
      ]),
    );
    for (const text of [body, list]) {
      expect(text).not.toContain(tokenOf('a'));
      expect(text).not.toContain(tokenOf('b'));
    }
    const again = await req(s.app, 'POST', `${path}/${second}/enable`);
    expect(again.status).toBe(200);
    expect(enabledIds(s)).toEqual([second]);
  });

  test.each([
    ['a rejected token', 'echo "401 invalid" >&2\nexit 1', 'auth'],
    ['a server without claude', null, 'unavailable'],
  ])('%s fails the precheck and the old account stays enabled', async (_name, script, reason) => {
    if (script === null) vi.stubEnv('CLAUDE_BIN', '/nonexistent/claude');
    else fakeClaude(script);
    const { s, path, first, second } = await twoAccounts();
    const response = await req(s.app, 'POST', `${path}/${second}/enable`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'precheck-failed',
      reason,
      error: expect.any(String),
    });
    expect(enabledIds(s)).toEqual([first]);
  });

  test('a running task on the enabled account blocks the switch, disable and delete and changes nothing', async () => {
    fakeClaude('exit 0');
    const { s, path, first, second } = await twoAccounts();
    runningStep(s, first);
    runningStep(s, first, 'run-2');
    for (const [method, url] of [
      ['POST', `${path}/${second}/enable`],
      ['POST', `${path}/${first}/disable`],
      ['DELETE', `${path}/${first}`],
    ] as const) {
      const response = await req(s.app, method, url);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'running-tasks', running: 2 });
    }
    expect(enabledIds(s)).toEqual([first]);
    expect(s.db.select().from(claudeSubscription).all()).toHaveLength(2);
    s.db.update(stepTable).set({ status: 'done' }).run();
    expect((await req(s.app, 'POST', `${path}/${second}/enable`)).status).toBe(200);
    expect(enabledIds(s)).toEqual([second]);
  });

  test('a running task bound to a disabled account does not block enabling it or another account', async () => {
    fakeClaude('exit 0');
    const { s, path, first, second } = await twoAccounts();
    runningStep(s, second);
    runningStep(s, 'someone-else', 'run-other');
    const response = await req(s.app, 'POST', `${path}/${second}/enable`);
    expect(response.status).toBe(200);
    expect(enabledIds(s)).toEqual([second]);
    expect(first).not.toBe(second);
  });

  test('an expired target is refused and an unknown or foreign id is 404', async () => {
    fakeClaude('exit 0');
    const { s, path, second } = await twoAccounts();
    s.db
      .update(claudeSubscription)
      .set({ expiresAt: 1 })
      .where(eq(claudeSubscription.id, second))
      .run();
    const response = await req(s.app, 'POST', `${path}/${second}/enable`);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'expired' });
    expect((await req(s.app, 'POST', `${path}/missing/enable`)).status).toBe(404);
    expect(
      (await req(s.app, 'POST', `/api/teams/other/claude-subscriptions/${second}/enable`)).status,
    ).toBe(404);
  });

  test('two switches racing during verification leave one enabled account and one conflict', async () => {
    fakeClaude('sleep 0.3\nexit 0');
    const { s, path, first, second } = await twoAccounts();
    const third = (
      (await (await req(s.app, 'POST', path, { label: 'Third', token: tokenOf('c') })).json()) as {
        id: string;
      }
    ).id;
    const results = await Promise.all([
      req(s.app, 'POST', `${path}/${second}/enable`),
      req(s.app, 'POST', `${path}/${third}/enable`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(await loser?.json()).toMatchObject({ code: 'conflict' });
    expect(enabledIds(s)).toHaveLength(1);
    expect(enabledIds(s)).not.toContain(first);
  });

  test('disable turns everything off, delete of the enabled account leaves none enabled', async () => {
    const { s, path, first, second } = await twoAccounts();
    const disabled = await req(s.app, 'POST', `${path}/${first}/disable`);
    expect(await disabled.json()).toMatchObject({ id: first, enabled: false });
    expect(enabledIds(s)).toEqual([]);
    expect((await req(s.app, 'POST', `${path}/${first}/disable`)).status).toBe(200);
    fakeClaude('exit 0');
    expect((await req(s.app, 'POST', `${path}/${second}/enable`)).status).toBe(200);
    expect((await req(s.app, 'DELETE', `${path}/${second}`)).status).toBe(204);
    expect(enabledIds(s)).toEqual([]);
    expect((await req(s.app, 'DELETE', `${path}/${first}`)).status).toBe(204);
  });

  test('a switch clears the rate-limit rejection recorded for the old account', async () => {
    fakeClaude('exit 0');
    const { s, path, second } = await twoAccounts();
    const machineId = insertMachine(s, { name: 'limited' });
    s.db
      .update(machineTable)
      .set({
        claudeRateLimits: [
          {
            subscription: 'five_hour',
            status: 'rejected',
            utilization: 1,
            resetsAt: Date.now() + 3_600_000,
            reportedAt: Date.now(),
          },
        ],
      })
      .where(eq(machineTable.id, machineId))
      .run();
    expect((await req(s.app, 'POST', `${path}/${second}/enable`)).status).toBe(200);
    expect(
      s.db.select().from(machineTable).where(eq(machineTable.id, machineId)).get()
        ?.claudeRateLimits,
    ).toBeNull();
  });

  test('rename keeps the token out of the label', async () => {
    const { s, path, first } = await twoAccounts();
    const renamed = await req(s.app, 'PATCH', `${path}/${first}`, { label: 'Work account' });
    expect(await renamed.json()).toMatchObject({ id: first, label: 'Work account' });
    const refused = await req(s.app, 'PATCH', `${path}/${first}`, { label: `x ${tokenOf('a')}` });
    expect(refused.status).toBe(400);
    expect(await refused.text()).not.toContain(tokenOf('a'));
    expect((await req(s.app, 'PATCH', `${path}/${first}`, { label: ' ' })).status).toBe(400);
  });

  test('the steps list shows what ran on the account, newest first, with a running outcome and paging', async () => {
    const { s, path, first, second } = await twoAccounts();
    s.db
      .insert(stepTable)
      .values([
        {
          id: 's-old',
          buildId: 'b1',
          kind: 'build',
          status: 'done',
          claimedAt: 10,
          createdAt: 9,
          claudeSubscriptionId: first,
        },
        {
          id: 's-fail',
          buildId: 'b2',
          kind: 'verify',
          status: 'failed',
          claimedAt: 20,
          createdAt: 19,
          claudeSubscriptionId: first,
        },
        {
          id: 's-run',
          buildId: 'b3',
          kind: 'chief',
          status: 'claimed',
          claimedAt: 30,
          createdAt: 29,
          claudeSubscriptionId: first,
        },
        {
          id: 's-queued',
          buildId: 'b4',
          kind: 'build',
          status: 'pending',
          claimedAt: 40,
          createdAt: 39,
          claudeSubscriptionId: first,
        },
        {
          id: 's-other',
          buildId: 'b5',
          kind: 'build',
          status: 'done',
          claimedAt: 50,
          createdAt: 49,
          claudeSubscriptionId: second,
        },
      ])
      .run();
    const page = (await (await req(s.app, 'GET', `${path}/${first}/steps?limit=2`)).json()) as {
      steps: { stepId: string; outcome: string; kind: string; threadId: string }[];
      hasEarlier: boolean;
    };
    expect(page.steps.map((row) => [row.stepId, row.outcome, row.kind])).toEqual([
      ['s-run', 'running', 'chief'],
      ['s-fail', 'failed', 'build'],
    ]);
    expect(page.hasEarlier).toBe(true);
    const all = (await (await req(s.app, 'GET', `${path}/${first}/steps`)).json()) as {
      steps: { stepId: string }[];
      hasEarlier: boolean;
    };
    expect(all.steps.map((row) => row.stepId)).toEqual(['s-run', 's-fail', 's-old']);
    expect(all.hasEarlier).toBe(false);
    expect((await req(s.app, 'GET', `${path}/missing/steps`)).status).toBe(404);
  });

  test('switching is refused for callers that are not the owner session', async () => {
    const s = bootServer({ authToken: 'owner-secret-0123456789abcdef' });
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    for (const [method, url] of [
      ['POST', `${path}/x/enable`],
      ['POST', `${path}/x/disable`],
      ['PATCH', `${path}/x`],
    ] as const) {
      const response = await s.app.request(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect([401, 403]).toContain(response.status);
    }
  });
});
