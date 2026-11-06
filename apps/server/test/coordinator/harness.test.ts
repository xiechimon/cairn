import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { AssistantEntry } from '@earendil-works/pi-durable';
import { afterEach, describe, expect, it } from 'vitest';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function stubModels(answer: string) {
  const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
  faux.setResponses([fauxAssistantMessage(answer)]);
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

describe('openCoordinatorHarness', () => {
  it('answers a turn and keeps it after reopening the same SQLite file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coord-'));
    dirs.push(dir);
    const path = join(dir, 'coordinator.sqlite');
    const ctx = BACKGROUND_CONTEXT;

    const first = await openCoordinatorHarness(path, stubModels('hello ian'), ctx);
    const root = await first.root(ctx, { agent: { model: { provider: 'stub', modelId: 'm' } } });
    const submission = await root.submit(
      { type: 'input', content: 'hi', requestId: 'step-1' },
      ctx,
    );
    const settled = await submission.wait(ctx);
    expect(settled.status).toBe('done');
    await first.close(ctx);

    const second = await openCoordinatorHarness(path, stubModels('unused'), ctx);
    const again = await second.root(ctx);
    const retried = await again.submit({ type: 'input', content: 'hi', requestId: 'step-1' }, ctx);
    expect(retried.id).toBe(submission.id);
    const page = await again.entries({}, 10, undefined, ctx);
    expect(page.items.filter((e) => e.kind === AssistantEntry.kind)).toHaveLength(1);
    await second.close(ctx);
  });
});
