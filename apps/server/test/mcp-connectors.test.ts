import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mcpConnectorRecordSchema } from '@cairn/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { describe, expect, onTestFinished, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { mcpConnector } from '../src/db/schema.js';
import { isOwnerOnlyRoute } from '../src/lib/token-auth.js';
import {
  checkMcpConnector,
  createMcpConnector,
  type McpConnectorDeps,
  updateMcpConnector,
} from '../src/services/mcp-servers.js';
import { bootServer, req } from './helpers.js';

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

function boot(fetch: typeof globalThis.fetch, claudeJson?: unknown) {
  const dir = makeTestTempDir('cairn-mcp-conn-');
  const mcpConfigPath = join(dir, 'claude.json');
  if (claudeJson !== undefined) writeFileSync(mcpConfigPath, JSON.stringify(claudeJson));
  const s = bootServer({ mcpFetch: fetch, mcpConfigPath });
  onTestFinished(() => s.dispose());
  const base = `/api/teams/${s.team.id}/mcp-connectors`;
  const deps: McpConnectorDeps = { db: s.db, box: s.secretBox, mcpConfigPath, fetch };
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
    expect(isOwnerOnlyRoute('GET', path)).toBe(false);
  });
});
