import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { antigravitySubscription } from '../src/db/schema.js';
import { openAntigravitySubscription } from '../src/services/antigravity-subscriptions.js';
import { antigravityUsable } from '../src/services/dispatch-eligibility.js';
import { bootServer, insertMachine, req } from './helpers.js';

const ACCESS_TOKEN = 'ya29.fake-personal-subscription-token';
const SECOND_TOKEN = 'ya29.fake-second-subscription-token';
const GOOGLE_SUBJECT = '102900000000000000001';
const OTHER_GOOGLE_SUBJECT = '102900000000000000002';
const PAID_VARIANTS = ['neon', 'carbon', 'argon'].flatMap((family) =>
  ['low', 'medium', 'high', 'xhigh'].map((effort) => ({
    id: `gemini-4-${family}-${effort}`,
    displayName: `Gemini 4 ${family} ${effort}`,
  })),
);

let prevAgyBin: string | undefined;

beforeEach(() => {
  prevAgyBin = process.env.AGY_BIN;
  process.env.AGY_BIN = '/nonexistent/agy';
});

afterEach(() => {
  if (prevAgyBin === undefined) delete process.env.AGY_BIN;
  else process.env.AGY_BIN = prevAgyBin;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each([undefined, null])(
  'creates a personal OAuth subscription from the dialog payload with expiry %s using tokeninfo',
  async (expiresAt) => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const upstream = vi.fn(async () => Response.json({ expires_in: '3599', sub: GOOGLE_SUBJECT }));
    vi.stubGlobal('fetch', upstream);
    const response = await req(s.app, 'POST', path, {
      label: 'Personal',
      token: ACCESS_TOKEN,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
    expect(response.status).toBe(201);
    const record = (await response.json()) as { id: string; expiresAt: number };
    expect(record.expiresAt).toBe(now + 3_599_000);
    expect(upstream).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/tokeninfo',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({ authorization: `Bearer ${ACCESS_TOKEN}` }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      openAntigravitySubscription(
        { db: s.db, box: s.secretBox },
        s.team.id,
        'antigravity',
        record.id,
      ),
    ).toBe(
      JSON.stringify({ kind: 'oauth-personal', token: ACCESS_TOKEN, expiresAt: record.expiresAt }),
    );
    expect(JSON.stringify(record)).not.toContain(ACCESS_TOKEN);
    s.dispose();
  },
);

test.each([
  ['rejected', 400, { error: 'invalid_token' }, 400],
  ['missing expiry', 200, {}, 502],
  ['expired', 200, { expires_in: '0', sub: GOOGLE_SUBJECT }, 400],
  ['malformed expiry', 200, { expires_in: 'not-a-number', sub: GOOGLE_SUBJECT }, 502],
  ['oversized expiry', 200, { expires_in: '9000000000000', sub: GOOGLE_SUBJECT }, 502],
  ['missing subject', 200, { expires_in: '3600' }, 502],
  ['upstream failure', 503, {}, 502],
] as const)(
  'does not store OAuth credentials when tokeninfo reports %s',
  async (_name, status, body, expected) => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(body, { status })),
    );
    const response = await req(s.app, 'POST', path, { label: 'Personal', token: ACCESS_TOKEN });
    expect(response.status).toBe(expected);
    expect(await response.text()).not.toContain(ACCESS_TOKEN);
    expect(await (await req(s.app, 'GET', path)).json()).toEqual([]);
    s.dispose();
  },
);

test('a tokeninfo network failure does not store a credential or expose its error', async () => {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error(ACCESS_TOKEN);
    }),
  );
  const response = await req(s.app, 'POST', path, { label: 'Personal', token: ACCESS_TOKEN });
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain(ACCESS_TOKEN);
  expect(await (await req(s.app, 'GET', path)).json()).toEqual([]);
  s.dispose();
});

test('a tokeninfo timeout fails closed without storing an account', async () => {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
  const deadline = vi
    .spyOn(AbortSignal, 'timeout')
    .mockReturnValue(AbortSignal.abort(new DOMException('Timeout', 'TimeoutError')));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.throwIfAborted();
      throw new Error('Expected the deadline to abort');
    }),
  );
  const response = await req(s.app, 'POST', path, { label: 'Personal', token: ACCESS_TOKEN });
  expect(response.status).toBe(502);
  expect(deadline).toHaveBeenCalledWith(8_000);
  expect(await (await req(s.app, 'GET', path)).json()).toEqual([]);
  s.dispose();
});

test('discovers each account’s entitlement models without switching the active subscription or adding quota-only models', async () => {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
  const upstream = vi.fn(async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const bearer = headers.get('Authorization');
    const paid = bearer === `Bearer ${ACCESS_TOKEN}`;
    if (!paid && bearer !== `Bearer ${SECOND_TOKEN}`) return new Response('{}', { status: 401 });
    if (url === 'https://oauth2.googleapis.com/tokeninfo') {
      return Response.json({
        expires_in: '3600',
        sub: paid ? GOOGLE_SUBJECT : OTHER_GOOGLE_SUBJECT,
      });
    }
    if (url.endsWith(':fetchAvailableModels')) {
      return Response.json({
        models: {
          'gemini-flash': { displayName: 'Gemini Flash', modelProvider: 'MODEL_PROVIDER_GOOGLE' },
          ...(paid
            ? {
                'claude-paid': {
                  displayName: 'Claude Paid',
                  modelProvider: 'MODEL_PROVIDER_ANTHROPIC',
                },
                'gpt-paid': { label: 'GPT Paid' },
                'gemini-echoed-credential': {
                  displayName: `${'x'.repeat(256 - ACCESS_TOKEN.length)}${ACCESS_TOKEN}`,
                },
                ...Object.fromEntries(
                  PAID_VARIANTS.map(({ id, displayName }) => [id, { displayName }]),
                ),
              }
            : {}),
        },
      });
    }
    if (url.endsWith(':retrieveUserQuotaSummary')) {
      return Response.json({
        groups: [
          { displayName: 'Gemini Models', buckets: [{ modelId: 'gemini-flash' }] },
          { displayName: 'Claude and GPT models', buckets: [{ modelId: 'quota-only' }] },
        ],
      });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', upstream);

  const gemini = { id: 'gemini-flash', name: 'Gemini Flash' };
  for (const [token, models] of [
    [
      ACCESS_TOKEN,
      [
        gemini,
        { id: 'claude-paid', name: 'Claude Paid' },
        { id: 'gpt-paid', name: 'GPT Paid' },
        ...PAID_VARIANTS.map(({ id, displayName }) => ({
          id,
          name: displayName,
        })),
      ],
    ],
    [SECOND_TOKEN, [gemini]],
  ] as const) {
    const created = await req(s.app, 'POST', path, {
      label: 'Google account',
      token,
      expiresAt: Date.now() + 600_000,
    });
    expect(created.status).toBe(201);
    const { id, enabled } = (await created.json()) as { id: string; enabled: boolean };
    expect(enabled).toBe(token === ACCESS_TOKEN);
    const response = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', models });
  }
  expect(upstream).toHaveBeenCalledTimes(4);
  for (const [url, init] of upstream.mock.calls) {
    expect(['https://cloudcode-pa.googleapis.com', 'https://oauth2.googleapis.com']).toContain(
      new URL(url).origin,
    );
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
  }
});

test('attaches OAuth only to the selected credentialless subscription and never overwrites a saved credential', async () => {
  const s = bootServer();
  const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
  const created = await req(s.app, 'POST', path, { label: 'Host account' });
  const { id } = (await created.json()) as { id: string };
  const credential = {
    kind: 'oauth-personal',
    token: ACCESS_TOKEN,
    expiresAt: Date.now() + 60_000,
  };
  expect((await req(s.app, 'POST', `${path}/missing/attach-oauth`, credential)).status).toBe(404);
  expect(
    (
      await req(s.app, 'POST', `${path}/${id}/attach-oauth`, {
        ...credential,
        expiresAt: Date.now() - 1000,
      })
    ).status,
  ).toBe(400);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ expires_in: '3600', sub: GOOGLE_SUBJECT })),
  );
  const attached = await req(s.app, 'POST', `${path}/${id}/attach-oauth`, credential);
  expect(attached.status).toBe(200);
  expect(await attached.json()).toMatchObject({
    id,
    label: 'Host account',
    enabled: true,
    hasToken: true,
    expiresAt: credential.expiresAt,
  });
  const overwrite = await req(s.app, 'POST', `${path}/${id}/attach-oauth`, {
    ...credential,
    token: SECOND_TOKEN,
  });
  expect(overwrite.status).toBe(409);
  const records = await (await req(s.app, 'GET', path)).json();
  expect(records).toHaveLength(1);
  expect(JSON.stringify(records)).not.toContain(ACCESS_TOKEN);
  expect(
    openAntigravitySubscription({ db: s.db, box: s.secretBox }, s.team.id, 'antigravity', id),
  ).toBe(JSON.stringify(credential));
});

test('renews expired desktop OAuth in place before probing the same account catalog', async () => {
  const s = bootServer();
  try {
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const upstream = vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/tokeninfo') {
        return Response.json({ expires_in: '3600', sub: GOOGLE_SUBJECT });
      }
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${SECOND_TOKEN}`);
      return url.endsWith(':fetchAvailableModels')
        ? Response.json({ models: { 'claude-renewed': { displayName: 'Claude Renewed' } } })
        : Response.json({ groups: [] });
    });
    vi.stubGlobal('fetch', upstream);
    const created = await req(s.app, 'POST', path, {
      label: 'Desktop account',
      token: ACCESS_TOKEN,
      expiresAt: start + 60_000,
    });
    expect(created.status).toBe(201);
    const { id, enabledAt } = (await created.json()) as { id: string; enabledAt: number };
    const models = [{ id: 'claude-renewed', name: 'Claude Renewed' }];
    expect((await req(s.app, 'PATCH', `${path}/${id}`, { models })).status).toBe(200);

    clock.mockReturnValue(start + 60_001);
    expect(await (await req(s.app, 'POST', `${path}/${id}/upstream-models`)).json()).toMatchObject({
      status: 'fallback',
      failure: 'auth',
    });
    expect(upstream).toHaveBeenCalledTimes(1);
    const credential = { kind: 'oauth-personal', token: SECOND_TOKEN, expiresAt: start + 120_000 };
    const renewed = await req(s.app, 'POST', `${path}/${id}/attach-oauth`, credential);
    expect(renewed.status).toBe(200);
    const records = await (await req(s.app, 'GET', path)).json();
    expect(records).toMatchObject([
      {
        id,
        enabledAt,
        label: 'Desktop account',
        models,
        expiresAt: credential.expiresAt,
        oauthPersonal: true,
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(SECOND_TOKEN);
    expect(await (await req(s.app, 'POST', `${path}/${id}/upstream-models`)).json()).toEqual({
      status: 'ok',
      models,
    });
    expect(upstream).toHaveBeenCalledTimes(3);
  } finally {
    s.dispose();
  }
});

test.each([
  ['a different account', OTHER_GOOGLE_SUBJECT, 409],
  ['no verifiable account', undefined, 502],
] as const)(
  'refuses to renew expired OAuth with %s without changing the row',
  async (_case, sub, status) => {
    const s = bootServer();
    try {
      const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
      const start = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
          expect(url).toBe('https://oauth2.googleapis.com/tokeninfo');
          return Response.json({
            expires_in: '3600',
            sub:
              new Headers(init.headers).get('authorization') === `Bearer ${ACCESS_TOKEN}`
                ? GOOGLE_SUBJECT
                : sub,
          });
        }),
      );
      const created = await req(s.app, 'POST', path, {
        label: 'Desktop account',
        token: ACCESS_TOKEN,
        expiresAt: start + 60_000,
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      const models = [{ id: 'gemini-account-a', name: 'Account A model' }];
      expect((await req(s.app, 'PATCH', `${path}/${id}`, { models })).status).toBe(200);
      const before = await (await req(s.app, 'GET', path)).json();
      clock.mockReturnValue(start + 60_001);
      const result = await req(s.app, 'POST', `${path}/${id}/attach-oauth`, {
        kind: 'oauth-personal',
        token: SECOND_TOKEN,
        expiresAt: start + 120_000,
      });
      expect(result.status).toBe(status);
      const error = await result.text();
      for (const secret of [ACCESS_TOKEN, SECOND_TOKEN, GOOGLE_SUBJECT, OTHER_GOOGLE_SUBJECT]) {
        expect(error).not.toContain(secret);
      }
      expect(await (await req(s.app, 'GET', path)).json()).toEqual(before);
    } finally {
      s.dispose();
    }
  },
);

test('allows reading old OAuth credentials but refuses to renew one without an account binding', async () => {
  const s = bootServer();
  try {
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const upstream = vi.fn(async () => Response.json({ expires_in: '3600', sub: GOOGLE_SUBJECT }));
    vi.stubGlobal('fetch', upstream);
    const created = await req(s.app, 'POST', path, { label: 'Legacy connection' });
    const { id } = (await created.json()) as { id: string };
    const expiresAt = start + 60_000;
    const tokenCipher = `oauth-personal:${s.secretBox.seal(ACCESS_TOKEN)}`;
    s.db
      .update(antigravitySubscription)
      .set({ tokenCipher, expiresAt })
      .where(eq(antigravitySubscription.id, id))
      .run();
    expect(
      openAntigravitySubscription({ db: s.db, box: s.secretBox }, s.team.id, 'antigravity', id),
    ).toBe(JSON.stringify({ kind: 'oauth-personal', token: ACCESS_TOKEN, expiresAt }));
    clock.mockReturnValue(expiresAt + 1);
    const result = await req(s.app, 'POST', `${path}/${id}/attach-oauth`, {
      kind: 'oauth-personal',
      token: SECOND_TOKEN,
      expiresAt: start + 120_000,
    });
    expect(result.status).toBe(409);
    expect(upstream).not.toHaveBeenCalled();
    expect(
      s.db.select().from(antigravitySubscription).where(eq(antigravitySubscription.id, id)).get(),
    ).toMatchObject({ tokenCipher, expiresAt });
  } finally {
    s.dispose();
  }
});

test('rejects replacing an expired API key with a desktop OAuth credential', async () => {
  const s = bootServer();
  try {
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await req(s.app, 'POST', path, {
      label: 'API key',
      token: `AIzaSyA${'a'.repeat(28)}`,
      expiresAt: Date.now() - 60_000,
    });
    const { id } = (await created.json()) as { id: string };
    const result = await req(s.app, 'POST', `${path}/${id}/attach-oauth`, {
      kind: 'oauth-personal',
      token: ACCESS_TOKEN,
      expiresAt: Date.now() + 60_000,
    });
    expect(result.status).toBe(409);
  } finally {
    s.dispose();
  }
});

test('does not turn a quota response into an account catalog when discovery is denied', async () => {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/tokeninfo') {
        return Response.json({ expires_in: '3600', sub: GOOGLE_SUBJECT });
      }
      return url.endsWith(':fetchAvailableModels')
        ? new Response('{}', { status: 403 })
        : Response.json({ groups: [{ displayName: 'Claude and GPT models' }] });
    }),
  );
  const created = await req(s.app, 'POST', path, {
    label: 'Denied account',
    token: ACCESS_TOKEN,
    expiresAt: Date.now() + 600_000,
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const response = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
  expect(await response.json()).toMatchObject({ status: 'fallback', failure: 'auth' });
});

test('binds OAuth execution with an explicit expiration to a compatible runner', async () => {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ expires_in: '3600', sub: GOOGLE_SUBJECT })),
  );
  const body = { label: 'Google account', token: ACCESS_TOKEN };
  const expiresAt = Date.now() + 600_000;
  const created = await req(s.app, 'POST', path, { ...body, expiresAt });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const caps = {
    mcpServers: [],
    skills: [],
    antigravity: { installed: true, authenticated: true },
  };
  insertMachine(s, { capabilities: caps });
  expect(antigravityUsable(s.db, s.team.id)).toBe(false);
  insertMachine(s, { capabilities: { ...caps, antigravityOAuthProfile: true } });
  expect(antigravityUsable(s.db, s.team.id)).toBe(true);
  expect(
    openAntigravitySubscription({ db: s.db, box: s.secretBox }, s.team.id, 'antigravity', id),
  ).toBe(JSON.stringify({ kind: 'oauth-personal', token: ACCESS_TOKEN, expiresAt }));
});

test('personal OAuth returns the full CLI-equivalent catalog even when an online Runner reports only gemini-3.8-flash', async () => {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  try {
    insertMachine(s, {
      name: 'legacy-1-5-2-runner',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          version: '1.5.2',
          authenticated: true,
          models: [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }],
        },
      },
    });
    const fullCliEntries = [
      ['gemini-4-neon', 'Gemini 4 Neon', 'MODEL_PROVIDER_GOOGLE'],
      ['gemini-4-carbon', 'Gemini 4 Carbon', 'MODEL_PROVIDER_GOOGLE'],
      ['gemini-4-argon', 'Gemini 4 Argon', 'MODEL_PROVIDER_GOOGLE'],
      ['gemini-4-hydrogen', 'Gemini 4 Hydrogen', 'MODEL_PROVIDER_GOOGLE'],
      ['gemini-pro-orchestrator-neon', 'Orchestrator (Neon)', 'MODEL_PROVIDER_GOOGLE'],
      ['gemini-pro-orchestrator', 'Orchestrator (Carbon)', 'MODEL_PROVIDER_GOOGLE'],
      ['gemini-pro-orchestrator-argon', 'Orchestrator (Argon)', 'MODEL_PROVIDER_GOOGLE'],
      ['gemini-3.8-flash', 'Gemini 3.8 Flash', 'MODEL_PROVIDER_GOOGLE'],
      ['claude-opus-5-5', 'Claude Opus 5.5', 'MODEL_PROVIDER_ANTHROPIC'],
      ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'MODEL_PROVIDER_ANTHROPIC'],
      ['gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)', 'MODEL_PROVIDER_OPENAI'],
    ] as const;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'https://oauth2.googleapis.com/tokeninfo') {
          return Response.json({ expires_in: '3600', sub: GOOGLE_SUBJECT });
        }
        if (url.endsWith(':fetchAvailableModels')) {
          return Response.json({
            models: Object.fromEntries(
              fullCliEntries.map(([id, displayName, modelProvider]) => [
                id,
                { displayName, modelProvider },
              ]),
            ),
          });
        }
        return Response.json({ groups: [] });
      }),
    );
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const created = await req(s.app, 'POST', path, {
      label: 'Personal full catalog',
      token: ACCESS_TOKEN,
      expiresAt: Date.now() + 600_000,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const response = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; models: { id: string }[] };
    expect(body.status).toBe('ok');
    expect(body.models.map((m) => m.id)).toEqual(fullCliEntries.map(([modelId]) => modelId));
  } finally {
    s.dispose();
  }
});

test('filters internal, non-chat, and unrunnable entries at source and returns clean human display names', async () => {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  try {
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'https://oauth2.googleapis.com/tokeninfo') {
          return Response.json({ expires_in: '3600', sub: GOOGLE_SUBJECT });
        }
        if (url.endsWith(':fetchAvailableModels')) {
          return Response.json({
            models: {
              chat_20706: {
                isInternal: true,
                apiProvider: 'API_PROVIDER_INTERNAL',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              },
              chat_23310: {
                isInternal: true,
                apiProvider: 'API_PROVIDER_INTERNAL',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              },
              tab_jump_flash_lite_preview: {
                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              },
              'gemini-3.1-flash-image': {
                displayName: 'Gemini 3.1 Flash Image',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              },
              'gemini-3.8-flash-tiered': {
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              },
              'gemini-2.5-pro': {
                displayName: 'Gemini 2.5 Pro',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              },
              'claude-sonnet-4-6': {
                displayName: 'Claude Sonnet 4.6 (Thinking)',
                modelProvider: 'MODEL_PROVIDER_ANTHROPIC',
              },
              'claude-opus-4-6-thinking': {
                displayName: 'Claude Opus 4.6 (Thinking)',
                modelProvider: 'MODEL_PROVIDER_ANTHROPIC',
              },
              'gpt-oss-120b-medium': {
                displayName: 'GPT-OSS 120B (Medium)',
                modelProvider: 'MODEL_PROVIDER_OPENAI',
              },
            },
            agentModelSorts: [
              {
                displayName: 'Recommended',
                groups: [
                  {
                    modelIds: [
                      'claude-sonnet-4-6',
                      'claude-opus-4-6-thinking',
                      'gpt-oss-120b-medium',
                    ],
                  },
                ],
              },
            ],
            tabModelIds: ['chat_20706', 'chat_23310'],
            imageGenerationModelIds: ['gemini-3.1-flash-image'],
            tieredModelIds: {
              flashLite: ['gemini-3.5-flash-lite'],
              flash: ['gemini-3.8-flash-tiered'],
              pro: ['gemini-3.8-flash-tiered'],
            },
          });
        }
        return Response.json({ groups: [] });
      }),
    );

    const created = await req(s.app, 'POST', path, {
      label: 'Personal account',
      token: ACCESS_TOKEN,
      expiresAt: Date.now() + 600_000,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const upstream = await req(s.app, 'POST', `${path}/${id}/upstream-models`);
    expect(upstream.status).toBe(200);
    expect(await upstream.json()).toEqual({
      status: 'ok',
      models: [
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
        { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
        { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
      ],
    });
  } finally {
    s.dispose();
  }
});

test('verifying an OAuth subscription enables its usable models by default without overwriting custom picks', async () => {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  try {
    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'https://oauth2.googleapis.com/tokeninfo') {
          return Response.json({ expires_in: '3600', sub: GOOGLE_SUBJECT });
        }
        if (url.endsWith(':fetchAvailableModels')) {
          return Response.json({
            models: {
              chat_20706: { isInternal: true, modelProvider: 'MODEL_PROVIDER_GOOGLE' },
              'gemini-3.8-flash': {
                displayName: 'Gemini 3.8 Flash',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              },
              'claude-sonnet-4-6': {
                displayName: 'Claude Sonnet 4.6 (Thinking)',
                modelProvider: 'MODEL_PROVIDER_ANTHROPIC',
              },
              'gpt-oss-120b-medium': {
                displayName: 'GPT-OSS 120B (Medium)',
                modelProvider: 'MODEL_PROVIDER_OPENAI',
              },
            },
          });
        }
        return Response.json({ groups: [] });
      }),
    );

    const created = await req(s.app, 'POST', path, {
      label: 'Newcomer Antigravity',
      token: ACCESS_TOKEN,
      expiresAt: Date.now() + 600_000,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const verified = await req(s.app, 'POST', `${path}/${id}/verify`);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({
      ok: true,
      check: { via: 'api' },
    });

    const listed = (await (await req(s.app, 'GET', path)).json()) as Array<{
      id: string;
      models: Array<{ id: string; name: string }>;
    }>;
    expect(listed[0]?.models).toEqual([
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
    ]);

    const custom = [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }];
    expect((await req(s.app, 'PATCH', `${path}/${id}`, { models: custom })).status).toBe(200);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 15_000);
    expect((await req(s.app, 'POST', `${path}/${id}/verify`)).status).toBe(200);
    const afterReverify = (await (await req(s.app, 'GET', path)).json()) as Array<{
      models: Array<{ id: string; name: string }>;
    }>;
    expect(afterReverify[0]?.models).toEqual(custom);
  } finally {
    s.dispose();
  }
});

test('probes the real agy acp catalog for OAuth subscriptions and seeds those exact models on create and verify', async () => {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  const binDir = makeTestTempDir('agy-oauth-catalog-');
  const fakeBin = join(binDir, 'fake-agy.sh');
  const refreshToken = `1//0gCatalogRefresh_${'r'.repeat(32)}`;
  const mintedAccess = `ya29.${'m'.repeat(64)}`;
  const cliModels = [
    { value: 'gemini-4-neon', name: 'Gemini 4 Neon' },
    { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
    { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
    { value: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    { value: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
    { value: 'chat_20706', name: 'chat_20706' },
  ];
  writeFileSync(
    fakeBin,
    [
      '#!/bin/sh',
      `exec "${process.execPath}" --input-type=module -e '`,
      'import { readFileSync, writeFileSync } from "node:fs";',
      'import { createInterface } from "node:readline";',
      'const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\\n");',
      'const tokenPath = process.env.HOME + "/.gemini/antigravity-acp/antigravity-oauth-token";',
      'const tok = JSON.parse(readFileSync(tokenPath, "utf8"));',
      `const options = ${JSON.stringify(cliModels)};`,
      'for await (const line of createInterface({ input: process.stdin })) {',
      '  const m = JSON.parse(line);',
      '  if (m.method === "initialize") send({ id: m.id, result: { protocolVersion: 1 } });',
      '  if (m.method === "session/new") {',
      `    if (tok.token?.refresh_token === "${refreshToken}") {`,
      `      tok.token.access_token = "${mintedAccess}";`,
      '      tok.token.expiry = new Date(Date.now() + 3600000).toISOString();',
      '      writeFileSync(tokenPath, JSON.stringify(tok));',
      '    }',
      '    send({ id: m.id, result: { sessionId: "s1", configOptions: [{ id: "model", category: "model", type: "select", currentValue: "gemini-4-neon", options }] } });',
      '  }',
      '}',
      "'",
    ].join('\n'),
    { mode: 0o755 },
  );
  process.env.AGY_BIN = fakeBin;
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === 'https://oauth2.googleapis.com/tokeninfo') {
          return Response.json({ expires_in: '3600', sub: GOOGLE_SUBJECT });
        }
        throw new Error(`Unexpected HTTP fetch when agy CLI catalog is available: ${url}`);
      }),
    );

    const path = `/api/teams/${s.team.id}/antigravity-subscriptions`;
    const expected = [
      { id: 'gemini-4-neon', name: 'Gemini 4 Neon' },
      { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
    ];

    const createdPortable = await req(s.app, 'POST', path, {
      label: 'Portable Antigravity',
      refreshToken,
      authMethod: 'consumer',
    });
    expect(createdPortable.status).toBe(201);
    const portable = (await createdPortable.json()) as {
      id: string;
      models: Array<{ id: string; name: string }>;
    };
    expect(portable.models).toEqual(expected);

    const portableUpstream = await req(s.app, 'POST', `${path}/${portable.id}/upstream-models`);
    expect(portableUpstream.status).toBe(200);
    expect(await portableUpstream.json()).toEqual({ status: 'ok', models: expected });

    const createdAccess = await req(s.app, 'POST', path, {
      label: 'Access-only Antigravity',
      token: ACCESS_TOKEN,
      expiresAt: Date.now() + 600_000,
    });
    expect(createdAccess.status).toBe(201);
    const accessSub = (await createdAccess.json()) as { id: string };
    const verifiedAccess = await req(s.app, 'POST', `${path}/${accessSub.id}/verify`);
    expect(verifiedAccess.status).toBe(200);
    expect(await verifiedAccess.json()).toMatchObject({
      ok: true,
      check: { via: 'cli', command: 'agy acp · Google OAuth' },
    });
    const accessUpstream = await req(s.app, 'POST', `${path}/${accessSub.id}/upstream-models`);
    expect(accessUpstream.status).toBe(200);
    expect(await accessUpstream.json()).toEqual({ status: 'ok', models: expected });
  } finally {
    releaseTestTempDir(binDir);
    s.dispose();
  }
});
