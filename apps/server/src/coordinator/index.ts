import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  type ClaimedStep,
  type MachineDoneBody,
  redactSecrets,
  type ThinkingLevel,
  thinkingLevelSchema,
  transcriptPromptRowId,
  withHistoryMarker,
} from '@cairn/shared';
import { and, asc, desc, eq, inArray, like, ne, not, sql } from 'drizzle-orm';
import {
  chief,
  chiefMessage,
  chiefSummary,
  chiefThread,
  coordinatorConversation,
  coordinatorEntry,
  coordinatorInput,
  project,
  step,
  todo,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { isChiefDigestStep } from '../services/chief-digest.js';
import { hasEarlierLiveChiefStep } from '../services/chief-turns.js';
import { lastTurnUsageForColdResume } from '../services/coordinator-context.js';
import { migrateUnfetchedCoordinatorInputs } from '../services/coordinator-input-upgrade.js';
import { coordinatorInputIsLive } from '../services/coordinator-inputs.js';
import { chiefTurnContext, claimPendingChiefStep } from '../services/coordinator-steps.js';
import { captureClaimInputs } from '../services/coordinator-turn-capture.js';
import { serverTakesTurn } from '../services/machine-claim.js';
import { type MachineDeps, publishStepStatus, upsertChiefRow } from '../services/machine-deps.js';
import { stepScopeProjectId } from '../services/picked-project.js';
import { chiefRemoteTools } from '../services/routing-rules.js';
import {
  type CoordinatorProviders,
  coordinatorApiKey,
  coordinatorProviders,
  scrubProviderError,
} from './credentials.js';
import { acquireLease, type Lease, LeaseHeldError } from './lease.js';
import { createMemoryFlush } from './memory-flush.js';
import {
  COLD_RECENT_EXCHANGES,
  coldWindowStartFromRows,
  isColdResume,
  resolveCacheRetentionTier,
  retentionMsFor,
} from './runtime/cold-slim.js';
import { summarizerFor } from './runtime/compaction.js';
import { reportCompactionFailure, setFailureSink } from './runtime/failure-report.js';
import type { MachineApi } from './runtime/machine-api.js';
import { createCoordinatorModels } from './runtime/models.js';
import type { ReconcileFacts } from './runtime/reconcile.js';
import type { SeedRow } from './runtime/seed.js';
import {
  createServerRuntime,
  type ProviderBinding,
  type ServerRuntimeConfig,
} from './runtime/server-runtime.js';
import { seedSummary } from './seed-summary.js';
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
  stopPollMs?: number;
  owner?: string;
}

export interface Coordinator {
  wake(threadId: string): void;
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
    const providers = coordinatorProviders({ db, box: machine.box }, teamId);
    const ids = [providers?.router.provider, providers?.summary.provider].filter(
      (id): id is string => id !== undefined,
    );
    return {
      ...body,
      errorMessage: scrubProviderError({ db, box: machine.box }, teamId, ids, body.errorMessage),
    };
  };
  const api: MachineApi = {
    ...serverApi,
    done: async (stepId, body, observation) => {
      if (!closing) await serverApi.done(stepId, scrubbed(stepId, body), observation);
    },
  };
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
      seed: async (summarize) => {
        const teamId = threadTeam(threadId);
        const providers =
          teamId === null ? null : coordinatorProviders({ db, box: machine.box }, teamId);
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
              m.role !== 'system' &&
              !pendingUsers.has(m.id) &&
              !m.id.startsWith('chief-digest-') &&
              !m.id.startsWith('chief-report-'),
          )
          .slice(0, SEED_MAX_ROWS)
          .reverse();
        const oldest = window[0];
        const seeded = await seedSummary(
          db,
          threadId,
          oldest === undefined ? null : { at: oldest.message.createdAt, rowid: oldest.rowid },
          summarize,
          (error) => {
            const ids = [providers?.router.provider, providers?.summary.provider].filter(
              (id): id is string => id !== undefined,
            );
            const message = scrubProviderError(
              { db, box: machine.box },
              teamId ?? '',
              ids,
              String(error),
            );
            const scrubbed = new Error(message);
            scrubbed.name = error instanceof Error ? error.name : 'Error';
            reportCompactionFailure({ threadId }, 'seed-summary', scrubbed);
          },
          nowMs(),
        );
        const summary = seeded.summary;
        const rows = window.map(
          ({ message: m }): SeedRow => ({
            id: m.id,
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            createdAt: m.createdAt,
          }),
        );
        return {
          summary,
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
      onReconciled: (threadId, outcome, stale) => {
        logger.info({ threadId, outcome, stale }, 'coordinator store reconciled');
      },
    },
    api,
  );

  const binding = (teamId: string, route: CoordinatorProviders['router']): ProviderBinding => ({
    config: route.config,
    modelId: route.modelId,
    resolveKey: () => coordinatorApiKey({ db, box: machine.box }, teamId, route.provider),
  });

  setFailureSink({
    log: (fields, message) => logger.error(fields, message),
    stepOf: (threadId) => liveSteps(threadId)[0]?.id ?? null,
    scrub: (threadId, message) => {
      const teamId = threadTeam(threadId);
      if (teamId === null) return message;
      const providers = coordinatorProviders({ db, box: machine.box }, teamId);
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
    const head = liveSteps(threadId)[0];
    if (head === undefined) return null;
    if (head.status === 'claimed') return head.machineId === null ? head : null;
    if (head.holdReason === 'steer' || head.holdReason === 'steer_sent') return null;
    if (head.holdUntil !== null && head.holdUntil > nowMs()) return null;
    const teamId = threadTeam(threadId);
    if (teamId === null || !serverTakesTurn(db, teamId, head)) return null;
    if (hasEarlierLiveChiefStep(db, head)) return null;
    if (!claimPendingChiefStep(db, head, null)) return null;
    freshClaims.add(head.id);
    publishStepStatus(machine, head.id);
    return db.select().from(step).where(eq(step.id, head.id)).get() ?? null;
  };

  const claimedPayload = (
    row: StepRow,
    providers: CoordinatorProviders,
  ): {
    claimed: ClaimedStep;
    volatileText: string | null;
    coldSlim: { cold: boolean; summaryHint: string | null };
  } | null => {
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
      });
    }
    const volatileParts = context.sections;
    const lastUsage = lastTurnUsageForColdResume(db, row.buildId);
    const routerModel = `${providers.router.provider}/${providers.router.modelId}`;
    const retentionMs = retentionMsFor(
      resolveCacheRetentionTier(),
      lastUsage?.model ?? routerModel,
    );
    const cold = isColdResume({
      now: nowMs(),
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
      retentionMs,
      activeModel: routerModel,
    });
    const summaryHint =
      db.select().from(chiefSummary).where(eq(chiefSummary.threadId, row.buildId)).get()?.summary ??
      null;
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
    captureClaimInputs(row.id, {
      initialTodoIds: db
        .select({ id: todo.id })
        .from(todo)
        .where(eq(todo.teamId, threadRow.teamId))
        .all()
        .map((t) => t.id),
      projects: db
        .select()
        .from(project)
        .where(eq(project.teamId, threadRow.teamId))
        .all()
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description ?? null,
          repoKind: p.repoKind ?? null,
          archivedAt: p.archivedAt ?? null,
        })),
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
        remoteTools: [...chiefRemoteTools()],
      },
      volatileText: volatileParts.length === 0 ? null : volatileParts.join('\n\n'),
      coldSlim: { cold, summaryHint },
    };
  };

  const catchUpColdSummary = async (
    threadId: string,
    teamId: string,
    providers: CoordinatorProviders,
  ): Promise<{ summary: string | null; complete: boolean }> => {
    const newestFirst = db
      .select({
        at: chiefMessage.createdAt,
        rowid: sql<number>`rowid`,
        role: chiefMessage.role,
      })
      .from(chiefMessage)
      .where(
        and(
          eq(chiefMessage.threadId, threadId),
          ne(chiefMessage.role, 'system'),
          not(like(chiefMessage.id, 'chief-digest-%')),
          not(like(chiefMessage.id, 'chief-report-%')),
        ),
      )
      .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
      .limit(COLD_RECENT_EXCHANGES * 4)
      .all();
    const windowStart = coldWindowStartFromRows(newestFirst);
    const models = createCoordinatorModels(options.fixedProviders ?? []);
    const summaryBind = binding(teamId, providers.summary);
    models.useProvider(summaryBind.config, summaryBind.resolveKey);
    let summarize = null as ReturnType<typeof summarizerFor> | null;
    try {
      summarize = summarizerFor(models.models, {
        provider: providers.summary.provider,
        modelId: providers.summary.modelId,
      });
    } catch (error) {
      reportCompactionFailure({ threadId }, 'summary-model', error);
    }
    const seeded = await seedSummary(
      db,
      threadId,
      windowStart,
      summarize,
      (error) => {
        const message = scrubProviderError(
          { db, box: machine.box },
          teamId,
          [providers.router.provider, providers.summary.provider],
          String(error),
        );
        const scrubbed = new Error(message);
        scrubbed.name = error instanceof Error ? error.name : 'Error';
        reportCompactionFailure({ threadId }, 'seed-summary', scrubbed);
      },
      nowMs(),
    );
    return { summary: seeded.summary === '' ? null : seeded.summary, complete: seeded.complete };
  };

  const runStep = async (row: StepRow): Promise<void> => {
    const teamId = threadTeam(row.buildId);
    if (teamId === null) return;
    const providers = coordinatorProviders({ db, box: machine.box }, teamId);
    const keyed = [providers?.router.provider, providers?.summary.provider].filter(
      (id): id is string => id !== undefined,
    );
    const heartbeat = setInterval(
      () => void api.heartbeat(row.id).catch(() => {}),
      options.heartbeatMs ?? HEARTBEAT_MS,
    );
    try {
      if (providers === null) throw new Error('Coordinator route resolves to no keyed provider');
      const payload = claimedPayload(row, providers);
      if (payload === null) throw new Error('Coordinator step has no chief thread');
      let coldSlim = payload.coldSlim;
      if (coldSlim.cold) {
        const prior = db
          .select()
          .from(chiefSummary)
          .where(eq(chiefSummary.threadId, row.buildId))
          .get();
        const newestFirst = db
          .select({
            at: chiefMessage.createdAt,
            rowid: sql<number>`rowid`,
            role: chiefMessage.role,
          })
          .from(chiefMessage)
          .where(
            and(
              eq(chiefMessage.threadId, row.buildId),
              ne(chiefMessage.role, 'system'),
              not(like(chiefMessage.id, 'chief-digest-%')),
              not(like(chiefMessage.id, 'chief-report-%')),
            ),
          )
          .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
          .limit(COLD_RECENT_EXCHANGES * 4)
          .all();
        const windowStart = coldWindowStartFromRows(newestFirst);
        const lagging =
          windowStart !== null &&
          (prior === undefined ||
            prior.coveredAt < windowStart.at ||
            (prior.coveredAt === windowStart.at && prior.coveredRowid < windowStart.rowid));
        const beforeGeneration = prior?.generation ?? 0;
        const caughtUp = await catchUpColdSummary(row.buildId, teamId, providers);
        const afterGeneration =
          db.select().from(chiefSummary).where(eq(chiefSummary.threadId, row.buildId)).get()
            ?.generation ?? 0;
        const catchUpAdvanced = afterGeneration > beforeGeneration;
        if (lagging && (!catchUpAdvanced || !caughtUp.complete)) {
          coldSlim = { cold: false, summaryHint: null };
        } else {
          coldSlim = { cold: true, summaryHint: caughtUp.summary };
        }
      }
      await runtime.runTurn({
        claimed: payload.claimed,
        volatileText: payload.volatileText,
        coldSlim,
        ...(coldSlim.cold
          ? {
              beforeDone: () => {
                const at = nowMs();
                db.update(coordinatorConversation)
                  .set({
                    lastColdSlimAt: at,
                    lastColdSlimStepId: row.id,
                    updatedAt: at,
                  })
                  .where(eq(coordinatorConversation.threadId, row.buildId))
                  .run();
              },
            }
          : {}),
        router: binding(teamId, providers.router),
        summary: binding(teamId, providers.summary),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const scrubbed = scrubProviderError({ db, box: machine.box }, teamId, keyed, message);
      logger.error({ stepId: row.id, error: scrubbed }, 'coordinator turn failed');
      const current = db.select().from(step).where(eq(step.id, row.id)).get();
      if (!closing && current?.status === 'claimed') {
        await api.done(row.id, { status: 'failed', errorMessage: scrubbed });
      }
    } finally {
      clearInterval(heartbeat);
      freshClaims.delete(row.id);
    }
  };

  const drain = async (threadId: string): Promise<void> => {
    for (;;) {
      if (closing) return;
      dirty.delete(threadId);
      if (heldLease(threadId) === null) return;
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
    if (draining.has(threadId)) return;
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
    ].filter((threadId) => {
      const live = liveSteps(threadId);
      return live.length === 0 || !live.every((row) => isChiefDigestStep(row));
    });
  };

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
    tick,
    idle: async () => {
      await Promise.resolve();
      while (draining.size > 0) await Promise.allSettled([...draining.values()]);
    },
    close: async () => {
      closing = true;
      clearInterval(timer);
      try {
        await runtime.close();
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
