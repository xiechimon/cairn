import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compactionWindow,
  coordinatorCompactionExtension,
  coordinatorCompactionSettings,
} from '../src/runtime/compaction.js';
import { openCoordinatorHarness } from '../src/runtime/harness.js';
import { createCoordinatorModels } from '../src/runtime/models.js';
import { runCoordinatorTurn } from '../src/runtime/turn.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';

const ctx = BACKGROUND_CONTEXT;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type FauxContext = { messages: unknown[] };

async function world(foldFails = false) {
  const calls: { model: string; tokens: number; summary: boolean }[] = [];
  const faux = fauxProvider({
    provider: 'stub',
    models: [
      { id: 'big', contextWindow: 200_000 },
      { id: 'small', contextWindow: 32_000 },
      { id: 'sum', contextWindow: 200_000 },
    ],
  });
  faux.setResponses(
    Array(40).fill((c: FauxContext, _o: unknown, _s: unknown, model: { id: string }) => {
      const tokens = Math.ceil(JSON.stringify(c.messages).length / 4);
      const summary = model.id === 'sum';
      calls.push({ model: model.id, tokens, summary });
      if (summary && foldFails)
        return fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'down' });
      if (summary) return fauxAssistantMessage('folded');
      return fauxAssistantMessage(`answer ${'word '.repeat(2500)}`);
    }),
  );
  const coordinatorModels = createCoordinatorModels([faux.provider]);
  const dir = mkdtempSync(join(tmpdir(), 'coord-switch-'));
  dirs.push(dir);
  const harness = await openCoordinatorHarness(
    join(dir, 'c.sqlite'),
    coordinatorModels.models,
    ctx,
    {
      extensions: [coordinatorCompactionExtension(() => ({ provider: 'stub', modelId: 'sum' }))],
      settings: () => ({
        compaction: coordinatorCompactionSettings([
          { provider: 'stub', id: 'big', contextWindow: 200_000 },
          { provider: 'stub', id: 'small', contextWindow: 32_000 },
        ]),
      }),
    },
  );
  const api = fakeMachineApi();
  const turn = (id: string, modelId: string) => {
    return runCoordinatorTurn(
      { harness, models: coordinatorModels, api, context: ctx, heartbeatMs: 10_000, now: () => 1 },
      chiefStep(id, `question ${id}`, 'You are the Coordinator.', modelId),
    );
  };
  return { harness, api, calls, turn };
}

describe('switching the Coordinator to a smaller model', () => {
  it('folds the thread before the first turn on the new model, so that turn fits its window', async () => {
    const { harness, calls, turn } = await world();
    for (let i = 0; i < 12; i++) await turn(`b${i}`, 'big');
    const before = calls.length;
    const result = await turn('s1', 'small');
    expect(result.status).toBe('success');
    const after = calls.slice(before);
    expect(after[0]?.summary).toBe(true);
    const firstSmall = after.find((c) => c.model === 'small');
    expect(firstSmall?.tokens).toBeLessThan(compactionWindow(32_000).blockingAt);
    await harness.close(ctx);
  }, 60_000);

  it('does not fold when the model stays the same or the context already fits', async () => {
    const { harness, calls, turn } = await world();
    await turn('b0', 'big');
    await turn('b1', 'big');
    await turn('s0', 'small');
    expect(calls.some((c) => c.summary)).toBe(false);
    await harness.close(ctx);
  }, 60_000);

  it('a failed fold never holds the turn: the step still gets its result', async () => {
    const { harness, turn } = await world(true);
    for (let i = 0; i < 12; i++) await turn(`b${i}`, 'big');
    const result = await turn('s1', 'small');
    expect(['success', 'failed']).toContain(result.status);
    await harness.close(ctx);
  }, 60_000);
});
