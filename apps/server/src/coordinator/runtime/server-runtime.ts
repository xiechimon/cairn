import {
  type ClaimedStep,
  isChiefMemoryThreadId,
  isMailWakeText,
  type MachineDoneBody,
  type ProviderConfig,
  type RemoteToolDef,
  WORKER_MEMORY_REMOTE_TOOLS,
} from '@cairn/shared';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type {
  Api,
  Model,
  ModelThinkingLevel,
  Provider,
  ProviderResponse,
} from '@earendil-works/pi-ai';
import type { ConversationId } from '@earendil-works/pi-durable';
import { createRegistry, type Harness } from '@earendil-works/pi-durable';
import type { BrowserOffer } from '../../services/coordinator-browser.js';
import { firstFeedback } from '../../services/first-feedback.js';
import {
  coordinatorCompactionExtension,
  coordinatorCompactionSettings,
  type MemoryFlush,
  type ModelRef,
  summarizerOverContext,
  type WarmSummary,
} from './compaction.js';
import { activeConversation, withRegisteredMailConversation } from './conversations.js';
import {
  type CompactionStage,
  type FailureScope,
  recordCompactionSuccess,
  reportCompactionFailure,
  taskFailure,
} from './failure-report.js';
import { generationTelemetryExtension } from './generation-telemetry.js';
import {
  type CompactionTrigger,
  IDLE_COMPACT_TIMEOUT_MS,
  summaryOutputBudget,
} from './idle-compact.js';
import { createInputReceipts, type InputReceipts } from './input-receipts.js';
import { replayCoordinatorInputs } from './input-replay.js';
import type { MachineApi } from './machine-api.js';
import { type CoordinatorModels, createCoordinatorModels } from './models.js';
import { openReconciledHarness, type ReconcileFacts, type ReconcileOutcome } from './reconcile.js';
import {
  coordinatorResponsivenessExtension,
  createResponsivenessTracker,
  type ResponsivenessTracker,
} from './responsiveness.js';
import { syncToRewind } from './rewind-sync.js';
import { coordinatorStoreId } from './store-identity.js';
import { coordinatorSubagentExtension, SubagentTurnLimiter } from './subagent.js';
import { threadStorePath } from './thread-harnesses.js';
import {
  CORE_COORDINATOR_TOOLS,
  type ConversationGate,
  coordinatorToolsExtension,
  createConversationGate,
} from './tools.js';
import { runCoordinatorTurn } from './turn.js';
import { createSetupTiming } from './turn-spans.js';
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
  desktopTools?(threadId: string): boolean;
  connectorTools?(threadId: string): RemoteToolDef[];
  ownComputer?(threadId: string): boolean;
  ownComputerWorkspace?(threadId: string): boolean;
  browserOffer?(threadId: string): BrowserOffer | undefined;
  phoneComputer?(threadId: string): readonly string[];
  providersFor?(threadId: string): readonly ProviderBinding[];
  onImagesRejected?(threadId: string, providerId: string, modelId: string): void;
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
  thinkingLevel?: ModelThinkingLevel | null;
  resolveKey(): string | null | Promise<string | null>;
  observe?(response: ProviderResponse, model: Model<Api>): void;
}

export interface ServerTurn {
  claimed: ClaimedStep;
  volatileText: string | null;
  freshSession?: boolean;
  router: ProviderBinding;
  summary: ProviderBinding;
}

interface ThreadState {
  harness: Promise<Harness>;
  models: CoordinatorModels;
  inputs: InputReceipts | undefined;
  gate: ConversationGate;
  volatile: VolatileContext;
  responsiveness: ResponsivenessTracker;
  summary: { ref: ModelRef | null };
  /** Summaries computed from a live context, waiting for the compaction that places them. */
  warmSummaries: Map<ConversationId, WarmSummary>;
  /** Compactions this runtime runs while nobody waits, which own the memory flush themselves. */
  idleCompacting: { count: number };
  syncConnectorTools: () => void;
}

export interface IdleCompactionPlan {
  trigger: CompactionTrigger;
  summary: ProviderBinding;
  /** Prompt tokens the thread's last turn measured, which the summary must fit. */
  contextTokens: number;
  /** Timestamp of the usage row this plan was decided from. */
  usageCreatedAt: number;
  /** Whether the summary model is the last turn's model, so its request reads that warm cache. */
  warmCache: boolean;
  /** The explicit cache mode the last turn used, absent when the provider caches on its own. */
  cacheRetention?: 'short' | 'long';
}

export type IdleCompactionOutcome = 'compacted' | 'empty' | 'skipped' | 'failed';

export function createServerRuntime(config: ServerRuntimeConfig, api: MachineApi) {
  const context = BACKGROUND_CONTEXT;
  let shuttingDown = false;
  const shutdown = new AbortController();
  const settings = (models: CoordinatorModels) => () => ({
    steeringMode: 'all' as const,
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
  const compacting = new Map<string, Promise<IdleCompactionOutcome>>();
  const suggestionYields = new Map<string, AbortController>();
  const turnSignals = new Map<string, { onSteer(): void; onStop(): void }>();
  const toolRounds = new Set<string>();
  const subagentLimiter = new SubagentTurnLimiter();
  const untrustedSteps = new Set<string>();
  const setup = createSetupTiming();

  const stateOf = (threadId: string, forceReseed = false): ThreadState => {
    const existing = open.get(threadId);
    if (existing !== undefined) return existing;
    const facts = config.factsFor(threadId);
    const models = createCoordinatorModels(config.fixedProviders, (providerId, modelId) => {
      for (const state of open.values()) state.models.markTextOnly(providerId, modelId);
      config.onImagesRejected?.(threadId, providerId, modelId);
    });
    for (const binding of config.providersFor?.(threadId) ?? []) {
      models.useProvider(binding.config, binding.resolveKey, binding.observe);
    }
    const gate = createConversationGate();
    const childParents = new Map<string, string>();
    const inputs =
      api.inputs === undefined
        ? undefined
        : createInputReceipts(threadId, api.inputs, context, (error) =>
            config.onInputError?.(threadId, error),
          );
    const volatile = createVolatileContext();
    const responsiveness = createResponsivenessTracker();
    const summary: ThreadState['summary'] = { ref: null };
    const warmSummaries: ThreadState['warmSummaries'] = new Map();
    const idleCompacting: ThreadState['idleCompacting'] = { count: 0 };
    const registry = createRegistry();
    const memoryThread = isChiefMemoryThreadId(threadId);
    const buildToolsExtension = (connectorTools: RemoteToolDef[]) =>
      coordinatorToolsExtension(api, gate, {
        routerTools: config.routerTools,
        desktopTools: config.desktopTools?.(threadId) === true,
        connectorTools,
        ...(memoryThread
          ? { remoteTools: WORKER_MEMORY_REMOTE_TOOLS }
          : { loaded: CORE_COORDINATOR_TOOLS }),
        ownComputer: config.ownComputer?.(threadId) === true,
        ownComputerWorkspace: config.ownComputerWorkspace?.(threadId) === true,
        ...config.browserOffer?.(threadId),
        phoneComputer: config.phoneComputer?.(threadId) ?? [],
        shuttingDown: () => shuttingDown,
        onToolRound: (conversationId, active) => {
          const key = `${threadId}:${conversationId}`;
          if (active) toolRounds.add(key);
          else toolRounds.delete(key);
        },
        ...(inputs === undefined
          ? {}
          : {
              storeId: inputs.storeId,
              beforeTool: async (signal?: AbortSignal, conversationId?: string) => {
                setup.mark(threadId, 'generation prepare');
                await inputs.barrier(signal);
                setup.mark(threadId, 'input barrier');
                if (conversationId !== undefined) {
                  const authorityId = childParents.get(conversationId) ?? conversationId;
                  await api.inputs?.assertConversation(threadId, inputs.key(authorityId));
                  setup.mark(threadId, 'conversation check');
                }
              },
            }),
      });
    const initialConnectorTools = memoryThread ? [] : (config.connectorTools?.(threadId) ?? []);
    let connectorDefs = new Map(
      initialConnectorTools.map((def) => [def.name, JSON.stringify(def)]),
    );
    let offeredBrowser = JSON.stringify(config.browserOffer?.(threadId) ?? null);
    const syncConnectorTools = () => {
      if (memoryThread) return;
      const next = config.connectorTools?.(threadId) ?? [];
      const nextDefs = new Map(next.map((def) => [def.name, JSON.stringify(def)]));
      const nextBrowser = JSON.stringify(config.browserOffer?.(threadId) ?? null);
      if (
        nextBrowser === offeredBrowser &&
        nextDefs.size === connectorDefs.size &&
        [...nextDefs].every(([name, raw]) => connectorDefs.get(name) === raw)
      )
        return;
      registry.install(buildToolsExtension(next));
      connectorDefs = nextDefs;
      offeredBrowser = nextBrowser;
    };
    const extensions = [
      buildToolsExtension(initialConnectorTools),
      ...(!memoryThread
        ? [
            coordinatorSubagentExtension({
              gate,
              models,
              api,
              ...(inputs === undefined ? {} : { storeId: inputs.storeId }),
              isUntrustedTurn: (stepId) => untrustedSteps.has(stepId),
              readOnlyConnectorNames: () =>
                new Set(
                  (config.connectorTools?.(threadId) ?? [])
                    .filter((def) => def.replaySafe === true)
                    .map((def) => def.name),
                ),
              onChildLifecycle: (childId, parentId) => {
                if (parentId === null) childParents.delete(childId);
                else childParents.set(childId, parentId);
              },
              limiter: subagentLimiter,
            }),
          ]
        : []),
      volatileContextExtension(volatile),
      coordinatorResponsivenessExtension(responsiveness),
      coordinatorCompactionExtension(
        () => summary.ref,
        () => (idleCompacting.count > 0 ? null : (config.memoryFlush?.(threadId) ?? null)),
        threadId,
        (conversationId) => {
          const warm = warmSummaries.get(conversationId);
          warmSummaries.delete(conversationId);
          return warm ?? null;
        },
      ),
      generationTelemetryExtension(
        async (conversationId) => ({
          threadId,
          stepId: await gate.stepFor(conversationId),
        }),
        {
          mark: (name) => setup.mark(threadId, name),
          end: () => setup.end(threadId),
        },
      ),
    ];
    for (const extension of extensions) registry.install(extension);
    const harness = openReconciledHarness(
      threadStorePath(config.storageDir, threadId),
      models.models,
      context,
      {
        registry,
        settings: settings(models),
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
    const state = {
      harness,
      models,
      gate,
      volatile,
      responsiveness,
      summary,
      warmSummaries,
      idleCompacting,
      inputs,
      syncConnectorTools,
    };
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
      firstFeedback.settle(threadId);
      state.responsiveness.clear();
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
    compactWhileIdle: async (
      threadId: string,
      plan: IdleCompactionPlan,
    ): Promise<IdleCompactionOutcome> => {
      if (busy.has(threadId) || compacting.has(threadId) || closing.has(threadId)) return 'skipped';
      const wasOpen = open.has(threadId);
      const state = stateOf(threadId);
      const ref: ModelRef = {
        provider: plan.summary.config.providerId,
        modelId: plan.summary.modelId,
        ...(plan.summary.thinkingLevel === undefined
          ? {}
          : { thinkingLevel: plan.summary.thinkingLevel }),
      };
      const priorRef = state.summary.ref;
      state.summary.ref = ref;
      state.models.useProvider(plan.summary.config, plan.summary.resolveKey, plan.summary.observe);
      state.idleCompacting.count += 1;
      const scope: FailureScope = { threadId };
      const stage: CompactionStage =
        plan.trigger === 'idle' ? 'idle-compaction' : 'cache-expiry-compaction';
      let abortCompaction: (() => Promise<void>) | null = null;
      let expired = false;
      const work = async (): Promise<IdleCompactionOutcome> => {
        const harness = await state.harness;
        const prior = config.factsFor(threadId).conversationId;
        const conversation =
          (await activeConversation(harness, prior, context)) ?? (await harness.root(context));
        if ((await harness.inspect(context)).tasks.length > 0) return 'skipped';
        const view = await conversation.context(context);
        const compactedAt = view.head?.model?.[0]?.timestamp;
        if (compactedAt !== undefined && compactedAt >= plan.usageCreatedAt) return 'skipped';
        const model = state.models.models.getModel(ref.provider, ref.modelId);
        const budget =
          !plan.warmCache || model === undefined
            ? null
            : summaryOutputBudget(plan.contextTokens, model.contextWindow, model.maxTokens);
        const startedAt = Date.now();
        try {
          if (budget !== null) {
            const summary = await summarizerOverContext(
              state.models.models,
              ref,
              {
                ...scope,
                stage,
                timeoutMs: IDLE_COMPACT_TIMEOUT_MS,
                maxTokens: budget,
                signal: shutdown.signal,
              },
              plan.cacheRetention,
            )(view.messages);
            const newest = view.entries.at(-1);
            state.warmSummaries.set(conversation.id, {
              summary,
              tail: newest === undefined ? null : String(newest.id),
            });
          }
          const taskId = await conversation.compact(undefined, context);
          abortCompaction = async () => {
            await harness.abortTask(taskId, context);
          };
          const settled = await harness.waitForTask(taskId, context);
          const outcome = settled.state.outcome;
          if (outcome.status !== 'completed') {
            reportCompactionFailure(
              scope,
              stage,
              taskFailure(String(outcome.error?.message ?? 'compaction failed')),
              startedAt,
            );
            return 'failed';
          }
          const placed =
            outcome.result.entryId !== undefined || outcome.result.submissionId !== undefined;
          if (!placed) return 'empty';
          recordCompactionSuccess(scope, stage, startedAt);
          return 'compacted';
        } catch (error) {
          reportCompactionFailure(scope, stage, error, startedAt);
          return 'failed';
        } finally {
          state.warmSummaries.delete(conversation.id);
        }
      };
      const settle = work().catch((error: unknown): IdleCompactionOutcome => {
        if (!shuttingDown && !expired) reportCompactionFailure(scope, stage, error);
        return 'failed';
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<IdleCompactionOutcome>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          resolve('failed');
        }, IDLE_COMPACT_TIMEOUT_MS + 60_000);
        timer.unref();
      });
      const run = Promise.race([settle, deadline]).then(async (outcome) => {
        if (!expired) return outcome;
        const abandoned = abortCompaction;
        abortCompaction = null;
        if (abandoned !== null) await abandoned().catch(() => {});
        reportCompactionFailure(scope, stage, taskFailure('idle compaction ran past its deadline'));
        return outcome;
      });
      compacting.set(threadId, run);
      try {
        return await run;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        compacting.delete(threadId);
        state.idleCompacting.count = Math.max(0, state.idleCompacting.count - 1);
        if (state.summary.ref === ref) state.summary.ref = priorRef;
        if (!wasOpen) await closeThread(threadId).catch(() => {});
      }
    },
    yieldSuggestions: (threadId: string) => suggestionYields.get(threadId)?.abort(),
    signalSteer: (threadId: string) => {
      suggestionYields.get(threadId)?.abort();
      turnSignals.get(threadId)?.onSteer();
    },
    signalStop: (threadId: string) => {
      suggestionYields.get(threadId)?.abort();
      turnSignals.get(threadId)?.onStop();
    },
    runTurn: async (turn: ServerTurn): Promise<MachineDoneBody> => {
      const { claimed } = turn;
      const threadId = claimed.chief?.threadId ?? '';
      setup.begin({
        threadId,
        stepId: claimed.step.id,
        provider: claimed.agent?.provider ?? '',
        model: claimed.agent?.modelId ?? '',
      });
      await settleClosing(threadId);
      const prepare = (target: ThreadState): ThreadState => {
        target.models.useProvider(turn.router.config, turn.router.resolveKey, turn.router.observe);
        target.models.useProvider(
          turn.summary.config,
          turn.summary.resolveKey,
          turn.summary.observe,
        );
        target.summary.ref = {
          provider: turn.summary.config.providerId,
          modelId: turn.summary.modelId,
          ...(turn.summary.thinkingLevel !== undefined
            ? { thinkingLevel: turn.summary.thinkingLevel }
            : {}),
        };
        return target;
      };
      const state = prepare(stateOf(threadId));
      state.syncConnectorTools();
      busy.set(threadId, (busy.get(threadId) ?? 0) + 1);
      const suggestionYield = new AbortController();
      suggestionYields.set(threadId, suggestionYield);
      try {
        let current = state;
        const mailTurn =
          config.setConversation !== undefined && isMailWakeText(turn.claimed.instruction ?? '');
        if (turn.freshSession === true && !mailTurn) {
          await closeThread(threadId);
          current = prepare(stateOf(threadId, true));
          await current.harness;
        } else {
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
        }
        setup.mark(threadId, 'open store');
        const prior = config.factsFor(threadId);
        if (mailTurn) untrustedSteps.add(claimed.step.id);
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
              responsiveness: current.responsiveness,
              volatileText: turn.volatileText,
              suggestionYield: suggestionYield.signal,
              setupPhase: (name) => setup.mark(threadId, name),
              registerSignals: (handlers) => {
                turnSignals.set(threadId, handlers);
                return () => {
                  if (turnSignals.get(threadId) === handlers) turnSignals.delete(threadId);
                };
              },
              isInToolRound: (id) => toolRounds.has(`${threadId}:${id}`),
            },
            turn.claimed,
          );
        if (!mailTurn) return await run(prior.conversationId);
        return await withRegisteredMailConversation(
          await current.harness,
          context,
          prior.conversationId,
          (id, restoreOwnerId) =>
            config.setConversation?.(threadId, id, prior.lastMirroredEntryId, restoreOwnerId),
          run,
        );
      } finally {
        subagentLimiter.clearStep(claimed.step.id);
        untrustedSteps.delete(claimed.step.id);
        if (suggestionYields.get(threadId) === suggestionYield) suggestionYields.delete(threadId);
        setup.end(threadId);
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
      shutdown.abort();
      const results = await Promise.allSettled([...open.keys()].map(closeThread));
      await Promise.allSettled([...compacting.values()]);
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0) throw new AggregateError(failures, failures.map(String).join('; '));
    },
  };
}
