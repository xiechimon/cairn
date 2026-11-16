import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { machineTokenResponseSchema, mcpConnectorRecordSchema } from '@cairn/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { eq } from 'drizzle-orm';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { mcpConnector, step as stepTable } from '../src/db/schema.js';
import { isOwnerOnlyRoute } from '../src/lib/token-auth.js';
import { pollGithubConnectorDevice } from '../src/services/mcp-github-connector.js';
import {
  checkMcpConnector,
  createMcpConnector,
  createPublicOAuthFetch,
  type GithubAppRegistration,
  type McpConnectorDeps,
  refreshMcpConnectorToken,
  stepConnectorEndpoints,
  updateMcpConnector,
} from '../src/services/mcp-servers.js';
import {
  bootServer,
  enrollConnectorRunner,
  postProject,
  queueConnectorStep,
  req,
  seedSessionRoute,
} from './helpers.js';

interface Seen {
  url: string;
  headers: Record<string, string>;
}

function fakeMcp(
  opts: { token?: string; status?: number; gate?: Promise<void>; redirect?: string } = {},
) {
  const seen: Seen[] = [];
  const mcpFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push({ url: request.url, headers: Object.fromEntries(request.headers) });
    await opts.gate;
    if (opts.redirect !== undefined) {
      if (init?.redirect !== 'manual') throw new Error('redirect would be followed');
      return new Response(null, { status: 307, headers: { location: opts.redirect } });
    }
    if (opts.status !== undefined)
      return new Response('upstream echo Bearer leak', { status: opts.status });
    if (opts.token !== undefined && request.headers.get('authorization') !== `Bearer ${opts.token}`)
      return new Response('nope', { status: 401 });
    const server = new McpServer({ name: 'fake', version: '1.0.0' });
    server.registerTool('one', { description: 'one' }, async () => ({ content: [] }));
    server.registerTool('two', { description: 'two' }, async () => ({ content: [] }));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  }) as typeof globalThis.fetch;
  return { fetch: mcpFetch, seen };
}

function boot(
  fetch: typeof globalThis.fetch,
  claudeJson?: unknown,
  githubApp?: GithubAppRegistration,
) {
  const dir = makeTestTempDir('cairn-mcp-conn-');
  const mcpConfigPath = join(dir, 'claude.json');
  if (claudeJson !== undefined) writeFileSync(mcpConfigPath, JSON.stringify(claudeJson));
  const s = bootServer({
    mcpFetch: fetch,
    mcpConfigPath,
    ...(githubApp !== undefined ? { mcpGithubApp: githubApp } : {}),
  });
  onTestFinished(() => s.dispose());
  const base = `/api/teams/${s.team.id}/mcp-connectors`;
  const deps: McpConnectorDeps = {
    db: s.db,
    box: s.secretBox,
    mcpConfigPath,
    fetch,
    oauthFetch: fetch,
    oauthState: s.mcpOAuthState,
    ...(githubApp !== undefined ? { githubApp } : {}),
  };
  return { s, base, deps };
}

describe('MCP connectors', () => {
  test('a custom connector is sealed, checked over MCP and listed without values or query', async () => {
    const mcp = fakeMcp({ token: 'tok-SECRET-1' });
    const { s, base } = boot(mcp.fetch);
    const res = await req(s.app, 'POST', base, {
      kind: 'custom',
      slug: 'acme',
      label: 'Acme',
      url: 'https://mcp.acme.test/mcp?key=QUERY-SECRET',
      headers: { Authorization: 'Bearer tok-SECRET-1' },
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    const record = mcpConnectorRecordSchema.parse(JSON.parse(text));
    expect(record).toMatchObject({
      slug: 'acme',
      url: 'https://mcp.acme.test/mcp',
      headerNames: ['Authorization'],
      status: 'connected',
      toolCount: 2,
      statusReason: null,
    });
    expect(mcp.seen[0]?.url).toBe('https://mcp.acme.test/mcp?key=QUERY-SECRET');
    const listed = await (await req(s.app, 'GET', base)).text();
    for (const body of [text, listed]) {
      expect(body).not.toContain('tok-SECRET-1');
      expect(body).not.toContain('QUERY-SECRET');
    }
    expect(s.db.select().from(mcpConnector).get()?.valuesCipher).not.toContain('tok-SECRET-1');
  });

  test('a rejected token is needs_auth and a server error is error, neither echoing the body', async () => {
    const denied = boot(fakeMcp({ token: 'right' }).fetch);
    const wrong = await req(denied.s.app, 'POST', denied.base, {
      kind: 'custom',
      slug: 'acme',
      label: 'Acme',
      url: 'https://mcp.acme.test/mcp',
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(await wrong.json()).toMatchObject({
      status: 'needs_auth',
      statusReason: 'unauthorized',
    });
    const broken = boot(fakeMcp({ status: 502 }).fetch);
    const failed = await req(broken.s.app, 'POST', broken.base, {
      kind: 'custom',
      slug: 'acme',
      label: 'Acme',
      url: 'https://mcp.acme.test/mcp',
    });
    const body = await failed.text();
    expect(JSON.parse(body)).toMatchObject({ status: 'error', statusReason: 'http_502' });
    expect(body).not.toContain('leak');
  });

  test('a redirect is not followed, so header values never leave the chosen origin', async () => {
    const mcp = fakeMcp({ redirect: 'http://10.0.0.5:8080/mcp' });
    const { s, base } = boot(mcp.fetch);
    const res = await req(s.app, 'POST', base, {
      kind: 'custom',
      slug: 'acme',
      label: 'Acme',
      url: 'https://mcp.acme.test/mcp',
      headers: { 'X-Api-Key': 'k1' },
    });
    expect(await res.json()).toMatchObject({ status: 'error', statusReason: 'http_307' });
    expect(mcp.seen.every((r) => r.url.startsWith('https://mcp.acme.test/'))).toBe(true);
  });

  test('catalog entries build their url and headers and enforce their auth kinds', async () => {
    const mcp = fakeMcp();
    const { s, base } = boot(mcp.fetch);
    const github = await req(s.app, 'POST', base, {
      kind: 'catalog',
      catalogId: 'github',
      slug: 'github',
      token: 'ghp_x',
      options: { readonly: 'true' },
    });
    expect(github.status).toBe(201);
    expect(mcp.seen[0]?.url).toBe('https://api.githubcopilot.com/mcp/');
    expect(mcp.seen[0]?.headers).toMatchObject({
      authorization: 'Bearer ghp_x',
      'x-mcp-readonly': 'true',
    });
    const supabase = await req(s.app, 'POST', base, {
      kind: 'catalog',
      catalogId: 'supabase',
      slug: 'supabase',
      token: 'sbp_x',
      options: { project: 'abc', readonly: 'true' },
    });
    expect(supabase.status).toBe(201);
    expect(mcp.seen.at(-1)?.url).toBe(
      'https://mcp.supabase.com/mcp?project_ref=abc&read_only=true',
    );
    const refusals = [
      { catalogId: 'github', slug: 'gh2' },
      { catalogId: 'notion', slug: 'notion' },
      { catalogId: 'notion', slug: 'notion', token: 't' },
      { catalogId: 'github', slug: 'gh3', token: 't', options: { readonly: 'yes' } },
      { catalogId: 'github', slug: 'gh4', token: 't', options: { unknown: 'true' } },
      { catalogId: 'github', slug: 'gh5', token: 't', options: { toolsets: 'repos\r\nX-Evil: 1' } },
    ];
    for (const body of refusals)
      expect((await req(s.app, 'POST', base, { kind: 'catalog', ...body })).status).toBe(400);
    const context7 = await req(s.app, 'POST', base, {
      kind: 'catalog',
      catalogId: 'context7',
      slug: 'context7',
    });
    expect(await context7.json()).toMatchObject({ headerNames: [], status: 'connected' });
  });

  test('slugs: reserved, duplicate and local entries are refused', async () => {
    const { s, base } = boot(fakeMcp().fetch, {
      mcpServers: { Linear: { url: 'https://mcp.linear.app/mcp' } },
    });
    const custom = (slug: string) =>
      req(s.app, 'POST', base, { kind: 'custom', slug, label: slug, url: 'https://x.test/mcp' });
    expect((await custom('cairn')).status).toBe(400);
    expect((await custom('Bad_Slug')).status).toBe(400);
    expect((await custom('linear')).status).toBe(409);
    expect((await custom('acme')).status).toBe(201);
    expect((await custom('acme')).status).toBe(409);
  });

  test('edits keep or require credentials by target, and delete removes the row', async () => {
    const mcp = fakeMcp();
    const { s, base } = boot(mcp.fetch);
    const custom = mcpConnectorRecordSchema.parse(
      await (
        await req(s.app, 'POST', base, {
          kind: 'custom',
          slug: 'acme',
          label: 'Acme',
          url: 'https://mcp.acme.test/mcp',
          headers: { 'X-Key': 'k1' },
        })
      ).json(),
    );
    const moved = await req(s.app, 'PATCH', `${base}/${custom.id}`, {
      url: 'https://other.test/mcp',
    });
    expect(moved.status).toBe(400);
    await req(s.app, 'PATCH', `${base}/${custom.id}`, { url: 'https://mcp.acme.test/v2' });
    expect(mcp.seen.at(-1)).toMatchObject({
      url: 'https://mcp.acme.test/v2',
      headers: { 'x-key': 'k1' },
    });
    const gh = mcpConnectorRecordSchema.parse(
      await (
        await req(s.app, 'POST', base, {
          kind: 'catalog',
          catalogId: 'github',
          slug: 'github',
          token: 'ghp_keep',
          options: { readonly: 'true' },
        })
      ).json(),
    );
    await req(s.app, 'PATCH', `${base}/${gh.id}`, { options: { toolsets: 'repos' } });
    expect(mcp.seen.at(-1)?.headers).toMatchObject({
      authorization: 'Bearer ghp_keep',
      'x-mcp-toolsets': 'repos',
    });
    expect(mcp.seen.at(-1)?.headers['x-mcp-readonly']).toBeUndefined();
    expect((await req(s.app, 'PATCH', `${base}/${gh.id}`, { url: 'https://x.test' })).status).toBe(
      400,
    );
    expect((await req(s.app, 'DELETE', `${base}/${gh.id}`)).status).toBe(204);
    expect((await req(s.app, 'DELETE', `${base}/${gh.id}`)).status).toBe(404);
  });

  test('a check that finishes after an edit does not overwrite the edited row', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { s, deps } = boot(fakeMcp({ gate }).fetch);
    const created = createMcpConnector(deps, s.team.id, {
      kind: 'custom',
      slug: 'acme',
      label: 'Acme',
      url: 'https://mcp.acme.test/mcp',
    });
    const check = checkMcpConnector(deps, s.team.id, created.id);
    updateMcpConnector(deps, s.team.id, created.id, { headers: { 'X-Key': 'new' } });
    release();
    expect(await check).toMatchObject({ status: 'unchecked', toolCount: null });
  });

  test('one deadline bounds the whole check, even when the server never answers', async () => {
    const real = fakeMcp().fetch;
    let calls = 0;
    const hang = ((input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return real(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }) as typeof globalThis.fetch;
    const { s, deps } = boot(hang);
    const created = createMcpConnector(deps, s.team.id, {
      kind: 'custom',
      slug: 'acme',
      label: 'Acme',
      url: 'https://mcp.acme.test/mcp',
    });
    const started = Date.now();
    const result = await checkMcpConnector({ ...deps, checkTimeoutMs: 300 }, s.team.id, created.id);
    expect(calls).toBeGreaterThan(1);
    expect(result).toMatchObject({ status: 'error', statusReason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  test('every write route is owner-only and reads are not', () => {
    const path = '/api/teams/t1/mcp-connectors';
    expect(isOwnerOnlyRoute('POST', path)).toBe(true);
    expect(isOwnerOnlyRoute('PATCH', `${path}/c1`)).toBe(true);
    expect(isOwnerOnlyRoute('DELETE', `${path}/c1`)).toBe(true);
    expect(isOwnerOnlyRoute('POST', `${path}/c1/check`)).toBe(true);
    expect(isOwnerOnlyRoute('POST', `${path}/oauth/start`)).toBe(true);
    expect(isOwnerOnlyRoute('GET', path)).toBe(false);
  });
});

const ORIGIN = 'http://127.0.0.1:8787';
const AS = 'https://auth.vendor.test';
const LINEAR = 'https://mcp.linear.app/mcp';

interface AuthWorldOptions {
  metadata?: Record<string, unknown>;
  resource?: string;
  authServer?: string;
  refresh?: 'ok' | 'invalid_grant' | 'invalid_client';
  oidc?: boolean;
  rejectClient?: string;
  refreshGate?: Promise<void>;
}

function authWorld(opts: AuthWorldOptions = {}) {
  const seen: { url: string; method: string; body: string }[] = [];
  const registrations: Record<string, unknown>[] = [];
  const tokenRequests: URLSearchParams[] = [];
  let generation = 0;
  let accessToken = 'none';
  const mcp = () => fakeMcp({ token: accessToken });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const issue = () => {
    generation += 1;
    accessToken = `at-${generation}`;
    return json({
      access_token: accessToken,
      refresh_token: `rt-${generation}`,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.clone().text() : '';
    seen.push({ url: url.href, method: request.method, body });
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp')
      return json({
        resource: opts.resource ?? LINEAR,
        authorization_servers: [opts.authServer ?? AS],
        scopes_supported: ['read'],
      });
    const metadataPath = opts.oidc
      ? '/.well-known/openid-configuration'
      : '/.well-known/oauth-authorization-server';
    if (url.origin === AS && url.pathname === metadataPath)
      return json({
        ...(opts.oidc
          ? {
              jwks_uri: `${AS}/jwks`,
              subject_types_supported: ['public'],
              id_token_signing_alg_values_supported: ['RS256'],
            }
          : {}),
        issuer: AS,
        authorization_endpoint: `${AS}/authorize`,
        token_endpoint: `${AS}/token`,
        registration_endpoint: `${AS}/register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        ...opts.metadata,
      });
    if (url.origin === AS && url.pathname === '/register') {
      registrations.push(JSON.parse(body) as Record<string, unknown>);
      return json({ client_id: `client-${registrations.length}`, redirect_uris: [] }, 201);
    }
    if (url.origin === AS && url.pathname === '/token') {
      const params = new URLSearchParams(body);
      tokenRequests.push(params);
      if (params.get('client_id') === opts.rejectClient)
        return json({ error: 'invalid_client' }, 401);
      if (params.get('grant_type') === 'authorization_code')
        return params.get('code') === 'code-ok' ? issue() : json({ error: 'invalid_grant' }, 400);
      await opts.refreshGate;
      if (opts.refresh === 'invalid_grant') return json({ error: 'invalid_grant' }, 400);
      if (opts.refresh === 'invalid_client') return json({ error: 'invalid_client' }, 401);
      return issue();
    }
    if (url.href === LINEAR) return mcp().fetch(request);
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, seen, registrations, tokenRequests, current: () => accessToken };
}

function bootOAuth(opts: AuthWorldOptions = {}) {
  const world = authWorld(opts);
  const booted = boot(world.fetch);
  const start = async (body: unknown, origin = ORIGIN) => {
    const res = await booted.s.app.request(`${booted.base}/oauth/start`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { authorizationUrl?: string; error?: string };
    const url = json.authorizationUrl === undefined ? null : new URL(json.authorizationUrl);
    return { res, json, url, state: url?.searchParams.get('state') ?? '' };
  };
  const callback = async (query: Record<string, string>) => {
    const res = await booted.s.app.request(`/api/oauth/callback?${new URLSearchParams(query)}`, {
      redirect: 'manual',
    });
    return res.headers.get('location') ?? '';
  };
  const row = () => booted.s.db.select().from(mcpConnector).get();
  const expire = (expiresAt = 1) => {
    const current = row();
    const sealed = JSON.parse(booted.s.secretBox.open(current?.oauthCipher ?? '')) as object;
    booted.s.db
      .update(mcpConnector)
      .set({ oauthCipher: booted.s.secretBox.seal(JSON.stringify({ ...sealed, expiresAt })) })
      .run();
  };
  return { ...booted, world, start, callback, row, expire };
}

const linearStart = { kind: 'catalog', catalogId: 'linear', slug: 'linear' };

describe('MCP connector OAuth', () => {
  test('start, callback and check: tokens sealed, resource and PKCE sent, landing names the row', async () => {
    const t = bootOAuth();
    const started = await t.start(linearStart);
    expect(started.res.status).toBe(200);
    const auth = started.url;
    expect(auth?.origin + (auth?.pathname ?? '')).toBe(`${AS}/authorize`);
    expect(Object.fromEntries(auth?.searchParams ?? [])).toMatchObject({
      client_id: 'client-1',
      response_type: 'code',
      code_challenge_method: 'S256',
      redirect_uri: `${ORIGIN}/api/oauth/callback`,
      resource: LINEAR,
      scope: 'read',
    });
    expect(t.world.registrations[0]).toMatchObject({
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      redirect_uris: [`${ORIGIN}/api/oauth/callback`],
    });
    expect(t.row()).toBeUndefined();
    const location = await t.callback({ code: 'code-ok', state: started.state, iss: AS });
    const row = t.row();
    expect(location).toBe(
      `${ORIGIN}/app/resources/mcp-servers?oauth=connected&connector=${row?.id}`,
    );
    expect(row).toMatchObject({
      authKind: 'oauth',
      status: 'connected',
      toolCount: 2,
      authRevision: 1,
      tokenGeneration: 1,
    });
    const exchange = t.world.tokenRequests[0];
    expect(exchange?.get('resource')).toBe(LINEAR);
    const verifier = exchange?.get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      auth?.searchParams.get('code_challenge'),
    );
    const listed = await (await req(t.s.app, 'GET', t.base)).text();
    for (const text of [listed, row?.oauthCipher ?? '', JSON.stringify(row?.oauthMeta)]) {
      expect(text).not.toContain('at-1');
      expect(text).not.toContain('rt-1');
    }
    expect(JSON.parse(listed)[0]).toMatchObject({ authKind: 'oauth', status: 'connected' });
    const replay = await t.callback({ code: 'code-ok', state: started.state, iss: AS });
    expect(replay).toContain('oauth=error&reason=state');
    expect(t.s.db.select().from(mcpConnector).all()).toHaveLength(1);
  });

  test('a wrong or missing issuer, a denied consent and a failed exchange create nothing', async () => {
    const t = bootOAuth({ metadata: { authorization_response_iss_parameter_supported: true } });
    const landing = `${ORIGIN}/app/resources/mcp-servers?oauth=error&reason=`;
    const wrong = await t.start(linearStart);
    expect(
      await t.callback({ code: 'code-ok', state: wrong.state, iss: 'https://evil.test' }),
    ).toBe(`${landing}exchange`);
    const missing = await t.start(linearStart);
    expect(await t.callback({ code: 'code-ok', state: missing.state })).toBe(`${landing}exchange`);
    expect(t.world.tokenRequests).toHaveLength(0);
    const denied = await t.start(linearStart);
    expect(await t.callback({ error: 'access_denied', state: denied.state })).toBe(
      `${landing}denied`,
    );
    const bad = await t.start(linearStart);
    expect(await t.callback({ code: 'code-bad', state: bad.state, iss: AS })).toBe(
      `${landing}exchange`,
    );
    expect(t.row()).toBeUndefined();
    expect(t.world.registrations).toHaveLength(1);
  });

  test('an issuer advertised through OIDC discovery is still required on the callback', async () => {
    const t = bootOAuth({
      oidc: true,
      metadata: { authorization_response_iss_parameter_supported: true },
    });
    const started = await t.start(linearStart);
    expect(started.res.status).toBe(200);
    expect(await t.callback({ code: 'code-ok', state: started.state })).toContain(
      'reason=exchange',
    );
    expect(t.world.tokenRequests).toHaveLength(0);
  });

  test('a registration the vendor rejects is dropped so the next start registers again', async () => {
    const t = bootOAuth({ rejectClient: 'client-1' });
    const first = await t.start(linearStart);
    expect(await t.callback({ code: 'code-ok', state: first.state, iss: AS })).toContain(
      'reason=exchange',
    );
    const second = await t.start(linearStart);
    expect(second.url?.searchParams.get('client_id')).toBe('client-2');
    expect(await t.callback({ code: 'code-ok', state: second.state, iss: AS })).toContain(
      'oauth=connected',
    );
  });

  test('a catalog entry asks for its own smallest scope and default options', async () => {
    const t = bootOAuth({ resource: 'https://mcp.supabase.com/mcp' });
    const started = await t.start({ kind: 'catalog', catalogId: 'supabase', slug: 'supabase' });
    expect(started.url?.searchParams.get('scope')).toBe(
      'organizations:read projects:read database:read analytics:read',
    );
    await t.callback({ code: 'code-ok', state: started.state, iss: AS });
    expect(t.row()?.url).toBe('https://mcp.supabase.com/mcp?read_only=true');
    const again = await t.start({ kind: 'reconnect', connectorId: t.row()?.id ?? '' });
    expect(again.url?.searchParams.get('scope')).toBe(
      'organizations:read projects:read database:read analytics:read',
    );
    await req(t.s.app, 'PATCH', `${t.base}/${t.row()?.id}`, { options: { project: 'abc' } });
    expect(t.row()?.url).toBe('https://mcp.supabase.com/mcp?read_only=true&project_ref=abc');
  });

  test('a custom server must name its issuer, so a code relayed from another vendor is refused', async () => {
    const acme = { kind: 'custom', slug: 'acme', label: 'Acme', url: LINEAR };
    const silent = bootOAuth();
    expect((await silent.start(acme)).res.status).toBe(400);
    expect(silent.world.registrations).toHaveLength(0);
    const catalog = await silent.start(linearStart);
    await silent.callback({ code: 'code-ok', state: catalog.state, iss: AS });
    silent.s.db.update(mcpConnector).set({ catalogId: 'retired' }).run();
    const retired = await silent.start({ kind: 'reconnect', connectorId: silent.row()?.id ?? '' });
    expect(retired.res.status).toBe(400);
    const t = bootOAuth({ metadata: { authorization_response_iss_parameter_supported: true } });
    const relayed = await t.start(acme);
    expect(relayed.res.status).toBe(200);
    expect(await t.callback({ code: 'code-ok', state: relayed.state })).toContain(
      'reason=exchange',
    );
    expect(t.world.tokenRequests).toHaveLength(0);
    const honest = await t.start(acme);
    expect(await t.callback({ code: 'code-ok', state: honest.state, iss: AS })).toContain(
      'oauth=connected',
    );
  });

  test('start refuses servers and origins it cannot sign in with safely', async () => {
    const cases: [AuthWorldOptions, string?][] = [
      [{ metadata: { code_challenge_methods_supported: undefined } }],
      [{ metadata: { code_challenge_methods_supported: ['plain'] } }],
      [{ metadata: { registration_endpoint: undefined } }],
      [{ metadata: { issuer: 'https://other.test' } }],
      [{ resource: 'https://mcp.linear.app/other' }],
      [{ authServer: 'http://169.254.169.254' }],
      [{ authServer: 'https://10.0.0.7' }],
      [{}, 'http://100.64.0.5:8787'],
    ];
    for (const [opts, origin] of cases) {
      const t = bootOAuth(opts);
      const started = await t.start(linearStart, origin);
      expect(started.res.status).toBe(400);
      expect(t.world.registrations).toHaveLength(0);
      expect(t.world.seen.every((r) => !/169\.254|10\.0\.0\.7/.test(r.url))).toBe(true);
    }
    const t = bootOAuth();
    expect((await t.start({ kind: 'catalog', catalogId: 'github', slug: 'gh' })).res.status).toBe(
      400,
    );
    const https = await t.start(linearStart, 'https://cairn.example.test');
    expect(t.world.registrations.at(-1)).toMatchObject({ application_type: 'web' });
    expect(https.url?.searchParams.get('redirect_uri')).toBe(
      'https://cairn.example.test/api/oauth/callback',
    );
  });

  test('a slug taken while the browser was away lands on conflict and keeps the other row', async () => {
    const t = bootOAuth();
    const started = await t.start(linearStart);
    await req(t.s.app, 'POST', t.base, {
      kind: 'custom',
      slug: 'linear',
      label: 'Mine',
      url: 'https://mcp.acme.test/mcp',
    });
    expect(await t.callback({ code: 'code-ok', state: started.state, iss: AS })).toContain(
      'reason=conflict',
    );
    expect(t.s.db.select().from(mcpConnector).all()).toMatchObject([{ label: 'Mine' }]);
  });

  test('reconnect replaces tokens on the same row and a stale reconnect is refused', async () => {
    const t = bootOAuth();
    const first = await t.start(linearStart);
    await t.callback({ code: 'code-ok', state: first.state, iss: AS });
    const id = t.row()?.id ?? '';
    const a = await t.start({ kind: 'reconnect', connectorId: id });
    const b = await t.start({ kind: 'reconnect', connectorId: id });
    expect(t.world.registrations).toHaveLength(1);
    expect(await t.callback({ code: 'code-ok', state: a.state, iss: AS })).toContain(
      `connector=${id}`,
    );
    expect(t.row()).toMatchObject({ authRevision: 2, tokenGeneration: 2, status: 'connected' });
    expect(await t.callback({ code: 'code-ok', state: b.state, iss: AS })).toContain(
      'reason=conflict',
    );
    expect(t.row()).toMatchObject({ authRevision: 2, tokenGeneration: 2 });
    expect(t.world.seen.at(-1)?.url).toBe(`${AS}/token`);
    const custom = await req(t.s.app, 'POST', t.base, {
      kind: 'custom',
      slug: 'acme',
      label: 'Acme',
      url: 'https://mcp.acme.test/mcp',
    });
    const staticId = ((await custom.json()) as { id: string }).id;
    expect((await t.start({ kind: 'reconnect', connectorId: staticId })).res.status).toBe(400);
  });

  test('an expired token is refreshed once for concurrent checks and the pair rotates', async () => {
    let release = () => {};
    const refreshGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = bootOAuth({ refreshGate });
    const started = await t.start(linearStart);
    await t.callback({ code: 'code-ok', state: started.state, iss: AS });
    t.expire();
    const id = t.row()?.id ?? '';
    const checks = [
      checkMcpConnector(t.deps, t.s.team.id, id),
      checkMcpConnector(t.deps, t.s.team.id, id),
    ];
    release();
    const results = await Promise.all(checks);
    const refreshes = t.world.tokenRequests.filter((p) => p.get('grant_type') === 'refresh_token');
    expect(refreshes.map((p) => p.get('refresh_token'))).toEqual(['rt-1']);
    expect(refreshes[0]?.get('resource')).toBe(LINEAR);
    expect(t.row()?.tokenGeneration).toBe(2);
    expect(results.map((r) => r.status)).toEqual(['connected', 'connected']);
    expect(t.world.current()).toBe('at-2');
  });

  test('a step that stops being claimed while its token waits on a refresh gets no connector credentials', async () => {
    let release = () => {};
    const t = bootOAuth({
      refreshGate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    const started = await t.start(linearStart);
    await t.callback({ code: 'code-ok', state: started.state, iss: AS });
    t.expire(Date.now() + 5 * 60_000);
    seedSessionRoute(t.s, { provider: 'stub-gw', modelId: 'stub-model' });
    const projectId = await postProject(t.s.app, 'refresh-race');
    const runner = await enrollConnectorRunner(t.s, 'race-runner', true);
    const [finished, kept] = [0, 1].map(() => {
      const id = queueConnectorStep(t.s, projectId, runner.machineId);
      t.s.db
        .update(stepTable)
        .set({ status: 'claimed', machineId: runner.machineId, claimedAt: Date.now() })
        .where(eq(stepTable.id, id))
        .run();
      return id;
    });
    const token = async (id: string) =>
      machineTokenResponseSchema.parse(
        await (
          await t.s.app.request(`/api/machine/token/${id}`, {
            headers: { authorization: `Bearer ${runner.token}` },
          })
        ).json(),
      );
    const pending = [token(finished ?? ''), token(kept ?? '')];
    await vi.waitFor(() =>
      expect(t.world.tokenRequests.some((p) => p.get('grant_type') === 'refresh_token')).toBe(true),
    );
    t.s.db
      .update(stepTable)
      .set({ status: 'done' })
      .where(eq(stepTable.id, finished ?? ''))
      .run();
    release();
    const [gone, live] = await Promise.all(pending);
    expect(gone?.mcpConnectors).toBeUndefined();
    expect(JSON.stringify(gone)).not.toContain('at-2');
    expect(live?.mcpConnectors?.[0]?.headers).toEqual({ Authorization: 'Bearer at-2' });
  });

  test('a refresh that finishes after a reconnect does not overwrite the new tokens', async () => {
    let release = () => {};
    const refreshGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = bootOAuth({ refreshGate });
    const first = await t.start(linearStart);
    await t.callback({ code: 'code-ok', state: first.state, iss: AS });
    const id = t.row()?.id ?? '';
    const refresh = refreshMcpConnectorToken(t.deps, t.s.team.id, id);
    const again = await t.start({ kind: 'reconnect', connectorId: id });
    await t.callback({ code: 'code-ok', state: again.state, iss: AS });
    const cipher = t.row()?.oauthCipher;
    release();
    await refresh;
    expect(t.world.current()).toBe('at-3');
    expect(t.row()).toMatchObject({
      oauthCipher: cipher,
      authRevision: 2,
      tokenGeneration: 2,
      status: 'connected',
    });
  });

  test('the step token refreshes a token close to expiry once and hands out the new one', async () => {
    const t = bootOAuth();
    const started = await t.start(linearStart);
    await t.callback({ code: 'code-ok', state: started.state, iss: AS });
    const refreshes = () =>
      t.world.tokenRequests.filter((p) => p.get('grant_type') === 'refresh_token').length;
    const fresh = await stepConnectorEndpoints(t.deps, t.s.team.id, ['linear']);
    expect(fresh.mcpConnectors?.[0]?.headers).toEqual({ Authorization: 'Bearer at-1' });
    expect(refreshes()).toBe(0);
    t.expire(Date.now() + 5 * 60_000);
    const both = await Promise.all([
      stepConnectorEndpoints(t.deps, t.s.team.id, ['linear']),
      stepConnectorEndpoints(t.deps, t.s.team.id, ['Linear']),
    ]);
    expect(refreshes()).toBe(1);
    expect(both.map((r) => r.mcpConnectors?.[0]?.headers?.Authorization)).toEqual([
      'Bearer at-2',
      'Bearer at-2',
    ]);
  });

  test('the step token keeps a still-valid token when the refresh hangs and withholds an expired one it cannot refresh', async () => {
    const hanging = bootOAuth({ refreshGate: new Promise<void>(() => {}) });
    const started = await hanging.start(linearStart);
    await hanging.callback({ code: 'code-ok', state: started.state, iss: AS });
    hanging.expire(Date.now() + 5 * 60_000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const pending = stepConnectorEndpoints(hanging.deps, hanging.s.team.id, ['linear']);
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await pending).mcpConnectors?.[0]?.headers).toEqual({
        Authorization: 'Bearer at-1',
      });
    } finally {
      vi.useRealTimers();
    }

    const rejected = bootOAuth({ refresh: 'invalid_grant' });
    const again = await rejected.start(linearStart);
    await rejected.callback({ code: 'code-ok', state: again.state, iss: AS });
    rejected.expire();
    expect(await stepConnectorEndpoints(rejected.deps, rejected.s.team.id, ['linear'])).toEqual({
      withheldMcp: ['linear'],
    });
    expect(rejected.row()).toMatchObject({
      status: 'needs_auth',
      statusReason: 'refresh_rejected',
    });
  });

  test('a rejected refresh asks for reconnect without probing the server', async () => {
    const t = bootOAuth({ refresh: 'invalid_grant' });
    const started = await t.start(linearStart);
    await t.callback({ code: 'code-ok', state: started.state, iss: AS });
    t.expire();
    const probes = t.world.seen.filter((r) => r.url === LINEAR).length;
    const record = await checkMcpConnector(t.deps, t.s.team.id, t.row()?.id ?? '');
    expect(record).toMatchObject({ status: 'needs_auth', statusReason: 'refresh_rejected' });
    expect(t.world.seen.filter((r) => r.url === LINEAR)).toHaveLength(probes);
  });

  test('a refresh the vendor answers with invalid_client asks for reconnect and registers again', async () => {
    const t = bootOAuth({ refresh: 'invalid_client' });
    const started = await t.start(linearStart);
    await t.callback({ code: 'code-ok', state: started.state, iss: AS });
    t.expire();
    const id = t.row()?.id ?? '';
    expect(await checkMcpConnector(t.deps, t.s.team.id, id)).toMatchObject({
      status: 'needs_auth',
      statusReason: 'refresh_rejected',
    });
    const again = await t.start({ kind: 'reconnect', connectorId: id });
    expect(again.url?.searchParams.get('client_id')).toBe('client-2');
  });

  test('edits: an OAuth row refuses tokens and drops its tokens when its origin moves', async () => {
    const t = bootOAuth({ metadata: { authorization_response_iss_parameter_supported: true } });
    const started = await t.start({
      kind: 'custom',
      slug: 'lin',
      label: 'Lin',
      url: LINEAR,
    });
    await t.callback({ code: 'code-ok', state: started.state, iss: AS });
    const id = t.row()?.id ?? '';
    expect((await req(t.s.app, 'PATCH', `${t.base}/${id}`, { headers: { A: 'b' } })).status).toBe(
      400,
    );
    const moved = await req(t.s.app, 'PATCH', `${t.base}/${id}`, {
      url: 'https://mcp.elsewhere.test/mcp',
    });
    expect(await moved.json()).toMatchObject({ status: 'needs_auth', statusReason: 'reconnect' });
    expect(t.row()).toMatchObject({ oauthCipher: null, oauthMeta: null, authRevision: 2 });
    expect(t.world.seen.some((r) => r.url.startsWith('https://mcp.elsewhere.test'))).toBe(false);
  });

  test('the production OAuth fetch refuses a host that resolves to a private address', async () => {
    const failure = await createPublicOAuthFetch({})('https://localhost/x').catch(
      (err: unknown) => err,
    );
    expect(String((failure as Error & { cause?: unknown }).cause)).toContain('non-public address');
  });
});

const GH_MCP = 'https://api.githubcopilot.com/mcp/';
const GH_APP = { clientId: 'Iv23-test-client', slug: 'cairn-test' } as const;

interface GithubWorldOptions {
  polls?: string[];
  refresh?: 'ok' | 'bad' | 'down';
  refreshGate?: Promise<void>;
  mcpStatus?: number;
}

function githubWorld(opts: GithubWorldOptions = {}) {
  const tokenRequests: URLSearchParams[] = [];
  const installationAuth: string[] = [];
  const polls = [...(opts.polls ?? ['complete'])];
  let generation = 0;
  let accessToken = 'none';
  let installations = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const issue = () => {
    generation += 1;
    accessToken = `ghu_ACCESS-${generation}`;
    return json({
      access_token: accessToken,
      refresh_token: `ghr_REFRESH-${generation}`,
      expires_in: 28_800,
      refresh_token_expires_in: 15_897_600,
      token_type: 'bearer',
      scope: '',
    });
  };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href === 'https://github.com/login/device/code')
      return json({
        device_code: 'DEVICE-SECRET-1',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });
    if (url.href === 'https://github.com/login/oauth/access_token') {
      const params = new URLSearchParams(await request.text());
      tokenRequests.push(params);
      if (params.get('grant_type') === 'refresh_token') {
        await opts.refreshGate;
        if (opts.refresh === 'bad') return json({ error: 'bad_refresh_token' });
        if (opts.refresh === 'down') return new Response('', { status: 503 });
        return issue();
      }
      const next = polls.shift() ?? 'authorization_pending';
      if (next === 'complete') return issue();
      if (next === 'slow_down') return json({ error: 'slow_down', interval: 10 });
      return json({ error: next });
    }
    if (url.href === GH_MCP) {
      if (opts.mcpStatus !== undefined) return new Response('', { status: opts.mcpStatus });
      return fakeMcp({ token: accessToken }).fetch(request);
    }
    if (request.headers.get('authorization') !== `Bearer ${accessToken}`)
      return new Response('', { status: 401 });
    if (url.pathname === '/user') return json({ login: 'octo', id: 42, name: null });
    if (url.pathname === '/user/installations') {
      installationAuth.push(request.headers.get('authorization') ?? '');
      return json({ total_count: installations, installations: [] });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return {
    fetch,
    tokenRequests,
    installationAuth,
    current: () => accessToken,
    install: () => {
      installations = 1;
    },
  };
}

function bootGithub(opts: GithubWorldOptions = {}, app: GithubAppRegistration = GH_APP) {
  const world = githubWorld(opts);
  const booted = boot(world.fetch, undefined, app);
  const device = `${booted.base}/github/device`;
  const texts: string[] = [];
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await req(booted.s.app, method, path, body);
    const text = await res.text();
    texts.push(text);
    return { status: res.status, body: text === '' ? null : JSON.parse(text) };
  };
  const start = (body: unknown = {}) => call('POST', device, body);
  const poll = (attemptId: string, due = true) => {
    const attempt = booted.s.mcpOAuthState.githubDevice.get(attemptId);
    if (attempt && due) attempt.nextPollAt = 0;
    return call('POST', `${device}/${attemptId}`);
  };
  const connect = async (body: unknown = {}) => {
    const started = await start(body);
    return poll(started.body.attemptId);
  };
  const rows = () => booted.s.db.select().from(mcpConnector).all();
  const githubRow = () => rows().find((r) => r.authKind === 'github-app');
  const sealed = () =>
    JSON.parse(booted.s.secretBox.open(githubRow()?.oauthCipher ?? '')) as Record<string, unknown>;
  const reseal = (patch: Record<string, unknown>) =>
    booted.s.db
      .update(mcpConnector)
      .set({ oauthCipher: booted.s.secretBox.seal(JSON.stringify({ ...sealed(), ...patch })) })
      .where(eq(mcpConnector.id, githubRow()?.id ?? ''))
      .run();
  const refreshes = () =>
    world.tokenRequests.filter((p) => p.get('grant_type') === 'refresh_token');
  return {
    ...booted,
    world,
    texts,
    call,
    start,
    poll,
    connect,
    rows,
    githubRow,
    sealed,
    reseal,
    refreshes,
  };
}

describe('GitHub connector device sign-in', () => {
  test('without a registered App the card stays on tokens and device sign-in is refused', async () => {
    const t = bootGithub({}, null);
    expect((await t.call('GET', `${t.base}/github`)).body).toEqual({
      available: false,
      installUrl: null,
    });
    expect((await t.start()).status).toBe(400);
    expect(t.world.tokenRequests).toHaveLength(0);
  });

  test('sign-in connects a new connector, honors the interval and never returns secrets', async () => {
    const t = bootGithub({ polls: ['authorization_pending', 'slow_down', 'complete'] });
    expect((await t.call('GET', `${t.base}/github`)).body).toEqual({
      available: true,
      installUrl: 'https://github.com/apps/cairn-test/installations/new',
    });
    const started = await t.start();
    expect(started.body).toMatchObject({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      intervalSeconds: 5,
      expiresInSeconds: 900,
    });
    const id = started.body.attemptId as string;
    expect((await t.poll(id)).body).toEqual({ status: 'pending', intervalSeconds: 5 });
    expect((await t.poll(id, false)).body).toEqual({ status: 'pending', intervalSeconds: 5 });
    expect(t.world.tokenRequests).toHaveLength(1);
    expect((await t.poll(id)).body).toEqual({ status: 'pending', intervalSeconds: 10 });
    const done = await t.poll(id);
    expect(done.body).toMatchObject({
      status: 'complete',
      connector: {
        slug: 'github',
        catalogId: 'github',
        url: GH_MCP,
        authKind: 'github-app',
        account: 'octo',
        status: 'connected',
        toolCount: 2,
      },
    });
    expect((await t.poll(id)).status).toBe(404);
    const grant = t.world.tokenRequests[0];
    expect(grant?.get('client_id')).toBe(GH_APP.clientId);
    expect(grant?.has('client_secret')).toBe(false);
    expect((await t.call('GET', t.base)).body[0]).toMatchObject({ account: 'octo' });
    expect(t.githubRow()?.oauthCipher).not.toContain('ghu_');
    expect(t.sealed()).toMatchObject({ login: 'octo', userId: 42, refreshToken: 'ghr_REFRESH-1' });
    for (const text of t.texts) {
      for (const secret of ['ghu_', 'ghr_', 'DEVICE-SECRET']) expect(text).not.toContain(secret);
    }
  });

  test('denied, expired and failed polls end the attempt; cancelled or foreign attempts are 404', async () => {
    for (const [answer, status] of [
      ['access_denied', 'denied'],
      ['expired_token', 'expired'],
      ['device_flow_disabled', 'failed'],
    ] as const) {
      const t = bootGithub({ polls: [answer] });
      const started = await t.start();
      expect((await t.poll(started.body.attemptId)).body).toEqual({ status });
      expect((await t.poll(started.body.attemptId)).status).toBe(404);
      expect(t.rows()).toHaveLength(0);
    }
    const t = bootGithub();
    const lapsed = await t.start();
    const attempt = t.s.mcpOAuthState.githubDevice.get(lapsed.body.attemptId);
    if (attempt) attempt.expiresAt = 1;
    expect((await t.poll(lapsed.body.attemptId)).body).toEqual({ status: 'expired' });
    const cancelled = await t.start();
    const path = `${t.base}/github/device/${cancelled.body.attemptId}`;
    expect((await t.call('DELETE', path)).status).toBe(204);
    expect((await t.poll(cancelled.body.attemptId)).status).toBe(404);
    const foreign = await t.start();
    for (const who of [
      { teamId: 'other-team', userId: t.s.user.id },
      { teamId: t.s.team.id, userId: 'someone-else' },
    ])
      await expect(
        pollGithubConnectorDevice(t.deps, { ...who, attemptId: foreign.body.attemptId }),
      ).rejects.toMatchObject({ status: 404 });
    expect(t.world.tokenRequests).toHaveLength(0);
    expect(t.rows()).toHaveLength(0);
  });

  test('a new sign-in takes the next free slug, leaves a token connector editable and refuses a slug taken meanwhile', async () => {
    const t = bootGithub({ polls: ['complete', 'complete'] });
    const pat = await t.call('POST', t.base, {
      kind: 'catalog',
      catalogId: 'github',
      slug: 'github',
      token: 'ghp_PAT-SECRET-1',
    });
    expect((await t.connect()).body.connector).toMatchObject({ slug: 'github-2' });
    const edited = await t.call('PATCH', `${t.base}/${pat.body.id}`, {
      token: 'ghp_PAT-SECRET-2',
      options: { readonly: 'true' },
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ authKind: 'static', headerNames: expect.any(Array) });
    const started = await t.start();
    await t.call('POST', t.base, {
      kind: 'custom',
      slug: 'github-3',
      label: 'Other',
      url: 'https://mcp.other.test/mcp',
    });
    const raced = await t.poll(started.body.attemptId);
    expect(raced.status).toBe(409);
    expect(t.rows().map((r) => [r.slug, r.authKind])).toEqual(
      expect.arrayContaining([
        ['github', 'static'],
        ['github-2', 'github-app'],
        ['github-3', 'none'],
      ]),
    );
    expect(t.rows()).toHaveLength(3);
  });

  test('reconnect replaces the pair on the same row; a stale or wrong-kind reconnect is refused', async () => {
    const t = bootGithub({ polls: ['complete', 'complete', 'complete'] });
    const first = (await t.connect()).body.connector;
    const again = await t.connect({ connectorId: first.id });
    expect(again.body.connector).toMatchObject({ id: first.id, status: 'connected' });
    expect(t.githubRow()).toMatchObject({ authRevision: 2, tokenGeneration: 2 });
    expect(t.sealed()).toMatchObject({ accessToken: 'ghu_ACCESS-2' });
    const stale = await t.start({ connectorId: first.id });
    t.s.db.update(mcpConnector).set({ authRevision: 7 }).run();
    expect((await t.poll(stale.body.attemptId)).status).toBe(409);
    expect(t.sealed()).toMatchObject({ accessToken: 'ghu_ACCESS-2' });
    const custom = await t.call('POST', t.base, {
      kind: 'custom',
      slug: 'acme',
      label: 'Acme',
      url: 'https://mcp.acme.test/mcp',
    });
    expect((await t.start({ connectorId: custom.body.id })).status).toBe(400);
  });

  test('a token close to expiry is refreshed once through the device core, without a client secret', async () => {
    let release = () => {};
    const t = bootGithub({
      refreshGate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    await t.connect();
    t.reseal({ expiresAt: Date.now() + 5 * 60_000 });
    const pending = [
      stepConnectorEndpoints(t.deps, t.s.team.id, ['github']),
      stepConnectorEndpoints(t.deps, t.s.team.id, ['github']),
    ];
    release();
    const both = await Promise.all(pending);
    expect(both.map((r) => r.mcpConnectors?.[0]?.headers)).toEqual([
      { Authorization: 'Bearer ghu_ACCESS-2' },
      { Authorization: 'Bearer ghu_ACCESS-2' },
    ]);
    expect(t.refreshes()).toHaveLength(1);
    expect(Object.fromEntries(t.refreshes()[0] ?? [])).toEqual({
      client_id: GH_APP.clientId,
      grant_type: 'refresh_token',
      refresh_token: 'ghr_REFRESH-1',
    });
    expect(t.githubRow()).toMatchObject({ tokenGeneration: 2, status: 'connected' });
    expect(t.sealed()).toMatchObject({ refreshToken: 'ghr_REFRESH-2', login: 'octo' });
  });

  test('a rejected or lapsed refresh asks for reconnect; a GitHub outage is an error', async () => {
    const bad = bootGithub({ refresh: 'bad' });
    await bad.connect();
    bad.reseal({ expiresAt: 1 });
    expect(
      await checkMcpConnector(bad.deps, bad.s.team.id, bad.githubRow()?.id ?? ''),
    ).toMatchObject({ status: 'needs_auth', statusReason: 'refresh_rejected' });
    expect(await stepConnectorEndpoints(bad.deps, bad.s.team.id, ['github'])).toEqual({
      withheldMcp: ['github'],
    });

    const lapsed = bootGithub();
    await lapsed.connect();
    lapsed.reseal({ expiresAt: 1, refreshExpiresAt: 1 });
    expect(
      await checkMcpConnector(lapsed.deps, lapsed.s.team.id, lapsed.githubRow()?.id ?? ''),
    ).toMatchObject({ status: 'needs_auth', statusReason: 'expired' });
    expect(lapsed.refreshes()).toHaveLength(0);

    const down = bootGithub({ refresh: 'down' });
    await down.connect();
    down.reseal({ expiresAt: 1 });
    expect(
      await checkMcpConnector(down.deps, down.s.team.id, down.githubRow()?.id ?? ''),
    ).toMatchObject({ status: 'error', statusReason: 'refresh_failed' });
  });

  test('a refresh that lands after delete or reconnect writes nothing', async () => {
    let release = () => {};
    const t = bootGithub({
      polls: ['complete', 'complete'],
      refreshGate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    const id = (await t.connect()).body.connector.id as string;
    const refresh = refreshMcpConnectorToken(t.deps, t.s.team.id, id);
    await t.connect({ connectorId: id });
    const cipher = t.githubRow()?.oauthCipher;
    release();
    await refresh;
    expect(t.githubRow()).toMatchObject({ oauthCipher: cipher, authRevision: 2 });

    let releaseAgain = () => {};
    const gone = bootGithub({
      refreshGate: new Promise<void>((resolve) => {
        releaseAgain = resolve;
      }),
    });
    const goneId = (await gone.connect()).body.connector.id as string;
    const late = refreshMcpConnectorToken(gone.deps, gone.s.team.id, goneId);
    expect((await gone.call('DELETE', `${gone.base}/${goneId}`)).status).toBe(204);
    releaseAgain();
    await late;
    expect(gone.rows()).toHaveLength(0);
  });

  test('a 403 from GitHub MCP is an error, and edits refuse credentials but keep the label', async () => {
    const t = bootGithub({ mcpStatus: 403 });
    expect((await t.connect()).body.connector).toMatchObject({
      status: 'error',
      statusReason: 'forbidden',
    });
    const id = t.githubRow()?.id ?? '';
    for (const patch of [{ token: 'ghp_x1234567' }, { options: { readonly: 'true' } }])
      expect((await t.call('PATCH', `${t.base}/${id}`, patch)).status).toBe(400);
    const renamed = await t.call('PATCH', `${t.base}/${id}`, { label: 'Work GitHub' });
    expect(renamed.body).toMatchObject({ label: 'Work GitHub', authKind: 'github-app' });
  });

  test('done re-reads the installations with the connector token', async () => {
    const t = bootGithub();
    const id = (await t.connect()).body.connector.id as string;
    const path = `${t.base}/${id}/github/installations`;
    expect((await t.call('POST', path)).body).toEqual({ installed: false });
    t.world.install();
    expect((await t.call('POST', path)).body).toEqual({ installed: true });
    expect(t.world.installationAuth).toEqual(['Bearer ghu_ACCESS-1', 'Bearer ghu_ACCESS-1']);
  });

  test('device routes are owner-only and the availability read is not', () => {
    const path = '/api/teams/t1/mcp-connectors';
    expect(isOwnerOnlyRoute('POST', `${path}/github/device`)).toBe(true);
    expect(isOwnerOnlyRoute('POST', `${path}/github/device/a1`)).toBe(true);
    expect(isOwnerOnlyRoute('DELETE', `${path}/github/device/a1`)).toBe(true);
    expect(isOwnerOnlyRoute('POST', `${path}/c1/github/installations`)).toBe(true);
    expect(isOwnerOnlyRoute('GET', `${path}/github`)).toBe(false);
  });
});
