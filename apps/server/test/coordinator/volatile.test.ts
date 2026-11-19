import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fenceMailText } from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { UserEntry } from '@earendil-works/pi-durable';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import {
  activeConversation,
  withRegisteredMailConversation,
} from '../../src/coordinator/runtime/conversations.js';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { stepProvider } from '../../src/coordinator/runtime/provider.js';
import {
  coordinatorToolsExtension,
  createConversationGate,
} from '../../src/coordinator/runtime/tools.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
import {
  createVolatileContext,
  shortenEarlierEvents,
  volatileContextExtension,
  withVolatileSection,
} from '../../src/coordinator/runtime/volatile.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';

const ctx = BACKGROUND_CONTEXT;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

describe('volatile turn context', () => {
  it('stays on the message it was sent with while the cache is warm and is never stored', async () => {
    const dir = makeTestTempDir('coord-volatile-');
    dirs.push(dir);
    const requests: string[] = [];
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    faux.setResponses(
      Array(4).fill((c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage('ok');
      }),
    );
    const models = createCoordinatorModels([faux.provider]);
    const volatile = createVolatileContext();
    let clock = 0;
    const harness = await openCoordinatorHarness(join(dir, 's.sqlite'), models.models, ctx, {
      extensions: [volatileContextExtension(volatile, { now: () => clock, reuseMs: 1_000 })],
    });
    const api = fakeMachineApi();
    const deps = {
      harness,
      models,
      api,
      context: ctx,
      heartbeatMs: 1000,
      now: () => 1,
      conversationGate: createConversationGate(),
      volatile,
    };

    await runCoordinatorTurn(
      { ...deps, volatileText: 'PROJECT-A-SECTION' },
      chiefStep('s1', 'first prompt'),
    );
    await runCoordinatorTurn(
      { ...deps, volatileText: 'PROJECT-B-SECTION' },
      chiefStep('s2', 'second prompt'),
    );

    clock = 5_000;
    await runCoordinatorTurn(
      { ...deps, volatileText: 'PROJECT-C-SECTION' },
      chiefStep('s3', 'third prompt'),
    );

    expect(requests).toHaveLength(3);
    expect(requests[0]).toContain('PROJECT-A-SECTION');
    expect(requests[1]).toContain('first prompt\\n\\nPROJECT-A-SECTION');
    expect(requests[1]).toContain('second prompt\\n\\nPROJECT-B-SECTION');
    expect(requests[2]).not.toContain('PROJECT-A-SECTION');
    expect(requests[2]).not.toContain('PROJECT-B-SECTION');
    expect(requests[2]).toContain('third prompt\\n\\nPROJECT-C-SECTION');
    const root = await harness.root(ctx);
    const stored = (await root.entries({}, 50, undefined, ctx)).items
      .filter((entry) => UserEntry.is(entry))
      .map((entry) => JSON.stringify(entry.model));
    expect(stored).toHaveLength(3);
    expect(stored.join('')).not.toContain('SECTION');
    expect(stored.join('')).toContain('first prompt');
    expect(stored.join('')).toContain('second prompt');
    await harness.close(ctx);
  });

  it('appends to the last user message in string and block form', () => {
    const base = { timestamp: 1 };
    const text = withVolatileSection(
      [
        { role: 'user', content: 'a', ...base },
        { role: 'user', content: 'b', ...base },
      ],
      'S',
    );
    expect(text[0]?.role === 'user' && text[0].content).toBe('a');
    expect(text[1]?.role === 'user' && text[1].content).toBe('b\n\nS');
    const blocks = withVolatileSection(
      [{ role: 'user', content: [{ type: 'text', text: 'x' }], ...base }],
      'S',
    );
    expect(JSON.stringify(blocks)).toContain('"text":"\\n\\nS"');
  });
});

describe('a mail wake does not leave fenced text in the next turn', () => {
  it('runs the mail wake on a registered side conversation and restores the owner one', async () => {
    const dir = makeTestTempDir('coord-mail-registered-');
    dirs.push(dir);
    const requests: string[] = [];
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    faux.setResponses([
      (c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage('ok');
      },
      (c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage('echo MAIL-SECRET-EXCERPT-9f3a');
      },
      (c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage('ok');
      },
    ]);
    const models = createCoordinatorModels([faux.provider]);
    const volatile = createVolatileContext();
    let registered = '';
    const harness = await openCoordinatorHarness(join(dir, 's.sqlite'), models.models, ctx, {
      extensions: [
        coordinatorToolsExtension(fakeMachineApi(), createConversationGate(), {
          beforeTool: async (_signal, conversationId) => {
            if (registered !== '' && conversationId !== registered) {
              throw new Error(`unregistered conversation ${conversationId}`);
            }
          },
        }),
        volatileContextExtension(volatile),
      ],
    });
    registered = String((await harness.root(ctx)).id);
    const deps = {
      harness,
      models,
      api: fakeMachineApi(),
      context: ctx,
      heartbeatMs: 1000,
      now: () => 1,
      conversationGate: createConversationGate(),
      volatile,
    };
    const owner = registered;
    const secret = 'MAIL-SECRET-EXCERPT-9f3a';
    await runCoordinatorTurn(deps, chiefStep('owner', 'PRIOR-OWNER'));
    const mail = `[wake:wake] provenance=mail:evt-1\n邮件事件 evt-1，账户 acc，外部编号 ext，规则 Payroll。\n${fenceMailText('ext', secret)}`;
    await withRegisteredMailConversation(
      harness,
      ctx,
      owner,
      (id) => {
        registered = id;
      },
      (id) => runCoordinatorTurn({ ...deps, conversationId: id }, chiefStep('evt-1', mail)),
    );
    expect(registered).toBe(owner);
    await runCoordinatorTurn({ ...deps, conversationId: owner }, chiefStep('next', 'what next'));
    const continued = await activeConversation(harness, owner, ctx);
    const inherited = JSON.stringify((await continued?.context(ctx))?.messages);
    expect(requests[1]).toContain(secret);
    expect(requests[1]).not.toContain('PRIOR-OWNER');
    expect(inherited).toContain('PRIOR-OWNER');
    expect(inherited).not.toContain(secret);
    expect(inherited).not.toContain('echo MAIL-SECRET');
    await harness.close(ctx);
  });
});

describe('earlier events reach the model in short form once the cache is cold', () => {
  const t = { timestamp: 1 };
  const big = (id: string) =>
    `[wake:settle] provenance=watch:t1\n${'report line '.repeat(3_000)}\n\n[history id: ${id}]`;

  it('shortens events before the latest user message and keeps the latest whole', () => {
    const out = shortenEarlierEvents([
      { role: 'user', content: big('s1'), ...t },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'x',
        provider: 'p',
        model: 'm',
        usage: {} as never,
        stopReason: 'stop',
        ...t,
      },
      { role: 'user', content: big('s2'), ...t },
    ]);
    const first = out[0]?.role === 'user' ? String(out[0].content) : '';
    const last = out[2]?.role === 'user' ? String(out[2].content) : '';
    expect(first.length).toBeLessThan(600);
    expect(first).toContain('read_history ids ["s1"]');
    expect(last.length).toBeGreaterThan(30_000);
  });

  it('keeps the event of the running step whole even after a steered message follows it', () => {
    const out = shortenEarlierEvents(
      [
        { role: 'user', content: big('user-s2'), ...t },
        { role: 'user', content: 'also check the other repo', ...t },
      ],
      's2',
    );
    expect(out[0]?.role === 'user' && String(out[0].content).length).toBeGreaterThan(30_000);
  });

  it('leaves ordinary user messages untouched however long they are', () => {
    const long = 'z'.repeat(20_000);
    const out = shortenEarlierEvents([
      { role: 'user', content: long, ...t },
      { role: 'user', content: 'next', ...t },
    ]);
    expect(out[0]?.role === 'user' && out[0].content).toBe(long);
  });

  it('shortens block-form events and never touches the stored entry', async () => {
    const dir = makeTestTempDir('coord-events-');
    dirs.push(dir);
    const requests: string[] = [];
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    faux.setResponses(
      Array(4).fill((c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage('ok');
      }),
    );
    const models = createCoordinatorModels([faux.provider]);
    const volatile = createVolatileContext();
    let clock = 0;
    const harness = await openCoordinatorHarness(join(dir, 's.sqlite'), models.models, ctx, {
      extensions: [volatileContextExtension(volatile, { now: () => clock, reuseMs: 1_000 })],
    });
    const deps = {
      harness,
      models,
      api: fakeMachineApi(),
      context: ctx,
      heartbeatMs: 1000,
      now: () => 1,
      conversationGate: createConversationGate(),
      volatile,
    };
    const fullEvent = `[wake:settle] provenance=watch:t1\n${'EVENT-BODY '.repeat(2_000)}TAIL-MARK`;
    await runCoordinatorTurn(deps, chiefStep('ev-1', fullEvent));
    await runCoordinatorTurn(deps, chiefStep('s2', 'what happened?'));
    clock = 5_000;
    await runCoordinatorTurn(deps, chiefStep('s3', 'and now?'));
    expect(requests[0]).toContain('TAIL-MARK');
    expect(requests[1]).toContain('TAIL-MARK');
    expect(requests[2]).not.toContain('TAIL-MARK');
    expect(requests[2]).toContain('[event settle]');
    const stored = (await (await harness.root(ctx)).entries({}, 50, undefined, ctx)).items
      .filter((entry) => UserEntry.is(entry))
      .map((entry) => JSON.stringify(entry.model))
      .join('');
    expect(stored).toContain('TAIL-MARK');
    await harness.close(ctx);
  });
});

interface BoundRequest {
  status: number;
  body: { messages: { role: string; content: unknown }[] };
}

async function anthropicWithThinkingBinding() {
  const prefixes = new Map<string, { items: string[]; paths: string[] }>();
  const requests: BoundRequest[] = [];
  let next = 0;
  const canonical = (value: unknown) =>
    JSON.stringify(value, (key, inner) => (key === 'cache_control' ? undefined : inner));
  const blocksOf = (content: unknown): unknown[] =>
    typeof content === 'string' ? [{ type: 'text', text: content }] : (content as unknown[]);
  const prefixOf = (
    body: { system?: unknown; tools?: unknown; messages: { role: string; content: unknown }[] },
    message: number,
    block: number,
  ) => {
    const items = [canonical({ system: body.system, tools: body.tools })];
    const paths = ['system'];
    body.messages.slice(0, message).forEach((m, i) => {
      items.push(m.role);
      paths.push(`messages.${i}`);
      blocksOf(m.content).forEach((b, j) => {
        items.push(canonical(b));
        paths.push(`messages.${i}.content.${j}`);
      });
    });
    items.push(body.messages[message]?.role ?? 'assistant');
    paths.push(`messages.${message}`);
    blocksOf(body.messages[message]?.content ?? [])
      .slice(0, block)
      .forEach((b, j) => {
        items.push(canonical(b));
        paths.push(`messages.${message}.content.${j}`);
      });
    return { items, paths };
  };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = JSON.parse(raw) as BoundRequest['body'] & { system?: unknown; tools?: unknown };
      for (const [i, m] of body.messages.entries()) {
        if (m.role !== 'assistant') continue;
        for (const [j, b] of blocksOf(m.content).entries()) {
          const block = b as { type?: string; signature?: string };
          if (block.type !== 'thinking') continue;
          const created = prefixes.get(block.signature ?? '');
          const now = prefixOf(body, i, j);
          const differs =
            created === undefined ? 0 : created.items.findIndex((item, k) => now.items[k] !== item);
          if (created !== undefined && differs === -1 && created.items.length === now.items.length)
            continue;
          requests.push({ status: 400, body });
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message: `messages.${i}.content.${j}: Invalid \`signature\` in \`thinking\` block. The block is bound to a different conversation. Remove the block, or set \`thinking.block_binding.prefix_mismatch_behavior\` to "drop_block". Content before this block differs from when it was created, first at \`${now.paths[Math.max(differs, 0)]}\`.`,
              },
            }),
          );
          return;
        }
      }
      requests.push({ status: 200, body });
      const signature = `sig-${++next}`;
      prefixes.set(signature, prefixOf(body, body.messages.length, 0));
      const events: [string, unknown][] = [
        [
          'message_start',
          {
            type: 'message_start',
            message: {
              id: `msg_${next}`,
              type: 'message',
              role: 'assistant',
              model: 'claude-opus-5-5',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 1 },
            },
          },
        ],
        [
          'content_block_start',
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          },
        ],
        [
          'content_block_delta',
          { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature } },
        ],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        [
          'content_block_start',
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'text', text: '' },
          },
        ],
        [
          'content_block_delta',
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'ok' } },
        ],
        ['content_block_stop', { type: 'content_block_stop', index: 1 }],
        [
          'message_delta',
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 5 },
          },
        ],
        ['message_stop', { type: 'message_stop' }],
      ];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        events
          .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          .join(''),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('replayed thinking keeps the prefix it was signed with', () => {
  const thinkingIn = (request: BoundRequest | undefined) =>
    (request?.body.messages ?? []).flatMap((m) =>
      blocksIn(m.content).filter((b) => (b as { type?: string }).type === 'thinking'),
    );
  const blocksIn = (content: unknown): unknown[] => (Array.isArray(content) ? content : []);

  const open = async (dir: string, baseUrl: string, volatile = createVolatileContext()) => {
    const provider = stepProvider(
      {
        kind: 'http',
        providerId: 'stub',
        api: 'anthropic-messages',
        baseUrl,
        models: [{ id: 'claude-opus-5-5', name: 'claude-opus-5-5' }],
        compat: { supportsDeveloperRole: false },
      },
      () => 'sk-test',
    );
    if (provider === null) throw new Error('provider did not build');
    const models = createCoordinatorModels([provider]);
    const harness = await openCoordinatorHarness(join(dir, 's.sqlite'), models.models, ctx, {
      extensions: [volatileContextExtension(volatile)],
    });
    const deps = {
      harness,
      models,
      api: fakeMachineApi(),
      context: ctx,
      heartbeatMs: 1000,
      now: () => 1,
      conversationGate: createConversationGate(),
      volatile,
    };
    const turn = (id: string, prompt: string, section: string) =>
      runCoordinatorTurn(
        { ...deps, volatileText: section },
        chiefStep(id, prompt, 'You are the Coordinator.', 'claude-opus-5-5', 'stub'),
      );
    return { harness, turn };
  };

  it('sends the next turn without a binding 400 when the project context changes', async () => {
    const dir = makeTestTempDir('coord-binding-');
    dirs.push(dir);
    const anthropic = await anthropicWithThinkingBinding();
    try {
      const { harness, turn } = await open(dir, anthropic.baseUrl);
      const first = await turn('s1', 'update the project memory', '## 项目记忆（Cairn）\n- one');
      const second = await turn(
        's2',
        'should this go in AGENTS.md?',
        '## 项目记忆（Cairn）\n- two',
      );
      expect(anthropic.requests.map((request) => request.status)).toEqual([200, 200]);
      expect([first.status, second.status]).not.toContain('failed');
      expect(thinkingIn(anthropic.requests[1])).toHaveLength(1);
      await harness.close(ctx);
    } finally {
      await anthropic.close();
    }
  });

  it('recovers a conversation whose saved thinking no longer matches by acting on the 400', async () => {
    const dir = makeTestTempDir('coord-binding-restart-');
    dirs.push(dir);
    const anthropic = await anthropicWithThinkingBinding();
    try {
      const before = await open(dir, anthropic.baseUrl);
      await before.turn('s1', 'update the project memory', '## 项目记忆（Cairn）\n- one');
      await before.harness.close(ctx);
      const after = await open(dir, anthropic.baseUrl);
      const second = await after.turn(
        's2',
        'should this go in AGENTS.md?',
        '## 项目记忆（Cairn）\n- two',
      );
      const third = await after.turn('s3', 'test', '## 项目记忆（Cairn）\n- two');
      expect(anthropic.requests.map((request) => request.status)).toEqual([200, 400, 200, 200]);
      expect([second.status, third.status]).not.toContain('failed');
      expect(thinkingIn(anthropic.requests[1])).toHaveLength(1);
      expect(thinkingIn(anthropic.requests[2])).toHaveLength(0);
      expect(thinkingIn(anthropic.requests[3])).toHaveLength(1);
      await after.harness.close(ctx);
    } finally {
      await anthropic.close();
    }
  });
});
