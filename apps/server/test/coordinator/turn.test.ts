import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai';
import { UserEntry } from '@earendil-works/pi-durable';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { SUGGEST_REPLIES_ASK } from '../../src/coordinator/runtime/suggest-replies.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
import { chiefStep, type FakeMachineApi, fakeMachineApi } from './fake-machine-api.js';

const ctx = BACKGROUND_CONTEXT;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function storagePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coord-turn-'));
  dirs.push(dir);
  return join(dir, 'coordinator.sqlite');
}

function setup(tokensPerSecond = 1e9) {
  const seen: { system: string; messages: number }[] = [];
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000 }],
    tokensPerSecond,
  });
  faux.setResponses(
    Array(12).fill(
      (c: { systemPrompt?: string; messages: { role: string; content: unknown }[] }) => {
        const asked = c.messages[0]?.content === SUGGEST_REPLIES_ASK;
        if (asked) {
          return fauxAssistantMessage([fauxText('{"replies":["继续看"]}')]);
        }
        seen.push({
          system: JSON.stringify([c.systemPrompt ?? '', c.messages[0]]),
          messages: c.messages.length,
        });
        return fauxAssistantMessage(tokensPerSecond < 1e6 ? `answer ${'x '.repeat(60)}` : 'answer');
      },
    ),
  );
  return { coordinatorModels: createCoordinatorModels([faux.provider]), faux, seen };
}

type TestHarness = Awaited<ReturnType<typeof openCoordinatorHarness>>;
type TestRoot = Awaited<ReturnType<TestHarness['root']>>;

function bound<T extends object>(target: T, prop: string | symbol): unknown {
  const value = Reflect.get(target, prop, target);
  return typeof value === 'function' ? value.bind(target) : value;
}

function instrumentWatch(
  harness: TestHarness,
  hooks: {
    afterWatch?: () => Promise<void>;
    submit?: () => Promise<never>;
  },
) {
  const stops: ReturnType<typeof vi.fn>[] = [];
  const instrumentedRoot = (root: TestRoot): TestRoot =>
    new Proxy(root, {
      get(target, prop) {
        if (prop === 'watch') {
          return async (...args: Parameters<TestRoot['watch']>) => {
            const handle = await target.watch(...args);
            stops.push(vi.spyOn(handle, 'stop'));
            await hooks.afterWatch?.();
            return handle;
          };
        }
        if (prop === 'submit' && hooks.submit !== undefined) return hooks.submit;
        return bound(target, prop);
      },
    });
  const instrumented = new Proxy(harness, {
    get(target, prop) {
      if (prop === 'root') {
        return async (...args: Parameters<TestHarness['root']>) =>
          instrumentedRoot(await target.root(...args));
      }
      return bound(target, prop);
    },
  });
  return { harness: instrumented, stops };
}

async function expectNoMirrorWriteAfterTurn(
  harness: TestHarness,
  api: FakeMachineApi,
): Promise<void> {
  const rows = api.rows.length;
  const deltas = api.deltas.length;
  const root = await harness.root(ctx);
  const later = await root.submit({ type: 'input', content: 'later', requestId: 'later' }, ctx);
  await later.wait(ctx);
  await new Promise((r) => setTimeout(r, 50));
  expect(api.rows).toHaveLength(rows);
  expect(api.deltas).toHaveLength(deltas);
}

describe('runCoordinatorTurn', () => {
  it('answers a claimed step, mirrors the answer and reports usage', async () => {
    const { coordinatorModels, seen } = setup();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    const deps = {
      harness,
      models: coordinatorModels,
      api,
      context: ctx,
      heartbeatMs: 1000,
      now: () => 42,
    };

    await runCoordinatorTurn(deps, chiefStep('step-1', 'status?', 'SYSTEM-PROMPT-MARK'));

    expect(api.keys).toHaveLength(1);
    expect(seen[0]?.system).toContain('SYSTEM-PROMPT-MARK');
    expect(api.rows).toEqual([
      {
        stepId: 'step-1',
        row: expect.objectContaining({
          id: expect.stringMatching(/^step-1-e\d+$/),
          role: 'assistant',
          content: [{ type: 'text', text: 'answer' }],
        }),
      },
    ]);
    expect(api.dones).toHaveLength(1);
    expect(api.dones[0]?.body.status).toBe('success');
    const usage = api.dones[0]?.body.usage?.[0];
    expect(usage?.model).toBe('stub/m');
    expect(usage?.contextTokens).toBe(
      (usage?.input ?? 0) +
        (usage?.output ?? 0) +
        (usage?.cacheRead ?? 0) +
        (usage?.cacheWrite ?? 0),
    );
    expect(api.suggestions).toEqual([]);
    expect(usage?.cacheRead).toBe(0);
    await harness.close(ctx);
  });

  it('reports no context size when an OpenAI-compatible model streams without usage', async () => {
    const server = createServer((_request, response) => {
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          model: 'test-model',
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        `${chunk({ role: 'assistant', content: 'ok' }, null)}${chunk({}, 'stop')}data: [DONE]\n\n`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('No test server port');
      const models = createCoordinatorModels();
      models.useStepProvider({
        kind: 'http',
        providerId: 'custom',
        baseUrl: `http://127.0.0.1:${address.port}`,
        api: 'openai-completions',
        models: [{ id: 'test-model', name: 'test-model' }],
      });
      await models.setApiKey('custom', 'unused');
      const harness = await openCoordinatorHarness(storagePath(), models.models, ctx);
      const api = fakeMachineApi();
      await runCoordinatorTurn(
        { harness, models, api, context: ctx, heartbeatMs: 1000, now: () => 1 },
        chiefStep('step-no-usage', 'hello', undefined, 'test-model', 'custom'),
      );
      expect(api.dones[0]?.body.status).toBe('success');
      const usage = api.dones[0]?.body.usage?.[0];
      expect(usage?.model).toBe('custom/test-model');
      expect(usage?.contextTokens).toBeUndefined();
      await harness.close(ctx);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      );
    }
  });

  it('predicts after cold and warm ordinary replies but skips every event trigger', async () => {
    const ordinary = setup();
    const ordinaryHarness = await openCoordinatorHarness(
      storagePath(),
      ordinary.coordinatorModels.models,
      ctx,
    );
    const ordinaryApi = fakeMachineApi();
    ordinaryApi.canSuggestReplies = async () => true;
    await runCoordinatorTurn(
      {
        harness: ordinaryHarness,
        models: ordinary.coordinatorModels,
        api: ordinaryApi,
        context: ctx,
        heartbeatMs: 1000,
        now: () => 1,
      },
      chiefStep('step-cold', 'hello'),
    );
    await runCoordinatorTurn(
      {
        harness: ordinaryHarness,
        models: ordinary.coordinatorModels,
        api: ordinaryApi,
        context: ctx,
        heartbeatMs: 1000,
        now: () => 1,
      },
      chiefStep('step-say', 'status?'),
    );
    expect(ordinary.faux.state.callCount).toBe(4);
    expect(ordinaryApi.suggestions).toEqual([
      { stepId: 'step-cold', replies: ['继续看'] },
      { stepId: 'step-say', replies: ['继续看'] },
    ]);
    const usage = ordinaryApi.dones.at(-1)?.body.usage?.[0];
    expect(usage?.contextTokens).toBeLessThan(
      (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheRead ?? 0),
    );
    for (const trigger of ['wake', 'settle', 'failed', 'gate'] as const) {
      const step = chiefStep(`step-${trigger}`, `[wake:${trigger}] event`);
      const calls = ordinary.faux.state.callCount;
      await runCoordinatorTurn(
        {
          harness: ordinaryHarness,
          models: ordinary.coordinatorModels,
          api: ordinaryApi,
          context: ctx,
          heartbeatMs: 1000,
          now: () => 2,
        },
        { ...step, chief: { ...step.chief!, trigger } },
      );
      expect(ordinary.faux.state.callCount).toBe(calls + 1);
    }
    expect(ordinaryApi.suggestions).toHaveLength(2);
    const calls = ordinary.faux.state.callCount;
    const expensive = await runCoordinatorTurn(
      {
        harness: ordinaryHarness,
        models: ordinary.coordinatorModels,
        api: ordinaryApi,
        context: ctx,
        heartbeatMs: 1000,
        now: () => 3,
      },
      chiefStep('step-budget', 'x'.repeat(16_384)),
    );
    expect(expensive.status).toBe('success');
    expect(expensive.usage?.[0]?.cacheRead).toBeGreaterThan(0);
    expect(ordinary.faux.state.callCount).toBe(calls + 2);
    expect(ordinaryApi.suggestions.at(-1)).toEqual({
      stepId: 'step-budget',
      replies: ['继续看'],
    });
    expect(ordinaryApi.rows.some((row) => row.stepId === 'step-budget')).toBe(true);
    await ordinaryHarness.close(ctx);
  });

  it('asks for quick replies while the transcript is still being mirrored', async () => {
    const { coordinatorModels } = setup();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    api.canSuggestReplies = async () => true;
    let asked = (): void => {};
    const askedBeforeMirrored = new Promise<void>((resolve) => {
      asked = resolve;
    });
    const complete = coordinatorModels.models.completeSimple.bind(coordinatorModels.models);
    coordinatorModels.models.completeSimple = (...args) => {
      asked();
      return complete(...args);
    };
    const result = await runCoordinatorTurn(
      {
        harness,
        models: coordinatorModels,
        api,
        context: ctx,
        heartbeatMs: 1000,
        now: () => 1,
        afterMirror: () =>
          Promise.race([
            askedBeforeMirrored,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('quick replies waited for the mirror')), 2_000),
            ),
          ]),
      },
      chiefStep('early', 'status?'),
    );
    expect(result.status).toBe('success');
    expect(api.suggestions).toEqual([{ stepId: 'early', replies: ['继续看'] }]);
    await harness.close(ctx);
  });

  it('aborts prediction on stop without publishing stale chips', async () => {
    const { coordinatorModels } = setup();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    api.canSuggestReplies = async () => true;
    const deps = {
      harness,
      models: coordinatorModels,
      api,
      context: ctx,
      heartbeatMs: 1000,
      stopPollMs: 5,
      now: () => 1,
    };
    await runCoordinatorTurn(deps, chiefStep('cold', 'hello'));
    api.suggestions.splice(0);
    coordinatorModels.models.completeSimple = async (_model, _context, options) => {
      api.stopRequested.add('predict-stop');
      await new Promise<void>((resolve) =>
        options?.signal?.addEventListener('abort', () => resolve(), { once: true }),
      );
      return fauxAssistantMessage('{"replies":["stale"]}', { stopReason: 'aborted' });
    };
    const result = await runCoordinatorTurn(deps, chiefStep('predict-stop', 'status?'));
    expect(result.status).toBe('stopped');
    expect(api.suggestions).toEqual([]);
    expect(api.rows.some((row) => row.stepId === 'predict-stop')).toBe(true);
    await harness.close(ctx);
  });

  it('keeps the answer successful and counts usage when prediction is unusable', async () => {
    const { coordinatorModels } = setup();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    api.canSuggestReplies = async () => true;
    const deps = {
      harness,
      models: coordinatorModels,
      api,
      context: ctx,
      heartbeatMs: 1000,
      now: () => 1,
    };
    await runCoordinatorTurn(deps, chiefStep('cold', 'hello'));
    api.suggestions.splice(0);
    coordinatorModels.models.completeSimple = async () => ({
      ...fauxAssistantMessage('invalid JSON'),
      usage: {
        input: 17,
        output: 11,
        cacheRead: 900,
        cacheWrite: 0,
        totalTokens: 928,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    const result = await runCoordinatorTurn(deps, chiefStep('invalid', 'status?'));
    expect(result.status).toBe('success');
    expect(result.usage?.[0]?.input).toBe(17);
    expect(result.usage?.[0]?.cacheRead).toBeGreaterThanOrEqual(900);
    expect(api.suggestions).toEqual([]);
    coordinatorModels.models.completeSimple = async () => {
      throw new Error('provider unavailable');
    };
    expect((await runCoordinatorTurn(deps, chiefStep('offline', 'status again?'))).status).toBe(
      'success',
    );
    await harness.close(ctx);
  });

  it('runs a re-claimed step once: the step id is the request id', async () => {
    const path = storagePath();
    const first = setup();
    const h1 = await openCoordinatorHarness(path, first.coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    const step = chiefStep('step-7', 'dispatch the fix');
    await runCoordinatorTurn(
      {
        harness: h1,
        models: first.coordinatorModels,
        api,
        context: ctx,
        heartbeatMs: 1000,
        now: () => 1,
      },
      step,
    );
    await h1.close(ctx);

    const second = setup();
    const h2 = await openCoordinatorHarness(path, second.coordinatorModels.models, ctx);
    await runCoordinatorTurn(
      {
        harness: h2,
        models: second.coordinatorModels,
        api,
        context: ctx,
        heartbeatMs: 1000,
        now: () => 2,
      },
      step,
    );

    expect(second.seen).toHaveLength(0);
    const root = await h2.root(ctx);
    const page = await root.entries({}, 50, undefined, ctx);
    expect(page.items.filter((e) => e.kind === UserEntry.kind)).toHaveLength(1);
    expect(api.dones.map((d) => d.body.status)).toEqual(['success', 'success']);
    await h2.close(ctx);
  });

  it('heartbeats the step while the model streams', async () => {
    const { coordinatorModels } = setup(200);
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    await runCoordinatorTurn(
      { harness, models: coordinatorModels, api, context: ctx, heartbeatMs: 20, now: () => 1 },
      chiefStep('step-2', 'long one'),
    );
    expect(api.heartbeats.length).toBeGreaterThan(0);
    expect(new Set(api.heartbeats)).toEqual(new Set(['step-2']));
    await harness.close(ctx);
  });

  it('a stop requested mid-turn ends the turn as stopped, and the next turn still answers', async () => {
    const { coordinatorModels } = setup(5);
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    const deps = {
      harness,
      models: coordinatorModels,
      api,
      context: ctx,
      heartbeatMs: 1000,
      stopPollMs: 20,
      now: () => 1,
    };
    const started = Date.now();
    const stopOnText = setInterval(() => {
      if (api.deltas.length > 0) api.stopRequested.add('step-stop');
    }, 10);
    const result = await runCoordinatorTurn(deps, chiefStep('step-stop', 'long one'));
    clearInterval(stopOnText);
    expect(result.status).toBe('stopped');
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(api.dones).toEqual([{ stepId: 'step-stop', body: { status: 'stopped' } }]);
    expect(new Set(api.stopPolls)).toEqual(new Set(['step-stop']));
    const kept = api.rows.filter((r) => r.stepId === 'step-stop');
    expect(kept).toHaveLength(1);
    expect(kept[0]?.row.content).toEqual([{ type: 'text', text: expect.any(String) }]);
    const text = ((kept[0]?.row.content ?? []) as { text: string }[])[0]?.text ?? '';
    expect(text.startsWith('answer')).toBe(true);
    expect(text.length).toBeLessThan(`answer ${'x '.repeat(60)}`.trim().length);

    const polls = api.stopPolls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(api.stopPolls.length).toBe(polls);

    const next = await runCoordinatorTurn(deps, chiefStep('step-after', 'still there?'));
    expect(next.status).toBe('success');
    await harness.close(ctx);
  }, 30_000);

  it('fails a step that carries no model', async () => {
    const { coordinatorModels } = setup();
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    const step = chiefStep('step-3', 'hi');
    await runCoordinatorTurn(
      { harness, models: coordinatorModels, api, context: ctx, heartbeatMs: 1000, now: () => 1 },
      { ...step, chief: undefined },
    );
    expect(api.dones).toEqual([
      {
        stepId: 'step-3',
        body: { status: 'failed', errorMessage: 'Coordinator step has no model or chief context' },
      },
    ]);
    expect(api.keys).toHaveLength(0);
    await harness.close(ctx);
  });

  it('stops the conversation watch when a stop request lands before the turn submits', async () => {
    const { coordinatorModels } = setup();
    const raw = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    const { harness, stops } = instrumentWatch(raw, {
      afterWatch: async () => {
        api.stopRequested.add('step-early');
        await new Promise((r) => setTimeout(r, 60));
      },
    });
    const result = await runCoordinatorTurn(
      {
        harness,
        models: coordinatorModels,
        api,
        context: ctx,
        heartbeatMs: 1000,
        stopPollMs: 5,
        now: () => 1,
      },
      chiefStep('step-early', 'never submitted'),
    );
    expect(result.status).toBe('stopped');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveBeenCalled();
    await expectNoMirrorWriteAfterTurn(raw, api);
    await raw.close(ctx);
  });

  it('does not answer a request whose stop lands while it is being submitted', async () => {
    const { coordinatorModels } = setup(40);
    const raw = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    const instrumented = new Proxy(raw, {
      get(target, prop) {
        if (prop !== 'root') return bound(target, prop);
        return async (...args: Parameters<TestHarness['root']>) => {
          const root = await target.root(...args);
          return new Proxy(root, {
            get(inner, key) {
              if (key !== 'submit') return bound(inner, key);
              return async (...submission: Parameters<TestRoot['submit']>) => {
                api.stopRequested.add('step-racing');
                await new Promise((r) => setTimeout(r, 60));
                return inner.submit(...submission);
              };
            },
          });
        };
      },
    });
    const result = await runCoordinatorTurn(
      {
        harness: instrumented,
        models: coordinatorModels,
        api,
        context: ctx,
        heartbeatMs: 1000,
        stopPollMs: 5,
        now: () => 1,
      },
      chiefStep('step-racing', 'delete every branch'),
    );
    expect(result.status).toBe('stopped');
    const full = `answer ${'x '.repeat(60)}`.trim();
    expect(JSON.stringify(api.rows)).not.toContain(full);
    const context = await (await raw.root(ctx)).context(ctx);
    expect(JSON.stringify(context.messages)).not.toContain(full);
    await raw.close(ctx);
  }, 30_000);

  const stoppedRun = async (script: unknown[]) => {
    const { coordinatorModels, faux } = setup();
    const sent: { role: string; content: unknown }[][] = [];
    const reply = (c: { messages: { role: string; content: unknown }[] }) => {
      sent.push(structuredClone(c.messages));
      return fauxAssistantMessage('ok');
    };
    faux.setResponses([
      ...(script as Parameters<typeof faux.setResponses>[0]),
      ...Array(8).fill(reply),
    ]);
    const harness = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    const run = (id: string, instruction: string) =>
      runCoordinatorTurn(
        { harness, models: coordinatorModels, api, context: ctx, heartbeatMs: 1000, now: () => 1 },
        chiefStep(id, instruction),
      );
    const notes = () =>
      (sent.at(-1) ?? [])
        .map((m) => JSON.stringify(m.content))
        .filter((text) => text.includes('[Stopped]'));
    return { harness, api, run, sent, notes };
  };
  const failure = () =>
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'usage limit reached' });

  it('cancels a request that failed and was stopped while it waited to run again', async () => {
    const { harness, api, run, sent, notes } = await stoppedRun([failure()]);
    expect((await run('step-waiting', 'delete every branch')).status).toBe('failed');
    api.stopRequested.add('step-waiting');

    await run('step-next', 'what time is it');

    const request = JSON.stringify(sent.at(-1));
    expect(request.indexOf('[Stopped]')).toBeGreaterThan(request.indexOf('delete every branch'));
    expect(request.indexOf('what time is it')).toBeGreaterThan(request.indexOf('[Stopped]'));
    await run('step-later', 'and the date');
    expect(notes(), 'one stop is noted once').toHaveLength(1);
    await harness.close(ctx);
  }, 30_000);

  it('cancels a stopped request that ran more than a hundred tool rounds', async () => {
    const round = () =>
      fauxAssistantMessage([fauxToolCall('look_around', {})], { stopReason: 'toolUse' });
    const { harness, api, run, notes } = await stoppedRun([
      ...Array.from({ length: 110 }, round),
      failure(),
    ]);
    await run('step-long', 'delete every branch');
    api.stopRequested.add('step-long');

    await run('step-next', 'what time is it');

    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toContain('delete every branch');
    await harness.close(ctx);
  }, 60_000);

  it('cancels only the stopped request, not an earlier one that merely failed', async () => {
    const { harness, api, run, notes } = await stoppedRun([failure(), failure()]);
    await run('step-failed', 'summarise the repository');
    await run('step-stopped', 'delete every branch');
    api.stopRequested.add('step-stopped');

    await run('step-next', 'what time is it');

    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toContain('delete every branch');
    expect(notes()[0]).not.toContain('summarise the repository');
    await harness.close(ctx);
  }, 30_000);

  it('stops the conversation watch when the turn throws after the watch started', async () => {
    const { coordinatorModels } = setup();
    const raw = await openCoordinatorHarness(storagePath(), coordinatorModels.models, ctx);
    const api = fakeMachineApi();
    const { harness, stops } = instrumentWatch(raw, {
      submit: async () => {
        throw new Error('submit failed');
      },
    });
    await expect(
      runCoordinatorTurn(
        { harness, models: coordinatorModels, api, context: ctx, heartbeatMs: 1000, now: () => 1 },
        chiefStep('step-throw', 'boom'),
      ),
    ).rejects.toThrow('submit failed');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveBeenCalled();
    await expectNoMirrorWriteAfterTurn(raw, api);
    await raw.close(ctx);
  });
});
