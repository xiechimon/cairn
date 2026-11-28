import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  type ClaimedStep,
  type MachineDoneBody,
  redactSecrets,
  startTurnHeartbeat,
  type ThinkingLevel,
  thinkingLevelSchema,
  transcriptPromptRowId,
  withHistoryMarker,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  chief,
  chiefMessage,
  chiefThread,
  coordinatorConversation,
  coordinatorEntry,
  coordinatorInput,
  step,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { greetingReadmeSection, parseChiefTrigger } from '../services/chief.js';
import {
  CHIEF_STOP_ROW_ID_PREFIX,
  hasEarlierLiveChiefStep,
  STEER_HOLDS,
} from '../services/chief-turns.js';
import { connectorToolDefsForTeam } from '../services/connector-broker.js';
import { browserOfferFor } from '../services/coordinator-browser.js';
import { lastTurnUsageForColdResume } from '../services/coordinator-context.js';
import { resolveCoordinatorRemoteTools } from '../services/coordinator-diagnostics.js';
import { migrateUnfetchedCoordinatorInputs } from '../services/coordinator-input-upgrade.js';
import { coordinatorInputIsLive } from '../services/coordinator-inputs.js';
import {
  chiefTurnContext,
  claimPendingChiefStep,
  recordReusedInstructions,
} from '../services/coordinator-steps.js';
import { captureCoordinatorClaim } from '../services/coordinator-turn-capture.js';
import { readDeployLease } from '../services/deploy-lease.js';
import { serverTurnModel } from '../services/machine-claim.js';
import { stageTurnAttachments, teamOffersDesktop } from '../services/machine-computer.js';
import { type MachineDeps, publishStepStatus, upsertChiefRow } from '../services/machine-deps.js';
import {
  CONNECTOR_TOOL_HYDRATE_BOUND_MS,
  connectorSlugs,
  hydrateMissingConnectorTools,
  mcpConnectorDepsOf,
} from '../services/mcp-servers.js';
import { ownComputerOffered, ownComputerWorkspaceOffered } from '../services/own-computer.js';
import { offeredPhoneNames } from '../services/phone-computer.js';
import { stepScopeProjectId } from '../services/picked-project.js';
import { markProviderModelTextOnly } from '../services/providers.js';
import { writeMemoryTraceGuarded } from '../services/step-groups/memory-trace.js';
import { readQuota } from '../services/step-groups/quota.js';
import {
  type CoordinatorProviders,
  coordinatorProviders,
  scrubProviderError,
} from './credentials.js';
import { createIdleMemorySweep } from './idle-memory.js';
import { acquireLease, type Lease, LeaseHeldError } from './lease.js';
import { settleInterruptedMailConversation } from './mail-owner.js';
import { createMemoryFlush } from './memory-flush.js';
import { providerBinding } from './provider-binding.js';
import { cacheTtlMsFor, isColdResume, resolveCacheRetentionTier } from './runtime/cold-slim.js';
import { thrownErrorText } from './runtime/error-text.js';
import { setFailureSink } from './runtime/failure-report.js';
import type { MachineApi } from './runtime/machine-api.js';
import type { ReconcileFacts } from './runtime/reconcile.js';
import type { SeedRow } from './runtime/seed.js';
import {
  createServerRuntime,
  type ProviderBinding,
  type ServerRuntimeConfig,
} from './runtime/server-runtime.js';
import { createCoordinatorServerApi } from './server-api.js';
import { parseWatermark } from './watermark.js';

const HEARTBEAT_MS = 15_000;
const TICK_MS = 5_000;
const IDLE_CLOSE_MS = 30 * 60 * 1000;
const SEED_MAX_ROWS = 100;

export interface CoordinatorLogger {
  info(obj: object, message: string): void;
  warn(obj: object, message: string): void;
  error(obj: object, message: string): void;
}

export interface CoordinatorOptions {
  machine: MachineDeps;
  storageDir: string;
  logger: CoordinatorLogger;
  routerTools?: boolean;
  fixedProviders?: ServerRuntimeConfig['fixedProviders'];
  heartbeatMs?: number;
  tickMs?: number;
  idleCloseMs?: number;
  idleMemoryFlushMs?: number;
  idleMemoryRetryMs?: number;
  idleMemoryTimeoutMs?: number;
  stopPollMs?: number;
  owner?: string;
}

export interface Coordinator {
  wake(threadId: string): void;
  signalSteer(threadId: string): void;
  signalStop(threadId: string): void;
  tick(): void;
  idle(): Promise<void>;
  close(): Promise<void>;
}

type StepRow = typeof step.$inferSelect;

function thinkingLevelOf(value: string | null): ThinkingLevel | null {
  const parsed = thinkingLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function startCoordinator(options: CoordinatorOptions): Coordinator {
  const { machine, logger } = options;
  const { db } = machine;
  let closing = false;
  const owner = options.owner ?? `server-${process.pid}-${randomUUID()}`;
  const serverApi = createCoordinatorServerApi(machine);
  const scrubbed = (stepId: string, body: MachineDoneBody): MachineDoneBody => {
    if (body.errorMessage === undefined) return body;
    const row = db.select().from(step).where(eq(step.id, stepId)).get();
    const teamId = row === undefined ? null : threadTeam(row.buildId);
    if (teamId === null)
      return { ...body, errorMessage: String(redactSecrets(body.errorMessage).value) };
    const providers = coordinatorProviders(
      { db, box: machine.box },
      teamId,
      row === undefined ? null : threadProject(row.buildId),
    );
    const ids = [providers?.router.provider, providers?.summary.provider].filter(
      (id): id is string => id !== undefined,
    );
    return {
      ...body,
      errorMessage: scrubProviderError({ db, box: machine.box }, teamId, ids, body.errorMessage),
    };
  };
  const forGen = serverApi.forGeneration;
  const wrapApi = (target: MachineApi): MachineApi => ({
    ...target,
    reusedInstructions: async (stepId, sentBy) => recordReusedInstructions(db, stepId, sentBy),
    done: async (stepId, body, observation) => {
      if (!closing) await target.done(stepId, scrubbed(stepId, body), observation);
    },
    ...(forGen !== undefined
      ? {
          forGeneration: (boundStepId, generation) => wrapApi(forGen(boundStepId, generation)),
        }
      : {}),
  });
  const api: MachineApi = wrapApi(serverApi);
  const leases = new Map<string, Lease>();
  const draining = new Map<string, Promise<void>>();
  const dirty = new Set<string>();
  const freshClaims = new Set<string>();
  const recoveryThreads = new Set(
    db
      .select({ threadId: coordinatorInput.threadId })
      .from(coordinatorInput)
      .all()
      .map((row) => row.threadId),
  );

  const threadTeam = (threadId: string): string | null =>
    db
      .select({ teamId: chiefThread.teamId })
      .from(chiefThread)
      .where(eq(chiefThread.id, threadId))
      .get()?.teamId ?? null;

  const threadProject = (threadId: string): string | null =>
    db
      .select({ projectId: chiefThread.projectId })
      .from(chiefThread)
      .where(eq(chiefThread.id, threadId))
      .get()?.projectId ?? null;

  const liveSteps = (threadId: string) =>
    db
      .select()
      .from(step)
      .where(
        and(
          eq(step.buildId, threadId),
          eq(step.kind, 'chief'),
          inArray(step.status, ['pending', 'claimed']),
        ),
      )
      .orderBy(asc(step.createdAt), sql`rowid`)
      .all();

  const factsFor = (threadId: string): ReconcileFacts => {
    const row = db
      .select()
      .from(coordinatorConversation)
      .where(eq(coordinatorConversation.threadId, threadId))
      .get();
    const live = liveSteps(threadId);
    return {
      storeId: row?.storeId ?? null,
      adoptStore: (storeId) => {
        db.update(coordinatorConversation)
          .set({ storeId })
          .where(eq(coordinatorConversation.threadId, threadId))
          .run();
      },
      conversationId: row?.conversationId ?? null,
      lastMirroredEntryId: row?.lastMirroredEntryId ?? null,
      piVersion: row?.piVersion ?? null,
      hasClaimedStep: live.some(
        (r) => r.status === 'claimed' && r.machineId === null && !freshClaims.has(r.id),
      ),
      isLive: (requestId) =>
        coordinatorInputIsLive(db, requestId) ??
        liveSteps(threadId).some((r) => r.id === requestId),
      seed: async () => {
        const teamId = threadTeam(threadId);
        const providers =
          teamId === null
            ? null
            : coordinatorProviders({ db, box: machine.box }, teamId, threadProject(threadId));
        const watermark = parseWatermark(row?.lastMirroredEntryId ?? null);
        const pendingUsers = new Set(
          live.flatMap((r) => [r.id, transcriptPromptRowId(r.id), ...(r.ownerMessageIds ?? [])]),
        );
        if (watermark?.kind === 'rewind') pendingUsers.add(watermark.anchorMessageId);
        const window = db
          .select({ message: chiefMessage, rowid: sql<number>`rowid` })
          .from(chiefMessage)
          .where(eq(chiefMessage.threadId, threadId))
          .orderBy(sql`${chiefMessage.createdAt} desc`, sql`rowid desc`)
          .limit(SEED_MAX_ROWS + pendingUsers.size + 20)
          .all()
          .filter(
            ({ message: m }) =>
              (m.role !== 'system' || m.id.startsWith(CHIEF_STOP_ROW_ID_PREFIX)) &&
              !pendingUsers.has(m.id) &&
              !m.id.startsWith('chief-digest-') &&
              !m.id.startsWith('chief-report-'),
          )
          .slice(0, SEED_MAX_ROWS)
          .reverse();
        const rows = window.map(
          ({ message: m }): SeedRow => ({
            id: m.id,
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            createdAt: m.createdAt,
          }),
        );
        return {
          rows,
          model: {
            provider: providers?.router.provider ?? 'unknown',
            modelId: providers?.router.modelId ?? 'unknown',
          },
        };
      },
      record: ({ storeId, conversationId, piVersion, reseeded }) => {
        const now = nowMs();
        db.transaction(() => {
          if (reseeded) {
            db.delete(coordinatorEntry).where(eq(coordinatorEntry.threadId, threadId)).run();
          }
          db.insert(coordinatorConversation)
            .values({
              threadId,
              storeId: storeId ?? null,
              conversationId,
              lastMirroredEntryId: null,
              piVersion,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: coordinatorConversation.threadId,
              set: {
                conversationId,
                storeId: storeId ?? null,
                piVersion,
                updatedAt: now,
                ...(reseeded ? { lastMirroredEntryId: null } : {}),
              },
            })
            .run();
        });
      },
    };
  };

  const runtime = createServerRuntime(
    {
      storageDir: options.storageDir,
      heartbeatMs: options.heartbeatMs ?? HEARTBEAT_MS,
      routerTools: options.routerTools ?? true,
      ...(options.fixedProviders === undefined ? {} : { fixedProviders: options.fixedProviders }),
      ...(options.stopPollMs === undefined ? {} : { stopPollMs: options.stopPollMs }),
      factsFor,
      desktopTools: (threadId) => {
        const teamId = threadTeam(threadId);
        return teamId !== null && teamOffersDesktop(db, teamId);
      },
      connectorTools: (threadId) => {
        const teamId = threadTeam(threadId);
        return teamId === null ? [] : connectorToolDefsForTeam(db, teamId);
      },
      ownComputer: (threadId) => ownComputerOffered(db, threadId),
      ownComputerWorkspace: (threadId) =>
        ownComputerWorkspaceOffered({ db, machineHub: machine.machineHub }, threadId),
      browserOffer: (threadId) => {
        const threadRow = db
          .select({ teamId: chiefThread.teamId, userId: chiefThread.userId })
          .from(chiefThread)
          .where(eq(chiefThread.id, threadId))
          .get();
        return threadRow === undefined
          ? undefined
          : browserOfferFor(
              db,
              threadRow,
              offeredPhoneNames({ db, machineHub: machine.machineHub }, threadId),
            );
      },
      phoneComputer: (threadId) =>
        offeredPhoneNames({ db, machineHub: machine.machineHub }, threadId),
      providersFor: (threadId) => {
        const teamId = threadTeam(threadId);
        const providers =
          teamId === null
            ? null
            : coordinatorProviders({ db, box: machine.box }, teamId, threadProject(threadId));
        if (providers === null || teamId === null) return [];
        return [binding(teamId, providers.router), binding(teamId, providers.summary)];
      },
      onImagesRejected: (threadId, providerId, modelId) => {
        const teamId = threadTeam(threadId);
        if (teamId === null) return;
        markProviderModelTextOnly({ db, box: machine.box }, teamId, providerId, modelId);
        logger.warn(
          { threadId, providerId, modelId },
          'coordinator model rejected images, marked text-only',
        );
      },
      onInputError: (threadId, error) =>
        logger.error(
          { threadId, error: String(redactSecrets(String(error)).value) },
          'coordinator input persistence blocked',
        ),
      memoryFlush: (threadId) => {
        const teamId = threadTeam(threadId);
        if (teamId === null) return null;
        return createMemoryFlush(db, { teamId, threadId }, (result) =>
          logger.info({ threadId, ...result }, 'coordinator memory flushed before compaction'),
        );
      },
      recordConversation: (threadId, conversationId, entryId) => {
        db.update(coordinatorConversation)
          .set({ conversationId, lastMirroredEntryId: String(entryId), updatedAt: nowMs() })
          .where(eq(coordinatorConversation.threadId, threadId))
          .run();
      },
      setConversation: (threadId, conversationId, watermark, restoreOwnerId) => {
        db.update(coordinatorConversation)
          .set({
            conversationId,
            mailOwnerConversationId: restoreOwnerId,
            ...(watermark === null ? {} : { lastMirroredEntryId: watermark }),
            updatedAt: nowMs(),
          })
          .where(eq(coordinatorConversation.threadId, threadId))
          .run();
      },
      onReconciled: (threadId, outcome, stale) => {
        logger.info({ threadId, outcome, stale }, 'coordinator store reconciled');
      },
    },
    api,
  );

  const binding = (teamId: string, route: CoordinatorProviders['router']): ProviderBinding =>
    providerBinding({ db, box: machine.box }, teamId, route);

  setFailureSink({
    log: (fields, message) => logger.error(fields, message),
    stepOf: (threadId) => liveSteps(threadId)[0]?.id ?? null,
    scrub: (threadId, message) => {
      const teamId = threadTeam(threadId);
      if (teamId === null) return message;
      const providers = coordinatorProviders(
        { db, box: machine.box },
        teamId,
        threadProject(threadId),
      );
      const keyed = [providers?.router.provider, providers?.summary.provider].filter(
        (id): id is string => id !== undefined,
      );
      return scrubProviderError({ db, box: machine.box }, teamId, keyed, message);
    },
  });

  const heldLease = (threadId: string): Lease | null => {
    const existing = leases.get(threadId);
    if (existing !== undefined) return existing;
    try {
      const lease = acquireLease(db, threadId, owner);
      leases.set(threadId, lease);
      return lease;
    } catch (error) {
      if (error instanceof LeaseHeldError) return null;
      throw error;
    }
  };

  const claimHead = (threadId: string): StepRow | null => {
    if (readDeployLease(db).status === 'draining') return null;
    const head = liveSteps(threadId)[0];
    if (head === undefined) return null;
    if (head.status === 'claimed') return head.machineId === null ? head : null;
    if (STEER_HOLDS.includes(head.holdReason ?? '')) return null;
    if (head.holdUntil !== null && head.holdUntil > nowMs()) return null;
    const teamId = threadTeam(threadId);
    if (teamId === null) return null;
    const model = serverTurnModel(db, teamId, head);
    if (model === null) return null;
    if (hasEarlierLiveChiefStep(db, head)) return null;
    const claimed = claimPendingChiefStep(db, head, {
      machineId: null,
      model,
      mcpGrant: connectorSlugs(db, teamId),
    });
    if (claimed === null) return null;
    freshClaims.add(head.id);
    publishStepStatus(machine, head.id);
    return claimed;
  };

  const claimedPayload = async (
    row: StepRow,
    providers: CoordinatorProviders,
    stagedUploads: string | null = null,
  ): Promise<{
    claimed: ClaimedStep;
    volatileText: string | null;
  } | null> => {
    const threadRow = db.select().from(chiefThread).where(eq(chiefThread.id, row.buildId)).get();
    if (threadRow === undefined) return null;
    const chiefRow = db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
    if (chiefRow === undefined) return null;
    const context = chiefTurnContext(machine, row, threadRow, chiefRow.id);
    const eventRowId = transcriptPromptRowId(row.id);
    if (row.prompt !== null && context.trigger !== 'user') {
      upsertChiefRow(machine, {
        id: eventRowId,
        threadId: row.buildId,
        role: 'user',
        content: row.prompt,
        createdAt: nowMs(),
        projectId: stepScopeProjectId(row),
        origin: 'task-prompt',
      });
    }
    const readmeSection = await greetingReadmeSection(machine, row, threadRow);
    const volatileParts = [
      ...context.sections,
      ...(readmeSection !== null ? [readmeSection] : []),
      ...(stagedUploads !== null ? [stagedUploads] : []),
    ];
    const lastUsage = lastTurnUsageForColdResume(db, row.buildId);
    const routerModel = `${providers.router.provider}/${providers.router.modelId}`;
    const retentionMs = cacheTtlMsFor(resolveCacheRetentionTier(), lastUsage?.model ?? routerModel);
    const cold = isColdResume({
      lastUsage:
        lastUsage === null
          ? null
          : {
              createdAt: lastUsage.createdAt,
              cacheRead: lastUsage.cacheRead,
              input: lastUsage.input,
              contextTokens: lastUsage.contextTokens,
              model: lastUsage.model,
            },
      activeModel: routerModel,
    });
    const traceGuard = and(
      eq(step.status, 'claimed'),
      isNull(step.machineId),
      row.claimedAt === null ? isNull(step.claimedAt) : eq(step.claimedAt, row.claimedAt),
    )!;
    const traceWritten = db.transaction((tx) => {
      const owned = tx
        .select({ id: step.id })
        .from(step)
        .where(and(eq(step.id, row.id), traceGuard))
        .get();
      if (owned === undefined) return false;
      writeMemoryTraceGuarded(tx, row.id, { memoryTrace: context.memoryTrace }, traceGuard);
      return true;
    });
    if (!traceWritten) return null;
    logger.info(
      {
        threadId: row.buildId,
        stepId: row.id,
        projectId: stepScopeProjectId(row),
        coldResume: cold,
        cacheRetentionMs: retentionMs,
        ...context.memoryTrace,
      },
      'coordinator memory injected',
    );
    captureCoordinatorClaim(db, row.id, threadRow.teamId, {
      systemPrompt: context.systemPrompt,
      instruction:
        row.prompt === null || context.trigger === 'user'
          ? row.prompt
          : withHistoryMarker(row.prompt, eventRowId),
      trigger: context.trigger,
      memories: context.memories.map((m) => `- ${m.title}：${m.content}`),
      provider: providers.router.provider,
      modelId: providers.router.modelId,
      thinkingLevel: thinkingLevelOf(providers.router.thinkingLevel),
      volatileText: volatileParts.length === 0 ? null : volatileParts.join('\n\n'),
    });
    return {
      claimed: {
        step: {
          id: row.id,
          buildId: row.buildId,
          kind: 'chief',
          machineId: null,
          createdAt: row.createdAt,
          generation: row.claimedAt ?? undefined,
        },
        conversationId: row.buildId,
        session: { action: 'new', sessionId: null },
        instruction:
          row.prompt === null || context.trigger === 'user'
            ? row.prompt
            : withHistoryMarker(row.prompt, eventRowId),
        agent: {
          id: chiefRow.id,
          displayName: 'Coordinator',
          description: null,
          provider: providers.router.provider,
          modelId: providers.router.modelId,
          thinkingLevel: thinkingLevelOf(providers.router.thinkingLevel),
          memories: context.memories,
        },
        chief: {
          threadId: row.buildId,
          systemPrompt: context.systemPrompt,
          trigger: context.trigger,
        },
        remoteTools: resolveCoordinatorRemoteTools(machine, {
          teamId: threadRow.teamId,
          threadRow,
          routerTools: options.routerTools ?? true,
        }).tools,
      },
      volatileText: volatileParts.length === 0 ? null : volatileParts.join('\n\n'),
    };
  };

  const runStep = async (row: StepRow): Promise<void> => {
    const teamId = threadTeam(row.buildId);
    if (teamId === null) return;
    const quota = readQuota(db, row.id);
    const providers = coordinatorProviders(
      { db, box: machine.box },
      teamId,
      threadProject(row.buildId),
      quota.ranModel ?? quota.fallback?.model ?? null,
    );
    const keyed = [providers?.router.provider, providers?.summary.provider].filter(
      (id): id is string => id !== undefined,
    );
    const heartbeat = startTurnHeartbeat({
      intervalMs: options.heartbeatMs ?? HEARTBEAT_MS,
      beat: () => api.heartbeat(row.id),
    });
    try {
      if (providers === null) throw new Error('Coordinator route resolves to no keyed provider');
      await hydrateMissingConnectorTools(mcpConnectorDepsOf(machine), {
        teamId,
        boundMs: CONNECTOR_TOOL_HYDRATE_BOUND_MS,
      });
      if (closing) return;
      const threadRow = db.select().from(chiefThread).where(eq(chiefThread.id, row.buildId)).get();
      const stagedUploads =
        threadRow !== undefined && row.prompt !== null
          ? await stageTurnAttachments(machine, row, threadRow, row.prompt).catch(() => null)
          : null;
      if (closing) return;
      const payload = await claimedPayload(row, providers, stagedUploads);
      if (closing) return;
      if (payload === null) {
        const current = db.select().from(step).where(eq(step.id, row.id)).get();
        if (
          current?.status !== 'claimed' ||
          current.machineId !== null ||
          current.claimedAt !== row.claimedAt
        ) {
          return;
        }
        throw new Error('Coordinator step has no chief thread');
      }
      await runtime.runTurn({
        claimed: payload.claimed,
        volatileText: payload.volatileText,
        ...(row.freshSession ? { freshSession: true } : {}),
        router: binding(teamId, providers.router),
        summary: binding(teamId, providers.summary),
      });
    } catch (error) {
      const message = thrownErrorText(error);
      const scrubbed = scrubProviderError({ db, box: machine.box }, teamId, keyed, message);
      logger.error({ stepId: row.id, error: scrubbed }, 'coordinator turn failed');
      const current = db.select().from(step).where(eq(step.id, row.id)).get();
      if (!closing && current?.status === 'claimed' && current.claimedAt === row.claimedAt) {
        await api.done(row.id, {
          status: 'failed',
          errorMessage: scrubbed,
          generation: row.claimedAt ?? undefined,
        });
      }
    } finally {
      heartbeat.stop();
      freshClaims.delete(row.id);
    }
  };

  const drain = async (threadId: string): Promise<void> => {
    for (;;) {
      if (closing) return;
      dirty.delete(threadId);
      if (heldLease(threadId) === null) return;
      settleInterruptedMailConversation(db, threadId);
      if (!runtime.isOpen(threadId)) migrateUnfetchedCoordinatorInputs(db, threadId, owner);
      const pending = db
        .select()
        .from(coordinatorInput)
        .where(and(eq(coordinatorInput.threadId, threadId), eq(coordinatorInput.state, 'pending')))
        .all();
      if (
        (recoveryThreads.has(threadId) ||
          pending.some((input) => coordinatorInputIsLive(db, input.id) === false)) &&
        !liveSteps(threadId).some((row) => row.status === 'claimed' && row.machineId === null)
      ) {
        await runtime.recoverThread(threadId);
        recoveryThreads.delete(threadId);
      }
      const row = claimHead(threadId);
      if (row === null) {
        if (!dirty.has(threadId)) return;
        continue;
      }
      await runStep(row);
      if (recoveryThreads.has(threadId)) {
        await runtime.recoverThread(threadId);
        recoveryThreads.delete(threadId);
      }
    }
  };

  const releaseLeaseIfUnused = (threadId: string): void => {
    const lease = leases.get(threadId);
    if (lease === undefined || runtime.isOpen(threadId) || draining.has(threadId)) return;
    if (!liveSteps(threadId).every((r) => r.machineId !== null)) return;
    lease.release();
    leases.delete(threadId);
  };

  const startDrain = (threadId: string): void => {
    if (closing || draining.has(threadId)) return;
    const running = drain(threadId)
      .catch((error: unknown) => {
        logger.error({ threadId, error: String(error) }, 'coordinator drain failed');
      })
      .finally(() => {
        draining.delete(threadId);
        releaseLeaseIfUnused(threadId);
      });
    draining.set(threadId, running);
  };

  const wake = (threadId: string): void => {
    if (closing) return;
    dirty.add(threadId);
    if (draining.has(threadId)) {
      if (
        liveSteps(threadId).some(
          (row) => row.status === 'pending' && parseChiefTrigger(row.prompt) === 'user',
        )
      )
        runtime.yieldSuggestions(threadId);
      return;
    }
    queueMicrotask(() => startDrain(threadId));
  };

  const liveThreads = (): string[] => {
    const rows = db
      .select({ threadId: step.buildId })
      .from(step)
      .where(and(eq(step.kind, 'chief'), inArray(step.status, ['pending', 'claimed'])))
      .all();
    const pending = db
      .select({ threadId: coordinatorInput.threadId })
      .from(coordinatorInput)
      .where(eq(coordinatorInput.state, 'pending'))
      .all();
    return [
      ...new Set([
        ...rows.map((row) => row.threadId),
        ...pending.map((row) => row.threadId),
        ...recoveryThreads,
      ]),
    ];
  };

  const idleMemory = createIdleMemorySweep(
    { db: machine.db, box: machine.box },
    {
      idleMs: options.idleMemoryFlushMs,
      retryMs: options.idleMemoryRetryMs,
      timeoutMs: options.idleMemoryTimeoutMs,
      fixedProviders: options.fixedProviders,
      logger,
    },
  );

  const tick = (): void => {
    if (closing) return;
    for (const [threadId, lease] of leases) {
      if (!lease.heartbeat()) {
        logger.warn({ threadId }, 'coordinator lease lost');
        leases.delete(threadId);
        void runtime.closeThread(threadId).catch((error: unknown) => {
          logger.error({ threadId, error: String(error) }, 'coordinator close after lease loss');
        });
      }
    }
    for (const threadId of liveThreads()) wake(threadId);
    idleMemory.sweep();
    void runtime
      .closeIdle(options.idleCloseMs ?? IDLE_CLOSE_MS)
      .then((closed) => {
        for (const threadId of closed) releaseLeaseIfUnused(threadId);
      })
      .catch((error: unknown) => {
        logger.error({ error: String(error) }, 'coordinator idle close failed');
      });
  };

  const timer = setInterval(tick, options.tickMs ?? TICK_MS);
  timer.unref();
  tick();

  return {
    wake,
    signalSteer: (threadId: string) => runtime.signalSteer(threadId),
    signalStop: (threadId: string) => runtime.signalStop(threadId),
    tick,
    idle: async () => {
      await Promise.resolve();
      while (draining.size > 0) await Promise.allSettled([...draining.values()]);
      await idleMemory.drain();
    },
    close: async (): Promise<void> => {
      closing = true;
      clearInterval(timer);
      try {
        await idleMemory.close();
        await runtime.close();
        while (draining.size > 0) await Promise.allSettled([...draining.values()]);
      } finally {
        for (const lease of leases.values()) lease.release();
        leases.clear();
      }
    },
  };
}

export function coordinatorStoreDir(dataDir: string): string {
  return join(dataDir, 'coordinator');
}
