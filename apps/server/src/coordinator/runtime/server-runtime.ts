import {
  type ClaimedStep,
  isMailWakeText,
  type MachineDoneBody,
  type ProviderConfig,
} from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Provider } from '@earendil-works/pi-ai';
import type { Harness } from '@earendil-works/pi-durable';
import {
  coordinatorCompactionExtension,
  coordinatorCompactionSettings,
  type MemoryFlush,
  type ModelRef,
  type Summarize,
  summarizerFor,
} from './compaction.js';
import { withRegisteredMailConversation } from './conversations.js';
import { reportCompactionFailure } from './failure-report.js';
import { generationTelemetryExtension } from './generation-telemetry.js';
import { createInputReceipts, type InputReceipts } from './input-receipts.js';
import { replayCoordinatorInputs } from './input-replay.js';
import type { MachineApi } from './machine-api.js';
import { type CoordinatorModels, createCoordinatorModels } from './models.js';
import { openReconciledHarness, type ReconcileFacts, type ReconcileOutcome } from './reconcile.js';
import { syncToRewind } from './rewind-sync.js';
import { coordinatorStoreId } from './store-identity.js';
import { threadStorePath } from './thread-harnesses.js';
import {
  type ConversationGate,
  coordinatorToolsExtension,
  createConversationGate,
} from './tools.js';
import { runCoordinatorTurn } from './turn.js';
import {
  createVolatileContext,
  type VolatileContext,
  volatileContextExtension,
} from './volatile.js';

export interface ServerRuntimeConfig {
  storageDir: string;
  heartbeatMs: number;
  routerTools: boolean;
  fixedProviders?: readonly Provider[];
  stopPollMs?: number;
  factsFor(threadId: string): ReconcileFacts;
  providersFor?(threadId: string): readonly ProviderBinding[];
  recordConversation?(threadId: string, conversationId: string, entryId: number): void;
  setConversation?(
    threadId: string,
    conversationId: string,
    watermark: string | null,
    restoreOwnerId: string | null,
  ): void;
  memoryFlush?(threadId: string): MemoryFlush | null;
  onInputError?(threadId: string, error: unknown): void;
  onReconciled?(threadId: string, outcome: ReconcileOutcome, stale: string[]): void;
}

export interface ProviderBinding {
  config: ProviderConfig;
  modelId: string;
  resolveKey(): string | null;
}

export interface ServerTurn {
  claimed: ClaimedStep;
  volatileText: string | null;
  coldSlim?: { cold: boolean; summaryHint?: string | null } | null;
  beforeDone?: () => void;
  router: ProviderBinding;
  summary: ProviderBinding;
}

interface ThreadState {
  harness: Promise<Harness>;
  models: CoordinatorModels;
  inputs: InputReceipts | undefined;
  gate: ConversationGate;
  volatile: VolatileContext;
  summary: { ref: ModelRef | null };
}

export function createServerRuntime(config: ServerRuntimeConfig, api: MachineApi) {
  const context = BACKGROUND_CONTEXT;
  let shuttingDown = false;
  const settings = (models: CoordinatorModels) => () => ({
    compaction: coordinatorCompactionSettings(
      models.models
        .getModels()
        .map((m) => ({ provider: m.provider, id: m.id, contextWindow: m.contextWindow })),
    ),
  });
  const open = new Map<string, ThreadState>();
  const busy = new Map<string, number>();
  const lastUsed = new Map<string, number>();
  const closing = new Map<string, Promise<void>>();

  const stateOf = (threadId: string, forceReseed = false): ThreadState => {
    const existing = open.get(threadId);
    if (existing !== undefined) return existing;
    const facts = config.factsFor(threadId);
    const models = createCoordinatorModels(config.fixedProviders);
    for (const binding of config.providersFor?.(threadId) ?? []) {
      models.useProvider(binding.config, binding.resolveKey);
    }
    const gate = createConversationGate();
    const inputs =
      api.inputs === undefined
        ? undefined
        : createInputReceipts(threadId, api.inputs, context, (error) =>
            config.onInputError?.(threadId, error),
          );
    const volatile = createVolatileContext();
    const summary: ThreadState['summary'] = { ref: null };
    const extensions = [
      coordinatorToolsExtension(api, gate, {
        routerTools: config.routerTools,
        shuttingDown: () => shuttingDown,
        ...(inputs === undefined
          ? {}
          : {
              storeId: inputs.storeId,
              beforeTool: async (signal?: AbortSignal, conversationId?: string) => {
                await inputs.barrier(signal);
                if (conversationId !== undefined)
                  await api.inputs?.assertConversation(threadId, inputs.key(conversationId));
              },
            }),
      }),
      volatileContextExtension(volatile),
      coordinatorCompactionExtension(
        () => summary.ref,
        () => config.memoryFlush?.(threadId) ?? null,
        threadId,
      ),
      generationTelemetryExtension(async (conversationId) => ({
        threadId,
        stepId: await gate.stepFor(conversationId),
      })),
    ];
    const summarize = (): Summarize | null => {
      try {
        return summarizerFor(models.models, summary.ref);
      } catch (error) {
        reportCompactionFailure({ threadId }, 'summary-model', error);
        return null;
      }
    };
    const harness = openReconciledHarness(
      threadStorePath(config.storageDir, threadId),
      models.models,
      context,
      {
        extensions,
        settings: settings(models),
        summarize,
        storeIdentity: (harness) => coordinatorStoreId(harness, context),
        refreshFacts: () => config.factsFor(threadId),
        beforeReconcile: async (harness, storeId) => {
          if (storeId === undefined)
            throw new Error('Coordinator durable store identity is missing');
          inputs?.attach(harness, storeId);
          await inputs?.recover(harness);
          if (api.inputs !== undefined)
            await replayCoordinatorInputs(harness, api.inputs, api, threadId, storeId, context);
        },
      },
      forceReseed ? { ...facts, forceReseed: true, hasClaimedStep: false } : facts,
    ).then((result) => {
      config.onReconciled?.(threadId, result.outcome, result.stale);
      return result.harness;
    });
    const state = { harness, models, gate, volatile, summary, inputs };
    open.set(threadId, state);
    harness.catch(() => open.delete(threadId));
    return state;
  };

  const settleClosing = async (threadId: string): Promise<void> => {
    while (closing.has(threadId)) await closing.get(threadId);
  };

  const openThread = async (threadId: string): Promise<Harness> => {
    await settleClosing(threadId);
    return stateOf(threadId).harness;
  };

  const closeThread = async (threadId: string): Promise<void> => {
    await settleClosing(threadId);
    const state = open.get(threadId);
    if (state === undefined) return;
    open.delete(threadId);
    lastUsed.delete(threadId);
    const shutdown = (async () => {
      const harness = await state.harness.catch(() => null);
      state.inputs?.stop();
      await harness?.close(context);
      await state.inputs?.close();
    })();
    closing.set(
      threadId,
      shutdown.catch(() => undefined),
    );
    try {
      await shutdown;
    } finally {
      closing.delete(threadId);
    }
  };

  return {
    openThread,
    recoverThread: async (threadId: string) => {
      const harness = await openThread(threadId);
      const inputs = open.get(threadId)?.inputs;
      await inputs?.recover(harness);
      const storeId = inputs?.storeId();
      if (api.inputs !== undefined && storeId !== undefined)
        await replayCoordinatorInputs(harness, api.inputs, api, threadId, storeId, context);
    },
    closeThread,
    isOpen: (threadId: string) => open.has(threadId),
    runTurn: async (turn: ServerTurn): Promise<MachineDoneBody> => {
      const { claimed } = turn;
      const threadId = claimed.chief?.threadId ?? '';
      await settleClosing(threadId);
      const prepare = (target: ThreadState): ThreadState => {
        target.models.useProvider(turn.router.config, turn.router.resolveKey);
        target.models.useProvider(turn.summary.config, turn.summary.resolveKey);
        target.summary.ref = {
          provider: turn.summary.config.providerId,
          modelId: turn.summary.modelId,
        };
        return target;
      };
      const state = prepare(stateOf(threadId));
      busy.set(threadId, (busy.get(threadId) ?? 0) + 1);
      try {
        let current = state;
        const synced = await syncToRewind(
          await current.harness,
          context,
          config.factsFor(threadId),
        );
        if (synced.action === 'reseed') {
          await closeThread(threadId);
          current = prepare(stateOf(threadId, true));
          await current.harness;
        } else if (synced.action === 'forked') {
          config.recordConversation?.(threadId, synced.conversationId, synced.entryId);
        }
        const prior = config.factsFor(threadId);
        const mailTurn =
          config.setConversation !== undefined && isMailWakeText(turn.claimed.instruction ?? '');
        const run = async (conversationId: string | null) =>
          runCoordinatorTurn(
            {
              harness: await current.harness,
              ...(current.inputs === undefined
                ? {}
                : {
                    inputs: current.inputs,
                    afterMirror: async () => {
                      const storeId = current.inputs?.storeId();
                      if (api.inputs !== undefined && storeId !== undefined)
                        await replayCoordinatorInputs(
                          await current.harness,
                          api.inputs,
                          api,
                          threadId,
                          storeId,
                          context,
                        );
                    },
                  }),
              conversationId,
              models: current.models,
              api,
              context,
              heartbeatMs: config.heartbeatMs,
              ...(config.stopPollMs === undefined ? {} : { stopPollMs: config.stopPollMs }),
              now: Date.now,
              conversationGate: current.gate,
              volatile: current.volatile,
              volatileText: turn.volatileText,
              coldSlim: turn.coldSlim ?? null,
              ...(turn.beforeDone === undefined ? {} : { beforeDone: turn.beforeDone }),
            },
            turn.claimed,
          );
        if (!mailTurn) return run(prior.conversationId);
        return withRegisteredMailConversation(
          await current.harness,
          context,
          prior.conversationId,
          (id, restoreOwnerId) =>
            config.setConversation?.(threadId, id, prior.lastMirroredEntryId, restoreOwnerId),
          run,
        );
      } finally {
        const left = (busy.get(threadId) ?? 1) - 1;
        if (left <= 0) busy.delete(threadId);
        else busy.set(threadId, left);
        lastUsed.set(threadId, Date.now());
      }
    },
    closeIdle: async (idleMs: number, now = Date.now()): Promise<string[]> => {
      const closed: string[] = [];
      for (const [threadId, at] of lastUsed) {
        if (busy.has(threadId) || now - at < idleMs) continue;
        await closeThread(threadId);
        closed.push(threadId);
      }
      return closed;
    },
    close: async (): Promise<void> => {
      shuttingDown = true;
      const results = await Promise.allSettled([...open.keys()].map(closeThread));
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0) throw new AggregateError(failures, failures.map(String).join('; '));
    },
  };
}
