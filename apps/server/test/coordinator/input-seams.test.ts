import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable';
import { expect, test, vi } from 'vitest';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { coordinatorToolsExtension, createStepGate } from '../../src/coordinator/runtime/tools.js';

test('receipt seams hold provider and tool dispatch separately and qualify the tool identity', async () => {
  const context = BACKGROUND_CONTEXT;
  let releaseProvider = () => {};
  let releaseTool = () => {};
  const providerBarrier = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const toolBarrier = new Promise<void>((resolve) => {
    releaseTool = resolve;
  });
  let barriers = 0;
  let requests = 0;
  const relay = vi.fn(async () => '[]');
  const call = fauxToolCall('todos', {});
  const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200000 }] });
  faux.setResponses([
    () => {
      requests++;
      return fauxAssistantMessage([call], { stopReason: 'toolUse' });
    },
    () => {
      requests++;
      return fauxAssistantMessage('done');
    },
  ]);
  const gate = createStepGate();
  gate.set('producer');
  const registry = createRegistry();
  registry.install(
    coordinatorToolsExtension({ relayTool: relay, askUser: vi.fn() }, gate, {
      beforeTool: async (_signal, conversationId) => {
        expect(conversationId).toBeDefined();
        barriers++;
        if (barriers === 1) await providerBarrier;
        if (barriers === 2) await toolBarrier;
      },
      storeId: () => 'opened-store',
    }),
  );
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createCoordinatorModels([faux.provider]).models, registry },
    context,
  );
  try {
    const root = await harness.root(context, {
      agent: { model: { provider: 'stub', modelId: 'm' } },
    });
    const submission = await root.submit(
      { type: 'input', content: 'List tasks.', requestId: 'owner' },
      context,
    );
    harness.resume();
    await vi.waitFor(() => expect(barriers).toBe(1));
    expect(requests).toBe(0);
    releaseProvider();
    await vi.waitFor(() => expect(barriers).toBe(2));
    expect(relay).not.toHaveBeenCalled();
    releaseTool();
    await submission.wait(context);
    expect(requests).toBe(2);
    expect(relay).toHaveBeenCalledWith(
      'producer',
      'todos',
      {},
      `native-opened-store:${call.id}`,
      expect.anything(),
    );
  } finally {
    releaseProvider();
    releaseTool();
    await harness.close(context);
  }
});
