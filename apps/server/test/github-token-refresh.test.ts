import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { githubConnection } from '../src/db/schema.js';
import { type FetchLike, githubUserRepos } from '../src/lib/github.js';
import {
  hasGithubConnection,
  openGithubToken,
  readGithubConnectionStatus,
  refreshingGithubFetch,
  teamGithubToken,
} from '../src/services/github-connection.js';
import { bootServer, req, type TestServer } from './helpers.js';

const ACCESS1 = 'ghu_access_token_one';
const REFRESH1 = 'ghr_refresh_token_one';
const ACCESS2 = 'ghu_access_token_two';
const REFRESH2 = 'ghr_refresh_token_two';
const CLIENT = { clientId: 'cid-test', clientSecret: 'cs-test' };
const ORIGIN = 'http://127.0.0.1:8787';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const REPOS_URL = 'https://api.github.com/user/repos';

const REPOS_PAYLOAD = [
  { id: 1, name: 'alpha', full_name: 'octo/alpha', private: false, owner: { login: 'octo' } },
];

interface TokenScript {
  status?: number;
  json?: unknown;
}

function boot(token: TokenScript) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: { ...(init?.headers ?? {}) }, body: init?.body ?? '' });
    if (url.startsWith(TOKEN_URL)) {
      const status = token.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => token.json,
        text: async () => JSON.stringify(token.json ?? null),
      };
    }
    const payload = url.startsWith(REPOS_URL) ? REPOS_PAYLOAD : { login: 'octocat' };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  const s = bootServer({
    oauthClient: CLIENT,
    oauthFetch: fetchImpl,
    githubFetch: fetchImpl,
  });
  return { s, calls, fetchImpl };
}

const WITH_EXPIRATION = {
  json: {
    access_token: ACCESS1,
    refresh_token: REFRESH1,
    expires_in: 28_800,
    scope: 'read:user,repo',
  },
};

const WITHOUT_EXPIRATION = { json: { access_token: ACCESS1, scope: 'read:user,repo' } };

async function connect(s: TestServer) {
  const res = await s.app.request(`/api/teams/${s.team.id}/github/oauth/authorize`, {
    method: 'POST',
    headers: { origin: ORIGIN },
  });
  const body = (await res.json()) as { authorizationUrl?: string };
  const state = new URL(body.authorizationUrl ?? '').searchParams.get('state');
  await s.app.request(`/api/oauth/callback?code=c&state=${state}`, { redirect: 'manual' });
}

function connectionRow(s: TestServer) {
  return s.db.select().from(githubConnection).where(eq(githubConnection.teamId, s.team.id)).get();
}

function expireAccessToken(s: TestServer) {
  s.db
    .update(githubConnection)
    .set({ accessTokenExpiresAt: Date.now() - 1000 })
    .where(eq(githubConnection.teamId, s.team.id))
    .run();
}

function tokenCallsOf(calls: { url: string; body: string }[]) {
  return calls.filter((c) => c.url.startsWith(TOKEN_URL));
}

function refreshCallsOf(calls: { url: string; body: string }[]) {
  return tokenCallsOf(calls).filter((c) => c.body.includes('grant_type=refresh_token'));
}

function rejectingRepos(
  inner: FetchLike,
  rejects: (authorization: string | undefined) => boolean,
): FetchLike {
  return async (input, init) => {
    if (String(input).startsWith(REPOS_URL) && rejects(init?.headers?.authorization)) {
      return {
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ message: 'Bad credentials' }),
        text: async () => '{"message":"Bad credentials"}',
      };
    }
    return inner(input, init);
  };
}

function reposRequest(s: TestServer) {
  return req(s.app, 'GET', '/api/github/repos');
}

describe('github connection token refresh (#1731)', () => {
  test('exchange with expiration stores the refresh token cipher and the access token expiry', async () => {
    const { s } = boot(WITH_EXPIRATION);
    try {
      await connect(s);
      const row = connectionRow(s);
      expect(row?.accessTokenCipher.startsWith('v1:')).toBe(true);
      expect(row?.refreshTokenCipher?.startsWith('v1:')).toBe(true);
      expect(row?.refreshTokenCipher).not.toContain(REFRESH1);
      expect(JSON.stringify(row)).not.toContain(REFRESH1);
      expect(JSON.stringify(row)).not.toContain(ACCESS1);
      const before = Date.now() + 28_800_000 - 60_000;
      const after = Date.now() + 28_800_000 + 1_000;
      expect(row?.accessTokenExpiresAt).toBeGreaterThan(before);
      expect(row?.accessTokenExpiresAt).toBeLessThan(after);
      expect(row?.disconnectedReason).toBeNull();
      const status = (await (await reposRequest(s)).json()) as unknown;
      expect(status).toEqual({ repos: expect.anything() });
    } finally {
      s.dispose();
    }
  });

  test('app without expiration stores no refresh material and later calls never hit the token endpoint', async () => {
    const { s, calls } = boot(WITHOUT_EXPIRATION);
    try {
      await connect(s);
      const row = connectionRow(s);
      expect(row?.refreshTokenCipher).toBeNull();
      expect(row?.accessTokenExpiresAt).toBeNull();
      expect(tokenCallsOf(calls)).toHaveLength(1);
      const res = await reposRequest(s);
      expect(res.status).toBe(200);
      expect(tokenCallsOf(calls)).toHaveLength(1);
      const apiCall = calls.find((c) => c.url.startsWith(REPOS_URL));
      expect(apiCall?.headers.authorization).toBe(`Bearer ${ACCESS1}`);
    } finally {
      s.dispose();
    }
  });

  test('expired access token: refreshed exactly once before the call, new pair saved, call succeeds', async () => {
    const token: TokenScript = { json: WITH_EXPIRATION.json };
    const { s, calls } = boot(token);
    try {
      await connect(s);
      token.json = {
        access_token: ACCESS2,
        refresh_token: REFRESH2,
        expires_in: 28_800,
        scope: 'read:user,repo',
      };
      expireAccessToken(s);
      const res = await reposRequest(s);
      expect(res.status).toBe(200);
      const refreshCalls = refreshCallsOf(calls);
      expect(refreshCalls).toHaveLength(1);
      expect(refreshCalls[0]?.body).toContain(`refresh_token=${REFRESH1}`);
      expect(refreshCalls[0]?.body).toContain(`client_id=${CLIENT.clientId}`);
      expect(refreshCalls[0]?.body).toContain('client_secret=cs-test');
      const apiCall = calls.find((c) => c.url.startsWith(REPOS_URL));
      expect(apiCall?.headers.authorization).toBe(`Bearer ${ACCESS2}`);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(ACCESS2);
      const row = connectionRow(s);
      const before = Date.now() + 28_800_000 - 60_000;
      const after = Date.now() + 28_800_000 + 1_000;
      expect(row?.accessTokenExpiresAt).toBeGreaterThan(before);
      expect(row?.accessTokenExpiresAt).toBeLessThan(after);
      const second = await reposRequest(s);
      expect(second.status).toBe(200);
      expect(refreshCallsOf(calls)).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('two parallel calls with an expired token trigger a single refresh and both succeed', async () => {
    const token: TokenScript = { json: WITH_EXPIRATION.json };
    const { s, calls } = boot(token);
    try {
      await connect(s);
      token.json = { access_token: ACCESS2, refresh_token: REFRESH2, expires_in: 28_800 };
      expireAccessToken(s);
      const [a, b] = await Promise.all([reposRequest(s), reposRequest(s)]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(refreshCallsOf(calls)).toHaveLength(1);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(ACCESS2);
    } finally {
      s.dispose();
    }
  });

  test('failed refresh marks the connection disconnected with a reason on the status surface', async () => {
    const token: TokenScript = { json: WITH_EXPIRATION.json };
    const { s, calls, fetchImpl } = boot(token);
    try {
      await connect(s);
      token.status = 400;
      token.json = { error: 'bad_verification_code' };
      expireAccessToken(s);
      const res = await reposRequest(s);
      expect(res.status).toBe(404);
      expect(refreshCallsOf(calls)).toHaveLength(1);
      const status = readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id);
      expect(status.connected).toBe(false);
      expect(status.disconnectReason).toContain('refresh');
      const access = await teamGithubToken(
        {
          db: s.db,
          box: s.secretBox,
          githubFetch: fetchImpl,
          oauthClient: CLIENT,
        },
        s.team.id,
      );
      expect(access).toEqual({ reason: 'github-disconnected' });
      expect(hasGithubConnection(s.db, s.team.id)).toBe(false);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('reconnect through oauth clears the disconnect reason and restores the connection', async () => {
    const token: TokenScript = { json: WITH_EXPIRATION.json };
    const { s } = boot(token);
    try {
      await connect(s);
      token.status = 400;
      token.json = { error: 'bad_verification_code' };
      expireAccessToken(s);
      await reposRequest(s);
      expect(readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id).connected).toBe(
        false,
      );
      token.status = 200;
      token.json = {
        access_token: ACCESS2,
        refresh_token: REFRESH2,
        expires_in: 28_800,
        scope: 'read:user,repo',
      };
      await connect(s);
      const status = readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id);
      expect(status).toEqual({ connected: true, login: 'octocat', scope: 'read:user,repo' });
      expect(hasGithubConnection(s.db, s.team.id)).toBe(true);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(ACCESS2);
    } finally {
      s.dispose();
    }
  });

  test('a 401 on a not-yet-expired token refreshes once and retries the call once', async () => {
    const token: TokenScript = { json: WITH_EXPIRATION.json };
    const { s, calls, fetchImpl } = boot(token);
    try {
      await connect(s);
      token.json = { access_token: ACCESS2, refresh_token: REFRESH2, expires_in: 28_800 };
      const repoAuth: (string | undefined)[] = [];
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        async (input, init) => {
          if (String(input).startsWith(REPOS_URL)) repoAuth.push(init?.headers?.authorization);
          return rejectingRepos(fetchImpl, (auth) => auth === `Bearer ${ACCESS1}`)(input, init);
        },
      );
      const repos = await githubUserRepos(wrapped, ACCESS1);
      expect(repos).toHaveLength(1);
      expect(refreshCallsOf(calls)).toHaveLength(1);
      expect(repoAuth).toEqual([`Bearer ${ACCESS1}`, `Bearer ${ACCESS2}`]);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(ACCESS2);
    } finally {
      s.dispose();
    }
  });

  test('a 401 whose refresh fails marks the connection disconnected and surfaces the 401', async () => {
    const token: TokenScript = { json: WITH_EXPIRATION.json };
    const { s, calls, fetchImpl } = boot(token);
    try {
      await connect(s);
      token.status = 400;
      token.json = { error: 'bad_refresh_token' };
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        rejectingRepos(fetchImpl, () => true),
      );
      const res = await wrapped(REPOS_URL, {
        headers: { authorization: `Bearer ${ACCESS1}` },
      });
      expect(res.status).toBe(401);
      expect(refreshCallsOf(calls)).toHaveLength(1);
      const status = readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id);
      expect(status.connected).toBe(false);
      expect(status.disconnectReason).toContain('refresh');
    } finally {
      s.dispose();
    }
  });

  test('a 401 for an app without refresh tokens passes through untouched', async () => {
    const { s, calls, fetchImpl } = boot(WITHOUT_EXPIRATION);
    try {
      await connect(s);
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        rejectingRepos(fetchImpl, () => true),
      );
      const res = await wrapped(REPOS_URL, {
        headers: { authorization: `Bearer ${ACCESS1}` },
      });
      expect(res.status).toBe(401);
      expect(refreshCallsOf(calls)).toHaveLength(0);
      expect(readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id).connected).toBe(
        true,
      );
    } finally {
      s.dispose();
    }
  });
});
