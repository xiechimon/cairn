import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { type ClaimedStep, type MachineDoneBody, redactSecrets } from '@cairn/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  chief,
  chiefMessage,
  chiefSummary,
  chiefThread,
  coordinatorConversation,
  coordinatorEntry,
  step,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { isChiefDigestStep } from '../services/chief-digest.js';
import { hasEarlierLiveChiefStep } from '../services/chief-turns.js';
import { chiefTurnContext, claimPendingChiefStep } from '../services/coordinator-steps.js';
import { serverTakesTurn } from '../services/machine-claim.js';
import { type MachineDeps, publishStepStatus } from '../services/machine-deps.js';
import { chiefRemoteTools } from '../services/routing-rules.js';
import {
  type CoordinatorProviders,
  coordinatorApiKey,
  coordinatorProviders,
  scrubProviderError,
} from './credentials.js';
import { acquireLease, type Lease, LeaseHeldError } from './lease.js';
import type { MachineApi } from './runtime/machine-api.js';
import type { ReconcileFacts } from './runtime/reconcile.js';
import type { SeedRow } from './runtime/seed.js';
import {
  createServerRuntime,
  type ProviderBinding,
  type ServerRuntimeConfig,
} from './runtime/server-runtime.js';
import { createCoordinatorServerApi } from './server-api.js';

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

function memoriesSection(memories: readonly { title: string; content: string }[]): string | null {
  if (memories.length === 0) return null;
  return `Memories:\n${memories.map((m) => `- ${m.title}: ${m.content}`).join('\n')}`;
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
    done: async (stepId, body) => {
      if (!closing) await serverApi.done(stepId, scrubbed(stepId, body));
    },
  };
  const leases = new Map<string, Lease>();
  const draining = new Map<string, Promise<void>>();
  const dirty = new Set<string>();
  const freshClaims = new Set<string>();

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
      conversationId: row?.conversationId ?? null,
      lastMirroredEntryId: row?.lastMirroredEntryId ?? null,
      piVersion: row?.piVersion ?? null,
      hasClaimedStep: live.some(
        (r) => r.status === 'claimed' && r.machineId === null && !freshClaims.has(r.id),
      ),
      isLive: (requestId) => live.some((r) => r.id === requestId),
      seed: () => {
        const teamId = threadTeam(threadId);
        const providers =
          teamId === null ? null : coordinatorProviders({ db, box: machine.box }, teamId);
        const summary = db
          .select({ summary: chiefSummary.summary })
          .from(chiefSummary)
          .where(eq(chiefSummary.threadId, threadId))
          .get();
        const pendingUsers = new Set(live.map((r) => r.id));
        const rows = db
          .select()
          .from(chiefMessage)
          .where(eq(chiefMessage.threadId, threadId))
          .orderBy(sql`${chiefMessage.createdAt} desc`, sql`rowid desc`)
          .limit(SEED_MAX_ROWS + pendingUsers.size + 20)
          .all()
          .filter(
            (m) =>
              m.role !== 'system' &&
              !pendingUsers.has(m.id) &&
              !m.id.startsWith('chief-digest-') &&
              !m.id.startsWith('chief-report-'),
          )
          .slice(0, SEED_MAX_ROWS)
          .reverse()
          .map(
            (m): SeedRow => ({
              id: m.id,
              role: m.role,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              createdAt: m.createdAt,
            }),
          );
        return {
          summary: summary?.summary ?? '',
          rows,
          model: {
            provider: providers?.router.provider ?? 'unknown',
            modelId: providers?.router.modelId ?? 'unknown',
          },
        };
      },
      record: ({ conversationId, piVersion, reseeded }) => {
        const now = nowMs();
        db.transaction(() => {
          if (reseeded) {
            db.delete(coordinatorEntry).where(eq(coordinatorEntry.threadId, threadId)).run();
          }
          db.insert(coordinatorConversation)
            .values({
              threadId,
              conversationId,
              lastMirroredEntryId: null,
              piVersion,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: coordinatorConversation.threadId,
              set: {
                conversationId,
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
      routerTools: options.routerTools ?? false,
      ...(options.fixedProviders === undefined ? {} : { fixedProviders: options.fixedProviders }),
      ...(options.stopPollMs === undefined ? {} : { stopPollMs: options.stopPollMs }),
      factsFor,
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
  ): { claimed: ClaimedStep; volatileText: string | null } | null => {
    const threadRow = db.select().from(chiefThread).where(eq(chiefThread.id, row.buildId)).get();
    if (threadRow === undefined) return null;
    const chiefRow = db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get();
    if (chiefRow === undefined) return null;
    const context = chiefTurnContext(machine, row, threadRow, chiefRow.id);
    const volatileParts = [...context.sections, memoriesSection(context.memories)].filter(
      (part): part is string => part !== null,
    );
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
        instruction: row.prompt,
        agent: {
          id: chiefRow.id,
          displayName: 'Coordinator',
          description: null,
          provider: providers.router.provider,
          modelId: providers.router.modelId,
          thinkingLevel: null,
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
    };
  };

  const runStep = async (row: StepRow): Promise<void> => {
    const teamId = threadTeam(row.buildId);
    if (teamId === null) return;
    const providers = coordinatorProviders({ db, box: machine.box }, teamId);
    const keyed = [providers?.router.provider, providers?.summary.provider].filter(
      (id): id is string => id !== undefined,
    );
    try {
      if (providers === null) throw new Error('Coordinator route resolves to no keyed provider');
      const payload = claimedPayload(row, providers);
      if (payload === null) throw new Error('Coordinator step has no chief thread');
      await runtime.runTurn({
        claimed: payload.claimed,
        volatileText: payload.volatileText,
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
      freshClaims.delete(row.id);
    }
  };

  const drain = async (threadId: string): Promise<void> => {
    for (;;) {
      if (closing) return;
      dirty.delete(threadId);
      if (heldLease(threadId) === null) return;
      const row = claimHead(threadId);
      if (row === null) {
        if (!dirty.has(threadId)) return;
        continue;
      }
      await runStep(row);
    }
  };

  const releaseLeaseIfUnused = (threadId: string): void => {
    const lease = leases.get(threadId);
    if (lease === undefined || runtime.isOpen(threadId) || draining.has(threadId)) return;
    if (!liveSteps(threadId).every((r) => r.machineId !== null)) return;
    lease.release();
    leases.delete(threadId);
  };

  const wake = (threadId: string): void => {
    if (closing) return;
    dirty.add(threadId);
    if (draining.has(threadId)) return;
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

  const liveThreads = (): string[] => {
    const rows = db
      .select({ threadId: step.buildId })
      .from(step)
      .where(and(eq(step.kind, 'chief'), inArray(step.status, ['pending', 'claimed'])))
      .all();
    return [...new Set(rows.map((r) => r.threadId))].filter(
      (threadId) => !liveSteps(threadId).every((r) => isChiefDigestStep(r)),
    );
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
      while (draining.size > 0) await Promise.allSettled([...draining.values()]);
    },
    close: async () => {
      closing = true;
      clearInterval(timer);
      await runtime.close();
      for (const lease of leases.values()) lease.release();
      leases.clear();
    },
  };
}

export function coordinatorStoreDir(dataDir: string): string {
  return join(dataDir, 'coordinator');
}
