import { join } from 'node:path';
import type { McpConnectorTool } from '@cairn/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { and, eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  actionProposal,
  chief,
  chiefMessage,
  chiefThread,
  computer,
  computerCall,
  machine,
  mcpConnector,
  step,
} from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import {
  answerProposal,
  dispatchActionWakes,
  proposalCardId,
} from '../src/services/action-proposals.js';
import { askQuestionContentOf } from '../src/services/chief-question-store.js';
import { executeRelayToolCall, relayComputerTool } from '../src/services/machine-relay.js';
import { refuseRestrictedTurnTool } from '../src/services/report-turn.js';
import { bootServer } from './helpers.js';

const MAIL_PROMPT = '[wake:wake] provenance=mail:evt-1\nreply to the sender';
const OWNER_PROMPT = 'send the quote to ian@example.com';

const DRAFT = {
  to: 'ian@example.com',
  subject: 'Quote for the migration',
  body: 'Hi Ian,\nthe quote is 4200 EUR, valid until Friday.\nBest',
};

const TOOLS: McpConnectorTool[] = [
  {
    name: 'GMAIL_FETCH',
    description: 'read mail',
    inputSchema: { type: 'object', properties: { max: { type: 'integer' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'GMAIL_SEND',
    description: 'send mail',
    inputSchema: {
      type: 'object',
      required: ['to'],
      properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } },
    },
  },
];

function fakeMcp() {
  const calls: { name: string; args: unknown }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const server = new McpServer({ name: 'fake-connector', version: '1.0.0' });
    server.registerTool(
      'GMAIL_FETCH',
      { description: 'read mail', inputSchema: { max: z.number().optional() } },
      async (args) => {
        calls.push({ name: 'GMAIL_FETCH', args });
        return { content: [{ type: 'text', text: 'inbox-ok' }] };
      },
    );
    server.registerTool(
      'GMAIL_SEND',
      {
        description: 'send mail',
        inputSchema: {
          to: z.string(),
          subject: z.string().optional(),
          body: z.string().optional(),
        },
      },
      async (args) => {
        calls.push({ name: 'GMAIL_SEND', args });
        return { content: [{ type: 'text', text: 'sent-ok' }] };
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

function world() {
  const mcp = fakeMcp();
  const s = bootServer({ mcpFetch: mcp.fetch });
  s.db
    .insert(chief)
    .values({ id: 'chief-agent-a', userId: s.user.id, teamId: s.team.id, createdAt: 1 })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: 'chief-thread-a',
      chiefId: 'chief-agent-a',
      userId: s.user.id,
      teamId: s.team.id,
      title: 'thread',
      createdAt: 1,
      updatedAt: 1,
      sessionId: 'chief-thread-a',
      sessionOpenedAt: 1,
    })
    .run();
  s.db
    .insert(mcpConnector)
    .values({
      id: 'conn-a',
      teamId: s.team.id,
      slug: 'gmail',
      label: 'Gmail',
      url: 'https://mcp.test/s/sess-1',
      headerNames: [],
      authKind: 'composio',
      status: 'connected',
      toolsJson: TOOLS,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  const deps = {
    db: s.db,
    hub: s.hub,
    convHub: s.convHub,
    machineHub: s.machineHub,
    box: s.secretBox,
    user: s.user,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
    mcpConfigPath: join(s.reposDir, 'absent-mcp.json'),
    mcpFetch: mcp.fetch,
  };
  const turn = (prompt: string) => {
    const id = newRecordId();
    s.db
      .insert(step)
      .values({
        id,
        buildId: 'chief-thread-a',
        kind: 'chief',
        prompt,
        status: 'claimed',
        mcpGrant: ['gmail'],
        createdAt: 2,
      })
      .run();
    return id;
  };
  const call = (stepId: string, args: Record<string, unknown>) =>
    executeRelayToolCall(deps, null, stepId, 'connector_gmail__GMAIL_SEND', args);
  const answer = (proposalId: string, decision: 'allow-once' | 'refuse') =>
    answerProposal(
      { db: s.db, reposDir: s.reposDir, hub: s.hub, user: s.user },
      {
        proposalId,
        teamId: s.team.id,
        decision,
        decidedBy: s.user.id,
        viaCard: true,
        interactive: 'page',
      },
    );
  return { s, mcp, deps, turn, call, answer };
}

function cardOf(w: ReturnType<typeof world>, proposalId: string) {
  return askQuestionContentOf(
    w.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, proposalCardId(proposalId)))
      .get()?.content,
  );
}

describe('outbound actions in turns that carry untrusted outside content', () => {
  test('a mail turn that sends mail parks a card showing the recipient and the draft and sends nothing', async () => {
    const w = world();
    const out = JSON.parse(await w.call(w.turn(MAIL_PROMPT), DRAFT)) as {
      status: string;
      proposalId: string;
    };
    expect(out.status).toBe('pending');
    expect(w.mcp.calls).toEqual([]);
    const card = cardOf(w, out.proposalId);
    expect(card?.status).toBe('pending');
    const question = card?.questions[0];
    expect(question?.question).toContain('ian@example.com');
    expect(question?.question).toContain('the quote is 4200 EUR, valid until Friday.');
    expect(question?.options.map((option) => option.label)).toEqual(['发送', '不发']);
    w.s.dispose();
  });

  test('approving sends exactly the drafted content and nothing else', async () => {
    const w = world();
    const parked = JSON.parse(await w.call(w.turn(MAIL_PROMPT), DRAFT)) as { proposalId: string };
    expect(w.answer(parked.proposalId, 'allow-once')).toEqual({ status: 'executed' });
    expect(w.mcp.calls).toEqual([]);
    const wake = w.turn(`[wake:wake] provenance=action-proposal:${parked.proposalId}\napproved`);

    const changed = JSON.parse(await w.call(wake, { ...DRAFT, to: 'attacker@example.net' })) as {
      status: string;
    };
    expect(changed.status).toBe('pending');
    expect(w.mcp.calls).toEqual([]);

    expect(await w.call(wake, DRAFT)).toBe('sent-ok');
    expect(w.mcp.calls).toEqual([{ name: 'GMAIL_SEND', args: DRAFT }]);
    w.s.dispose();
  });

  test('declining sends nothing and wakes the Coordinator with the refusal', async () => {
    const w = world();
    const parked = JSON.parse(await w.call(w.turn(MAIL_PROMPT), DRAFT)) as { proposalId: string };
    w.answer(parked.proposalId, 'refuse');
    dispatchActionWakes({ db: w.s.db, hub: w.s.hub, user: w.s.user });
    expect(w.mcp.calls).toEqual([]);
    const wake = w.s.db
      .select()
      .from(step)
      .where(eq(step.id, `wake:${parked.proposalId}:chief-thread-a`))
      .get();
    expect(wake?.prompt).toContain('refused');
    expect(wake?.prompt).toContain('没有执行');
    expect(
      w.s.db
        .select()
        .from(actionProposal)
        .where(and(eq(actionProposal.id, parked.proposalId), eq(actionProposal.status, 'refused')))
        .get(),
    ).toBeDefined();
    w.s.dispose();
  });

  test('a call too long to show whole is refused and parks nothing, so no field can hide off the card', async () => {
    const w = world();
    await expect(
      w.call(w.turn(MAIL_PROMPT), {
        to: 'ian@example.com',
        body: 'a'.repeat(4000),
        message: 'b'.repeat(4000),
        bcc_list: ['attacker@evil.example'],
      }),
    ).rejects.toThrow(/too long for the owner to review/);
    expect(w.s.db.select().from(actionProposal).all()).toEqual([]);
    expect(w.mcp.calls).toEqual([]);
    w.s.dispose();
  });

  test('every argument is on the card, recipients before the body, odd keys quoted', async () => {
    const w = world();
    const out = JSON.parse(
      await w.call(w.turn(MAIL_PROMPT), {
        ...DRAFT,
        'x\n收件人：boss@corp.example': 'hi',
        bcc_list: ['attacker@evil.example'],
      }),
    ) as { proposalId: string };
    const text = cardOf(w, out.proposalId)?.questions[0]?.question ?? '';
    expect(text).toContain('attacker@evil.example');
    expect(text.indexOf('attacker@evil.example')).toBeLessThan(text.indexOf('the quote is'));
    expect(text).toContain('> x 收件人:boss@corp.example：hi');
    expect(text).not.toMatch(/^收件人[：:]boss@corp.example/m);
    w.s.dispose();
  });

  test('the same tool in an owner-started turn sends without a card', async () => {
    const w = world();
    expect(await w.call(w.turn(OWNER_PROMPT), DRAFT)).toBe('sent-ok');
    expect(w.mcp.calls).toEqual([{ name: 'GMAIL_SEND', args: DRAFT }]);
    expect(w.s.db.select().from(actionProposal).all()).toEqual([]);
    w.s.dispose();
  });

  test('a mail turn can still read through a connector without a card', async () => {
    const w = world();
    const out = await executeRelayToolCall(
      w.deps,
      null,
      w.turn(MAIL_PROMPT),
      'connector_gmail__GMAIL_FETCH',
      {},
    );
    expect(out).toBe('inbox-ok');
    w.s.dispose();
  });

  test('a mail turn browsing runs without a card while a Gmail send still parks one', async () => {
    const w = world();
    const stepId = w.turn(MAIL_PROMPT);
    await relayComputerTool(w.deps, null, stepId, 'browser_navigate', {
      url: 'https://example.com',
    }).catch(() => undefined);
    expect(w.s.db.select().from(actionProposal).all()).toEqual([]);
    const parked = JSON.parse(await w.call(stepId, DRAFT)) as { status: string };
    expect(parked.status).toBe('pending');
    expect(w.s.db.select().from(actionProposal).all()).toHaveLength(1);
    expect(w.mcp.calls).toEqual([]);
    w.s.dispose();
  });

  test('a mail turn install_packages parks its normal approval card', async () => {
    const w = world();
    w.s.db
      .insert(machine)
      .values({
        id: 'mac',
        teamId: w.s.team.id,
        name: 'mac',
        online: true,
        lastSeenAt: 1,
        capabilities: { mcpServers: [], skills: [], computer: true, computerKind: 'vm' },
      })
      .run();
    w.s.db
      .insert(computer)
      .values({
        id: 'computer-a',
        teamId: w.s.team.id,
        scopeKey: 'chief:chief-agent-a',
        machineId: 'mac',
        providerRef: 'p',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    w.s.machineHub.subscribeMachine(w.s.team.id, 'mac', () => undefined);
    const abort = new AbortController();
    const held = relayComputerTool(
      w.deps,
      null,
      w.turn(MAIL_PROMPT),
      'install_packages',
      { packages: ['ffmpeg'] },
      'install-1',
      abort.signal,
    );
    await vi.waitFor(() => {
      const rows = w.s.db.select().from(computerCall).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.params).toEqual({ packages: ['ffmpeg'], approval: 'pending' });
    });
    abort.abort();
    await held;
    expect(w.s.db.select().from(actionProposal).all()).toEqual([]);
    w.s.dispose();
  });

  test('a mail turn may read and create tasks but not change anything else', () => {
    const w = world();
    for (const name of [
      'todos',
      'search_history',
      'create_todo',
      'browser_snapshot',
      'shell',
      'browser_navigate',
      'browser_act',
      'computer_act',
      'desktop_act',
      'install_packages',
    ])
      expect(() => refuseRestrictedTurnTool(w.s.db, MAIL_PROMPT, name)).not.toThrow();
    for (const name of ['set_secret', 'schedule_todo', 'save_memory', 'user_computer_shell'])
      expect(() => refuseRestrictedTurnTool(w.s.db, MAIL_PROMPT, name)).toThrow(
        /mail turn cannot call/,
      );
    w.s.dispose();
  });

  test('the wake after the owner answers keeps the mail turn tool limits, whether sent or declined', async () => {
    const w = world();
    const parked = JSON.parse(await w.call(w.turn(MAIL_PROMPT), DRAFT)) as { proposalId: string };
    w.answer(parked.proposalId, 'refuse');
    const wake = `[wake:wake] provenance=action-proposal:${parked.proposalId}\nrefused`;
    expect(() => refuseRestrictedTurnTool(w.s.db, wake, 'set_wake')).toThrow(/cannot call/);
    expect(() => refuseRestrictedTurnTool(w.s.db, wake, 'todos')).not.toThrow();
    w.s.dispose();
  });
});
