import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { githubConnection, team } from '../src/db/schema.js';
import { type FetchLike, githubAppUserRepos, githubUserRepos } from '../src/lib/github.js';
import {
  hasGithubConnection,
  markGithubConnectionDisconnected,
  openGithubToken,
  readGithubConnectionStatus,
  refreshingGithubFetch,
  saveRefreshedTokens,
  teamGithubToken,
  upsertGithubConnection,
} from '../src/services/github-connection.js';
import { type GithubAuthFake, githubAuthFake } from './fakes/github-auth.js';
import { bootServer, req, type TestServer } from './helpers.js';

const CLIENT = { clientId: 'cid-test', clientSecret: 'cs-test' };
const ORIGIN = 'http://127.0.0.1:8787';
const REPOS_PATH = '/user/repos';
const OCTO = { id: 1, login: 'octocat', name: null };

function boot() {
  const gh = githubAuthFake({
    user: OCTO,
    repos: [
      { id: 1, name: 'alpha', full_name: 'octo/alpha', private: false, owner: { login: 'octo' } },
    ],
  });
  const s = bootServer({
    oauthClient: CLIENT,
    oauthFetch: gh.fetch,
    githubFetch: gh.fetch,
  });
  return { s, gh };
}

async function connect(s: TestServer, gh: GithubAuthFake, expires = true) {
  const res = await s.app.request(`/api/teams/${s.team.id}/github/oauth/authorize`, {
    method: 'POST',
    headers: { origin: ORIGIN },
  });
  const body = (await res.json()) as { authorizationUrl?: string };
  const state = new URL(body.authorizationUrl ?? '').searchParams.get('state');
  const code = gh.issueAuthCode(undefined, { expires, scope: 'read:user,repo' });
  await s.app.request(`/api/oauth/callback?code=${encodeURIComponent(code)}&state=${state}`, {
    redirect: 'manual',
  });
  const access = [...gh.grants.keys()].at(-1);
  const refresh = access === undefined ? '' : (gh.grants.get(access)?.refreshToken ?? '');
  return { access: access ?? '', refresh };
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

function tokenCallsOf(gh: GithubAuthFake) {
  return gh.calls.filter((c) => c.url.endsWith('/login/oauth/access_token'));
}

function refreshCallsOf(gh: GithubAuthFake) {
  return tokenCallsOf(gh).filter((c) => c.form.get('grant_type') === 'refresh_token');
}

function reposRequest(s: TestServer) {
  return req(s.app, 'GET', '/api/github/repos');
}

describe('github connection token refresh (#1731)', () => {
  test('exchange with expiration stores the refresh token cipher and the access token expiry', async () => {
    const { s, gh } = boot();
    try {
      const { access, refresh } = await connect(s, gh);
      const row = connectionRow(s);
      expect(row?.accessTokenCipher.startsWith('v1:')).toBe(true);
      expect(row?.refreshTokenCipher?.startsWith('v1:')).toBe(true);
      expect(JSON.stringify(row)).not.toContain(refresh);
      expect(JSON.stringify(row)).not.toContain(access);
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
    const { s, gh } = boot();
    try {
      const { access } = await connect(s, gh, false);
      const row = connectionRow(s);
      expect(row?.refreshTokenCipher).toBeNull();
      expect(row?.accessTokenExpiresAt).toBeNull();
      expect(tokenCallsOf(gh)).toHaveLength(1);
      const res = await reposRequest(s);
      expect(res.status).toBe(200);
      expect(tokenCallsOf(gh)).toHaveLength(1);
      const apiCall = gh.calls.find((c) => c.url.includes(REPOS_PATH));
      expect(apiCall?.auth).toBe(`Bearer ${access}`);
    } finally {
      s.dispose();
    }
  });

  test('expired access token: refreshed exactly once before the call, new pair saved, call succeeds', async () => {
    const { s, gh } = boot();
    try {
      const { access, refresh } = await connect(s, gh);
      expireAccessToken(s);
      const res = await reposRequest(s);
      expect(res.status).toBe(200);
      const refreshCalls = refreshCallsOf(gh);
      expect(refreshCalls).toHaveLength(1);
      expect(refreshCalls[0]?.form.get('refresh_token')).toBe(refresh);
      expect(refreshCalls[0]?.form.get('client_id')).toBe(CLIENT.clientId);
      expect(refreshCalls[0]?.form.get('client_secret')).toBe(CLIENT.clientSecret);
      const rotated = [...gh.grants.keys()].at(-1);
      expect(rotated).not.toBe(access);
      const apiCall = gh.calls.find((c) => c.url.includes(REPOS_PATH));
      expect(apiCall?.auth).toBe(`Bearer ${rotated}`);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(rotated);
      const row = connectionRow(s);
      const before = Date.now() + 28_800_000 - 60_000;
      const after = Date.now() + 28_800_000 + 1_000;
      expect(row?.accessTokenExpiresAt).toBeGreaterThan(before);
      expect(row?.accessTokenExpiresAt).toBeLessThan(after);
      const second = await reposRequest(s);
      expect(second.status).toBe(200);
      expect(refreshCallsOf(gh)).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('two parallel calls with an expired token trigger a single refresh and both succeed', async () => {
    const { s, gh } = boot();
    try {
      const { access } = await connect(s, gh);
      expireAccessToken(s);
      const [a, b] = await Promise.all([reposRequest(s), reposRequest(s)]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(refreshCallsOf(gh)).toHaveLength(1);
      const rotated = [...gh.grants.keys()].at(-1);
      expect(rotated).not.toBe(access);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(rotated);
    } finally {
      s.dispose();
    }
  });

  test('failed refresh marks the connection disconnected with a reason on the status surface', async () => {
    const { s, gh } = boot();
    try {
      const { refresh } = await connect(s, gh);
      gh.revoke(refresh);
      expireAccessToken(s);
      const res = await reposRequest(s);
      expect(res.status).toBe(404);
      expect(refreshCallsOf(gh)).toHaveLength(1);
      const status = readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id);
      expect(status.connected).toBe(false);
      expect(status.disconnectReason).toContain('refresh');
      const access = await teamGithubToken(
        {
          db: s.db,
          box: s.secretBox,
          githubFetch: gh.fetch,
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
    const { s, gh } = boot();
    try {
      const { refresh } = await connect(s, gh);
      gh.revoke(refresh);
      expireAccessToken(s);
      await reposRequest(s);
      expect(readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id).connected).toBe(
        false,
      );
      const second = await connect(s, gh);
      const status = readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id);
      expect(status).toEqual({ connected: true, login: 'octocat', scope: 'read:user,repo' });
      expect(hasGithubConnection(s.db, s.team.id)).toBe(true);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(second.access);
    } finally {
      s.dispose();
    }
  });

  test('a 401 on a not-yet-expired token refreshes once and retries the call once', async () => {
    const { s, gh } = boot();
    try {
      const { access } = await connect(s, gh);
      gh.revokeAccess(access);
      const repoAuth: (string | undefined)[] = [];
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        async (input, init) => {
          if (String(input).includes(REPOS_PATH)) repoAuth.push(init?.headers?.authorization);
          return gh.fetch(input, init);
        },
      );
      const repos = await githubUserRepos(wrapped, access);
      expect(repos).toHaveLength(1);
      expect(refreshCallsOf(gh)).toHaveLength(1);
      const rotated = [...gh.grants.keys()].at(-1);
      expect(repoAuth).toEqual([`Bearer ${access}`, `Bearer ${rotated}`]);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(rotated);
    } finally {
      s.dispose();
    }
  });

  test('a 401 mid-pagination keeps later pages on the rotated token (oauth connection)', async () => {
    const { s, gh } = boot();
    try {
      const { access } = await connect(s, gh);
      gh.revokeAccess(access);
      const pageAuths: (string | undefined)[] = [];
      const paging: FetchLike = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname !== REPOS_PATH) return gh.fetch(input, init);
        pageAuths.push(init?.headers?.authorization);
        if (init?.headers?.authorization === `Bearer ${access}`) {
          return {
            ok: false,
            status: 401,
            headers: { get: () => null },
            json: async () => ({ message: 'Bad credentials' }),
            text: async () => JSON.stringify({ message: 'Bad credentials' }),
          };
        }
        const page = Number(url.searchParams.get('page') ?? '1');
        const body =
          page === 1
            ? Array.from({ length: 100 }, (_, i) => ({
                id: i + 1,
                name: `r${i}`,
                full_name: `octo/r${i}`,
                private: false,
                owner: { login: 'octo' },
              }))
            : [
                {
                  id: 101,
                  name: 'tail',
                  full_name: 'octo/tail',
                  private: false,
                  owner: { login: 'octo' },
                },
              ];
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      };
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        paging,
      );
      const repos = await githubUserRepos(wrapped, access);
      expect(repos).toHaveLength(101);
      const rotated = [...gh.grants.keys()].at(-1);
      expect(rotated).not.toBe(access);
      expect(pageAuths).toEqual([`Bearer ${access}`, `Bearer ${rotated}`, `Bearer ${rotated}`]);
    } finally {
      s.dispose();
    }
  });

  test('a 401 mid-pagination keeps later pages on the rotated token (app device grant)', async () => {
    const gh = githubAuthFake({
      user: OCTO,
      repos: Array.from({ length: 101 }, (_, i) => ({
        id: i + 1,
        name: `r${i}`,
        full_name: `octo/r${i}`,
        private: false,
        owner: { login: 'octo' },
      })),
    });
    gh.knowGrant('ghu_stale', 'ghr_stale');
    const s = bootServer({ oauthClient: CLIENT, oauthFetch: gh.fetch, githubFetch: gh.fetch });
    try {
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        {
          teamId: s.team.id,
          login: 'octo',
          accessToken: 'ghu_stale',
          refreshToken: 'ghr_stale',
          scope: '',
          device: { clientId: 'Iv23shared', refreshTokenExpiresAt: Date.now() + 86_400_000 },
        },
      );
      gh.revokeAccess('ghu_stale');
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        gh.fetch,
        s.team.id,
      );
      const listed = await githubAppUserRepos(wrapped, 'ghu_stale');
      expect(listed.repos).toHaveLength(101);
      const rotated = [...gh.grants.keys()].at(-1);
      expect(rotated).not.toBe('ghu_stale');
      const repoAuths = gh.calls.filter((c) => c.url.includes('/repositories')).map((c) => c.auth);
      expect(repoAuths.at(-1)).toBe(`Bearer ${rotated}`);
    } finally {
      s.dispose();
    }
  });

  test('a 401 whose refresh fails marks the connection disconnected and surfaces the 401', async () => {
    const { s, gh } = boot();
    try {
      const { access, refresh } = await connect(s, gh);
      gh.revokeAccess(access);
      gh.revoke(refresh);
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        gh.fetch,
      );
      const res = await wrapped(`https://api.github.com${REPOS_PATH}`, {
        headers: { authorization: `Bearer ${access}` },
      });
      expect(res.status).toBe(401);
      expect(refreshCallsOf(gh)).toHaveLength(1);
      const status = readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id);
      expect(status.connected).toBe(false);
      expect(status.disconnectReason).toContain('refresh');
    } finally {
      s.dispose();
    }
  });

  test('a team-scoped 401 refresh rotates only that team even when another team holds the same token', async () => {
    const { s, gh } = boot();
    try {
      const other = 'team-collide';
      s.db.insert(team).values({ id: other, name: 'other', createdAt: Date.now() }).run();
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        {
          teamId: other,
          login: 'octo',
          accessToken: 'gho_shared',
          refreshToken: 'ghr_scoped_b',
          scope: 'repo',
        },
      );
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        {
          teamId: s.team.id,
          login: 'octo',
          accessToken: 'gho_shared',
          refreshToken: 'ghr_scoped_a',
          scope: 'repo',
        },
      );
      gh.knowGrant('gho_shared', 'ghr_scoped_a');
      gh.knowGrant('gho_b_key', 'ghr_scoped_b');
      gh.revokeAccess('gho_shared');
      const otherBefore = s.db
        .select()
        .from(githubConnection)
        .where(eq(githubConnection.teamId, other))
        .get();
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        gh.fetch,
        s.team.id,
      );
      const res = await wrapped(`https://api.github.com${REPOS_PATH}`, {
        headers: { authorization: 'Bearer gho_shared' },
      });
      expect(res.status).toBe(200);
      const refreshCalls = refreshCallsOf(gh);
      expect(refreshCalls).toHaveLength(1);
      expect(refreshCalls[0]?.form.get('refresh_token')).toBe('ghr_scoped_a');
      const otherAfter = s.db
        .select()
        .from(githubConnection)
        .where(eq(githubConnection.teamId, other))
        .get();
      expect(otherAfter).toEqual(otherBefore);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).not.toBe('gho_shared');
    } finally {
      s.dispose();
    }
  });

  test('an unscoped 401 refresh passes through when two teams hold the same token', async () => {
    const { s, gh } = boot();
    try {
      const other = 'team-collide';
      s.db.insert(team).values({ id: other, name: 'other', createdAt: Date.now() }).run();
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        {
          teamId: other,
          login: 'octo',
          accessToken: 'gho_shared',
          refreshToken: 'ghr_scoped_b',
          scope: 'repo',
        },
      );
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        {
          teamId: s.team.id,
          login: 'octo',
          accessToken: 'gho_shared',
          refreshToken: 'ghr_scoped_a',
          scope: 'repo',
        },
      );
      gh.knowGrant('gho_shared', 'ghr_scoped_a');
      gh.knowGrant('gho_b_key', 'ghr_scoped_b');
      gh.revokeAccess('gho_shared');
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        gh.fetch,
      );
      const res = await wrapped(`https://api.github.com${REPOS_PATH}`, {
        headers: { authorization: 'Bearer gho_shared' },
      });
      expect(res.status).toBe(401);
      expect(refreshCallsOf(gh)).toHaveLength(0);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe('gho_shared');
      expect(openGithubToken({ db: s.db, box: s.secretBox }, other)).toBe('gho_shared');
    } finally {
      s.dispose();
    }
  });

  test('a stale refresh cannot overwrite a replacement connection row', async () => {
    const { s } = boot();
    try {
      const deps = { db: s.db, box: s.secretBox };
      upsertGithubConnection(deps, {
        teamId: s.team.id,
        login: 'octo',
        accessToken: 'gho_old',
        refreshToken: 'ghr_old',
        scope: 'repo',
      });
      const stale = s.db
        .select()
        .from(githubConnection)
        .where(eq(githubConnection.teamId, s.team.id))
        .get();
      expect(stale).toBeDefined();
      upsertGithubConnection(deps, {
        teamId: s.team.id,
        login: 'octo',
        accessToken: 'gho_new',
        refreshToken: 'ghr_new',
        scope: 'repo',
      });
      s.db
        .update(githubConnection)
        .set({ createdAt: stale!.createdAt + 1 })
        .where(eq(githubConnection.teamId, s.team.id))
        .run();
      saveRefreshedTokens(deps, stale!, {
        accessToken: 'gho_stale_rotated',
        refreshToken: 'ghr_stale',
        expiresInSeconds: 3600,
      });
      expect(openGithubToken(deps, s.team.id)).toBe('gho_new');
    } finally {
      s.dispose();
    }
  });

  test('binding a github project survives a probe-triggered rotation on the same connection', async () => {
    const gh = githubAuthFake({
      user: OCTO,
      repos: [
        { id: 1, name: 'alpha', full_name: 'octo/alpha', private: false, owner: { login: 'octo' } },
      ],
    });
    let staleAccess = '';
    let probeCalls = 0;
    const probeFetch: FetchLike = async (input, init) => {
      if (String(input).includes('/repos/')) {
        probeCalls += 1;
        if (staleAccess !== '' && init?.headers?.authorization === `Bearer ${staleAccess}`) {
          return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
        }
        return new Response(JSON.stringify({ full_name: 'octo/alpha' }), { status: 200 });
      }
      return gh.fetch(input, init);
    };
    const s = bootServer({ oauthClient: CLIENT, oauthFetch: gh.fetch, githubFetch: probeFetch });
    try {
      const { access } = await connect(s, gh);
      staleAccess = access;
      gh.revokeAccess(access);
      const res = await req(s.app, 'POST', '/api/projects', {
        name: 'bound-repo',
        kind: 'github',
        githubRepo: 'octo/alpha',
      });
      expect(res.status).toBe(201);
      expect(probeCalls).toBe(2);
      expect(refreshCallsOf(gh)).toHaveLength(1);
      const row = connectionRow(s);
      expect(row?.connectionGeneration).toBeNull();
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).not.toBe(access);
    } finally {
      s.dispose();
    }
  });

  test('GET /api/github/repos retries on 401 through the requesting team connection only', async () => {
    const gh = githubAuthFake({
      user: OCTO,
      repos: [
        { id: 1, name: 'alpha', full_name: 'octo/alpha', private: false, owner: { login: 'octo' } },
      ],
    });
    let inner: FetchLike = gh.fetch;
    const s = bootServer({
      oauthClient: CLIENT,
      oauthFetch: gh.fetch,
      githubBaseFetch: gh.fetch,
      githubFetch: (input, init) => inner(input, init),
    });
    try {
      inner = refreshingGithubFetch({ db: s.db, box: s.secretBox, oauthClient: CLIENT }, gh.fetch);
      const other = 'team-collide';
      s.db.insert(team).values({ id: other, name: 'other', createdAt: Date.now() }).run();
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        {
          teamId: other,
          login: 'octo',
          accessToken: 'gho_shared',
          refreshToken: 'ghr_scoped_b',
          scope: 'repo',
        },
      );
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        { teamId: s.team.id, login: 'octo', accessToken: 'gho_shared', scope: 'repo' },
      );
      gh.knowGrant('gho_shared', 'ghr_scoped_b');
      gh.revokeAccess('gho_shared');
      const res = await reposRequest(s);
      expect(res.status).toBe(502);
      expect(refreshCallsOf(gh)).toHaveLength(0);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, other)).toBe('gho_shared');
    } finally {
      s.dispose();
    }
  });

  test('a listing whose stale token another request already rotated retries on the shared replacement', async () => {
    const { s, gh } = boot();
    try {
      const { access } = await connect(s, gh);
      gh.revokeAccess(access);
      const deps = { db: s.db, box: s.secretBox, oauthClient: CLIENT };
      const second = refreshingGithubFetch(
        deps,
        async (input, init) => {
          if (init?.headers?.authorization === `Bearer ${access}`) {
            await githubUserRepos(refreshingGithubFetch(deps, gh.fetch, s.team.id), access);
            return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
          }
          return gh.fetch(input, init);
        },
        s.team.id,
      );
      const repos = await githubUserRepos(second, access);
      expect(repos).toHaveLength(1);
      const rotated = [...gh.grants.keys()].at(-1);
      expect(rotated).not.toBe(access);
      const repoAuths = gh.calls.filter((c) => c.url.includes(REPOS_PATH)).map((c) => c.auth);
      expect(repoAuths).toEqual([`Bearer ${access}`, `Bearer ${rotated}`, `Bearer ${rotated}`]);
      expect(refreshCallsOf(gh)).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('a rotated token is not substituted once the connection row is replaced', async () => {
    const { s, gh } = boot();
    try {
      const { access } = await connect(s, gh);
      gh.revokeAccess(access);
      const seen: (string | undefined)[] = [];
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        async (input, init) => {
          seen.push(init?.headers?.authorization);
          return gh.fetch(input, init);
        },
      );
      const repos = await githubUserRepos(wrapped, access);
      expect(repos).toHaveLength(1);
      upsertGithubConnection(
        { db: s.db, box: s.secretBox },
        {
          teamId: s.team.id,
          login: 'octo',
          accessToken: 'gho_reconnected',
          refreshToken: 'ghr_reconnected',
          scope: 'repo',
        },
      );
      const res = await wrapped(`https://api.github.com${REPOS_PATH}`, {
        headers: { authorization: `Bearer ${access}` },
      });
      expect(res.status).toBe(401);
      expect(seen.at(-1)).toBe(`Bearer ${access}`);
      expect(refreshCallsOf(gh)).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('a rotated token is not substituted once the connection is disconnected', async () => {
    const { s, gh } = boot();
    try {
      const { access } = await connect(s, gh);
      gh.revokeAccess(access);
      const seen: (string | undefined)[] = [];
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        async (input, init) => {
          seen.push(init?.headers?.authorization);
          return gh.fetch(input, init);
        },
      );
      const repos = await githubUserRepos(wrapped, access);
      expect(repos).toHaveLength(1);
      markGithubConnectionDisconnected(
        { db: s.db, box: s.secretBox },
        s.team.id,
        'reconnect later',
      );
      const res = await wrapped(`https://api.github.com${REPOS_PATH}`, {
        headers: { authorization: `Bearer ${access}` },
      });
      expect(res.status).toBe(401);
      expect(seen.at(-1)).toBe(`Bearer ${access}`);
      expect(refreshCallsOf(gh)).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('a 401 for an app without refresh tokens passes through untouched', async () => {
    const { s, gh } = boot();
    try {
      const { access } = await connect(s, gh, false);
      gh.revokeAccess(access);
      const wrapped = refreshingGithubFetch(
        { db: s.db, box: s.secretBox, oauthClient: CLIENT },
        gh.fetch,
      );
      const res = await wrapped(`https://api.github.com${REPOS_PATH}`, {
        headers: { authorization: `Bearer ${access}` },
      });
      expect(res.status).toBe(401);
      expect(refreshCallsOf(gh)).toHaveLength(0);
      expect(readGithubConnectionStatus({ db: s.db, box: s.secretBox }, s.team.id).connected).toBe(
        true,
      );
    } finally {
      s.dispose();
    }
  });
});
