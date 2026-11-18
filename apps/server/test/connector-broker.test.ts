import { join } from 'node:path';
import type { McpConnectorStatus, McpConnectorTool } from '@cairn/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  actionJournal,
  actionProposal,
  chief,
  chiefThread,
  mcpConnector,
  team as teamTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { answerProposal } from '../src/services/action-proposals.js';
import {
  type ConnectorBrokerDeps,
  type ConnectorCallContext,
  connectorToolDefsForTeam,
  executeConnectorToolCall,
} from '../src/services/connector-broker.js';
import { newMcpOAuthState } from '../src/services/mcp-servers.js';
import { bootServer, type TestServer } from './helpers.js';

function fakeMcp() {
  const calls: { name: string; args: unknown }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const server = new McpServer({ name: 'fake-connector', version: '1.0.0' });
    server.registerTool(
      'GMAIL_FETCH',
      {
        description: 'read mail',
        inputSchema: { max: z.number().optional() },
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        calls.push({ name: 'GMAIL_FETCH', args });
        return { content: [{ type: 'text', text: 'inbox-ok' }] };
      },
    );
    server.registerTool(
      'GMAIL_SEND',
      { description: 'send mail', inputSchema: { to: z.string(), body: z.string().optional() } },
      async (args) => {
        calls.push({ name: 'GMAIL_SEND', args });
        return { content: [{ type: 'text', text: 'sent-ok' }] };
      },
    );
    server.registerTool(
      'GMAIL_DELETE',
      {
        description: 'delete mail',
        inputSchema: { id: z.string() },
        annotations: { destructiveHint: true },
      },
      async (args) => {
        calls.push({ name: 'GMAIL_DELETE', args });
        return { content: [{ type: 'text', text: 'deleted-ok' }] };
      },
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const TOOLS: McpConnectorTool[] = [
  {
    name: 'GMAIL_FETCH',
    description: 'read mail',
    inputSchema: {
      type: 'object',
      properties: { max: { type: 'integer' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'GMAIL_SEND',
    description: 'send mail',
    inputSchema: {
      type: 'object',
      required: ['to'],
      properties: { to: { type: 'string' }, body: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'GMAIL_DELETE',
    description: 'delete mail',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
];

function insertConnector(
  s: TestServer,
  opts: { slug?: string; status?: McpConnectorStatus; toolsJson?: McpConnectorTool[] } = {},
): string {
  const id = `conn-${Math.random().toString(36).slice(2, 10)}`;
  s.db
    .insert(mcpConnector)
    .values({
      id,
      teamId: s.team.id,
      slug: opts.slug ?? 'gmail',
      label: 'Gmail',
      url: 'https://mcp.test/s/sess-1',
      headerNames: [],
      authKind: 'composio',
      status: opts.status ?? 'connected',
      toolsJson: opts.toolsJson ?? TOOLS,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  return id;
}

function world(opts: { tier?: 'guarded' | 'full' } = {}) {
  const mcp = fakeMcp();
  const s = bootServer({ mcpFetch: mcp.fetch });
  if (opts.tier === 'guarded') s.db.update(teamTable).set({ actionTier: 'guarded' }).run();
  s.db
    .insert(chief)
    .values({ id: 'chief-a', userId: s.user.id, teamId: s.team.id, createdAt: 1 })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: 'thread-a',
      chiefId: 'chief-a',
      userId: s.user.id,
      teamId: s.team.id,
      title: 'thread',
      createdAt: 1,
      updatedAt: 1,
      sessionId: 'thread-a',
      sessionOpenedAt: 1,
    })
    .run();
  const deps: ConnectorBrokerDeps = {
    db: s.db,
    mcp: {
      db: s.db,
      box: s.secretBox,
      mcpConfigPath: join(s.reposDir, 'absent-mcp.json'),
      fetch: mcp.fetch,
      oauthFetch: mcp.fetch,
      oauthState: newMcpOAuthState(),
    },
    reposDir: s.reposDir,
    hub: s.hub,
    convHub: s.convHub,
    user: s.user,
  };
  const ctx: ConnectorCallContext = {
    teamId: s.team.id,
    threadId: 'thread-a',
    scopeProjectId: null,
  };
  return { s, mcp, deps, ctx };
}

function journalRows(s: TestServer) {
  return s.db.select().from(actionJournal).where(eq(actionJournal.teamId, s.team.id)).all();
}

async function expectHttpError(
  call: () => Promise<string>,
  status: number,
  match: RegExp,
): Promise<void> {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
    expect((error as HttpError).message).toMatch(match);
    return;
  }
  throw new Error('expected an HttpError');
}

describe('connectorToolDefsForTeam', () => {
  test('emits connector_<slug>__<tool> defs for connected rows only', () => {
    const { s } = world();
    insertConnector(s);
    insertConnector(s, { slug: 'notion', status: 'needs_auth' });
    insertConnector(s, { slug: 'slack', status: 'revoked' });
    const defs = connectorToolDefsForTeam(s.db, s.team.id);
    expect(defs.map((def) => def.name)).toEqual([
      'connector_gmail__GMAIL_FETCH',
      'connector_gmail__GMAIL_SEND',
      'connector_gmail__GMAIL_DELETE',
    ]);
    expect(defs[1]?.parameters).toEqual(TOOLS[1]?.inputSchema);
    s.dispose();
  });
});

describe('executeConnectorToolCall validation', () => {
  test.each([
    'connector_',
    'connector_gmail',
    'connector__GMAIL_FETCH',
    'connector_gmail__',
    'gmail__GMAIL_FETCH',
  ])('rejects the garbled name %s without an upstream call or journal', async (name) => {
    const { s, mcp, deps, ctx } = world();
    insertConnector(s);
    await expectHttpError(
      () => executeConnectorToolCall(deps, ctx, name, {}),
      400,
      /unknown connector tool/,
    );
    expect(mcp.calls).toHaveLength(0);
    expect(journalRows(s)).toHaveLength(0);
    s.dispose();
  });

  test('rejects an unknown slug and journals the error', async () => {
    const { s, mcp, deps, ctx } = world();
    await expectHttpError(
      () => executeConnectorToolCall(deps, ctx, 'connector_nope__X', {}),
      400,
      /unknown connector nope/,
    );
    expect(journalRows(s)).toMatchObject([
      { actionId: 'connector.nope.X', targetId: 'nope', kind: 'error', actor: 'coordinator' },
    ]);
    expect(mcp.calls).toHaveLength(0);
    s.dispose();
  });

  test('rejects a connector that is not connected', async () => {
    const { s, mcp, deps, ctx } = world();
    insertConnector(s, { status: 'needs_auth' });
    await expectHttpError(
      () => executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_FETCH', {}),
      409,
      /is needs_auth/,
    );
    insertConnector(s, { slug: 'dead', status: 'revoked' });
    await expectHttpError(
      () => executeConnectorToolCall(deps, ctx, 'connector_dead__GMAIL_FETCH', {}),
      409,
      /is revoked/,
    );
    expect(mcp.calls).toHaveLength(0);
    expect(journalRows(s).filter((row) => row.kind === 'error')).toHaveLength(2);
    s.dispose();
  });

  test('rejects a tool missing from the cached tools/list', async () => {
    const { s, mcp, deps, ctx } = world();
    insertConnector(s);
    await expectHttpError(
      () => executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_FAKE', {}),
      400,
      /has no tool GMAIL_FAKE/,
    );
    expect(mcp.calls).toHaveLength(0);
    s.dispose();
  });

  test('rejects arguments that fail the cached input schema', async () => {
    const { s, mcp, deps, ctx } = world();
    insertConnector(s);
    await expectHttpError(
      () => executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_SEND', {}),
      400,
      /missing to/,
    );
    await expectHttpError(
      () => executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_SEND', { to: 42 }),
      400,
      /expected string/,
    );
    await expectHttpError(
      () => executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_FETCH', { smuggle: true }),
      400,
      /unexpected smuggle/,
    );
    expect(mcp.calls).toHaveLength(0);
    expect(journalRows(s).filter((row) => row.kind === 'error')).toHaveLength(3);
    s.dispose();
  });
});

describe('executeConnectorToolCall dispatch', () => {
  test('a read-only tool dispatches directly and journals the run', async () => {
    const { s, mcp, deps, ctx } = world();
    insertConnector(s);
    const out = await executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_FETCH', {
      max: 5,
    });
    expect(out).toBe('inbox-ok');
    expect(mcp.calls).toMatchObject([{ name: 'GMAIL_FETCH', args: { max: 5 } }]);
    expect(journalRows(s)).toMatchObject([
      { actionId: 'connector.gmail.GMAIL_FETCH', targetId: 'gmail', kind: 'run' },
    ]);
    s.dispose();
  });

  test('an unannotated tool defaults to external and dispatches under full autonomy', async () => {
    const { s, mcp, deps, ctx } = world();
    insertConnector(s);
    const out = await executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_SEND', {
      to: 'a@b.c',
    });
    expect(out).toBe('sent-ok');
    expect(mcp.calls).toMatchObject([{ name: 'GMAIL_SEND', args: { to: 'a@b.c' } }]);
    expect(journalRows(s)).toMatchObject([{ actionId: 'connector.gmail.GMAIL_SEND', kind: 'run' }]);
    s.dispose();
  });

  test('guarded autonomy parks the call as a proposal and approval covers the retry', async () => {
    const { s, mcp, deps, ctx } = world({ tier: 'guarded' });
    insertConnector(s);
    const parked = JSON.parse(
      await executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_DELETE', { id: 'm1' }),
    ) as { status: string; proposalId: string };
    expect(parked.status).toBe('pending');
    expect(mcp.calls).toHaveLength(0);
    const proposal = s.db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.id, parked.proposalId))
      .get();
    expect(proposal).toMatchObject({ actionId: 'connector.gmail.GMAIL_DELETE', status: 'pending' });

    answerProposal(
      { db: s.db, reposDir: s.reposDir, hub: s.hub, user: s.user },
      {
        proposalId: parked.proposalId,
        teamId: s.team.id,
        decision: 'allow-once',
        decidedBy: s.user.id,
        viaCard: true,
      },
    );
    expect(mcp.calls).toHaveLength(0);

    const out = await executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_DELETE', {
      id: 'm1',
    });
    expect(out).toBe('deleted-ok');
    expect(mcp.calls).toMatchObject([{ name: 'GMAIL_DELETE', args: { id: 'm1' } }]);
    expect(journalRows(s).filter((row) => row.kind === 'run')).toHaveLength(1);
    s.dispose();
  });

  test('changed args after approval are not covered by the earlier grant', async () => {
    const { s, mcp, deps, ctx } = world({ tier: 'guarded' });
    insertConnector(s);
    const parked = JSON.parse(
      await executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_DELETE', { id: 'm1' }),
    ) as { status: string; proposalId: string };
    answerProposal(
      { db: s.db, reposDir: s.reposDir, hub: s.hub, user: s.user },
      {
        proposalId: parked.proposalId,
        teamId: s.team.id,
        decision: 'allow-once',
        decidedBy: s.user.id,
        viaCard: true,
      },
    );
    const again = JSON.parse(
      await executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_DELETE', { id: 'm2' }),
    ) as { status: string };
    expect(again.status).toBe('pending');
    expect(mcp.calls).toHaveLength(0);
    s.dispose();
  });
});
