import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { createRegistry, Harness, MemoryStorage } from '@earendil-works/pi-durable';
import { afterEach, expect, test, vi } from 'vitest';
import type { InputChannel, NativeInput } from '../../src/coordinator/runtime/input-channel.js';
import { createInputReceipts } from '../../src/coordinator/runtime/input-receipts.js';
import { coordinatorStoreId } from '../../src/coordinator/runtime/store-identity.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
const context = BACKGROUND_CONTEXT;

async function setup() {
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    context,
  );
  const root = await harness.root(context);
  const channel = {
    position: vi.fn<InputChannel['position']>().mockResolvedValue(null),
    targets: vi.fn<InputChannel['targets']>().mockResolvedValue([]),
    assertConversation: vi.fn<InputChannel['assertConversation']>().mockResolvedValue(),
    runs: vi.fn<InputChannel['runs']>().mockResolvedValue([]),
    bindRun: vi.fn<InputChannel['bindRun']>().mockResolvedValue(),
    list: vi.fn<InputChannel['list']>().mockResolvedValue([]),
    prepare: vi.fn<InputChannel['prepare']>(),
    consume: vi.fn<InputChannel['consume']>().mockResolvedValue(),
    release: vi.fn<InputChannel['release']>().mockResolvedValue(),
    checkpoint: vi.fn<InputChannel['checkpoint']>().mockResolvedValue(),
  };
  const report = vi.fn();
  const receipts = createInputReceipts('thread', channel, context, report);
  receipts.attach(harness, await coordinatorStoreId(harness, context));
  cleanups.push(async () => {
    receipts.stop();
    await harness.close(context);
    await receipts.close();
  });
  return { harness, root, channel, receipts, report };
}

test('stored placement is persisted while the native submission is still waiting for an answer', async () => {
  const w = await setup();
  const input = await w.root.submit(
    { type: 'input', content: 'image', requestId: 'owner' },
    context,
  );
  const status = await input.status(context);
  expect(status.status).toBe('placed');
  await w.receipts.barrier();
  expect(w.channel.consume).toHaveBeenCalledWith(
    'owner',
    w.receipts.key(String(w.root.id)),
    String(status.entry),
  );
  expect((await input.status(context)).status).toBe('placed');
});

test('admission alone grants nothing, and abort without placement releases the exact request', async () => {
  const w = await setup();
  await w.root.submit({ type: 'input', content: 'start', requestId: 'owner' }, context);
  const steer = await w.root.submit(
    { type: 'input', content: 'image', whenBusy: 'steer', requestId: 'steer' },
    context,
  );
  expect((await steer.status(context)).status).toBe('queued');
  await w.receipts.barrier();
  expect(w.channel.consume.mock.calls.map((call) => call[0])).toEqual(['owner']);
  expect(w.channel.release).not.toHaveBeenCalled();
  await steer.abort(context);
  await w.receipts.barrier();
  expect(w.channel.release).toHaveBeenCalledWith('steer', w.receipts.key(String(w.root.id)));
});

test('a failed receipt remains first and blocks dependent work until the same receipt commits', async () => {
  const w = await setup();
  let available = false;
  w.channel.consume.mockImplementation(async () => {
    if (!available) throw new Error('host write unavailable');
  });
  await w.root.submit({ type: 'input', content: 'image', requestId: 'first' }, context);
  let passed = false;
  const dependent = w.receipts.barrier().then(() => {
    passed = true;
  });
  await vi.waitFor(() => expect(w.report).toHaveBeenCalled());
  expect(passed).toBe(false);
  expect(w.channel.consume.mock.calls.every((call) => call[0] === 'first')).toBe(true);
  available = true;
  await dependent;
  expect(passed).toBe(true);
  await w.receipts.barrier();
});

test('recovery reads a stored placement even when the producer is retired', async () => {
  const w = await setup();
  const input = await w.root.submit(
    { type: 'input', content: 'image', requestId: 'image' },
    context,
  );
  const record = await input.status(context);
  w.channel.list.mockResolvedValue([
    {
      id: 'image',
      stepId: 'producer',
      kind: 'steer',
      content: 'image',
      ownerMessageIds: ['owner'],
      conversationId: w.receipts.key(String(w.root.id)),
      state: 'pending',
      entryId: null,
      live: false,
    } satisfies NativeInput,
  ]);
  await w.receipts.recover(w.harness);
  expect(w.channel.consume).toHaveBeenCalledWith(
    'image',
    w.receipts.key(String(w.root.id)),
    String(record.entry),
  );
  expect(w.channel.release).not.toHaveBeenCalled();
});

test('recovery releases missing admission only for a retired target in an intact bound conversation', async () => {
  const w = await setup();
  const batch: NativeInput = {
    id: 'missing',
    stepId: 'producer',
    kind: 'steer',
    content: 'image',
    ownerMessageIds: ['owner'],
    conversationId: w.receipts.key(String(w.root.id)),
    state: 'pending',
    entryId: null,
    live: true,
  };
  w.channel.list.mockResolvedValue([batch]);
  await w.receipts.recover(w.harness);
  expect(w.channel.release).not.toHaveBeenCalled();
  batch.live = false;
  await w.receipts.recover(w.harness);
  expect(w.channel.release).toHaveBeenCalledWith('missing', w.receipts.key(String(w.root.id)));
  batch.conversationId = w.receipts.key('999');
  await expect(w.receipts.recover(w.harness)).rejects.toThrow('conversation missing');
  expect(w.channel.release).toHaveBeenCalledTimes(1);
});

test('a failed shutdown receipt remains recoverable by a fresh observer', async () => {
  const w = await setup();
  const input = await w.root.submit(
    { type: 'input', content: 'image', requestId: 'retained' },
    context,
  );
  const record = await input.status(context);
  w.channel.consume.mockRejectedValue(new Error('host unavailable'));
  await expect(w.receipts.close()).rejects.toThrow('host unavailable');
  w.channel.consume.mockResolvedValue();
  w.channel.list.mockResolvedValue([
    {
      id: 'retained',
      stepId: 'producer',
      kind: 'initial',
      content: 'image',
      ownerMessageIds: ['owner'],
      conversationId: w.receipts.key(String(w.root.id)),
      state: 'pending',
      entryId: null,
      live: false,
    },
  ]);
  const again = createInputReceipts('thread', w.channel, context, w.report);
  again.attach(w.harness, await coordinatorStoreId(w.harness, context));
  await again.recover(w.harness);
  expect(w.channel.consume).toHaveBeenCalledWith(
    'retained',
    again.key(String(w.root.id)),
    String(record.entry),
  );
  await again.close();
});
