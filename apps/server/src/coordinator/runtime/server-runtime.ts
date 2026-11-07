import type { ClaimedStep, MachineDoneBody, ProviderConfig } from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Provider } from '@earendil-works/pi-ai';
import type { Harness } from '@earendil-works/pi-durable';
import {
  coordinatorCompactionExtension,
  coordinatorCompactionSettings,
  type ModelRef,
} from './compaction.js';
import type { MachineApi } from './machine-api.js';
import { type CoordinatorModels, createCoordinatorModels } from './models.js';
import { openReconciledHarness, type ReconcileFacts, type ReconcileOutcome } from './reconcile.js';
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
  router: ProviderBinding;
  summary: ProviderBinding;
}

interface ThreadState {
  harness: Promise<Harness>;
  models: CoordinatorModels;
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

  const stateOf = (threadId: string): ThreadState => {
    const existing = open.get(threadId);
    if (existing !== undefined) return existing;
    const models = createCoordinatorModels(config.fixedProviders);
    const gate = createConversationGate();
    const volatile = createVolatileContext();
    const summary: ThreadState['summary'] = { ref: null };
    const extensions = [
      coordinatorToolsExtension(api, gate, {
        routerTools: config.routerTools,
        shuttingDown: () => shuttingDown,
      }),
      volatileContextExtension(volatile),
      coordinatorCompactionExtension(() => summary.ref),
    ];
    const harness = openReconciledHarness(
      threadStorePath(config.storageDir, threadId),
      models.models,
      context,
      { extensions, settings: settings(models) },
      config.factsFor(threadId),
    ).then((result) => {
      config.onReconciled?.(threadId, result.outcome, result.stale);
      return result.harness;
    });
    const state = { harness, models, gate, volatile, summary };
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
      await harness?.close(context);
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
    closeThread,
    isOpen: (threadId: string) => open.has(threadId),
    runTurn: async (turn: ServerTurn): Promise<MachineDoneBody> => {
      const { claimed } = turn;
      const threadId = claimed.chief?.threadId ?? '';
      await settleClosing(threadId);
      const state = stateOf(threadId);
      state.models.useProvider(turn.router.config, turn.router.resolveKey);
      state.models.useProvider(turn.summary.config, turn.summary.resolveKey);
      state.summary.ref = {
        provider: turn.summary.config.providerId,
        modelId: turn.summary.modelId,
      };
      busy.set(threadId, (busy.get(threadId) ?? 0) + 1);
      try {
        const harness = await state.harness;
        return await runCoordinatorTurn(
          {
            harness,
            models: state.models,
            api,
            context,
            heartbeatMs: config.heartbeatMs,
            ...(config.stopPollMs === undefined ? {} : { stopPollMs: config.stopPollMs }),
            now: Date.now,
            conversationGate: state.gate,
            volatile: state.volatile,
            volatileText: turn.volatileText,
          },
          claimed,
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
      for (const threadId of [...open.keys()]) await closeThread(threadId);
    },
  };
}
