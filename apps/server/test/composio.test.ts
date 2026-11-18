import { isDaemonReadSecretName } from '@cairn/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { eq } from 'drizzle-orm';
import { describe, expect, onTestFinished, test } from 'vitest';
import { mcpConnector, secret } from '../src/db/schema.js';
import { isOwnerOnlyRoute } from '../src/lib/token-auth.js';
import { openSecretGrants } from '../src/services/secrets.js';
import { bootServer, req } from './helpers.js';

const BASE_COMPOSIO = '/api/v3.1';

interface ComposioCall {
  method: string;
  pathname: string;
  headers: Headers;
  body: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FakeComposioAccount {
  id: string;
  status: string;
  status_reason: string | null;
  is_disabled: boolean;
}

function fakeComposio(
  opts: { key?: string; account?: FakeComposioAccount | null; toolkitSlug?: string } = {},
) {
  const key = opts.key ?? 'ck-test';
  const slug = opts.toolkitSlug ?? 'gmail';
  const calls: ComposioCall[] = [];
  let account: FakeComposioAccount | null = opts.account ?? null;
  let sessions = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? '' : await request.clone().text();
    calls.push({ method: request.method, pathname: url.pathname, headers: request.headers, body });
    if (!url.pathname.startsWith(BASE_COMPOSIO)) return json({ message: 'nope' }, 404);
    if (request.headers.get('x-api-key') !== key)
      return json({ error: { message: 'invalid key' } }, 401);
    if (url.pathname === `${BASE_COMPOSIO}/toolkits`)
      return json({
        items: [
          {
            slug,
            name: 'Gmail',
            meta: {
              description: 'Read and send mail',
              logo: 'https://cdn.test/gmail.png',
              tools_count: 3,
            },
            auth_schemes: ['OAUTH2'],
          },
          {
            slug: 'calculator',
            name: 'Calculator',
            meta: { description: 'Math' },
            no_auth: true,
          },
        ],
      });
    if (url.pathname === `${BASE_COMPOSIO}/tool_router/session`) {
      sessions += 1;
      return json({
        session_id: `sess-${sessions}`,
        mcp: { url: `https://mcp.composio.dev/s/sess-${sessions}` },
      });
    }
    const link = /^\/api\/v3\.1\/tool_router\/session\/([^/]+)\/link$/.exec(url.pathname);
    if (link !== null) {
      account ??= { id: 'ca-1', status: 'INITIATED', status_reason: null, is_disabled: false };
      return json({
        redirect_url: 'https://connect.composio.dev/link/abc',
        connected_account_id: 'ca-1',
      });
    }
    if (url.pathname === `${BASE_COMPOSIO}/connected_accounts`) {
      const statuses = url.searchParams.get('statuses');
      const items =
        account === null ||
        url.searchParams.get('toolkit_slugs') !== slug ||
        (statuses !== null && !statuses.split(',').includes(account.status))
          ? []
          : [account];
      return json({ items });
    }
    const accountGet = /^\/api\/v3\.1\/connected_accounts\/([^/]+)$/.exec(url.pathname);
    if (accountGet !== null && request.method === 'GET') {
      if (account === null || account.id !== accountGet[1]) return json({ message: 'gone' }, 404);
      return json({
        id: account.id,
        status: account.status,
        status_reason: account.status_reason,
        is_disabled: account.is_disabled,
        state: { val: { access_token: 'PROVIDER-TOKEN-MUST-NOT-LEAK' } },
        toolkit: { slug },
      });
    }
    if (accountGet !== null && request.method === 'DELETE') {
      if (account !== null && account.id === accountGet[1])
        account = { ...account, status: 'INACTIVE' };
      return json({}, 200);
    }
    return json({ message: 'unhandled' }, 404);
  }) as typeof globalThis.fetch;
  return {
    fetch,
    calls,
    get account() {
      return account;
    },
    setAccount(next: FakeComposioAccount | null) {
      account = next;
    },
    get sessions() {
      return sessions;
    },
  };
}

function fakeMcp(
  tools: { name: string; text: string; annotations?: Record<string, boolean> }[] = [
    { name: 'GMAIL_FETCH', text: 'inbox-ok', annotations: { readOnlyHint: true } },
    { name: 'GMAIL_SEND', text: 'sent-ok' },
    { name: 'GMAIL_DELETE', text: 'deleted-ok', annotations: { destructiveHint: true } },
  ],
) {
  const calls: { name: string; args: unknown }[] = [];
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push({ url: request.url, headers: Object.fromEntries(request.headers) });
    const server = new McpServer({ name: 'fake-composio', version: '1.0.0' });
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          description: `${tool.name} description`,
          ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
        },
        async (args) => {
          calls.push({ name: tool.name, args });
          return { content: [{ type: 'text', text: tool.text }] };
        },
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  }) as typeof globalThis.fetch;
  return { fetch, calls, seen };
}

function boot(opts: { account?: FakeComposioAccount | null; key?: string } = {}) {
  const composio = fakeComposio(opts);
  const mcp = fakeMcp();
  const s = bootServer({ composioFetch: composio.fetch, mcpFetch: mcp.fetch });
  onTestFinished(() => s.dispose());
  return { s, composio, mcp, base: `/api/teams/${s.team.id}/mcp-connectors` };
}

async function putKey(s: ReturnType<typeof bootServer>, key = 'ck-test') {
  const res = await req(s.app, 'PUT', `/api/teams/${s.team.id}/mcp-connectors/composio/key`, {
    key,
  });
  expect(res.status).toBe(200);
}

describe('composio connector routes', () => {
  test('key save, app list, connect, authorize, poll and revoke', async () => {
    const { s, composio, mcp, base } = boot();
    const empty = await (await req(s.app, 'GET', `${base}/composio`)).json();
    expect(empty).toEqual({ configured: false, apps: [] });

    await putKey(s);
    const apps = (await (await req(s.app, 'GET', `${base}/composio`)).json()) as {
      configured: boolean;
      apps: {
        slug: string;
        name: string;
        noAuth: boolean;
        toolsCount: number | null;
        connector: unknown;
      }[];
    };
    expect(apps.configured).toBe(true);
    const gmail = apps.apps.find((app) => app.slug === 'gmail');
    expect(gmail).toMatchObject({
      name: 'Gmail',
      noAuth: false,
      toolsCount: 3,
      connector: null,
    });
    expect(composio.calls.every((call) => call.headers.get('x-api-key') === 'ck-test')).toBe(true);

    const created = (await (
      await req(s.app, 'POST', `${base}/composio/toolkits`, { slug: 'gmail' })
    ).json()) as { id: string; url: string };
    expect(created).toMatchObject({
      slug: 'gmail',
      label: 'Gmail',
      catalogId: 'composio',
      authKind: 'composio',
      status: 'needs_auth',
      statusReason: 'no connected account',
      headerNames: ['x-api-key'],
    });
    expect(created.url).toBe('https://mcp.composio.dev');
    const sessionBody = JSON.parse(
      composio.calls.find((call) => call.pathname === `${BASE_COMPOSIO}/tool_router/session`)
        ?.body ?? '{}',
    ) as Record<string, unknown>;
    expect(sessionBody).toMatchObject({
      user_id: s.team.id,
      toolkits: { enable: ['gmail'] },
      manage_connections: { enable: false },
      workbench: { enable: false },
      preload: { tools: 'all' },
      search: { enable: false },
      execute: { enable_multi_execute: false },
    });

    const authorized = (await (
      await req(s.app, 'POST', `${base}/composio/${created.id}/authorize`)
    ).json()) as { redirectUrl: string | null; connector: { status: string } };
    expect(authorized.redirectUrl).toBe('https://connect.composio.dev/link/abc');
    expect(authorized.connector).toMatchObject({ status: 'needs_auth' });

    const stillWaiting = (await (
      await req(s.app, 'POST', `${base}/composio/${created.id}/poll`)
    ).json()) as { status: string; statusReason: string };
    expect(stillWaiting).toMatchObject({ status: 'needs_auth', statusReason: 'authorizing' });

    composio.setAccount({ id: 'ca-1', status: 'ACTIVE', status_reason: null, is_disabled: false });
    const polled = (await (
      await req(s.app, 'POST', `${base}/composio/${created.id}/poll`)
    ).json()) as { status: string; toolCount: number };
    expect(polled).toMatchObject({ status: 'connected', toolCount: 3 });
    expect(mcp.seen.some((call) => call.headers['x-api-key'] === 'ck-test')).toBe(true);
    const row = s.db.select().from(mcpConnector).where(eq(mcpConnector.id, created.id)).get();
    expect(row?.toolsJson).toHaveLength(3);
    expect(row?.url).toBe('https://mcp.composio.dev/s/sess-1');

    const revoked = (await (
      await req(s.app, 'POST', `${base}/composio/${created.id}/revoke`)
    ).json()) as { status: string };
    expect(revoked.status).toBe('revoked');
    expect(
      composio.calls.some(
        (call) =>
          call.method === 'DELETE' && call.pathname === `${BASE_COMPOSIO}/connected_accounts/ca-1`,
      ),
    ).toBe(true);
  });

  test('a no-auth toolkit connects immediately and provider state is never persisted', async () => {
    const { s, base } = boot();
    await putKey(s);
    const created = (await (
      await req(s.app, 'POST', `${base}/composio/toolkits`, { slug: 'calculator' })
    ).json()) as { status: string; toolCount: number };
    expect(created).toMatchObject({ status: 'connected', toolCount: 3 });
    const row = s.db.select().from(mcpConnector).get();
    expect(row?.status).toBe('connected');
    expect(JSON.stringify(row)).not.toContain('PROVIDER-TOKEN-MUST-NOT-LEAK');
  });

  test('an existing active account connects on add without a link', async () => {
    const { s, composio, base } = boot({
      account: { id: 'ca-9', status: 'ACTIVE', status_reason: null, is_disabled: false },
    });
    await putKey(s);
    const created = (await (
      await req(s.app, 'POST', `${base}/composio/toolkits`, { slug: 'gmail' })
    ).json()) as { status: string; toolCount: number };
    expect(created).toMatchObject({ status: 'connected', toolCount: 3 });
    expect(composio.calls.every((call) => !call.pathname.endsWith('/link'))).toBe(true);
  });

  test('the composio key is non-grantable and not daemon-readable', async () => {
    const { s } = boot();
    await putKey(s);
    const row = s.db.select().from(secret).where(eq(secret.name, 'composio.api-key')).get();
    expect(row).toBeDefined();
    if (row === undefined) return;
    const grants = openSecretGrants({ db: s.db, box: s.secretBox }, s.team.id, [row.id], null);
    expect(grants.values).toEqual({});
    expect(grants.http).toEqual([]);
    expect(isDaemonReadSecretName('composio.api-key')).toBe(true);
    const secretsList = await (await req(s.app, 'GET', `/api/teams/${s.team.id}/secrets`)).text();
    expect(secretsList).not.toContain('ck-test');
  });

  test('composio mutations are owner-only routes', () => {
    const base = '/api/teams/t1/mcp-connectors/composio';
    expect(isOwnerOnlyRoute('PUT', `${base}/key`)).toBe(true);
    expect(isOwnerOnlyRoute('DELETE', `${base}/key`)).toBe(true);
    expect(isOwnerOnlyRoute('POST', `${base}/toolkits`)).toBe(true);
    expect(isOwnerOnlyRoute('POST', `${base}/c1/authorize`)).toBe(true);
    expect(isOwnerOnlyRoute('POST', `${base}/c1/poll`)).toBe(true);
    expect(isOwnerOnlyRoute('POST', `${base}/c1/reconnect`)).toBe(true);
    expect(isOwnerOnlyRoute('POST', `${base}/c1/revoke`)).toBe(true);
    expect(isOwnerOnlyRoute('GET', base)).toBe(false);
  });

  test('a missing key fails fast before any upstream call, then a bad slug fails validation', async () => {
    const { s, composio, base } = boot();
    const res = await req(s.app, 'POST', `${base}/composio/toolkits`, { slug: 'gmail' });
    expect(res.status).toBe(400);
    expect(composio.calls).toHaveLength(0);
    await putKey(s);
    const bad = await req(s.app, 'POST', `${base}/composio/toolkits`, { slug: 'NOT_A_SLUG' });
    expect(bad.status).toBe(400);
    expect(composio.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
});
