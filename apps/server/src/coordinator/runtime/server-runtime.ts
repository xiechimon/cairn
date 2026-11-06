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
import { createCoordinatorModels } from './models.js';
import { openReconciledHarness, type ReconcileFacts, type ReconcileOutcome } from './reconcile.js';
import { threadStorePath } from './thread-harnesses.js';
import { coordinatorToolsExtension, createConversationGate } from './tools.js';
import { runCoordinatorTurn } from './turn.js';
import { createVolatileContext, volatileContextExtension } from './volatile.js';

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

export function createServerRuntime(config: ServerRuntimeConfig, api: MachineApi) {
  const context = BACKGROUND_CONTEXT;
  const models = createCoordinatorModels(config.fixedProviders);
  const gate = createConversationGate();
  const volatile = createVolatileContext();
  let summaryRef: ModelRef | null = null;
  let shuttingDown = false;
  const extensions = [
    coordinatorToolsExtension(api, gate, {
      routerTools: config.routerTools,
      shuttingDown: () => shuttingDown,
    }),
    volatileContextExtension(volatile),
    coordinatorCompactionExtension(() => summaryRef),
  ];
  const settings = () => ({
    compaction: coordinatorCompactionSettings(
      models.models
        .getModels()
        .map((m) => ({ provider: m.provider, id: m.id, contextWindow: m.contextWindow })),
    ),
  });
  const open = new Map<string, Promise<Harness>>();
  const busy = new Map<string, number>();
  const lastUsed = new Map<string, number>();

  const openThread = (threadId: string): Promise<Harness> => {
    const existing = open.get(threadId);
    if (existing !== undefined) return existing;
    const opening = openReconciledHarness(
      threadStorePath(config.storageDir, threadId),
      models.models,
      context,
      { extensions, settings },
      config.factsFor(threadId),
    ).then((result) => {
      config.onReconciled?.(threadId, result.outcome, result.stale);
      return result.harness;
    });
    open.set(threadId, opening);
    opening.catch(() => open.delete(threadId));
    return opening;
  };

  const closeThread = async (threadId: string): Promise<void> => {
    const opening = open.get(threadId);
    if (opening === undefined) return;
    open.delete(threadId);
    lastUsed.delete(threadId);
    const harness = await opening.catch(() => null);
    await harness?.close(context);
  };

  return {
    openThread,
    isOpen: (threadId: string) => open.has(threadId),
    runTurn: async (turn: ServerTurn): Promise<MachineDoneBody> => {
      const { claimed } = turn;
      const threadId = claimed.chief?.threadId ?? '';
      models.useProvider(turn.router.config, turn.router.resolveKey);
      models.useProvider(turn.summary.config, turn.summary.resolveKey);
      summaryRef = { provider: turn.summary.config.providerId, modelId: turn.summary.modelId };
      busy.set(threadId, (busy.get(threadId) ?? 0) + 1);
      try {
        const harness = await openThread(threadId);
        return await runCoordinatorTurn(
          {
            harness,
            models,
            api,
            context,
            heartbeatMs: config.heartbeatMs,
            ...(config.stopPollMs === undefined ? {} : { stopPollMs: config.stopPollMs }),
            now: Date.now,
            conversationGate: gate,
            volatile,
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
