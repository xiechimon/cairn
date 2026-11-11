import { describe, expect, it } from 'vitest';
import {
  createProvider,
  deleteProvider,
  openProviderKey,
  updateProvider,
} from '../src/services/providers.js';
import {
  materializeXaiAccessToken,
  XAI_DEVICE_CODE_URL,
  XAI_PI_PUBLIC_CLIENT_ID,
  XAI_PI_REFERRER,
  XAI_TOKEN_URL,
} from '../src/services/xai-device-login.js';
import { bootServer, req, type TestServer } from './helpers.js';

const ACCESS = 'xai-access-token';
const REFRESH = 'xai-refresh-token';
const DEVICE = 'device-secret';
const ROTATED = 'xai-refresh-rotated';
const NEXT_ACCESS = 'xai-access-next';

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

const deviceJson = {
  device_code: DEVICE,
  user_code: 'ABCD-1234',
  verification_uri: 'https://auth.x.ai/device',
  verification_uri_complete: 'https://auth.x.ai/device?user_code=ABCD-1234',
  interval: 5,
  expires_in: 600,
};

async function start(s: TestServer) {
  const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers/oauth/xai/device`);
  const body = (await res.json()) as {
    state?: string;
    userCode?: string;
    verificationUri?: string;
    error?: string;
  };
  return { res, body, text: JSON.stringify(body) };
}

describe('xAI SuperGrok device login', () => {
  it('starts a device login without returning the device code', async () => {
    const { s, mock } = boot([{ json: deviceJson }]);
    const { res, body, text } = await start(s);
    expect(res.status).toBe(200);
    expect(body.userCode).toBe('ABCD-1234');
    expect(body.verificationUri).toBe('https://auth.x.ai/device?user_code=ABCD-1234');
    expect(text).not.toContain(DEVICE);
    expect(mock.calls[0]?.url).toBe(XAI_DEVICE_CODE_URL);
    expect(mock.calls[0]?.body).toContain(`client_id=${XAI_PI_PUBLIC_CLIENT_ID}`);
    expect(mock.calls[0]?.body).toContain(`referrer=${XAI_PI_REFERRER}`);
    expect(s.xaiDeviceStates.get(body.state ?? '')?.deviceCode).toBe(DEVICE);
  });

  it('rejects a non-https verification URI and stores nothing', async () => {
    const { s } = boot([
      { json: { ...deviceJson, verification_uri_complete: 'http://auth.x.ai/device' } },
    ]);
    const { res, text } = await start(s);
    expect(res.status).toBe(502);
    expect(text).not.toContain(DEVICE);
    expect(s.xaiDeviceStates.size).toBe(0);
  });

  it('does not poll xAI until the interval has elapsed', async () => {
    const { s, mock } = boot([{ json: deviceJson }]);
    const { body } = await start(s);
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/providers/oauth/xai/device/poll`,
      {
        state: body.state,
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending', intervalSeconds: 5 });
    expect(mock.calls).toHaveLength(1);
  });

  it('stores the refresh token, not the access token, when the user finishes', async () => {
    const { s, mock } = boot([
      { json: deviceJson },
      { json: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 } },
    ]);
    const { body } = await start(s);
    const entry = s.xaiDeviceStates.get(body.state ?? '');
    if (!entry) throw new Error('state missing');
    entry.lastPollAt = 0;
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/providers/oauth/xai/device/poll`,
      {
        state: body.state,
      },
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ status: 'complete' });
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain(REFRESH);
    expect(text).not.toContain(DEVICE);
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai');
    expect(opened?.apiKey).toContain(REFRESH);
    expect(opened?.apiKey).not.toBe(ACCESS);
    expect(opened?.row).toMatchObject({
      baseUrl: 'https://api.x.ai/v1',
      api: 'openai-responses',
      authHeader: false,
    });
    expect(opened?.row.models.map((model) => model.id)).toEqual([
      'grok-4.7',
      'grok-4.6',
      'grok-4.5',
      'grok-4.3',
    ]);
    expect(mock.calls[1]?.url).toBe(XAI_TOKEN_URL);
    expect(mock.calls[1]?.body).toContain(DEVICE);
    expect(s.xaiDeviceStates.size).toBe(0);
  });

  it('reports denial without creating a provider', async () => {
    const { s } = boot([{ json: deviceJson }, { status: 400, json: { error: 'access_denied' } }]);
    const { body } = await start(s);
    const entry = s.xaiDeviceStates.get(body.state ?? '');
    if (!entry) throw new Error('state missing');
    entry.lastPollAt = 0;
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/providers/oauth/xai/device/poll`,
      {
        state: body.state,
      },
    );
    expect(await res.json()).toEqual({ status: 'denied' });
    expect(openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai')).toBeNull();
  });

  it('hides another team state', async () => {
    const { s } = boot([{ json: deviceJson }]);
    const { body } = await start(s);
    const res = await req(s.app, 'POST', '/api/teams/other-team/providers/oauth/xai/device/poll', {
      state: body.state,
    });
    expect(res.status).toBe(404);
    expect(s.xaiDeviceStates.has(body.state ?? '')).toBe(true);
  });

  it('dispatches a refreshed access token and persists a rotated refresh token', async () => {
    const { s, mock } = boot([
      { json: { access_token: NEXT_ACCESS, refresh_token: ROTATED, expires_in: 3600 } },
    ]);
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        body: {
          providerId: 'xai',
          label: 'xAI',
          baseUrl: 'https://api.x.ai/v1',
          api: 'openai-responses',
          authHeader: false,
          apiKey: JSON.stringify({
            kind: 'xai-oauth',
            refresh: REFRESH,
            access: ACCESS,
            expires: Date.now() - 1_000,
          }),
        },
      },
    );
    const openedBefore = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai');
    if (!openedBefore?.apiKey) throw new Error('stored secret missing');
    const access = await materializeXaiAccessToken(
      {
        db: s.db,
        box: s.secretBox,
        fetch: mock.fetchImpl,
        states: s.xaiDeviceStates,
      },
      s.team.id,
      'xai',
    );
    expect(access).toBe(NEXT_ACCESS);
    expect(access).not.toContain(REFRESH);
    expect(access).not.toContain(ROTATED);
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai');
    expect(opened?.apiKey).toContain(ROTATED);
    expect(opened?.apiKey).not.toContain(REFRESH);
  });

  it('does not overwrite a credential replaced while refresh is in flight', async () => {
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
          access_token: 'stale-access',
          refresh_token: 'stale-refresh',
          expires_in: 3600,
        }),
        text: async () => '',
      };
    };
    const { s } = boot([{ json: {} }]);
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        body: {
          providerId: 'xai',
          label: 'xAI',
          baseUrl: 'https://api.x.ai/v1',
          api: 'openai-responses',
          apiKey: JSON.stringify({
            kind: 'xai-oauth',
            refresh: REFRESH,
            access: ACCESS,
            expires: Date.now() - 1_000,
          }),
        },
      },
    );
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai');
    if (!opened?.apiKey) throw new Error('stored secret missing');
    const pending = materializeXaiAccessToken(
      { db: s.db, box: s.secretBox, fetch: fetchImpl, states: s.xaiDeviceStates },
      s.team.id,
      'xai',
    );
    updateProvider({ db: s.db, box: s.secretBox }, s.team.id, opened.row.id, {
      apiKey: 'console-key',
    });
    release();
    await expect(pending).resolves.toBe('console-key');
    expect(openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai')?.apiKey).toBe(
      'console-key',
    );
  });

  it('returns the replacement when the refresh write loses the compare-and-set', async () => {
    const { s, mock } = boot([
      { json: { access_token: 'stale-access', refresh_token: 'stale-refresh', expires_in: 3600 } },
    ]);
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        body: {
          providerId: 'xai',
          label: 'xAI',
          baseUrl: 'https://api.x.ai/v1',
          api: 'openai-responses',
          apiKey: JSON.stringify({
            kind: 'xai-oauth',
            refresh: REFRESH,
            access: ACCESS,
            expires: Date.now() - 1_000,
          }),
        },
      },
    );
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai');
    if (!opened?.apiKey) throw new Error('stored secret missing');
    const db = s.db as unknown as {
      update: (...args: unknown[]) => {
        set: (...setArgs: unknown[]) => {
          where: (...whereArgs: unknown[]) => unknown;
        };
      };
    };
    const realUpdate = db.update.bind(s.db);
    db.update = (...args: unknown[]) => {
      const query = realUpdate(...args);
      const realSet = query.set.bind(query);
      query.set = (...setArgs: unknown[]) => {
        const afterSet = realSet(...setArgs);
        const realWhere = afterSet.where.bind(afterSet);
        afterSet.where = (...whereArgs: unknown[]) => {
          db.update = realUpdate;
          updateProvider({ db: s.db, box: s.secretBox }, s.team.id, opened.row.id, {
            apiKey: 'console-key',
          });
          return realWhere(...whereArgs);
        };
        return afterSet;
      };
      return query;
    };
    const access = await materializeXaiAccessToken(
      { db: s.db, box: s.secretBox, fetch: mock.fetchImpl, states: s.xaiDeviceStates },
      s.team.id,
      'xai',
    );
    expect(access).toBe('console-key');
    expect(openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai')?.apiKey).toBe(
      'console-key',
    );
  });

  it('dispatches the stored credential, not an unexpired token read before a replacement', async () => {
    const { s, mock } = boot([]);
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        body: {
          providerId: 'xai',
          label: 'xAI',
          baseUrl: 'https://api.x.ai/v1',
          api: 'openai-responses',
          apiKey: JSON.stringify({
            kind: 'xai-oauth',
            refresh: REFRESH,
            access: ACCESS,
            expires: Date.now() + 60_000,
          }),
        },
      },
    );
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai');
    if (!opened?.apiKey) throw new Error('stored secret missing');
    updateProvider({ db: s.db, box: s.secretBox }, s.team.id, opened.row.id, {
      apiKey: JSON.stringify({
        kind: 'xai-oauth',
        refresh: 'newer-refresh',
        access: 'newer-access',
        expires: Date.now() + 60_000,
      }),
    });
    const access = await materializeXaiAccessToken(
      { db: s.db, box: s.secretBox, fetch: mock.fetchImpl, states: s.xaiDeviceStates },
      s.team.id,
      'xai',
    );
    expect(access).toBe('newer-access');
    expect(mock.calls).toEqual([]);
  });

  it('does not dispatch a key after the provider row is removed', async () => {
    const { s, mock } = boot([]);
    const created = createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        body: {
          providerId: 'xai',
          label: 'xAI',
          baseUrl: 'https://api.x.ai/v1',
          api: 'openai-responses',
          apiKey: 'console-key',
        },
      },
    );
    deleteProvider({ db: s.db, box: s.secretBox }, s.team.id, created.id);
    await expect(
      materializeXaiAccessToken(
        { db: s.db, box: s.secretBox, fetch: mock.fetchImpl, states: s.xaiDeviceStates },
        s.team.id,
        'xai',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(mock.calls).toEqual([]);
  });

  it('does not store an older device login over a credential saved while xAI was pending', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const fetchImpl = async (input: string | URL) => {
      calls += 1;
      const url = String(input);
      if (url === XAI_TOKEN_URL) await gate;
      const json =
        url === XAI_TOKEN_URL
          ? { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 }
          : deviceJson;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => json,
        text: async () => JSON.stringify(json),
      };
    };
    const s = bootServer({ oauthFetch: fetchImpl });
    const { body } = await start(s);
    const entry = s.xaiDeviceStates.get(body.state ?? '');
    if (!entry) throw new Error('state missing');
    expect(entry.baselineCipher).toBeNull();
    entry.lastPollAt = 0;
    const pending = req(s.app, 'POST', `/api/teams/${s.team.id}/providers/oauth/xai/device/poll`, {
      state: body.state,
    });
    createProvider(
      { db: s.db, box: s.secretBox },
      {
        teamId: s.team.id,
        createdBy: s.user.id,
        body: {
          providerId: 'xai',
          label: 'xAI',
          baseUrl: 'https://api.x.ai/v1',
          api: 'openai-responses',
          apiKey: 'console-key',
        },
      },
    );
    release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'superseded' });
    expect(openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'xai')?.apiKey).toBe(
      'console-key',
    );
    expect(calls).toBe(2);
  });
});
