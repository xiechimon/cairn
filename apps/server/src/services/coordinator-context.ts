import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefThread, chiefTurnUsage, provider } from '../db/schema.js';

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
  threadId?: string,
): { tokens: number; contextWindow: number } | null {
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
  const latest = db
    .select({ stepId: chiefTurnUsage.stepId })
    .from(chiefTurnUsage)
    .where(scope)
    .orderBy(desc(chiefTurnUsage.createdAt))
    .get();
  if (latest == null) return null;
  const last = db
    .select({ tokens: chiefTurnUsage.contextTokens, model: chiefTurnUsage.model })
    .from(chiefTurnUsage)
    .where(and(eq(chiefTurnUsage.stepId, latest.stepId), isNotNull(chiefTurnUsage.contextTokens)))
    .get();
  if (last?.tokens == null) return null;
  return {
    tokens: last.tokens,
    contextWindow: contextWindowOf(db, chiefRow.teamId, last.model),
  };
}
