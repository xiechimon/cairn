import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefThread, chiefTurnUsage, provider } from '../db/schema.js';

export const DEFAULT_CONTEXT_WINDOW = 128_000;

let serverContextOn = false;
let sidecarMachineId: string | null = null;

export function setCoordinatorServerContextEnabled(on: boolean): void {
  serverContextOn = on;
}

export function coordinatorServerContextEnabled(): boolean {
  return serverContextOn;
}

export function setCoordinatorMachineId(machineId: string | null): void {
  sidecarMachineId = machineId;
}

export function coordinatorMachineId(): string | null {
  return sidecarMachineId;
}

export function coordinatorSidecarEnabled(): boolean {
  return sidecarMachineId !== null;
}

export function coordinatorRunsOnPi(): boolean {
  return serverContextOn || coordinatorSidecarEnabled();
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
): { tokens: number; contextWindow: number } | null {
  const last = db
    .select({ tokens: chiefTurnUsage.contextTokens, model: chiefTurnUsage.model })
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
  return {
    tokens: last.tokens,
    contextWindow: contextWindowOf(db, chiefRow.teamId, last.model),
  };
}
