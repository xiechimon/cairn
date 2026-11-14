import { and, desc, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import {
  type ContextResume,
  contextResumeOf,
  resolveCacheRetentionTier,
  resumeExpiresAtOf,
  retentionMsFor,
} from '../coordinator/runtime/cold-slim.js';
import { compactionWindow } from '../coordinator/runtime/compaction.js';
import { catalogContextWindow, DEFAULT_CONTEXT_WINDOW } from '../coordinator/runtime/provider.js';
import type { Db } from '../db/client.js';
import { chiefThread, chiefTurnUsage, provider } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { coordinatorProfile } from './routing-rules.js';

export { DEFAULT_CONTEXT_WINDOW };

let serverContextOn = false;
let inServer = false;
let wakeThread: (threadId: string) => void = () => {};

export function setCoordinatorInServer(on: boolean): void {
  inServer = on;
}

export function coordinatorInServerEnabled(): boolean {
  return inServer;
}

export function setCoordinatorWake(wake: (threadId: string) => void): void {
  wakeThread = wake;
}

export function wakeCoordinator(threadId: string): void {
  wakeThread(threadId);
}

export function setCoordinatorServerContextEnabled(on: boolean): void {
  serverContextOn = on;
}

export function coordinatorServerContextEnabled(): boolean {
  return serverContextOn;
}

export function coordinatorRunsOnPi(): boolean {
  return serverContextOn || inServer;
}

function contextWindowOf(db: Db, teamId: string, usageModel: string): number {
  const slash = usageModel.indexOf('/');
  if (slash <= 0) return DEFAULT_CONTEXT_WINDOW;
  const providerId = usageModel.slice(0, slash);
  const modelId = usageModel.slice(slash + 1);
  const providerRow = db
    .select({ models: provider.models })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();
  return (
    providerRow?.models.find((m) => m.id === modelId)?.contextWindow ??
    catalogContextWindow(providerId, modelId)
  );
}

function activeRouterModel(db: Db, teamId: string): string | null {
  const profile = coordinatorProfile(db, teamId);
  const providerId = profile?.provider?.trim() ?? '';
  const modelId = profile?.modelId?.trim() ?? '';
  if (providerId === '' || modelId === '') return null;
  return `${providerId}/${modelId}`;
}

export type ContextBearingTurnUsage = {
  stepId: string;
  threadId: string;
  model: string;
  createdAt: number;
  cacheRead: number;
  input: number;
  contextTokens: number;
};

export type TurnUsageForColdResume = {
  stepId: string;
  threadId: string;
  model: string;
  createdAt: number;
  cacheRead: number;
  input: number;
  contextTokens: number | null;
};

function latestTurnUsageStepId(db: Db, scope: SQL): string | null {
  return (
    db
      .select({ stepId: chiefTurnUsage.stepId })
      .from(chiefTurnUsage)
      .where(scope)
      .orderBy(desc(chiefTurnUsage.createdAt))
      .get()?.stepId ?? null
  );
}

function lastContextBearingTurnUsageWhere(db: Db, scope: SQL): ContextBearingTurnUsage | null {
  const stepId = latestTurnUsageStepId(db, scope);
  if (stepId == null) return null;
  const last = db
    .select({
      contextTokens: chiefTurnUsage.contextTokens,
      model: chiefTurnUsage.model,
      createdAt: chiefTurnUsage.createdAt,
      cacheRead: chiefTurnUsage.cacheRead,
      input: chiefTurnUsage.input,
      threadId: chiefTurnUsage.threadId,
      stepId: chiefTurnUsage.stepId,
    })
    .from(chiefTurnUsage)
    .where(and(eq(chiefTurnUsage.stepId, stepId), isNotNull(chiefTurnUsage.contextTokens)))
    .orderBy(desc(chiefTurnUsage.createdAt))
    .get();
  if (last?.contextTokens == null) return null;
  return {
    stepId: last.stepId,
    threadId: last.threadId,
    model: last.model,
    createdAt: last.createdAt,
    cacheRead: last.cacheRead,
    input: last.input,
    contextTokens: last.contextTokens,
  };
}

export function lastContextBearingTurnUsage(
  db: Db,
  threadId: string,
): ContextBearingTurnUsage | null {
  return lastContextBearingTurnUsageWhere(db, eq(chiefTurnUsage.threadId, threadId));
}

export function lastTurnUsageForColdResume(
  db: Db,
  threadId: string,
): TurnUsageForColdResume | null {
  const scope = eq(chiefTurnUsage.threadId, threadId);
  const bearing = lastContextBearingTurnUsageWhere(db, scope);
  if (bearing !== null) return bearing;
  const stepId = latestTurnUsageStepId(db, scope);
  if (stepId == null) return null;
  const raw = db
    .select({
      contextTokens: chiefTurnUsage.contextTokens,
      model: chiefTurnUsage.model,
      createdAt: chiefTurnUsage.createdAt,
      cacheRead: chiefTurnUsage.cacheRead,
      input: chiefTurnUsage.input,
      threadId: chiefTurnUsage.threadId,
      stepId: chiefTurnUsage.stepId,
    })
    .from(chiefTurnUsage)
    .where(eq(chiefTurnUsage.stepId, stepId))
    .orderBy(desc(chiefTurnUsage.createdAt))
    .get();
  if (raw === undefined) return null;
  return {
    stepId: raw.stepId,
    threadId: raw.threadId,
    model: raw.model,
    createdAt: raw.createdAt,
    cacheRead: raw.cacheRead,
    input: raw.input,
    contextTokens: raw.contextTokens ?? null,
  };
}

export function lastTurnContext(
  db: Db,
  chiefRow: { id: string; teamId: string },
  threadId?: string,
): {
  tokens: number;
  contextWindow: number;
  compactAt: number;
  resume: ContextResume;
  resumeExpiresAt?: number;
  resumeExpiresInMs?: number;
} | null {
  if (threadId !== undefined) {
    const owned = db
      .select({ id: chiefThread.id })
      .from(chiefThread)
      .where(and(eq(chiefThread.chiefId, chiefRow.id), eq(chiefThread.id, threadId)))
      .get();
    if (owned === undefined) return null;
  }
  const scope =
    threadId !== undefined
      ? eq(chiefTurnUsage.threadId, threadId)
      : inArray(
          chiefTurnUsage.threadId,
          db
            .select({ id: chiefThread.id })
            .from(chiefThread)
            .where(eq(chiefThread.chiefId, chiefRow.id)),
        );
  const last = lastContextBearingTurnUsageWhere(db, scope);
  if (last == null) return null;
  const retentionMs = retentionMsFor(resolveCacheRetentionTier(), last.model);
  const now = nowMs();
  const resume = contextResumeOf({
    lastUsage: {
      createdAt: last.createdAt,
      cacheRead: last.cacheRead,
      input: last.input,
      contextTokens: last.contextTokens,
      model: last.model,
    },
    activeModel: activeRouterModel(db, chiefRow.teamId),
  });
  const resumeExpiresAt = resumeExpiresAtOf({
    resume,
    retentionMs,
    lastUsageCreatedAt: last.createdAt,
  });
  const contextWindow = contextWindowOf(db, chiefRow.teamId, last.model);
  return {
    tokens: last.contextTokens,
    contextWindow,
    compactAt: compactionWindow(contextWindow).backgroundAt,
    resume,
    ...(resumeExpiresAt !== null
      ? {
          resumeExpiresAt,
          resumeExpiresInMs: Math.max(0, resumeExpiresAt - now),
        }
      : {}),
  };
}
