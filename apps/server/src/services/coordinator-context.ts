import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  type ContextResume,
  contextResumeOf,
  resolveCacheRetentionTier,
  retentionMsFor,
} from '../coordinator/runtime/cold-slim.js';
import type { Db } from '../db/client.js';
import { chiefThread, chiefTurnUsage, coordinatorConversation, provider } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export const DEFAULT_CONTEXT_WINDOW = 128_000;

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
  return providerRow?.models.find((m) => m.id === modelId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

export function lastTurnContext(
  db: Db,
  chiefRow: { id: string; teamId: string },
): { tokens: number; contextWindow: number; resume: ContextResume } | null {
  const last = db
    .select({
      tokens: chiefTurnUsage.contextTokens,
      model: chiefTurnUsage.model,
      createdAt: chiefTurnUsage.createdAt,
      cacheRead: chiefTurnUsage.cacheRead,
      input: chiefTurnUsage.input,
      threadId: chiefTurnUsage.threadId,
    })
    .from(chiefTurnUsage)
    .where(
      and(
        isNotNull(chiefTurnUsage.contextTokens),
        inArray(
          chiefTurnUsage.threadId,
          db
            .select({ id: chiefThread.id })
            .from(chiefThread)
            .where(eq(chiefThread.chiefId, chiefRow.id)),
        ),
      ),
    )
    .orderBy(desc(chiefTurnUsage.createdAt))
    .get();
  if (last?.tokens == null) return null;
  const retentionMs = retentionMsFor(resolveCacheRetentionTier(), last.model);
  const lastColdSlimAt =
    db
      .select({ at: coordinatorConversation.lastColdSlimAt })
      .from(coordinatorConversation)
      .where(eq(coordinatorConversation.threadId, last.threadId))
      .get()?.at ?? null;
  return {
    tokens: last.tokens,
    contextWindow: contextWindowOf(db, chiefRow.teamId, last.model),
    resume: contextResumeOf({
      now: nowMs(),
      retentionMs,
      lastUsage: {
        createdAt: last.createdAt,
        cacheRead: last.cacheRead,
        input: last.input,
        contextTokens: last.tokens,
        model: last.model,
      },
      lastColdSlimAt,
    }),
  };
}
