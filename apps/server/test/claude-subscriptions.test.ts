import { readdirSync, readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  claudeSubscription,
  machine as machineTable,
  pairedDevice,
  step as stepTable,
} from '../src/db/schema.js';
import { issueBrowserSession } from '../src/services/browser-session.js';
import {
  bootServer,
  insertClaudeSubscription,
  insertMachine,
  req,
  type TestServer,
} from './helpers.js';

const TOKEN =
  'sk-ant-oat01-subscription-test-private-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const CLAUDE_MODEL_IDS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

const modelsOk = (ids: string[] = CLAUDE_MODEL_IDS) =>
  new Response(
    JSON.stringify({
      data: ids.map((id) => ({ id, display_name: id })),
      has_more: false,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

function stubClaudeModels(handler?: () => Promise<Response> | Response) {
  const stub = vi.fn<typeof globalThis.fetch>(async () => (await handler?.()) ?? modelsOk());
  vi.stubGlobal('fetch', stub);
  return stub;
}

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

  test('verification probes the OAuth models endpoint and hides upstream failures', async () => {
    const logs: string[] = [];
    const s = bootServer({
      logger: pino({ level: 'trace' }, { write: (line) => logs.push(line) }),
    });
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const created = await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const fetchStub = stubClaudeModels();
    const listed = async () =>
      ((await (await req(s.app, 'GET', path)).json()) as { lastCheck: unknown }[])[0]?.lastCheck;
    expect(await listed()).toBeNull();
    expect(await (await req(s.app, 'POST', `${path}/${id}/verify`)).json()).toMatchObject({
      ok: true,
      check: {
        ok: true,
        reason: null,
        check: 'sign-in',
        command: 'GET https://api.anthropic.com/v1/models',
      },
    });
    expect(await listed()).toMatchObject({ ok: true, durationMs: expect.any(Number) });
    const [checkedUrl, checkedInit] = fetchStub.mock.calls[0]!;
    expect(String(checkedUrl)).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(new Headers(checkedInit?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    fetchStub.mockImplementation(
      async () => new Response(`private-upstream-response ${TOKEN}`, { status: 401 }),
    );
    const rejected = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(await rejected.json()).toMatchObject({ ok: false, reason: 'auth' });
    expect(await listed()).toMatchObject({ ok: false, reason: 'auth' });
    clock.mockReturnValue(Date.now() + 10_000);
    fetchStub.mockImplementation(
      async () => new Response(`private-quota-response ${TOKEN}`, { status: 429 }),
    );
    const exhausted = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(await exhausted.json()).toMatchObject({ ok: false, reason: 'quota' });
    clock.mockReturnValue(Date.now() + 10_000);
    fetchStub.mockImplementation(async () => new Response('down', { status: 503 }));
    const failed = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(await failed.json()).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(JSON.stringify(await listed())).not.toContain(TOKEN);
    expect(logs.join('')).not.toContain(TOKEN);
    expect(logs.join('')).not.toContain('private-upstream-response');
    expect(logs.join('')).not.toContain('private-quota-response');
    expect(
      (await req(s.app, 'POST', `/api/teams/other/claude-subscriptions/${id}/verify`)).status,
    ).toBe(404);
    const diagnostics = logs
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.msg === 'Claude subscription verification completed');
    expect(diagnostics).toMatchObject(
      [
        { ok: true, reason: null },
        { ok: false, reason: 'auth' },
        { ok: false, reason: 'quota' },
        { ok: false, reason: 'unavailable' },
      ].map((outcome) => ({
        ...outcome,
        teamId: s.team.id,
        subscriptionId: id,
        durationMs: expect.any(Number),
      })),
    );
    expect(fetchStub).toHaveBeenCalledTimes(4);
  });

  test('a model test checks the listed model against the subscription token, refuses flag-shaped ids and leaves the last check alone', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const { id } = (await (
      await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN })
    ).json()) as { id: string };
    const fetchStub = stubClaudeModels();
    const tested = await req(s.app, 'POST', `${path}/${id}/test`, { model: 'claude-opus-5-5' });
    expect(await tested.json()).toMatchObject({ status: 'ok', latencyMs: expect.any(Number) });
    const probeCall = fetchStub.mock.calls.find(([url]) => String(url).includes('/v1/messages'))!;
    expect(JSON.parse(probeCall[1]?.body as string)).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1,
    });
    expect(
      (await req(s.app, 'POST', `${path}/${id}/test`, { model: 'claude-opus-5-5' })).status,
    ).toBe(429);
    expect(
      (await req(s.app, 'POST', `${path}/${id}/test`, { model: 'claude-sonnet-5-5' })).status,
    ).toBe(200);
    expect(
      (await req(s.app, 'POST', `${path}/${id}/test`, { model: '--dangerously-skip-permissions' }))
        .status,
    ).toBe(400);
    expect((await req(s.app, 'POST', `${path}/${id}/test`, { model: 'made-up-1' })).status).toBe(
      400,
    );
    expect(
      (
        await req(s.app, 'PATCH', `${path}/${id}`, {
          models: [{ id: 'claude-opus-5-5', name: `x ${TOKEN}` }],
        })
      ).status,
    ).toBe(400);
    const list = (await (await req(s.app, 'GET', path)).json()) as { lastCheck: unknown }[];
    expect(list[0]?.lastCheck).toBeNull();
  });

  test('picked models are stored canonically and become the Claude Code model source', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const { id } = (await (
      await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN })
    ).json()) as { id: string };
    insertMachine(s, {
      claudeCodeReport: {
        installed: true,
        hostname: 'mac',
        models: [
          { id: 'opus[1m]', name: 'opus[1m]', slot: 'default' },
          { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', slot: 'default-sonnet' },
          { id: 'claude-opus-5-5', name: 'claude-opus-5-5', slot: 'builtin' },
        ],
      },
    });
    const claudeModels = async () =>
      (
        (await (await req(s.app, 'GET', `/api/teams/${s.team.id}/model-sources`)).json()) as {
          sources: { runtime: string; models: { id: string; name: string }[] }[];
        }
      ).sources
        .filter((source) => source.runtime === 'claude-code')
        .flatMap((source) => source.models.map((model) => `${model.id} ${model.name}`));
    expect(await claudeModels()).toEqual([
      'claude-opus-5-5 Claude Opus 5.5',
      'claude-sonnet-5-5 Claude Sonnet 5.5',
    ]);
    const picked = [
      { id: 'claude-fable-5-2', name: 'Claude Fable 5.2' },
      { id: 'sonnet[1m]', name: 'sonnet[1m]' },
      { id: 'claude-sonnet-5-5', name: 'duplicate' },
    ];
    const patched = await req(s.app, 'PATCH', `${path}/${id}`, { models: picked });
    expect((await patched.json()) as { models: unknown }).toMatchObject({
      models: [
        { id: 'claude-fable-5-2', name: 'Claude Fable 5.2' },
        { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
      ],
    });
    expect(await claudeModels()).toEqual([
      'claude-fable-5-2 Claude Fable 5.2',
      'claude-sonnet-5-5 Claude Sonnet 5.5',
    ]);
    s.db
      .update(claudeSubscription)
      .set({
        models: [
          { id: 'opus[1m]', name: 'opus[1m]' },
          { id: 'default', name: 'default' },
          { id: '--permission-mode', name: 'flag' },
        ],
      })
      .where(eq(claudeSubscription.id, id))
      .run();
    expect(
      (
        await req(s.app, 'PATCH', `${path}/${id}`, {
          models: [{ id: '--dangerously-skip-permissions', name: 'flag' }],
        })
      ).status,
    ).toBe(400);
    const listed = (await (await req(s.app, 'GET', path)).json()) as { models: unknown }[];
    expect(listed[0]?.models).toEqual([{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }]);
    expect(await claudeModels()).toEqual(['claude-opus-5-5 Claude Opus 5.5']);
    await req(s.app, 'PATCH', `${path}/${id}`, { models: null });
    expect(await claudeModels()).toHaveLength(2);
  });

  test('upstream models come from the Anthropic models API with the subscription token, newest first across pages', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const { id } = (await (
      await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN })
    ).json()) as { id: string };
    insertMachine(s, {
      claudeCodeReport: {
        installed: true,
        hostname: 'mac',
        models: [{ id: 'opus[1m]', name: 'opus[1m]', slot: 'default' }],
      },
    });
    const pages = [
      {
        data: [
          { type: 'model', id: 'claude-fable-5-2', display_name: 'Claude Fable 5.2' },
          { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
        ],
        has_more: true,
        last_id: 'claude-opus-5-5',
      },
      {
        data: [
          { type: 'model', id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
        ],
        has_more: false,
        last_id: 'claude-haiku-4-5-20251001',
      },
    ];
    const seen: { url: string; headers: Headers }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        seen.push({ url: String(url), headers: new Headers(init?.headers) });
        return Response.json(pages[seen.length - 1]);
      }),
    );
    const response = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
    const text = await response.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toEqual({
      status: 'ok',
      models: [
        { id: 'claude-fable-5-2', name: 'Claude Fable 5.2' },
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
      ],
    });
    expect(seen.map((call) => call.url)).toEqual([
      'https://api.anthropic.com/v1/models?limit=1000',
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-opus-5-5',
    ]);
    expect(seen[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]?.headers.get('anthropic-beta')).toBe('oauth-2025-04-20');
    expect(seen[0]?.headers.has('x-api-key')).toBe(false);
  });

  test('a failed upstream call says so and offers the labelled fallback list without aliases', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const { id } = (await (
      await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN })
    ).json()) as { id: string };
    insertMachine(s, {
      claudeCodeReport: {
        installed: true,
        hostname: 'mac',
        models: [
          { id: 'opus[1m]', name: 'opus[1m]', slot: 'default' },
          { id: 'claude-haiku-5-5', name: 'claude-haiku-5-5', slot: 'default-haiku' },
        ],
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { type: 'error', error: { type: 'authentication_error', message: TOKEN } },
          { status: 401 },
        ),
      ),
    );
    const response = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
    const text = await response.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toEqual({
      status: 'fallback',
      failure: 'auth',
      httpStatus: 401,
      models: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
        { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
      ],
    });
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

  test('a token that no longer decrypts reads as a failed check, not a server error', async () => {
    const s = bootServer();
    const path = `/api/teams/${s.team.id}/claude-subscriptions`;
    const { id } = (await (
      await req(s.app, 'POST', path, { label: 'Personal', token: TOKEN })
    ).json()) as { id: string };
    s.db
      .update(claudeSubscription)
      .set({ tokenCipher: 'v1:tampered' })
      .where(eq(claudeSubscription.id, id))
      .run();
    const verified = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ ok: false, reason: 'failed' });
    const list = (await (await req(s.app, 'GET', path)).json()) as { lastCheck: unknown }[];
    expect(list[0]?.lastCheck).toMatchObject({ ok: false, reason: 'failed' });
    const tested = await req(s.app, 'POST', `${path}/${id}/test`, { model: 'claude-opus-5-5' });
    expect(tested.status).toBe(200);
    expect(await tested.json()).toMatchObject({ status: 'failed', failure: 'upstream' });
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
  let mode: 'hold' | 'ok' | 'auth' = 'ok';
  const queued: (() => void)[] = [];
  const fetchStub = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        if (mode === 'hold') {
          queued.push(() => resolve(modelsOk()));
          return;
        }
        resolve(mode === 'auth' ? new Response('x', { status: 401 }) : modelsOk());
      }),
  );
  vi.stubGlobal('fetch', fetchStub);
  mode = 'hold';
  const first = req(s.app, 'POST', `${path}/${ids[0]}/verify`);
  await vi.waitFor(() => expect(queued).toHaveLength(1));
  const limited = await req(s.app, 'POST', `${path}/${ids[0]}/verify`);
  expect(limited.status).toBe(429);
  const message = await limited.text();
  expect(message).toContain('10 seconds');
  expect(message).not.toContain(TOKEN);
  expect(fetchStub).toHaveBeenCalledTimes(1);
  mode = 'ok';
  expect((await req(s.app, 'POST', `${path}/${ids[1]}/verify`)).status).toBe(200);
  queued[0]?.();
  expect((await first).status).toBe(200);
  now += 9_999;
  expect((await req(s.app, 'POST', `${path}/${ids[0]}/verify`)).status).toBe(429);
  expect(fetchStub).toHaveBeenCalledTimes(2);
  now += 1;
  mode = 'auth';
  const failed = await req(s.app, 'POST', `${path}/${ids[0]}/verify`);
  expect(failed.status).toBe(200);
  expect(await failed.json()).toMatchObject({ ok: false, reason: 'auth' });
  expect((await req(s.app, 'POST', `${path}/${ids[0]}/verify`)).status).toBe(429);
  expect((await req(s.app, 'POST', `${path}/missing/verify`)).status).toBe(404);
  expect(
    (await req(s.app, 'POST', `/api/teams/other/claude-subscriptions/${ids[0]}/verify`)).status,
  ).toBe(404);
  expect(fetchStub).toHaveBeenCalledTimes(3);
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
    stubClaudeModels();
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
    ['a rejected token', () => new Response('x', { status: 401 }), 'auth'],
    ['an unreachable upstream', () => Promise.reject(new TypeError('fetch failed')), 'unavailable'],
    ['an exhausted subscription', () => new Response('x', { status: 429 }), 'quota'],
  ])('%s fails the precheck and the old account stays enabled', async (_name, impl, reason) => {
    stubClaudeModels(impl);
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
    stubClaudeModels();
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
    stubClaudeModels();
    const { s, path, first, second } = await twoAccounts();
    runningStep(s, second);
    runningStep(s, 'someone-else', 'run-other');
    const response = await req(s.app, 'POST', `${path}/${second}/enable`);
    expect(response.status).toBe(200);
    expect(enabledIds(s)).toEqual([second]);
    expect(first).not.toBe(second);
  });

  test('an expired target is refused and an unknown or foreign id is 404', async () => {
    stubClaudeModels();
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
    stubClaudeModels(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(modelsOk()), 300)),
    );
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
    stubClaudeModels();
    expect((await req(s.app, 'POST', `${path}/${second}/enable`)).status).toBe(200);
    expect((await req(s.app, 'DELETE', `${path}/${second}`)).status).toBe(204);
    expect(enabledIds(s)).toEqual([]);
    expect((await req(s.app, 'DELETE', `${path}/${first}`)).status).toBe(204);
  });

  test('a switch clears the rate-limit rejection recorded for the old account', async () => {
    stubClaudeModels();
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

test('a paired device runs subscription checks, and the check bookkeeping is stored', async () => {
  const s = bootServer({ authToken: 'owner-secret-0123456789abcdef' });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  s.db
    .insert(pairedDevice)
    .values({
      id: 'phone',
      teamId: s.team.id,
      name: 'phone',
      tokenHash: 'synthetic',
      masked: 'phone',
      createdAt: 1,
    })
    .run();
  const id = insertClaudeSubscription(s);
  const cookie = `cairn_auth=${issueBrowserSession(s.db, 'device', 'phone').token}`;
  const team = `/api/teams/${s.team.id}`;
  for (const url of [
    `${team}/claude-subscriptions/${id}/verify`,
    `${team}/claude-subscriptions/${id}/test`,
    `${team}/claude-subscriptions/${id}/upstream-models`,
    `${team}/devin-subscriptions/${id}/verify`,
    `${team}/antigravity-subscriptions/${id}/verify`,
  ]) {
    const response = await s.app.request(url, {
      method: 'POST',
      headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-5-5' }),
    });
    expect(response.status).not.toBe(403);
    expect((await response.json()) as { error?: string }).not.toEqual({
      error: 'only the owner token can do this',
    });
  }
  expect(
    s.db.select().from(claudeSubscription).where(eq(claudeSubscription.id, id)).get()?.lastCheck,
  ).not.toBeNull();
  s.dispose();
});

describe('the subscription list wire carries quota windows and usage stats', () => {
  const list = async (s: TestServer) =>
    (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/claude-subscriptions`)
    ).json()) as Record<string, unknown>[];

  test('windows, exhausted state, cooldown and usage stats ride the list response', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    const now = Date.now();
    const observed = now - 60_000;
    const resetsAt = now + 3_600_000;
    s.db
      .update(claudeSubscription)
      .set({
        quotaWindows: [
          {
            subscription: 'five_hour',
            status: 'rejected',
            utilization: 1,
            resetsAt,
            reportedAt: observed,
          },
          {
            subscription: 'seven_day',
            status: 'allowed_warning',
            utilization: 0.4,
            resetsAt: resetsAt + 86_400_000,
            reportedAt: observed,
          },
          {
            subscription: 'overage',
            status: 'allowed',
            utilization: null,
            resetsAt: null,
            reportedAt: observed,
          },
        ],
      })
      .where(eq(claudeSubscription.id, id))
      .run();
    s.db
      .insert(stepTable)
      .values([
        {
          id: 's-old',
          buildId: 'b1',
          kind: 'build',
          status: 'done',
          claimedAt: now - 30 * 3_600_000,
          createdAt: 1,
          claudeSubscriptionId: id,
        },
        {
          id: 's-done',
          buildId: 'b2',
          kind: 'build',
          status: 'done',
          claimedAt: now - 2 * 3_600_000,
          createdAt: 2,
          claudeSubscriptionId: id,
        },
        {
          id: 's-run',
          buildId: 'b3',
          kind: 'build',
          status: 'claimed',
          claimedAt: now - 60_000,
          createdAt: 3,
          claudeSubscriptionId: id,
        },
        {
          id: 's-queued',
          buildId: 'b4',
          kind: 'build',
          status: 'pending',
          createdAt: 4,
          claudeSubscriptionId: id,
        },
        {
          id: 's-elsewhere',
          buildId: 'b5',
          kind: 'build',
          status: 'done',
          claimedAt: now - 1_000,
          createdAt: 5,
          claudeSubscriptionId: 'other-subscription',
        },
      ])
      .run();
    const [row] = await list(s);
    expect(row).toMatchObject({
      id,
      state: 'exhausted',
      cooldownUntil: resetsAt,
      lastUsedAt: now - 60_000,
      stepsLast24h: 2,
      windows: [
        { name: 'five_hour', utilization: 1, resetsAt, observedAt: observed },
        {
          name: 'seven_day',
          utilization: 0.4,
          resetsAt: resetsAt + 86_400_000,
          observedAt: observed,
        },
      ],
    });
    s.dispose();
  });

  test('a rejection past its reset reads ok again and a fresh account sends null usage stats', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    const fresh = insertClaudeSubscription(s, { label: 'Fresh' });
    const observed = Date.now() - 3_600_000;
    s.db
      .update(claudeSubscription)
      .set({
        quotaWindows: [
          {
            subscription: 'five_hour',
            status: 'rejected',
            utilization: 1,
            resetsAt: observed + 1_000,
            reportedAt: observed,
          },
        ],
      })
      .where(eq(claudeSubscription.id, id))
      .run();
    const rows = await list(s);
    const byId = new Map(rows.map((row) => [row.id as string, row]));
    const used = byId.get(id)!;
    expect(used.state).toBeUndefined();
    expect(used.cooldownUntil).toBeUndefined();
    expect(used.windows).toEqual([]);
    expect(used.lastUsedAt).toBeNull();
    expect(used.stepsLast24h).toBeNull();
    const freshRow = byId.get(fresh)!;
    expect(freshRow.state).toBeUndefined();
    expect(freshRow.windows).toEqual([]);
    expect(freshRow.lastUsedAt).toBeNull();
    expect(freshRow.stepsLast24h).toBeNull();
    s.dispose();
  });
});

describe('opening the tray refreshes the Claude quota from upstream', () => {
  const quotaHeaders = (fiveHour: string, sevenDay: string) =>
    new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'anthropic-ratelimit-unified-status': 'allowed',
        'anthropic-ratelimit-unified-representative-claim': 'seven_day',
        'anthropic-ratelimit-unified-5h-utilization': fiveHour,
        'anthropic-ratelimit-unified-5h-reset': '1800000000',
        'anthropic-ratelimit-unified-7d-utilization': sevenDay,
        'anthropic-ratelimit-unified-7d-reset': '1800500000',
      },
    });

  const staleWeek = (s: TestServer, id: string, reportedAt: number) =>
    s.db
      .update(claudeSubscription)
      .set({
        quotaWindows: [
          {
            subscription: 'seven_day',
            status: 'allowed',
            utilization: 0.31,
            resetsAt: null,
            reportedAt,
          },
        ],
      })
      .where(eq(claudeSubscription.id, id))
      .run();

  test('a figure used elsewhere since the last Cairn run is read back from the account, once per minute', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    staleWeek(s, id, Date.now() - 10 * 60_000);
    const fetchStub = vi.fn<typeof globalThis.fetch>(async (url) =>
      String(url).includes('/v1/models') ? modelsOk() : quotaHeaders('0.14', '0.33'),
    );
    vi.stubGlobal('fetch', fetchStub);
    const path = `/api/teams/${s.team.id}/claude-subscriptions/quota`;
    const refreshed = (await (await req(s.app, 'POST', path)).json()) as {
      windows: { name: string; utilization: number; resetsAt: number | null }[];
    }[];
    expect(refreshed[0]?.windows).toEqual([
      expect.objectContaining({
        name: 'seven_day',
        utilization: 0.33,
        resetsAt: 1_800_500_000_000,
      }),
      expect.objectContaining({
        name: 'five_hour',
        utilization: 0.14,
        resetsAt: 1_800_000_000_000,
      }),
    ]);
    expect(fetchStub).toHaveBeenCalledTimes(3);
    const [url, init] = fetchStub.mock.calls[2]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      max_tokens: 1,
      model: 'claude-haiku-5-5',
    });
    expect((await req(s.app, 'POST', path)).status).toBe(200);
    expect(fetchStub).toHaveBeenCalledTimes(3);
    s.dispose();
  });

  test('a refused first model falls through to the next model the account lists', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    staleWeek(s, id, Date.now() - 10 * 60_000);
    const probed: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (url, init) => {
        const target = String(url);
        if (target.includes('/api/oauth/usage')) return new Response('{}', { status: 429 });
        if (target.includes('/v1/models')) return modelsOk();
        probed.push(JSON.parse(String(init?.body)).model as string);
        return probed.length === 1
          ? new Response('{"error":{"type":"rate_limit_error"}}', { status: 429 })
          : quotaHeaders('0.14', '0.33');
      }),
    );
    const refreshed = (await (
      await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions/quota`)
    ).json()) as {
      windows: { name: string; utilization: number }[];
    }[];
    expect(probed).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    expect(refreshed[0]?.windows).toEqual([
      expect.objectContaining({ name: 'seven_day', utilization: 0.33 }),
      expect.objectContaining({ name: 'five_hour', utilization: 0.14 }),
    ]);
    s.dispose();
  });

  test('an upstream that answers without quota headers keeps the stored figure and is not asked again within the minute', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    staleWeek(s, id, Date.now() - 10 * 60_000);
    const fetchStub = vi.fn<typeof globalThis.fetch>(
      async () => new Response('{"error":{}}', { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchStub);
    const path = `/api/teams/${s.team.id}/claude-subscriptions/quota`;
    const first = (await (await req(s.app, 'POST', path)).json()) as {
      windows: { name: string; utilization: number }[];
    }[];
    expect(first[0]?.windows).toEqual([
      expect.objectContaining({ name: 'seven_day', utilization: 0.31 }),
    ]);
    await req(s.app, 'POST', path);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    s.dispose();
  });

  test('reads the windows Claude Code reads from the usage endpoint, without sending a paid message', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    staleWeek(s, id, Date.now() - 10 * 60_000);
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (url) => {
        calls.push(String(url));
        if (String(url).includes('/api/oauth/usage')) {
          return Response.json({
            five_hour: { utilization: 42, resets_at: '2030-01-01T00:00:00Z' },
            seven_day: { utilization: 7, resets_at: null },
            extra_usage: { is_enabled: true, utilization: 5 },
          });
        }
        return quotaHeaders('0.14', '0.33');
      }),
    );
    const refreshed = (await (
      await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions/quota`)
    ).json()) as {
      windows: { name: string; utilization: number; resetsAt: number | null }[];
    }[];
    expect(refreshed[0]?.windows).toEqual([
      expect.objectContaining({ name: 'seven_day', utilization: 0.07, resetsAt: null }),
      expect.objectContaining({
        name: 'five_hour',
        utilization: 0.42,
        resetsAt: Date.parse('2030-01-01T00:00:00Z'),
      }),
    ]);
    expect(calls).toEqual(['https://api.anthropic.com/api/oauth/usage']);
    s.dispose();
  });

  test('a refused probe marks the account exhausted instead of keeping a stale figure', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    staleWeek(s, id, Date.now() - 10 * 60_000);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (url) => {
        const target = String(url);
        if (target.includes('/api/oauth/usage')) return new Response('{}', { status: 403 });
        if (target.includes('/v1/models')) return modelsOk();
        return new Response('{"error":{"type":"rate_limit_error"}}', { status: 429 });
      }),
    );
    const refreshed = (await (
      await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions/quota`)
    ).json()) as {
      state?: string;
      cooldownUntil?: number | null;
      windows: { name: string }[];
    }[];
    expect(refreshed[0]?.state).toBe('exhausted');
    expect(refreshed[0]?.cooldownUntil).toBeNull();
    expect(refreshed[0]?.windows).toEqual([expect.objectContaining({ name: 'seven_day' })]);
    s.dispose();
  });

  test('a token the usage endpoint refuses goes straight to the message probe next time', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    staleWeek(s, id, Date.now() - 10 * 60_000);
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (url) => {
        calls.push(String(url).split('?')[0]!);
        const target = String(url);
        if (target.includes('/api/oauth/usage')) return new Response('{}', { status: 403 });
        if (target.includes('/v1/models')) return modelsOk();
        return quotaHeaders('0.14', '0.33');
      }),
    );
    const path = `/api/teams/${s.team.id}/claude-subscriptions/quota`;
    const t0 = Date.now();
    await req(s.app, 'POST', path);
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 61_000);
    const refreshed = (await (await req(s.app, 'POST', path)).json()) as {
      windows: { name: string; utilization: number }[];
    }[];
    expect(refreshed[0]?.windows).toEqual([
      expect.objectContaining({ name: 'seven_day', utilization: 0.33 }),
      expect.objectContaining({ name: 'five_hour', utilization: 0.14 }),
    ]);
    expect(calls).toEqual([
      'https://api.anthropic.com/api/oauth/usage',
      'https://api.anthropic.com/v1/models',
      'https://api.anthropic.com/v1/messages',
      'https://api.anthropic.com/v1/models',
      'https://api.anthropic.com/v1/messages',
    ]);
    s.dispose();
  });

  test('a recovered account clears the exhausted mark when real windows arrive', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    staleWeek(s, id, Date.now() - 10 * 60_000);
    let probes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (url) => {
        const target = String(url);
        if (target.includes('/api/oauth/usage')) return new Response('{}', { status: 403 });
        if (target.includes('/v1/models')) return modelsOk();
        probes += 1;
        return probes <= 3
          ? new Response('{"error":{"type":"rate_limit_error"}}', { status: 429 })
          : quotaHeaders('0.14', '0.33');
      }),
    );
    const path = `/api/teams/${s.team.id}/claude-subscriptions/quota`;
    const t0 = Date.now();
    const first = (await (await req(s.app, 'POST', path)).json()) as { state?: string }[];
    expect(first[0]?.state).toBe('exhausted');
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 61_000);
    const refreshed = (await (await req(s.app, 'POST', path)).json()) as {
      state?: string;
      windows: { name: string; utilization: number }[];
    }[];
    expect(refreshed[0]?.state).toBeUndefined();
    expect(refreshed[0]?.windows).toEqual([
      expect.objectContaining({ name: 'seven_day', utilization: 0.33 }),
      expect.objectContaining({ name: 'five_hour', utilization: 0.14 }),
    ]);
    s.dispose();
  });

  test('a window whose reset already passed no longer reports its last figure', async () => {
    const s = bootServer();
    const id = insertClaudeSubscription(s);
    const now = Date.now();
    s.db
      .update(claudeSubscription)
      .set({
        quotaWindows: [
          {
            subscription: 'five_hour',
            status: 'allowed',
            utilization: 0.9,
            resetsAt: now - 1_000,
            reportedAt: now - 3_600_000,
          },
          {
            subscription: 'seven_day',
            status: 'allowed',
            utilization: 0.34,
            resetsAt: now + 86_400_000,
            reportedAt: now - 3_600_000,
          },
        ],
      })
      .where(eq(claudeSubscription.id, id))
      .run();
    const rows = (await (
      await req(s.app, 'GET', `/api/teams/${s.team.id}/claude-subscriptions`)
    ).json()) as {
      windows: { name: string; utilization: number; resetsAt: number | null }[];
    }[];
    expect(rows[0]?.windows).toEqual([
      {
        name: 'seven_day',
        utilization: 0.34,
        resetsAt: now + 86_400_000,
        observedAt: now - 3_600_000,
      },
    ]);
    s.dispose();
  });
});
