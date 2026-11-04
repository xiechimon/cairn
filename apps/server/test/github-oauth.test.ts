import { describe, expect, test } from 'vitest';
import type { AppContext } from '../src/context.js';
import type { FetchLike } from '../src/lib/github.js';
import { openGithubToken } from '../src/services/github-connection.js';
import { bootServer, req, type TestServer } from './helpers.js';

const TOKEN = 'ghu_connection_token_value';
const SECOND_TOKEN = 'ghu_second_connection_token';
const CLIENT = { clientId: 'cid-test', clientSecret: 'cs-test' };
const ORIGIN = 'http://127.0.0.1:8787';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

interface UpstreamScript {
  token?: { status?: number; json?: unknown };
  user?: { status?: number; json?: unknown };
  throwUrls?: string[];
}

function mockUpstream(script: UpstreamScript) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      headers: { ...(init?.headers ?? {}) },
      body: init?.body ?? '',
    });
    if (script.throwUrls?.some((prefix) => url.startsWith(prefix))) {
      throw new Error('network down');
    }
    const entry = url.startsWith(TOKEN_URL) ? script.token : script.user;
    const status = entry?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => entry?.json,
      text: async () => JSON.stringify(entry?.json ?? null),
    };
  };
  return { calls, fetchImpl };
}

const HAPPY: UpstreamScript = {
  token: { json: { access_token: TOKEN, scope: 'read:user,repo', token_type: 'bearer' } },
  user: { json: { login: 'octocat', id: 1 } },
};

function boot(script: UpstreamScript, opts: { client?: AppContext['oauthClient'] } = {}) {
  const mock = mockUpstream(script);
  const s = bootServer({
    oauthClient: opts.client === undefined ? CLIENT : opts.client,
    oauthFetch: mock.fetchImpl as AppContext['oauthFetch'],
  });
  return { s, mock };
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
    const { s } = boot(HAPPY, { client: null });
    try {
      const { res, body } = await authorizeConnection(s);
      expect(res.status).toBe(400);
      expect(body.error).toContain('CAIRN_GITHUB_OAUTH_CLIENT_ID');
    } finally {
      s.dispose();
    }
  });

  test('2. happy: authorization URL carries all four params (scope = read:user repo) + state registered', async () => {
    const { s } = boot(HAPPY);
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
    const { s } = boot(HAPPY);
    try {
      const res = await statusOf(s);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ connected: false });
    } finally {
      s.dispose();
    }
  });

  test('3b. connected -> {connected:true,login,scope}; unknown team -> 404', async () => {
    const { s } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      await callback(s, `code=c&state=${state}`);
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
    const { s, mock } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `code=mockcode&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=connected&github=connection`,
      );
      const tokenCall = mock.calls.find((c) => c.url === TOKEN_URL);
      expect(tokenCall?.body).toContain('code=mockcode');
      expect(tokenCall?.body).toContain(`client_id=${CLIENT.clientId}`);
      const userCall = mock.calls.find((c) => c.url === USER_URL);
      expect(userCall?.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(userCall?.url).not.toContain(TOKEN);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(TOKEN);
      const status = (await (await statusOf(s)).json()) as Record<string, unknown>;
      expect(status.login).toBe('octocat');
      expect(status.scope).toBe('read:user,repo');
    } finally {
      s.dispose();
    }
  });

  test('5. exchange succeeded but GET /user failed -> 302 reason=exchange', async () => {
    const { s } = boot({ ...HAPPY, user: { status: 500, json: { message: 'boom' } } });
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `code=c&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=error&reason=exchange&github=connection`,
      );
    } finally {
      s.dispose();
    }
  });

  test('6. user declined -> 302 reason=denied&github=connection + state consumed + token endpoint not called', async () => {
    const { s, mock } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `error=access_denied&state=${state}`);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(
        `${ORIGIN}/app/project/new?oauth=error&reason=denied&github=connection`,
      );
      expect(s.oauthStates.has(state as string)).toBe(false);
      expect(mock.calls).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });

  test('7. connection state expired -> 302 reason=state&github=connection', async () => {
    const { s } = boot(HAPPY);
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
    const { s } = boot(HAPPY);
    try {
      const res = await callback(s, 'code=c&state=bogus');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/app/resources/providers?oauth=error&reason=state');
    } finally {
      s.dispose();
    }
  });

  test('9. provider family regression: provider state still lands on the providers page (two families do not cross)', async () => {
    const { s } = boot(HAPPY);
    try {
      const res = await s.app.request(
        `/api/teams/${s.team.id}/providers/oauth/github-copilot/authorize`,
        { method: 'POST', headers: { origin: ORIGIN } },
      );
      const body = (await res.json()) as { authorizationUrl: string };
      const state = new URL(body.authorizationUrl).searchParams.get('state');
      const landed = await callback(s, `code=c&state=${state}`);
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
    const script: UpstreamScript = {
      token: { json: { access_token: TOKEN, scope: 'read:user,repo' } },
      user: { json: { login: 'octocat' } },
    };
    const { s } = boot(script);
    try {
      const a1 = await authorizeConnection(s);
      await callback(s, `code=c1&state=${a1.state}`);
      script.token = { json: { access_token: SECOND_TOKEN, scope: 'repo' } };
      script.user = { json: { login: 'octocat2' } };
      const a2 = await authorizeConnection(s);
      const res = await callback(s, `code=c2&state=${a2.state}`);
      expect(res.status).toBe(302);
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBe(SECOND_TOKEN);
      const status = (await (await statusOf(s)).json()) as Record<string, unknown>;
      expect(status).toEqual({ connected: true, login: 'octocat2', scope: 'repo' });
    } finally {
      s.dispose();
    }
  });

  test('12. token never enters the wire: status JSON and 302 Location both contain no plaintext', async () => {
    const { s } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      const res = await callback(s, `code=c&state=${state}`);
      expect(res.headers.get('location') ?? '').not.toContain(TOKEN);
      const statusRes = await statusOf(s);
      const raw = await statusRes.text();
      expect(raw).not.toContain(TOKEN);
      expect(raw).not.toContain('v1:');
    } finally {
      s.dispose();
    }
  });
});

describe('DELETE /api/teams/:id/github/connection (disconnect)', () => {
  test('11a. row present -> 204 + status back to connected:false + token read-out point null', async () => {
    const { s } = boot(HAPPY);
    try {
      const { state } = await authorizeConnection(s);
      await callback(s, `code=c&state=${state}`);
      const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/github/connection`);
      expect(res.status).toBe(204);
      expect(await (await statusOf(s)).json()).toEqual({ connected: false });
      expect(openGithubToken({ db: s.db, box: s.secretBox }, s.team.id)).toBeNull();
    } finally {
      s.dispose();
    }
  });

  test('11b. no row -> 204 idempotent; unknown team -> 404', async () => {
    const { s } = boot(HAPPY);
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
