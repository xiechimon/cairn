import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { UserEntry } from '@earendil-works/pi-durable';
import { afterEach, describe, expect, it } from 'vitest';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';

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
    expect(api.dones[0]?.body.usage?.[0]?.model).toBe('stub/m');
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
    setTimeout(() => api.stopRequested.add('step-stop'), 200);
    const result = await runCoordinatorTurn(deps, chiefStep('step-stop', 'long one'));
    expect(result.status).toBe('stopped');
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(api.dones).toEqual([{ stepId: 'step-stop', body: { status: 'stopped' } }]);
    expect(new Set(api.stopPolls)).toEqual(new Set(['step-stop']));

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
});
