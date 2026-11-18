import { describe, expect, test } from 'vitest';
import type { AppContext } from '../src/context.js';
import { githubConnection } from '../src/db/schema.js';
import { openGithubToken } from '../src/services/github-connection.js';
import { type GithubAuthFake, githubAuthFake } from './fakes/github-auth.js';
import { bootServer, req, type TestServer } from './helpers.js';

const CLIENT = { clientId: 'cid-test', clientSecret: 'cs-test' };
const ORIGIN = 'http://127.0.0.1:8787';
const OCTO = { id: 1, login: 'octocat', name: null };

function boot(opts: { client?: AppContext['oauthClient'] } = {}) {
  const gh = githubAuthFake({ user: OCTO });
  const s = bootServer({
    oauthClient: opts.client === undefined ? CLIENT : opts.client,
    oauthFetch: gh.fetch as AppContext['oauthFetch'],
    githubFetch: gh.fetch,
  });
  return { s, gh };
}

async function authorizeConnection(s: TestServer) {
  const res = await s.app.request(`/api/teams/${s.team.id}/github/oauth/authorize`, {
    method: 'POST',
    headers: { origin: ORIGIN },
  });
  const body = (await res.json()) as { authorizationUrl?: string; error?: string };
  const url = body.authorizationUrl ? new URL(body.authorizationUrl) : null;
  return { res, body, url, state: url?.searchParams.get('state') ?? null };
}

function callback(s: TestServer, query: string) {
  return s.app.request(`/api/oauth/callback?${query}`, { redirect: 'manual' });
}

async function connect(
  s: TestServer,
  gh: GithubAuthFake,
  opts: Parameters<GithubAuthFake['issueAuthCode']>[1] = {},
) {
  const { state } = await authorizeConnection(s);
  const code = gh.issueAuthCode(undefined, { scope: 'read:user,repo', ...opts });
  const res = await callback(s, `code=${encodeURIComponent(code)}&state=${state}`);
  return { res, grant: [...gh.grants.keys()].at(-1) };
}

function ageState(s: TestServer, state: string | null, minutesAgo: number) {
  if (state === null) throw new Error('state missing');
  const entry = s.oauthStates.get(state);
  if (!entry) throw new Error('state missing');
  entry.createdAt -= minutesAgo * 60 * 1000;
}

function statusOf(s: TestServer) {
  return req(s.app, 'GET', `/api/teams/${s.team.id}/github/connection`);
}

describe('POST /api/teams/:id/github/oauth/authorize (connection family issuance)', () => {
  test('1. oauth not configured -> 400 (not-configured family carried over, env slot name in the message)', async () => {
    const { s } = boot({ client: null });
    try {
      const { res, body } = await authorizeConnection(s);
      expect(res.status).toBe(400);
      expect(body.error).toContain('CAIRN_GITHUB_OAUTH_CLIENT_ID');
    } finally {
      s.dispose();
    }
  });

  test('2. happy: authorization URL carries all four params (scope = read:user repo) + state registered', async () => {
    const { s } = boot();
    try {
      const { res, url, state } = await authorizeConnection(s);
      expect(res.status).toBe(200);
      if (!url) throw new Error('authorizationUrl missing');
      expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe(CLIENT.clientId);
      expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/oauth/callback`);
      expect(url.searchParams.get('scope')).toBe('read:user repo');
      expect(state).toBeTruthy();
      expect(s.oauthStates.has(state as string)).toBe(true);
    } finally {
      s.dispose();
    }
  });
});

describe('GET /api/teams/:id/github/connection (auth state read surface)', () => {
  test('3a. not connected -> {connected:false}, no login/scope slots', async () => {
    const { s } = boot();
    try {
      const res = await statusOf(s);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ connected: false });
    } finally {
      s.dispose();
    }
  });

  test('3b. connected -> {connected:true,login,scope}; unknown team -> 404', async () => {
    const { s, gh } = boot();
    try {
      await connect(s, gh);
      const res = await statusOf(s);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ connected: true, login: 'octocat', scope: 'read:user,repo' });
      const unknown = await req(s.app, 'GET', '/api/teams/nope/github/connection');
      expect(unknown.status).toBe(404);
    } finally {
      s.dispose();
    }
  });
});

describe('GET /api/oauth/callback (github-connection family branch)', () => {
  test('4. happy full chain: 302 to the new-project page + row established + granted scope persisted + token only in the header', async () => {
    const { s, gh } = boot();
    try {
      const { res, grant } = await connect(s, gh);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=connected&github=connection`,
      );
      const tokenCall = gh.calls.find((c) => c.url.endsWith('/login/oauth/access_token'));
      expect(tokenCall?.form.get('code')).not.toBeNull();
      expect(tokenCall?.form.get('client_id')).toBe(CLIENT.clientId);
      const userCall = gh.calls.find((c) => c.url.endsWith('/user'));
      expect(userCall?.auth).toBe(`Bearer ${grant}`);
      expect(userCall?.url).not.toContain(String(grant));
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(grant);
      const status = (await (await statusOf(s)).json()) as Record<string, unknown>;
      expect(status.login).toBe('octocat');
      expect(status.scope).toBe('read:user,repo');
      expect(s.db.select().from(githubConnection).get()?.githubUserId).toBe(1);
      expect(await (await req(s.app, 'GET', '/api/user/me')).json()).toMatchObject({
        displayName: 'octocat',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
      });
    } finally {
      s.dispose();
    }
  });

  test('5. exchange succeeded but GET /user failed -> 302 reason=exchange', async () => {
    const { s, gh } = boot();
    gh.setPathFault('/user', 500, { message: 'boom' });
    try {
      const { res } = await connect(s, gh);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=error&reason=exchange&github=connection`,
      );
    } finally {
      s.dispose();
    }
  });

  test('6. user declined -> 302 reason=denied&github=connection + state consumed + token endpoint not called', async () => {
    const { s, gh } = boot();
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `error=access_denied&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=error&reason=denied&github=connection`,
      );
      expect(s.oauthStates.has(state as string)).toBe(false);
      expect(gh.calls).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });

  test('6b. an unknown code is rejected by GitHub -> 302 reason=exchange', async () => {
    const { s } = boot();
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `code=not-issued&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=error&reason=exchange&github=connection`,
      );
    } finally {
      s.dispose();
    }
  });

  test('7. connection state expired -> 302 reason=state&github=connection', async () => {
    const { s } = boot();
    try {
      const { state } = await authorizeConnection(s);
      ageState(s, state, 31);
      const res = await callback(s, `code=c&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=error&reason=state&github=connection`,
      );
    } finally {
      s.dispose();
    }
  });

  test('8. state not registered (kind undecidable) -> 302 lands on the providers page (existing default unchanged)', async () => {
    const { s } = boot();
    try {
      const res = await callback(s, 'code=c&state=bogus');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/app/resources/providers?oauth=error&reason=state');
    } finally {
      s.dispose();
    }
  });

  test('9. provider family regression: provider state still lands on the providers page (two families do not cross)', async () => {
    const { s, gh } = boot();
    try {
      const res = await s.app.request(
        `/api/teams/${s.team.id}/providers/oauth/github-copilot/authorize`,
        { method: 'POST', headers: { origin: ORIGIN } },
      );
      const body = (await res.json()) as { authorizationUrl: string };
      const state = new URL(body.authorizationUrl).searchParams.get('state');
      const code = gh.issueAuthCode();
      const landed = await callback(s, `code=${encodeURIComponent(code)}&state=${state}`);
      expect(landed.status).toBe(302);
      expect(landed.headers.get('location')).toBe(
        `${ORIGIN}/app/resources/providers?oauth=connected&provider=github-copilot`,
      );
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('10. reauth = overwrite: second happy new token/login -> single row new value effective', async () => {
    const { s, gh } = boot();
    try {
      await connect(s, gh);
      const { state } = await authorizeConnection(s);
      const code = gh.issueAuthCode({ id: 2, login: 'octocat2', name: null }, { scope: 'repo' });
      const res = await callback(s, `code=${encodeURIComponent(code)}&state=${state}`);
      expect(res.status).toBe(302);
      const second = [...gh.grants.keys()].at(-1);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(second);
      const status = (await (await statusOf(s)).json()) as Record<string, unknown>;
      expect(status).toEqual({ connected: true, login: 'octocat2', scope: 'repo' });
    } finally {
      s.dispose();
    }
  });

  test('12. token never enters the wire: status JSON and 302 Location both contain no plaintext', async () => {
    const { s, gh } = boot();
    try {
      const { res, grant } = await connect(s, gh);
      expect(res.headers.get('location') ?? '').not.toContain(String(grant));
      const statusRes = await statusOf(s);
      const raw = await statusRes.text();
      expect(raw).not.toContain(String(grant));
      expect(raw).not.toContain('v1:');
    } finally {
      s.dispose();
    }
  });
});

describe('DELETE /api/teams/:id/github/connection (disconnect)', () => {
  test('11a. row present -> 204 + status back to connected:false + token read-out point null', async () => {
    const { s, gh } = boot();
    try {
      await connect(s, gh);
      const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/github/connection`);
      expect(res.status).toBe(204);
      expect(await (await statusOf(s)).json()).toEqual({ connected: false });
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('11b. no row -> 204 idempotent; unknown team -> 404', async () => {
    const { s } = boot();
    try {
      const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/github/connection`);
      expect(res.status).toBe(204);
      const unknown = await req(s.app, 'DELETE', '/api/teams/nope/github/connection');
      expect(unknown.status).toBe(404);
    } finally {
      s.dispose();
    }
  });
});
