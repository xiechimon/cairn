import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { openCoordinatorHarness } from '../../src/coordinator/runtime/harness.js';
import {
  createCoordinatorModels,
  IMAGE_OMITTED_NOTE,
} from '../../src/coordinator/runtime/models.js';
import { coordinatorToolsExtension, createStepGate } from '../../src/coordinator/runtime/tools.js';
import { runCoordinatorTurn } from '../../src/coordinator/runtime/turn.js';
import { chiefStep, fakeMachineApi } from './fake-machine-api.js';

const ctx = BACKGROUND_CONTEXT;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) releaseTestTempDir(d);
});

const imageContext = {
  messages: [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'look' },
        { type: 'image' as const, data: 'AAAA', mimeType: 'image/png' },
      ],
      timestamp: 1,
    },
  ],
};

type FauxContext = { messages: { role: string; content: unknown }[] };

function gatewayWithoutVision() {
  const requests: string[] = [];
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200_000, input: ['text', 'image'] }],
  });
  faux.setResponses(
    Array(20).fill((c: FauxContext) => {
      const text = JSON.stringify(c.messages);
      requests.push(text);
      return text.includes('"image"')
        ? fauxAssistantMessage('', { stopReason: 'error', errorMessage: '400 invalid content' })
        : fauxAssistantMessage('seen without images');
    }),
  );
  return { faux, requests };
}

describe('model requests that carry images', () => {
  it('retries a failed image request without images, then marks the model text-only', async () => {
    const { faux, requests } = gatewayWithoutVision();
    const rejected: string[][] = [];
    const models = createCoordinatorModels([faux.provider], (provider, id) =>
      rejected.push([provider, id]),
    );
    const model = models.models.getModel('stub', 'm');
    if (model === undefined) throw new Error('model missing');
    const reply = await models.models.completeSimple(model, imageContext as never);
    expect(reply.stopReason).toBe('stop');
    expect(JSON.stringify(reply.content)).toContain('seen without images');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain(IMAGE_OMITTED_NOTE);
    expect(requests[1]).not.toContain('"image"');
    expect(rejected).toEqual([['stub', 'm']]);
    expect(models.models.getModel('stub', 'm')?.input).toEqual(['text']);
  });

  it('refuses computer_observe on the next call once the model is marked text-only', async () => {
    const { faux } = gatewayWithoutVision();
    const models = createCoordinatorModels([faux.provider]);
    const model = models.models.getModel('stub', 'm');
    if (model === undefined) throw new Error('model missing');
    await models.models.completeSimple(model, imageContext as never);
    const results: string[] = [];
    faux.setResponses(
      Array(5).fill((c: FauxContext) => {
        const last = c.messages.at(-1);
        if (last?.role === 'toolResult') {
          results.push(JSON.stringify(last.content));
          return fauxAssistantMessage('done');
        }
        return fauxAssistantMessage([fauxToolCall('computer_observe', {})], {
          stopReason: 'toolUse',
        });
      }),
    );
    const api = fakeMachineApi();
    const relayed: string[] = [];
    api.relayComputer = async (_stepId, name) => {
      relayed.push(name);
      return { text: 'screen', images: [] };
    };
    const gate = createStepGate();
    const dir = makeTestTempDir('coord-image-fallback-');
    dirs.push(dir);
    const harness = await openCoordinatorHarness(join(dir, 'c.sqlite'), models.models, ctx, {
      extensions: [coordinatorToolsExtension(api, gate, { desktopTools: true })],
    });
    try {
      await runCoordinatorTurn(
        { harness, models, api, context: ctx, heartbeatMs: 1000, now: () => 1, gate },
        chiefStep('step-after-fallback', 'Look at the desktop'),
      );
      expect(relayed).toEqual([]);
      expect(results[0]).toContain('cannot see screenshots');
    } finally {
      await harness.close(ctx);
    }
  });
});
