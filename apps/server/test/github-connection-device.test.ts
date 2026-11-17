import { capabilitiesResponseSchema, githubConnectionDevicePollSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { githubConnection, user } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { githubTokenOrNull, upsertGithubConnection } from '../src/services/github-connection.js';
import {
  cancelGithubConnectionDevice,
  pollGithubConnectionDevice,
  startGithubConnectionDevice,
} from '../src/services/github-connection-device.js';
import { bootServer, req, type TestServer } from './helpers.js';

const APP = { clientId: 'Iv23shared', slug: 'cairnwright' };

interface Call {
  url: string;
  form: URLSearchParams;
  auth: string | undefined;
}

function scripted(onCall?: (call: Call) => void) {
  const calls: Call[] = [];
  const replies: { status: number; body: unknown }[] = [];
  const fetch: FetchLike = async (input, init) => {
    const call = {
      url: String(input),
      form: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
      auth: init?.headers?.authorization,
    };
    calls.push(call);
    onCall?.(call);
    const reply = replies.shift() ?? { status: 500, body: {} };
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: () => null },
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
    };
  };
  const reply = (body: unknown, status = 200) => replies.push({ status, body });
  return { fetch, calls, reply };
}

const CODE = {
  device_code: 'private-device-code',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  interval: 5,
  expires_in: 900,
};
const GRANT = {
  access_token: 'ghu_first_access',
  refresh_token: 'ghr_first_refresh',
  expires_in: 28_800,
  refresh_token_expires_in: 15_552_000,
  scope: '',
};

let s: TestServer | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => {
  s?.dispose();
  s = undefined;
  vi.useRealTimers();
});

function boot(fetch: FetchLike, app: typeof APP | null = APP) {
  s = bootServer({ githubFetch: fetch, mcpGithubApp: app });
  return s;
}

const base = (server: TestServer) => `/api/teams/${server.team.id}/github/connection/device`;
const row = (server: TestServer) =>
  server.db
    .select()
    .from(githubConnection)
    .where(eq(githubConnection.teamId, server.team.id))
    .get();

async function startAttempt(server: TestServer, gh: ReturnType<typeof scripted>) {
  gh.reply(CODE);
  const res = await req(server.app, 'POST', base(server), {});
  expect(res.status).toBe(200);
  return (await res.json()) as { attemptId: string; userCode: string; verificationUri: string };
}

async function poll(server: TestServer, attemptId: string) {
  const res = await req(server.app, 'POST', `${base(server)}/${attemptId}`, {});
  return { status: res.status, body: (await res.json()) as unknown };
}

describe('team GitHub connection through device flow', () => {
  test('capabilities name the App install page only when a registration exists', async () => {
    const off = boot(scripted().fetch, null);
    const offBody = await (await req(off.app, 'GET', '/api/capabilities')).json();
    expect(capabilitiesResponseSchema.parse(offBody).githubDeviceInstallUrl).toBeNull();
    off.dispose();
    const on = boot(scripted().fetch);
    const onBody = await (await req(on.app, 'GET', '/api/capabilities')).json();
    expect(capabilitiesResponseSchema.parse(onBody).githubDeviceInstallUrl).toBe(
      'https://github.com/apps/cairnwright/installations/new',
    );
  });

  test('start without a registration is 400 and makes no GitHub request', async () => {
    const gh = scripted();
    const server = boot(gh.fetch, null);
    const res = await req(server.app, 'POST', base(server), {});
    expect(res.status).toBe(400);
    expect(gh.calls).toHaveLength(0);
  });

  test('start keeps the device code private; polling before the interval asks GitHub nothing', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    const started = await startAttempt(server, gh);
    expect(started).toMatchObject({
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
    });
    expect(JSON.stringify(started)).not.toContain('private-device-code');
    expect(gh.calls[0]?.form.get('client_id')).toBe('Iv23shared');
    expect(gh.calls[0]?.form.has('client_secret')).toBe(false);
    expect(await poll(server, started.attemptId)).toEqual({
      status: 200,
      body: { status: 'pending', intervalSeconds: 5 },
    });
    expect(gh.calls).toHaveLength(1);
  });

  test('slow_down widens the interval; denied ends the attempt and writes nothing', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    const { attemptId } = await startAttempt(server, gh);
    vi.advanceTimersByTime(5_000);
    gh.reply({ error: 'slow_down', interval: 10 });
    expect((await poll(server, attemptId)).body).toEqual({
      status: 'pending',
      intervalSeconds: 10,
    });
    vi.advanceTimersByTime(5_000);
    expect((await poll(server, attemptId)).body).toEqual({
      status: 'pending',
      intervalSeconds: 10,
    });
    expect(gh.calls).toHaveLength(2);
    vi.advanceTimersByTime(5_000);
    gh.reply({ error: 'access_denied' });
    expect((await poll(server, attemptId)).body).toEqual({ status: 'denied' });
    expect((await poll(server, attemptId)).status).toBe(404);
    expect(row(server)).toBeUndefined();
  });

  test('an attempt past its expiry reports expired without asking GitHub', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    const { attemptId } = await startAttempt(server, gh);
    vi.advanceTimersByTime(900_000);
    expect((await poll(server, attemptId)).body).toEqual({ status: 'expired' });
    expect(gh.calls).toHaveLength(1);
  });

  test('complete writes a sealed device row; a later OAuth reconnect clears its device fields', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    const { attemptId } = await startAttempt(server, gh);
    vi.advanceTimersByTime(5_000);
    gh.reply(GRANT);
    gh.reply({ login: 'octo', id: 42, name: 'Octo' });
    const done = await poll(server, attemptId);
    expect(githubConnectionDevicePollSchema.parse(done.body)).toEqual({
      status: 'complete',
      login: 'octo',
    });
    const saved = row(server);
    expect(saved).toMatchObject({
      login: 'octo',
      githubUserId: 42,
      appClientId: 'Iv23shared',
      accessTokenExpiresAt: 1_800_000_000_000 + 5_000 + 28_800_000,
      refreshTokenExpiresAt: 1_800_000_000_000 + 5_000 + 15_552_000_000,
    });
    expect(saved?.connectionGeneration).toEqual(expect.any(String));
    expect(JSON.stringify(saved)).not.toContain('ghu_first_access');
    expect(JSON.stringify(saved)).not.toContain('ghr_first_refresh');
    const status = await (
      await req(server.app, 'GET', `/api/teams/${server.team.id}/github/connection`)
    ).json();
    expect(status).toMatchObject({ connected: true, login: 'octo' });

    upsertGithubConnection(
      { db: server.db, box: server.secretBox },
      { teamId: server.team.id, login: 'octo', accessToken: 'gho_legacy', scope: 'repo' },
    );
    expect(row(server)).toMatchObject({
      appClientId: null,
      connectionGeneration: null,
      refreshTokenExpiresAt: null,
    });
  });

  test('another team or user cannot poll or cancel the attempt', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    const deps = {
      db: server.db,
      box: server.secretBox,
      fetch: gh.fetch,
      app: APP,
      attempts: new Map(),
    };
    gh.reply(CODE);
    const { attemptId } = await startGithubConnectionDevice(deps, { teamId: 't1', userId: 'u1' });
    for (const who of [
      { teamId: 't1', userId: 'u2' },
      { teamId: 't2', userId: 'u1' },
    ]) {
      await expect(pollGithubConnectionDevice(deps, { ...who, attemptId })).rejects.toMatchObject({
        status: 404,
      });
      expect(() => cancelGithubConnectionDevice(deps, { ...who, attemptId })).toThrow();
    }
    expect(deps.attempts.has(attemptId)).toBe(true);
  });

  test('cancel drops the attempt', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    const { attemptId } = await startAttempt(server, gh);
    expect((await req(server.app, 'DELETE', `${base(server)}/${attemptId}`)).status).toBe(204);
    expect((await poll(server, attemptId)).status).toBe(404);
  });
});

describe('GitHub profile adoption on connect', () => {
  async function connectAs(server: TestServer, gh: ReturnType<typeof scripted>, identity: object) {
    const { attemptId } = await startAttempt(server, gh);
    vi.advanceTimersByTime(5_000);
    gh.reply(GRANT);
    gh.reply(identity);
    expect((await poll(server, attemptId)).body).toMatchObject({ status: 'complete' });
    return (await (await req(server.app, 'GET', '/api/user/me')).json()) as {
      displayName: string;
      avatarUrl: string | null;
    };
  }

  test('an untouched name follows GitHub; a name the owner set survives while the avatar still updates', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    expect(await connectAs(server, gh, { login: 'octo', id: 42, name: ' Octo Cat ' })).toEqual(
      expect.objectContaining({
        displayName: 'Octo Cat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4',
      }),
    );
    expect(await connectAs(server, gh, { login: 'hubot', id: 7, name: null })).toEqual(
      expect.objectContaining({
        displayName: 'hubot',
        avatarUrl: 'https://avatars.githubusercontent.com/u/7?v=4',
      }),
    );
    await req(server.app, 'PATCH', '/api/user/me', { displayName: 'Mon' });
    expect(await connectAs(server, gh, { login: 'octo', id: 42, name: 'Octo Cat' })).toEqual(
      expect.objectContaining({
        displayName: 'Mon',
        avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4',
      }),
    );
    const restarted = bootServer({ db: server.db });
    expect(restarted.user).toMatchObject({
      displayName: 'Mon',
      avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4',
    });
    restarted.dispose();
  });

  test('an owner from before the rename flag keeps a non-default name', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    server.db.update(user).set({ displayName: 'Mon', displayNameEdited: null }).run();
    expect(await connectAs(server, gh, { login: 'octo', id: 42, name: 'Octo Cat' })).toMatchObject({
      displayName: 'Mon',
    });
  });
});

describe('device-grant refresh', () => {
  function seedDevice(server: TestServer, access: string, expiresAt: number) {
    upsertGithubConnection(
      { db: server.db, box: server.secretBox },
      {
        teamId: server.team.id,
        login: 'octo',
        accessToken: access,
        refreshToken: `${access}-refresh`,
        accessTokenExpiresAt: expiresAt,
        scope: '',
        device: { clientId: 'Iv23stored', refreshTokenExpiresAt: expiresAt + 1e10 },
      },
    );
  }
  const read = (server: TestServer, fetch: FetchLike) =>
    githubTokenOrNull({ db: server.db, box: server.secretBox, githubFetch: fetch }, server.team.id);

  test('an expiring device token refreshes with the stored client ID and no secret', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    seedDevice(server, 'ghu_old', Date.now() + 30_000);
    gh.reply({ ...GRANT, access_token: 'ghu_new', refresh_token: 'ghr_new' });
    expect(await read(server, gh.fetch)).toBe('ghu_new');
    expect(gh.calls[0]?.form.get('client_id')).toBe('Iv23stored');
    expect(gh.calls[0]?.form.get('refresh_token')).toBe('ghu_old-refresh');
    expect(gh.calls[0]?.form.has('client_secret')).toBe(false);
    expect(await read(server, gh.fetch)).toBe('ghu_new');
    expect(gh.calls).toHaveLength(1);
  });

  test('a refresh that loses to a newer sign-in keeps the newer grant', async () => {
    let server: TestServer;
    const gh = scripted((call) => {
      if (call.form.get('grant_type') === 'refresh_token')
        seedDevice(server, 'ghu_newer_signin', Date.now() + 3_600_000);
    });
    server = boot(gh.fetch);
    seedDevice(server, 'ghu_old', Date.now() + 30_000);
    gh.reply({ ...GRANT, access_token: 'ghu_lost_race', refresh_token: 'ghr_lost_race' });
    expect(await read(server, gh.fetch)).toBe('ghu_newer_signin');
    expect(await read(server, gh.fetch)).toBe('ghu_newer_signin');
  });

  test('a revoked refresh token disconnects; an outage keeps the row and the stale token', async () => {
    const gh = scripted();
    const server = boot(gh.fetch);
    seedDevice(server, 'ghu_old', Date.now() + 30_000);
    gh.reply({}, 503);
    expect(await read(server, gh.fetch)).toBe('ghu_old');
    expect(row(server)?.disconnectedReason).toBeNull();
    gh.reply({ error: 'bad_refresh_token' }, 400);
    expect(await read(server, gh.fetch)).toBeNull();
    expect(row(server)?.disconnectedReason).toBe('GitHub authorization expired');
  });

  test.each([
    [
      'succeeds',
      200,
      { access_token: 'gho_refreshed', refresh_token: 'ghr_x', expires_in: 28_800 },
    ],
    ['fails', 401, { error: 'bad_refresh_token' }],
  ] as const)(
    'a legacy OAuth refresh that %s after a device sign-in leaves the device row alone',
    async (_, status, body) => {
      let server: TestServer;
      const gh = scripted((call) => {
        if (call.form.get('client_secret') === 'oauth-secret')
          seedDevice(server, 'ghu_device_signin', Date.now() + 3_600_000);
      });
      server = boot(gh.fetch);
      upsertGithubConnection(
        { db: server.db, box: server.secretBox },
        {
          teamId: server.team.id,
          login: 'octo',
          accessToken: 'gho_legacy',
          refreshToken: 'ghr_legacy',
          accessTokenExpiresAt: Date.now() + 30_000,
          scope: 'repo',
        },
      );
      gh.reply(body, status);
      const token = await githubTokenOrNull(
        {
          db: server.db,
          box: server.secretBox,
          githubFetch: gh.fetch,
          oauthClient: { clientId: 'oauth-id', clientSecret: 'oauth-secret' },
        },
        server.team.id,
      );
      expect(token).toBe('ghu_device_signin');
      expect(row(server)).toMatchObject({ appClientId: 'Iv23stored', disconnectedReason: null });
    },
  );
});
