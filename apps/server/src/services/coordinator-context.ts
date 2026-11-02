import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, chiefThread, chiefTurnUsage, provider } from '../db/schema.js';

export const DEFAULT_CONTEXT_WINDOW = 128_000;

let serverContextOn = false;

export function setCoordinatorServerContextEnabled(on: boolean): void {
  serverContextOn = on;
}

export function coordinatorServerContextEnabled(): boolean {
  return serverContextOn;
}

function contextWindowOf(db: Db, teamId: string, agentId: string | null): number {
  if (agentId === null) return DEFAULT_CONTEXT_WINDOW;
  const agentRow = db.select().from(agent).where(eq(agent.id, agentId)).get();
  if (agentRow?.provider == null || agentRow.modelId == null) return DEFAULT_CONTEXT_WINDOW;
  const providerRow = db
    .select({ models: provider.models })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, agentRow.provider)))
    .get();
  return (
    providerRow?.models.find((m) => m.id === agentRow.modelId)?.contextWindow ??
    DEFAULT_CONTEXT_WINDOW
  );
}

export function lastTurnContext(
  db: Db,
  chiefRow: { id: string; teamId: string; agentId: string | null },
): { tokens: number; contextWindow: number } | null {
  const last = db
    .select({ tokens: chiefTurnUsage.contextTokens })
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
    contextWindow: contextWindowOf(db, chiefRow.teamId, chiefRow.agentId),
  };
}
