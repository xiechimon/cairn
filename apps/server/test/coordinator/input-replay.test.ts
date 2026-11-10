import { coordinatorConversationKey } from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import {
  AssistantEntry,
  createRegistry,
  defineExtension,
  defineTool,
  GenerationTask,
  Harness,
  hook,
  MemoryStorage,
  UserEntry,
} from '@earendil-works/pi-durable';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import type { InputChannel } from '../../src/coordinator/runtime/input-channel.js';
import {
  createInputReceipts,
  type InputReceipts,
} from '../../src/coordinator/runtime/input-receipts.js';
import { replayCoordinatorInputs } from '../../src/coordinator/runtime/input-replay.js';
import type { MachineApi } from '../../src/coordinator/runtime/machine-api.js';
import { coordinatorStoreId } from '../../src/coordinator/runtime/store-identity.js';
import {
  chiefMessage,
  coordinatorConversation,
  coordinatorInput,
  coordinatorRun,
  step,
} from '../../src/db/schema.js';
import {
  consumeCoordinatorInput,
  coordinatorInputIsLive,
  coordinatorInputs,
  prepareCoordinatorInput,
  releaseCoordinatorInput,
  requireCoordinatorConversation,
} from '../../src/services/coordinator-inputs.js';
import { bindCoordinatorRun, coordinatorRuns } from '../../src/services/coordinator-runs.js';
import { H, registerChiefHarness } from '../chief-harness.js';

registerChiefHarness();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const context = BACKGROUND_CONTEXT;

async function fixture(reversePublications = false) {
  const models = createModels();
  const faux = fauxProvider({
    provider: 'stub',
    models: [{ id: 'm', contextWindow: 200000 }],
    tokensPerSecond: 1e9,
  });
  let requests = 0;
  faux.setResponses([
    () => {
      requests++;
      return fauxAssistantMessage([fauxToolCall('echo', {})], {
        stopReason: 'toolUse',
      });
    },
    () => {
      requests++;
      return fauxAssistantMessage('Stored final answer.');
    },
  ]);
  models.setProvider(faux.provider);
  let receipts: InputReceipts | undefined;
  let executions = 0;
  const extension = defineExtension({
    name: 'replay-proof',
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async (_request, _api, ctx) => {
          await receipts?.barrier(ctx.abortSignal);
        },
      }),
    ],
    tools: [
      defineTool({
        name: 'echo',
        description: 'Return a fixed probe response.',
        parameters: { type: 'object', properties: {} },
        replay: 'safe',
        execute: async () => {
          executions++;
          return { output: [{ type: 'text', text: 'hello' }] };
        },
      }),
    ],
  });
  const registry = createRegistry();
  registry.install(extension);
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
  const root = await harness.root(context, {
    agent: { model: { provider: 'stub', modelId: 'm' } },
  });
  const storeId = await coordinatorStoreId(harness, context);
  const key = coordinatorConversationKey(storeId, String(root.id));
  H.s.db
    .insert(chiefMessage)
    .values({
      id: 'owner',
      threadId: H.threadId,
      role: 'user',
      content: 'Original image.',
      createdAt: 1,
    })
    .run();
  H.s.db
    .insert(step)
    .values({
      id: 'producer',
      buildId: H.threadId,
      kind: 'chief',
      status: 'claimed',
      ownerMessageIds: ['owner'],
      prompt: 'Original image.',
      createdAt: 1,
    })
    .run();
  H.s.db
    .insert(coordinatorConversation)
    .values({
      threadId: H.threadId,
      conversationId: String(root.id),
      piVersion: '1.5.0',
      updatedAt: 1,
    })
    .run();
  const channel: InputChannel = {
    list: async () =>
      coordinatorInputs(H.s.db, H.threadId).map((input) => ({
        ...input,
        live: coordinatorInputIsLive(H.s.db, input.id) === true,
      })),
    position: async () => H.s.db.select().from(coordinatorConversation).get() ?? null,
    targets: async () => [],
    assertConversation: async (threadId, conversationId) =>
      requireCoordinatorConversation(H.s.db, threadId, conversationId),
    prepare: async (stepId, conversationId, content, existingEntryId) => ({
      ...prepareCoordinatorInput(H.s.db, stepId, conversationId, content, existingEntryId),
      live: true,
    }),
    consume: async (...args) => consumeCoordinatorInput(H.s.db, ...args),
    release: async (...args) => releaseCoordinatorInput(H.s.db, ...args),
    runs: async () => coordinatorRuns(H.s.db, H.threadId),
    bindRun: async (...args) => bindCoordinatorRun(H.s.db, ...args),
    checkpoint: async (_threadId, _conversationId, entryId) => {
      H.s.db.update(coordinatorConversation).set({ lastMirroredEntryId: entryId }).run();
    },
  };
  const report = vi.fn();
  if (reversePublications) {
    const observe = harness.observeCommits.bind(harness);
    vi.spyOn(harness, 'observeCommits').mockImplementation((observer) =>
      observe({
        ...observer,
        advance(publication, ctx) {
          observer.advance({ ...publication, changes: [...publication.changes].reverse() }, ctx);
        },
      }),
    );
  }
  receipts = createInputReceipts(H.threadId, channel, context, report);
  receipts.attach(harness, storeId);
  let writeAvailable = true;
  const api = {
    transcriptRow: vi.fn<MachineApi['transcriptRow']>(async (_stepId, row) => {
      if (!writeAvailable) throw new Error('mirror unavailable');
      H.s.db
        .insert(chiefMessage)
        .values({ ...row, threadId: H.threadId })
        .onConflictDoUpdate({ target: chiefMessage.id, set: { content: row.content } })
        .run();
    }),
  } satisfies Pick<
    import('../../src/coordinator/runtime/machine-api.js').MachineApi,
    'transcriptRow'
  >;
  cleanups.push(async () => {
    receipts?.stop();
    await harness.close(context);
    await receipts?.close();
  });
  const prepared = await channel.prepare('producer', key, 'Original image.');
  const input = await root.submit(
    { type: 'input', content: prepared.content, requestId: prepared.id },
    context,
  );
  const replay = () =>
    replayCoordinatorInputs(harness, channel, api, H.threadId, storeId, context, 2);
  const finish = async () => {
    harness.resume();
    await input.wait(context);
    await receipts?.barrier();
  };
  return {
    root,
    api,
    report,
    finish,
    replay,
    requests: () => requests,
    executions: () => executions,
    failMirror: () => {
      writeAvailable = false;
    },
    restoreMirror: () => {
      writeAvailable = true;
    },
  };
}

test.each([false, true])(
  'replay combines pages and results without repeating tools; reversed publication=%s',
  async (reverse) => {
    const w = await fixture(reverse);
    await w.finish();
    await w.replay();
    await w.replay();
    const rows = H.s.db.select().from(chiefMessage).all();
    expect(JSON.stringify(rows)).toContain('Stored final answer.');
    expect(JSON.stringify(rows)).toContain('endedAt');
    expect(w.executions()).toBe(1);
    expect(w.requests()).toBe(2);
    expect(rows.filter((row) => row.role === 'assistant')).toHaveLength(2);
  },
);

test('a receipt committed before a failed mirror remains recoverable without repeating input', async () => {
  const w = await fixture();
  await w.finish();
  w.failMirror();
  expect(H.s.db.select().from(coordinatorInput).get()?.state).toBe('consumed');
  await expect(w.replay()).rejects.toThrow('mirror unavailable');
  expect(H.s.db.select().from(coordinatorConversation).get()?.lastMirroredEntryId).toBeNull();
  w.restoreMirror();
  await w.replay();
  expect(H.s.db.select().from(coordinatorConversation).get()?.lastMirroredEntryId).toMatch(/^\d+$/);
  expect(w.requests()).toBe(2);
});

test('unknown content stops the watermark instead of being skipped', async () => {
  const w = await fixture();
  await w.finish();
  await w.replay();
  const before = H.s.db.select().from(coordinatorConversation).get()?.lastMirroredEntryId;
  await w.root.submit(
    {
      type: 'write',
      entry: {
        kind: UserEntry.kind,
        model: [{ role: 'user', content: 'Unknown owner.', timestamp: 1 }],
      },
    },
    context,
  );
  await expect(w.replay()).rejects.toThrow('unknown ownership');
  expect(H.s.db.select().from(coordinatorConversation).get()?.lastMirroredEntryId).toBe(before);
});

test('replay preserves a rewind intent and cannot recreate its deleted future', async () => {
  const w = await fixture();
  await w.finish();
  H.s.db.update(coordinatorConversation).set({ lastMirroredEntryId: 'rewind:0:owner' }).run();
  await w.replay();
  expect(w.api.transcriptRow).not.toHaveBeenCalled();
  expect(H.s.db.select().from(coordinatorConversation).get()?.lastMirroredEntryId).toBe(
    'rewind:0:owner',
  );
});

test('an assistant without durable generation ownership cannot advance the watermark', async () => {
  const w = await fixture();
  await w.finish();
  H.s.db.delete(coordinatorRun).where(eq(coordinatorRun.threadId, H.threadId)).run();
  await expect(w.replay()).rejects.toThrow('unknown ownership');
  expect(w.api.transcriptRow).not.toHaveBeenCalled();
  const firstUnknown = (
    await w.root.entries({ order: 'ascending' }, 100, undefined, context)
  ).items.find((entry) => AssistantEntry.is(entry));
  const watermark = Number(
    H.s.db.select().from(coordinatorConversation).get()?.lastMirroredEntryId,
  );
  expect(watermark).toBeGreaterThanOrEqual(
    Number(H.s.db.select().from(coordinatorInput).get()?.entryId),
  );
  expect(watermark).toBeLessThan(Number(firstUnknown?.id));
});

test('a host binding write failure blocks the provider until the same binding commits', async () => {
  const w = await fixture();
  H.s.db.run(
    "CREATE TRIGGER reject_run BEFORE INSERT ON coordinator_run BEGIN SELECT RAISE(FAIL, 'run unavailable'); END",
  );
  const finished = w.finish();
  await vi.waitFor(() => expect(w.report).toHaveBeenCalled());
  expect(w.requests()).toBe(0);
  H.s.db.run('DROP TRIGGER reject_run');
  await finished;
  expect(w.requests()).toBe(2);
  expect(H.s.db.select().from(coordinatorInput).all()).toHaveLength(1);
});
