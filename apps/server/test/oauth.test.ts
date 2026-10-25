import { describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context.js';
import { openProviderKey } from '../src/services/providers.js';
import { bootServer, req, type TestServer } from './helpers.js';

function mockOAuthFetch(script: { status?: number; json?: unknown; throw?: boolean }) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = async (input: string | URL, init?: { body?: string }) => {
    calls.push({ url: String(input), body: init?.body ?? '' });
    if (script.throw) throw new Error('network down');
    const status = script.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => script.json,
      text: async () => JSON.stringify(script.json),
    };
  };
  return { calls, fetchImpl };
}

const CLIENT = { clientId: 'cid-test', clientSecret: 'cs-test' };
const ORIGIN = 'http://127.0.0.1:8787';

function bootOAuth(
  script: Parameters<typeof mockOAuthFetch>[0],
  opts: { client?: AppContext['oauthClient'] } = {},
) {
  const mock = mockOAuthFetch(script);
  const s = bootServer({
    oauthClient: opts.client === undefined ? CLIENT : opts.client,
    oauthFetch: mock.fetchImpl as AppContext['oauthFetch'],
  });
  return { s, mock };
}

async function authorize(s: TestServer, preset = 'github-copilot') {
  const res = await s.app.request(`/api/teams/${s.team.id}/providers/oauth/${preset}/authorize`, {
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

describe('POST /api/teams/:id/providers/oauth/:preset/authorize', () => {
  it('1. unknown family -> 404', async () => {
    const { s } = bootOAuth({ json: {} });
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/providers/oauth/anthropic/authorize`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('anthropic');
  });

  it('2. oauth not configured -> 400', async () => {
    const { s } = bootOAuth({ json: {} }, { client: null });
    const { res, body } = await authorize(s);
    expect(res.status).toBe(400);
    expect(body.error).toContain('CAIRN_GITHUB_OAUTH_CLIENT_ID');
  });

  it('3. happy: issues the authorization URL with all four params + state registered', async () => {
    const { s } = bootOAuth({ json: {} });
    const { res, url, state } = await authorize(s);
    expect(res.status).toBe(200);
    if (!url) throw new Error('authorizationUrl missing');
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url?.searchParams.get('client_id')).toBe(CLIENT.clientId);
    expect(url?.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/oauth/callback`);
    expect(url?.searchParams.get('scope')).toBe('read:user');
    expect(state).toBeTruthy();
    expect(s.oauthStates.has(state as string)).toBe(true);
  });
});

describe('GET /api/oauth/callback', () => {
  it('4. state not registered -> 302 relative back to the providers page reason=state', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_x' } });
    const res = await callback(s, 'code=c1&state=bogus');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app/resources/providers?oauth=error&reason=state');
  });

  it('5. state expired -> 302 back to entry.origin reason=state', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_x' } });
    const { state } = await authorize(s);
    ageState(s, state, 31);
    const res = await callback(s, `code=c1&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=error&reason=state`,
    );
  });

  it('6. state single-use consumed: second visit -> 302 reason=state', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_once' } });
    const { state } = await authorize(s);
    const first = await callback(s, `code=c1&state=${state}`);
    expect(first.status).toBe(302);
    const second = await callback(s, `code=c1&state=${state}`);
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toBe(
      '/app/resources/providers?oauth=error&reason=state',
    );
  });

  it('7. happy full chain: 302 back to the providers page + token sealed and persisted + GET projection has no token', async () => {
    const { s, mock } = bootOAuth({
      json: { access_token: 'gho_mocktoken', token_type: 'bearer' },
    });
    const { state } = await authorize(s);
    const res = await callback(s, `code=mockcode&state=${state}`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toBe(
      `${ORIGIN}/app/resources/providers?oauth=connected&provider=github-copilot`,
    );
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.url).toBe('https://github.com/login/oauth/access_token');
    expect(mock.calls[0]?.body).toContain('code=mockcode');
    expect(mock.calls[0]?.body).toContain(`client_id=${CLIENT.clientId}`);
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'github-copilot');
    expect(opened?.apiKey).toBe('gho_mocktoken');
    const list = await req(s.app, 'GET', `/api/teams/${s.team.id}/providers`);
    const envelope = (await list.json()) as { providers: Record<string, unknown>[] };
    const row = envelope.providers.find((p) => p.providerId === 'github-copilot');
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('gho_mocktoken');
    expect(row).not.toHaveProperty('apiKey');
  });

  it('8. reconnect: same row re-sealed, no extra row', async () => {
    const script: { json: unknown } = { json: { access_token: 'gho_first' } };
    const mock = mockOAuthFetch(script);
    const s = bootServer({
      oauthClient: CLIENT,
      oauthFetch: mock.fetchImpl as AppContext['oauthFetch'],
    });
    const a1 = await authorize(s);
    await callback(s, `code=c1&state=${a1.state}`);
    script.json = { access_token: 'gho_second' };
    const a2 = await authorize(s);
    const res = await callback(s, `code=c2&state=${a2.state}`);
    expect(res.status).toBe(302);
    const list = await req(s.app, 'GET', `/api/teams/${s.team.id}/providers`);
    const envelope = (await list.json()) as { providers: { providerId: string }[] };
    expect(envelope.providers.filter((p) => p.providerId === 'github-copilot')).toHaveLength(1);
    const opened = openProviderKey({ db: s.db, box: s.secretBox }, s.team.id, 'github-copilot');
    expect(opened?.apiKey).toBe('gho_second');
    expect(mock.calls).toHaveLength(2);
  });

  it('9. upstream exchange not ok -> 302 error=exchange', async () => {
    const { s } = bootOAuth({ status: 400, json: { error: 'bad_verification_code' } });
    const { state } = await authorize(s);
    const res = await callback(s, `code=bad&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=error&reason=exchange`,
    );
  });

  it('10. upstream 200 but missing access_token -> 302 error=exchange', async () => {
    const { s } = bootOAuth({ json: { token_type: 'bearer' } });
    const { state } = await authorize(s);
    const res = await callback(s, `code=c&state=${state}`);
    expect(res.headers.get('location')).toContain('oauth=error&reason=exchange');
  });

  it('11. fetch throws (network down) -> 302 error=exchange', async () => {
    const { s } = bootOAuth({ throw: true });
    const { state } = await authorize(s);
    const res = await callback(s, `code=c&state=${state}`);
    expect(res.headers.get('location')).toContain('oauth=error&reason=exchange');
  });

  it('12. user declines on GitHub -> 302 error=denied + state consumed', async () => {
    const { s, mock } = bootOAuth({ json: { access_token: 'gho_x' } });
    const { state } = await authorize(s);
    const res = await callback(s, `error=access_denied&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=error&reason=denied`,
    );
    expect(s.oauthStates.has(state as string)).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });

  it('13. persisted row shape: family template + record projection without apiKey', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_shape' } });
    const { state } = await authorize(s);
    await callback(s, `code=c&state=${state}`);
    const list = await req(s.app, 'GET', `/api/teams/${s.team.id}/providers`);
    const envelope = (await list.json()) as { providers: Record<string, unknown>[] };
    const row = envelope.providers.find((p) => p.providerId === 'github-copilot');
    expect(row?.kind).toBe('custom');
    expect(row?.authHeader).toBe(true);
    expect(row?.api).toBe('openai-completions');
    expect(row?.baseUrl).toBe('https://api.githubcopilot.com');
    expect(row?.models).toEqual([]);
    expect(row).not.toHaveProperty('apiKey');
  });

  it('14. state within the window (29min) -> connected normally (TTL human-loop window behavior pinned)', async () => {
    const { s } = bootOAuth({ json: { access_token: 'gho_window' } });
    const { state } = await authorize(s);
    ageState(s, state, 29);
    const res = await callback(s, `code=c1&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=connected&provider=github-copilot`,
    );
  });

  it('15. denied path + state expired -> 302 reason=state (abort same law)', async () => {
    const { s, mock } = bootOAuth({ json: { access_token: 'gho_x' } });
    const { state } = await authorize(s);
    ageState(s, state, 31);
    const res = await callback(s, `error=access_denied&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/app/resources/providers?oauth=error&reason=state`,
    );
    expect(mock.calls).toHaveLength(0);
  });
});
