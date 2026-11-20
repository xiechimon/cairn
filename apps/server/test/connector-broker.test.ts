import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { actionJournal, actionProposal, chief, chiefThread, step } from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { answerProposal, dispatchActionWakes } from '../src/services/action-proposals.js';
import {
  type ConnectorBrokerDeps,
  type ConnectorCallContext,
  connectorToolDefsForTeam,
  executeConnectorToolCall,
} from '../src/services/connector-broker.js';
import { newMcpOAuthState } from '../src/services/mcp-servers.js';
import { fakeMcp, insertConnector } from './fake-mcp-connector.js';
import { bootServer, type TestServer } from './helpers.js';

function world(opts: { untrustedTurn?: boolean } = {}) {
  const mcp = fakeMcp();
  const s = bootServer({ mcpFetch: mcp.fetch });
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
    ...(opts.untrustedTurn === true ? { untrustedTurn: true } : {}),
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
    expect(defs[1]?.parameters).toEqual({
      type: 'object',
      required: ['to'],
      properties: { to: { type: 'string' }, body: { type: 'string' } },
    });
    s.dispose();
  });

  test('sanitizes third-party inputSchema into the daemon tool vocabulary', () => {
    const { s } = world();
    insertConnector(s, {
      toolsJson: [
        {
          name: 'GMAIL_LIST',
          description: 'list mail',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['label'],
            properties: {
              label: { type: 'string', enum: ['INBOX', 'SENT'], default: 'INBOX' },
              max: { type: 'integer', minimum: 1 },
              filter: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
              cursor: { type: ['string', 'null'] },
            },
          },
        },
      ],
    });
    const defs = connectorToolDefsForTeam(s.db, s.team.id);
    expect(defs[0]?.parameters).toEqual({
      type: 'object',
      required: ['label'],
      properties: {
        label: { type: 'string' },
        max: { type: 'integer' },
        filter: { type: 'string' },
        cursor: { type: 'string' },
      },
    });
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

  test.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'])(
    'rejects the extra key %s under additionalProperties:false instead of reading it off the prototype',
    async (extra) => {
      const { s, mcp, deps, ctx } = world();
      insertConnector(s);
      const params = JSON.parse(`{"to":"a@b.c","${extra}":{}}`) as Record<string, unknown>;
      await expectHttpError(
        () => executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_SEND', params),
        400,
        new RegExp(`unexpected ${extra}`),
      );
      expect(mcp.calls).toHaveLength(0);
      s.dispose();
    },
  );

  test.each(['toString', 'constructor', '__proto__'])(
    'rejects a call that never sent the required key %s instead of seeing the inherited member',
    async (required) => {
      const { s, mcp, deps, ctx } = world();
      insertConnector(s, {
        toolsJson: [
          {
            name: 'PING',
            description: 'ping',
            inputSchema: {
              type: 'object',
              required: ['to', required],
              properties: {
                to: { type: 'string' },
                [required]: { type: 'string' },
              },
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
          },
        ],
      });
      await expectHttpError(
        () => executeConnectorToolCall(deps, ctx, 'connector_gmail__PING', { to: 'a@b.c' }),
        400,
        new RegExp(`missing ${required}`),
      );
      expect(mcp.calls).toHaveLength(0);
      s.dispose();
    },
  );

  test('the extra-key check also applies inside a nested object property', async () => {
    const { s, mcp, deps, ctx } = world();
    insertConnector(s, {
      toolsJson: [
        {
          name: 'PING',
          description: 'ping',
          inputSchema: {
            type: 'object',
            properties: {
              cfg: {
                type: 'object',
                properties: { x: { type: 'string' } },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
        },
      ],
    });
    await expectHttpError(
      () => executeConnectorToolCall(deps, ctx, 'connector_gmail__PING', { cfg: { toString: 1 } }),
      400,
      /unexpected toString/,
    );
    expect(mcp.calls).toHaveLength(0);
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

  test('an unannotated tool defaults to external and dispatches in a trusted turn', async () => {
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

  test('an untrusted turn parks the call as a proposal and approval covers the retry', async () => {
    const { s, mcp, deps, ctx } = world({ untrustedTurn: true });
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

  test('the wake after approval hands back the approved arguments so the retry sends without a second card', async () => {
    const { s, mcp, deps, ctx } = world({ untrustedTurn: true });
    insertConnector(s);
    const draft = { to: 'a@b.c', body: '收到，回信测试通过。' };
    const parked = JSON.parse(
      await executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_SEND', draft),
    ) as { proposalId: string };
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
    dispatchActionWakes(s);
    const prompt = s.db.select().from(step).get()?.prompt ?? '';
    const copied = /已批准的参数：(\{.*\})/.exec(prompt)?.[1];
    const retry =
      copied === undefined
        ? { ...draft, body: draft.body.normalize('NFKC') }
        : (JSON.parse(copied) as Record<string, unknown>);

    const out = await executeConnectorToolCall(deps, ctx, 'connector_gmail__GMAIL_SEND', retry);
    expect(out).toBe('sent-ok');
    expect(mcp.calls).toMatchObject([{ name: 'GMAIL_SEND', args: draft }]);
    expect(s.db.select().from(actionProposal).all()).toHaveLength(1);
    s.dispose();
  });

  test('changed args after approval are not covered by the earlier grant', async () => {
    const { s, mcp, deps, ctx } = world({ untrustedTurn: true });
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
