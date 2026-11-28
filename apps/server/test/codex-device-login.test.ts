import { describe, expect, it, vi } from 'vitest';
import { stepProvider } from '../src/coordinator/runtime/provider.js';
import {
  CODEX_DEVICE_REDIRECT_URI,
  CODEX_DEVICE_TOKEN_URL,
  CODEX_DEVICE_USER_CODE_URL,
  CODEX_PI_PUBLIC_CLIENT_ID,
  CODEX_TOKEN_URL,
  materializeCodexAccessToken,
} from '../src/services/codex-device-login.js';
import { createProvider, openProviderKey, updateProvider } from '../src/services/providers.js';
import { bootServer, req, type TestServer } from './helpers.js';

const claims = Buffer.from(
  JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } }),
).toString('base64url');
const ACCESS = `header.${claims}.sig`;
const NEXT_ACCESS = `header.${claims}.next`;
const REFRESH = 'codex-refresh-token';
const ROTATED = 'codex-refresh-rotated';
const DEVICE_AUTH_ID = 'device-auth-secret';
const AUTH_CODE = 'authorization-code-secret';
const VERIFIER = 'code-verifier-secret';

function scriptedFetch(steps: Array<{ status?: number; json: unknown }>) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = async (input: string | URL, init?: { body?: string }) => {
    calls.push({ url: String(input), body: init?.body ?? '' });
    const step = steps[calls.length - 1] ?? { status: 500, json: {} };
    const status = step.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => step.json,
      text: async () => JSON.stringify(step.json),
    };
  };
  return { calls, fetchImpl };
}

function boot(steps: Array<{ status?: number; json: unknown }>) {
  const mock = scriptedFetch(steps);
  const s = bootServer({ oauthFetch: mock.fetchImpl });
  return { s, mock };
}

const deviceJson = { device_auth_id: DEVICE_AUTH_ID, user_code: 'ABCD-1234', interval: '5' };
const grantJson = { authorization_code: AUTH_CODE, code_verifier: VERIFIER };
const tokenJson = { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 };

const deviceUrl = (s: TestServer, tail = '') =>
  `/api/teams/${s.team.id}/providers/oauth/openai-codex/device${tail}`;

async function start(s: TestServer) {
  const res = await req(s.app, 'POST', deviceUrl(s));
  const body = (await res.json()) as {
    state?: string;
    userCode?: string;
    verificationUri?: string;
  };
  return { res, body, text: JSON.stringify(body) };
}

async function poll(s: TestServer, state: string | undefined) {
  const entry = s.codexDeviceStates.get(state ?? '');
  if (entry) entry.lastPollAt = 0;
  return req(s.app, 'POST', deviceUrl(s, '/poll'), { state });
}

function seedCodex(s: TestServer, apiKey: string) {
  return createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      createdBy: s.user.id,
      body: {
        providerId: 'openai-codex',
        label: 'ChatGPT',
        baseUrl: 'https://chatgpt.com/backend-api',
        api: 'openai-responses',
        authHeader: false,
        apiKey,
      },
    },
  );
}

it('lists selectable ChatGPT models through the subscription catalog after device sign-in', async () => {
  // Minimal projection of a Codex 0.166.0 upstream models cache; no account or prompt fields.
  const catalog = {
    models: [
      { slug: 'gpt-6.2-sol', display_name: 'GPT-6.2-Sol', visibility: 'list' },
      { slug: 'gpt-6.1-terra', display_name: 'GPT-6.1 Terra', visibility: 'list' },
      { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide' },
    ],
  };
  const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const headers = new Headers(init?.headers);
    const endpoint = new URL(String(url));
    if (
      endpoint.origin !== 'https://chatgpt.com' ||
      endpoint.pathname !== '/backend-api/codex/models'
    ) {
      return new Response(null, { status: 404 });
    }
    if (
      headers.get('authorization') !== `Bearer ${ACCESS}` ||
      headers.get('chatgpt-account-id') !== 'acct-1' ||
      !endpoint.searchParams.get('client_version') ||
      init?.redirect !== 'error'
    ) {
      return new Response(null, { status: 401 });
    }
    return Response.json(catalog);
  });
  try {
    const { s } = boot([{ json: deviceJson }, { json: grantJson }, { json: tokenJson }]);
    const { body } = await start(s);
    expect(await (await poll(s, body.state)).json()).toEqual({ status: 'complete', created: true });
    const path = `/api/teams/${s.team.id}/providers`;
    const { providers } = (await (await req(s.app, 'GET', path)).json()) as {
      providers: { id: string; providerId: string }[];
    };
    const row = providers.find(({ providerId }) => providerId === 'openai-codex');
    expect(row).toBeDefined();
    const text = await (await req(s.app, 'GET', `${path}/${row?.id}/upstream-models`)).text();
    expect(text).not.toContain(ACCESS);
    expect(JSON.parse(text)).toEqual({
      status: 'ok',
      models: [
        { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
        { id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' },
      ],
    });
  } finally {
    upstream.mockRestore();
  }
});

const expiredSecret = (access = ACCESS) =>
  JSON.stringify({
    kind: 'codex-oauth',
    refresh: REFRESH,
    access,
    expires: Date.now() - 1_000,
    accountId: 'acct-1',
  });

const deps = (s: TestServer, fetchImpl: ReturnType<typeof scriptedFetch>['fetchImpl']) => ({
  db: s.db,
  box: s.secretBox,
  fetch: fetchImpl,
  states: s.codexDeviceStates,
});

describe('OpenAI Codex device login', () => {
  it('starts a device login without returning the device auth id', async () => {
    const { s, mock } = boot([{ json: deviceJson }]);
    const { res, body, text } = await start(s);
    expect(res.status).toBe(200);
    expect(body.userCode).toBe('ABCD-1234');
    expect(body.verificationUri).toBe('https://auth.openai.com/codex/device');
    expect(text).not.toContain(DEVICE_AUTH_ID);
    expect(mock.calls[0]?.url).toBe(CODEX_DEVICE_USER_CODE_URL);
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      client_id: CODEX_PI_PUBLIC_CLIENT_ID,
    });
    expect(s.codexDeviceStates.get(body.state ?? '')?.deviceAuthId).toBe(DEVICE_AUTH_ID);
  });

  it('stores nothing when the device response is malformed', async () => {
    const { s } = boot([{ json: { user_code: 'ABCD-1234' } }]);
    const { res } = await start(s);
    expect(res.status).toBe(502);
    expect(s.codexDeviceStates.size).toBe(0);
  });

  it('does not poll OpenAI until the interval has elapsed', async () => {
    const { s, mock } = boot([{ json: deviceJson }]);
    const { body } = await start(s);
    const res = await req(s.app, 'POST', deviceUrl(s, '/poll'), { state: body.state });
    expect(await res.json()).toEqual({ status: 'pending', intervalSeconds: 5 });
    expect(mock.calls).toHaveLength(1);
  });

  it('stays pending while authorization is not granted yet', async () => {
    const { s, mock } = boot([{ json: deviceJson }, { status: 403, json: {} }]);
    const { body } = await start(s);
    const res = await poll(s, body.state);
    expect(await res.json()).toEqual({ status: 'pending', intervalSeconds: 5 });
    expect(mock.calls[1]?.url).toBe(CODEX_DEVICE_TOKEN_URL);
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({
      device_auth_id: DEVICE_AUTH_ID,
      user_code: 'ABCD-1234',
    });
    expect(s.codexDeviceStates.has(body.state ?? '')).toBe(true);
  });

  it('exchanges the grant and stores an encrypted OAuth secret as a Codex provider', async () => {
    const { s, mock } = boot([{ json: deviceJson }, { json: grantJson }, { json: tokenJson }]);
    const { body } = await start(s);
    const res = await poll(s, body.state);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'complete', created: true });
    for (const secret of [ACCESS, REFRESH, AUTH_CODE, VERIFIER, DEVICE_AUTH_ID]) {
      expect(text).not.toContain(secret);
    }
    const form = new URLSearchParams(mock.calls[2]?.body);
    expect(mock.calls[2]?.url).toBe(CODEX_TOKEN_URL);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      client_id: CODEX_PI_PUBLIC_CLIENT_ID,
      code: AUTH_CODE,
      code_verifier: VERIFIER,
      redirect_uri: CODEX_DEVICE_REDIRECT_URI,
    });
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'openai-codex');
    expect(JSON.parse(opened?.apiKey ?? '{}')).toMatchObject({
      kind: 'codex-oauth',
      refresh: REFRESH,
      access: ACCESS,
      accountId: 'acct-1',
    });
    expect(opened?.row).toMatchObject({
      baseUrl: 'https://chatgpt.com/backend-api',
      api: 'openai-responses',
      authHeader: false,
    });
    expect(opened?.row.models.map((model) => model.id)).toEqual([
      'gpt-6.1-sol',
      'gpt-6.1-terra',
      'gpt-6-sol',
    ]);
    expect(s.codexDeviceStates.size).toBe(0);
  });

  it('fails the login when the token carries no account id', async () => {
    const { s } = boot([
      { json: deviceJson },
      { json: grantJson },
      { json: { ...tokenJson, access_token: 'opaque-token' } },
    ]);
    const { body } = await start(s);
    const res = await poll(s, body.state);
    expect(res.status).toBe(502);
    expect(openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'openai-codex')).toBeNull();
  });

  it('reports denial and expiry without creating a provider', async () => {
    const denied = boot([
      { json: deviceJson },
      { status: 400, json: { error: { code: 'access_denied' } } },
    ]);
    const first = await start(denied.s);
    expect(await (await poll(denied.s, first.body.state)).json()).toEqual({ status: 'denied' });
    expect(
      openProviderKey(
        { db: denied.s.db, box: denied.s.secretBox },
        denied.s.team.id,
        'openai-codex',
      ),
    ).toBeNull();
    expect(denied.s.codexDeviceStates.size).toBe(0);

    const expired = boot([{ json: deviceJson }]);
    const second = await start(expired.s);
    const entry = expired.s.codexDeviceStates.get(second.body.state ?? '');
    if (!entry) throw new Error('state missing');
    entry.expiresAt = Date.now() - 1;
    const res = await poll(expired.s, second.body.state);
    expect(await res.json()).toEqual({ status: 'expired' });
    expect(expired.mock.calls).toHaveLength(1);
    expect(expired.s.codexDeviceStates.size).toBe(0);
  });

  it('hides another team state', async () => {
    const { s } = boot([{ json: deviceJson }]);
    const { body } = await start(s);
    const res = await req(
      s.app,
      'POST',
      '/api/teams/other-team/providers/oauth/openai-codex/device/poll',
      {
        state: body.state,
      },
    );
    expect(res.status).toBe(404);
    expect(s.codexDeviceStates.has(body.state ?? '')).toBe(true);
  });

  it('does not store a login over a credential saved while it was pending', async () => {
    const { s } = boot([{ json: deviceJson }, { json: grantJson }, { json: tokenJson }]);
    const { body } = await start(s);
    seedCodex(s, 'console-key');
    const res = await poll(s, body.state);
    expect(await res.json()).toEqual({ status: 'superseded' });
    expect(openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'openai-codex')?.apiKey).toBe(
      'console-key',
    );
  });

  it('refreshes an expired token and persists the rotated refresh token', async () => {
    const { s, mock } = boot([
      { json: { access_token: NEXT_ACCESS, refresh_token: ROTATED, expires_in: 3600 } },
    ]);
    seedCodex(s, expiredSecret());
    const access = await materializeCodexAccessToken(deps(s, mock.fetchImpl), s.team.id);
    expect(access).toBe(NEXT_ACCESS);
    const form = Object.fromEntries(new URLSearchParams(mock.calls[0]?.body));
    expect(mock.calls[0]?.url).toBe(CODEX_TOKEN_URL);
    expect(form).toEqual({
      grant_type: 'refresh_token',
      client_id: CODEX_PI_PUBLIC_CLIENT_ID,
      refresh_token: REFRESH,
    });
    const stored = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'openai-codex');
    expect(stored?.apiKey).toContain(ROTATED);
    expect(stored?.apiKey).not.toContain(REFRESH);
  });

  it('returns an unexpired access token without calling OpenAI', async () => {
    const { s, mock } = boot([]);
    seedCodex(
      s,
      JSON.stringify({
        kind: 'codex-oauth',
        refresh: REFRESH,
        access: ACCESS,
        expires: Date.now() + 60_000,
        accountId: 'acct-1',
      }),
    );
    expect(await materializeCodexAccessToken(deps(s, mock.fetchImpl), s.team.id)).toBe(ACCESS);
    expect(mock.calls).toEqual([]);
  });

  it('shares one refresh between concurrent dispatches', async () => {
    const { s, mock } = boot([
      { json: { access_token: NEXT_ACCESS, refresh_token: ROTATED, expires_in: 3600 } },
    ]);
    seedCodex(s, expiredSecret());
    const results = await Promise.all([
      materializeCodexAccessToken(deps(s, mock.fetchImpl), s.team.id),
      materializeCodexAccessToken(deps(s, mock.fetchImpl), s.team.id),
    ]);
    expect(results).toEqual([NEXT_ACCESS, NEXT_ACCESS]);
    expect(mock.calls).toHaveLength(1);
  });

  it('does not overwrite a credential replaced while the refresh is in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = async () => {
      await gate;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          access_token: NEXT_ACCESS,
          refresh_token: 'stale-refresh',
          expires_in: 3600,
        }),
        text: async () => '',
      };
    };
    const { s } = boot([]);
    const created = seedCodex(s, expiredSecret());
    const pending = materializeCodexAccessToken(deps(s, fetchImpl), s.team.id);
    updateProvider({ db: s.db, box: s.secretBox }, s.team.id, created.id, {
      apiKey: 'console-key',
    });
    release();
    await expect(pending).resolves.toBe('console-key');
    expect(openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'openai-codex')?.apiKey).toBe(
      'console-key',
    );
  });

  it('rejects dispatch when the refresh is refused and keeps the stored secret', async () => {
    const { s, mock } = boot([{ status: 400, json: { error: 'invalid_grant' } }]);
    seedCodex(s, expiredSecret());
    await expect(
      materializeCodexAccessToken(deps(s, mock.fetchImpl), s.team.id),
    ).rejects.toMatchObject({
      status: 502,
    });
    expect(
      openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'openai-codex')?.apiKey,
    ).toContain(REFRESH);
  });

  it('passes a plain stored key through and rejects a removed provider', async () => {
    const { s, mock } = boot([]);
    seedCodex(s, 'console-key');
    expect(await materializeCodexAccessToken(deps(s, mock.fetchImpl), s.team.id)).toBe(
      'console-key',
    );
    await expect(
      materializeCodexAccessToken(deps(s, mock.fetchImpl), 'other-team'),
    ).rejects.toMatchObject({ status: 409 });
    expect(mock.calls).toEqual([]);
  });

  it('serves the stored provider through the Codex responses API with the access token', async () => {
    const config = {
      kind: 'http' as const,
      providerId: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api',
      api: 'openai-responses' as const,
      authHeader: false,
      models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }],
    };
    const built = stepProvider(config, () => ACCESS);
    const model = built?.getModels()[0];
    expect(model?.api).toBe('openai-codex-responses');
    expect(model?.reasoning).toBe(true);
  });
});
