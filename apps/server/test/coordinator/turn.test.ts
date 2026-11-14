import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { UserEntry } from '@earendil-works/pi-durable';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
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
    Array(5).fill((c: { systemPrompt?: string; messages: unknown[] }) => {
      seen.push({
        system: JSON.stringify([c.systemPrompt ?? '', c.messages[0]]),
        messages: c.messages.length,
      });
      return fauxAssistantMessage(tokensPerSecond < 1e6 ? `answer ${'x '.repeat(60)}` : 'answer');
    }),
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
