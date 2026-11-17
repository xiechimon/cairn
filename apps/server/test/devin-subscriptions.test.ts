import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { devinSubscription, step as stepTable } from '../src/db/schema.js';
import { bootServer, req, type TestServer } from './helpers.js';

const TOKEN = `wsk-test-private-subscription-token-${'z'.repeat(64)}`;

const fixtureDirs: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => {
  for (const dir of fixtureDirs.splice(0)) releaseTestTempDir(dir);
});

function fakeDevin(opts: { authenticate?: 'ok' | 'reject' | 'absent' } = {}): string {
  const dir = makeTestTempDir('devin-subscriptions-');
  fixtureDirs.push(dir);
  const runs = join(dir, 'runs');
  const binary = join(dir, 'devin');
  const authMethods =
    opts.authenticate === 'absent'
      ? '[]'
      : '[{"id":"devin-browser","name":"Devin browser","description":"browser"}]';
  const authenticateReply =
    opts.authenticate === 'reject'
      ? '{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"401 invalid api key"}}'
      : '{"jsonrpc":"2.0","id":2,"result":null}';
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      `echo run >> "${runs}"`,
      'while IFS= read -r line; do',
      '  case "$line" in',
      '    *initialize*)',
      `      printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{},"authMethods":${authMethods}}}' ;;`,
      '    *authenticate*)',
      `      printf '%s\\n' '${authenticateReply}' ;;`,
      '    *session/new*)',
      `      printf '%s\\n' '{"jsonrpc":"2.0","id":3,"result":{"sessionId":"verify-session"}}' ;;`,
      '  esac',
      'done',
    ].join('\n'),
    { mode: 0o755 },
  );
  vi.stubEnv('DEVIN_BIN', binary);
  return join(dir, 'runs');
}

describe('Devin subscription connections', () => {
  test('seals independent connections and never returns or logs the token', async () => {
    const logs: string[] = [];
    const s = bootServer({
      logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
    });
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
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
    const rows = s.db.all<{ tokenCipher: string }>(sql`SELECT tokenCipher FROM devin_subscription`);
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

  test('verification drives devin acp initialize+authenticate and hides upstream failures', async () => {
    const logs: string[] = [];
    const s = bootServer({
      logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
    });
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const runs = fakeDevin();
    expect(await (await req(s.app, 'POST', `${path}/${id}/verify`)).json()).toEqual({
      ok: true,
    });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    fakeDevin({ authenticate: 'reject' });
    const rejected = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(await rejected.json()).toEqual({ ok: false, reason: 'auth' });
    clock.mockReturnValue(Date.now() + 10_000);
    vi.stubEnv('DEVIN_BIN', join(fixtureDirs[fixtureDirs.length - 1] ?? '/nonexistent', 'missing'));
    const failed = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(await failed.json()).toEqual({ ok: false, reason: 'unavailable' });
    expect(logs.join('')).not.toContain(TOKEN);
    expect(
      (await req(s.app, 'POST', `/api/teams/other/devin-subscriptions/${id}/verify`)).status,
    ).toBe(404);
    expect(readFileSync(runs, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  test('verification probes a session when the agent advertises no auth methods', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    const { id } = (await created.json()) as { id: string };
    fakeDevin({ authenticate: 'absent' });
    expect(await (await req(s.app, 'POST', `${path}/${id}/verify`)).json()).toEqual({
      ok: true,
    });
  });

  test('invalid input and foreign connection ids reveal no credentials', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    expect((await req(s.app, 'POST', path, { label: 'Empty', token: '' })).status).toBe(400);
    expect(
      (await req(s.app, 'POST', path, { label: 'Bad expiry', token: TOKEN, expiresAt: 'tomorrow' }))
        .status,
    ).toBe(400);
    expect((await req(s.app, 'POST', `${path}/missing/verify`)).status).toBe(404);
  });
});

test.each(['tiny', `wsk-${'a'.repeat(10)}`, `${TOKEN}!`, `bad ${TOKEN}`])(
  'rejects malformed subscription token without echoing input %#',
  async (token) => {
    const logs: string[] = [];
    const s = bootServer({
      logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
    });
    const response = await req(s.app, 'POST', `/api/teams/${s.team.id}/devin-subscriptions`, {
      label: 'Invalid',
      token,
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(token);
    expect(logs.join('')).not.toContain(token);
  },
);

test('a foreign team connection cannot be deleted through the current team path', async () => {
  const s = bootServer();
  s.db.run(sql`INSERT INTO team (id, name, createdAt) VALUES ('foreign', 'Foreign', 1)`);
  s.db.run(
    sql`INSERT INTO devin_subscription (id, teamId, label, tokenCipher, createdAt) VALUES ('foreign-connection', 'foreign', 'Foreign', ${s.secretBox.seal(TOKEN)}, 1)`,
  );
  const response = await req(
    s.app,
    'DELETE',
    `/api/teams/${s.team.id}/devin-subscriptions/foreign-connection`,
  );
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(TOKEN);
  expect(
    s.db.all(sql`SELECT id FROM devin_subscription WHERE id = 'foreign-connection'`),
  ).toHaveLength(1);
});

describe('the subscription token is stored only for the owner session', () => {
  test('anonymous callers are refused, the owner stores it, and no response or list carries it', async () => {
    const s = bootServer({ authToken: 'owner-secret-0123456789abcdef' });
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
    const anonymous = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    expect([401, 403]).toContain(anonymous.status);
    expect(s.db.all(sql`SELECT id FROM devin_subscription`)).toEqual([]);
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

describe('switching the enabled Devin subscription', () => {
  const tokenOf = (letter: string) => `wsk-${letter.repeat(64)}`;

  async function twoAccounts() {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/devin-subscriptions`;
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
      .from(devinSubscription)
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
        devinSubscriptionId: subscriptionId,
      })
      .run();
  }

  test('a verified account becomes the only enabled one and no response carries a token', async () => {
    fakeDevin();
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
    ['a rejected token', 'reject' as const, 'auth'],
    ['a server without devin', 'missing' as const, 'unavailable'],
  ])('%s fails the precheck and the old account stays enabled', async (_name, mode, reason) => {
    if (mode === 'missing') vi.stubEnv('DEVIN_BIN', '/nonexistent/devin');
    else fakeDevin({ authenticate: mode });
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
    fakeDevin();
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
    expect(s.db.select().from(devinSubscription).all()).toHaveLength(2);
    s.db.update(stepTable).set({ status: 'done' }).run();
    expect((await req(s.app, 'POST', `${path}/${second}/enable`)).status).toBe(200);
    expect(enabledIds(s)).toEqual([second]);
  });

  test('disable turns everything off, delete of the enabled account leaves none enabled', async () => {
    const { s, path, first, second } = await twoAccounts();
    const disabled = await req(s.app, 'POST', `${path}/${first}/disable`);
    expect(await disabled.json()).toMatchObject({ id: first, enabled: false });
    expect(enabledIds(s)).toEqual([]);
    expect((await req(s.app, 'POST', `${path}/${first}/disable`)).status).toBe(200);
    fakeDevin();
    expect((await req(s.app, 'POST', `${path}/${second}/enable`)).status).toBe(200);
    expect((await req(s.app, 'DELETE', `${path}/${second}`)).status).toBe(204);
    expect(enabledIds(s)).toEqual([]);
    expect((await req(s.app, 'DELETE', `${path}/${first}`)).status).toBe(204);
  });

  test('rename keeps the token out of the label', async () => {
    const { s, path, first } = await twoAccounts();
    const renamed = await req(s.app, 'PATCH', `${path}/${first}`, { label: 'Work account' });
    expect(await renamed.json()).toMatchObject({ id: first, label: 'Work account' });
    const refused = await req(s.app, 'PATCH', `${path}/${first}`, {
      label: `x ${tokenOf('a')}`,
    });
    expect(refused.status).toBe(400);
    expect(await refused.text()).not.toContain(tokenOf('a'));
    expect((await req(s.app, 'PATCH', `${path}/${first}`, { label: ' ' })).status).toBe(400);
  });

  test('the steps list shows what ran on the account, newest first', async () => {
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
          devinSubscriptionId: first,
        },
        {
          id: 's-run',
          buildId: 'b3',
          kind: 'build',
          status: 'claimed',
          claimedAt: 30,
          createdAt: 29,
          devinSubscriptionId: first,
        },
        {
          id: 's-other',
          buildId: 'b5',
          kind: 'build',
          status: 'done',
          claimedAt: 50,
          createdAt: 49,
          devinSubscriptionId: second,
        },
      ])
      .run();
    const response = await req(s.app, 'GET', `${path}/${first}/steps`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      steps: { stepId: string; outcome: string }[];
      hasEarlier: boolean;
    };
    expect(page.steps.map((row) => [row.stepId, row.outcome])).toEqual([
      ['s-run', 'running'],
      ['s-old', 'done'],
    ]);
    expect(page.hasEarlier).toBe(false);
    expect((await req(s.app, 'GET', `${path}/missing/steps`)).status).toBe(404);
    expect(
      (await req(s.app, 'GET', `/api/teams/other/devin-subscriptions/${first}/steps`)).status,
    ).toBe(404);
  });
});

test('expired enabled subscription does not verify and no run reaches it', async () => {
  const s = bootServer();
  const path = `/api/teams/${s.team.id}/devin-subscriptions`;
  const created = await req(s.app, 'POST', path, {
    label: 'Expired',
    token: TOKEN,
    expiresAt: Date.now() + 60_000,
  });
  const { id } = (await created.json()) as { id: string };
  s.db
    .update(devinSubscription)
    .set({ expiresAt: Date.now() - 1000 })
    .where(eq(devinSubscription.id, id))
    .run();
  const verified = await req(s.app, 'POST', `${path}/${id}/verify`);
  expect(await verified.json()).toEqual({ ok: false });
  const enabled = await req(s.app, 'POST', `${path}/${id}/enable`);
  expect(enabled.status).toBe(409);
  expect(await enabled.json()).toMatchObject({ code: 'expired' });
});
