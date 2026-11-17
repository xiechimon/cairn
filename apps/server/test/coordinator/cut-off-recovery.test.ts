import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { afterEach, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import {
  coordinatorToolsExtension,
  createStepGate,
  type ToolChannel,
} from '../../src/coordinator/runtime/tools.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

it('a Coordinator reply cut off at the length limit is told so in-turn instead of ending the turn', async () => {
  const dir = makeTestTempDir('coord-cut-');
  dirs.push(dir);
  const ctx = BACKGROUND_CONTEXT;
  let retryContext = '';
  const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
  faux.setResponses([
    fauxAssistantMessage([{ type: 'text', text: 'Writing it now.' }, fauxToolCall('shell', {})], {
      stopReason: 'length',
    }),
    (context) => {
      retryContext = JSON.stringify(context.messages);
      return fauxAssistantMessage('Done in smaller steps.');
    },
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const gate = createStepGate();
  gate.set('step-1');
  const channel = {} as ToolChannel;
  const harness = await openCoordinatorHarness(join(dir, 'coordinator.sqlite'), models, ctx, {
    extensions: [coordinatorToolsExtension(channel, gate)],
  });
  const root = await harness.root(ctx, { agent: { model: { provider: 'stub', modelId: 'm' } } });
  const submission = await root.submit({ type: 'input', content: 'hi', requestId: 'step-1' }, ctx);
  const settled = await submission.wait(ctx);
  await harness.close(ctx);

  expect(retryContext).toContain('cut off at the length limit');
  expect(retryContext).not.toContain('"type":"toolCall"');
  expect(settled.status).toBe('done');
});
