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
  it('reaches only the request of its own turn and is never stored', async () => {
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
    const harness = await openCoordinatorHarness(join(dir, 's.sqlite'), models.models, ctx, {
      extensions: [volatileContextExtension(volatile)],
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

    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain('PROJECT-A-SECTION');
    expect(requests[1]).toContain('PROJECT-B-SECTION');
    expect(requests[1]).not.toContain('PROJECT-A-SECTION');
    const root = await harness.root(ctx);
    const stored = (await root.entries({}, 50, undefined, ctx)).items
      .filter((entry) => UserEntry.is(entry))
      .map((entry) => JSON.stringify(entry.model));
    expect(stored).toHaveLength(2);
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

describe('earlier events reach the model in short form', () => {
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

  it('on a cold turn, projects summary plus recent exchanges and drops older turns', async () => {
    const dir = makeTestTempDir('coord-cold-slim-');
    dirs.push(dir);
    const requests: string[] = [];
    const faux = fauxProvider({
      provider: 'stub',
      models: [{ id: 'm', contextWindow: 200_000 }],
      tokensPerSecond: 1e9,
    });
    faux.setResponses(
      Array(20).fill((c: { messages: unknown[] }) => {
        requests.push(JSON.stringify(c.messages));
        return fauxAssistantMessage('ok');
      }),
    );
    const models = createCoordinatorModels([faux.provider]);
    const volatile = createVolatileContext();
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
    for (let i = 0; i < 12; i++) {
      await runCoordinatorTurn(deps, chiefStep(`warm-${i}`, `OLD-TURN-${i}`));
    }
    await runCoordinatorTurn(
      {
        ...deps,
        coldSlim: { cold: true, summaryHint: 'billing pause summary' },
      },
      chiefStep('cold-1', 'resume with 收到'),
    );
    const cold = requests.at(-1) ?? '';
    expect(cold).toContain('billing pause summary');
    expect(cold).toContain('resume with 收到');
    expect(cold).toContain('OLD-TURN-11');
    expect(cold).not.toContain('"OLD-TURN-0"');
    expect(cold).not.toContain('"OLD-TURN-4"');
    const stored = (await (await harness.root(ctx)).entries({}, 50, undefined, ctx)).items
      .filter((entry) => UserEntry.is(entry))
      .map((entry) => JSON.stringify(entry.model))
      .join('');
    expect(stored).toContain('OLD-TURN-0');
    await harness.close(ctx);
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
    const fullEvent = `[wake:settle] provenance=watch:t1\n${'EVENT-BODY '.repeat(2_000)}TAIL-MARK`;
    await runCoordinatorTurn(deps, chiefStep('ev-1', fullEvent));
    await runCoordinatorTurn(deps, chiefStep('s2', 'what happened?'));
    expect(requests[0]).toContain('TAIL-MARK');
    expect(requests[1]).not.toContain('TAIL-MARK');
    expect(requests[1]).toContain('[event settle]');
    const stored = (await (await harness.root(ctx)).entries({}, 50, undefined, ctx)).items
      .filter((entry) => UserEntry.is(entry))
      .map((entry) => JSON.stringify(entry.model))
      .join('');
    expect(stored).toContain('TAIL-MARK');
    await harness.close(ctx);
  });
});
