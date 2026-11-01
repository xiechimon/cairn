import {
  CHIEF_REMOTE_TOOLS,
  type CoordinatorCompactResponse,
  type CoordinatorContextResponse,
  type CoordinatorPageQuery,
  type CoordinatorPageResponse,
} from '@cairn/shared';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { chiefMessage } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  buildChiefSystemPrompt,
  type ChiefDeps,
  type ChiefResourceDeps,
  chiefThreadView,
  coordinatorThreadRow,
  ensureChief,
} from './chief.js';
import { compactThreadNow, threadContextUsage } from './chief-compaction.js';

function earlierThan(deps: ChiefDeps, threadId: string, messageId: string) {
  const cursor = deps.db
    .select({ createdAt: chiefMessage.createdAt, rowid: sql<number>`rowid` })
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, messageId), eq(chiefMessage.threadId, threadId)))
    .get();
  if (!cursor) throw new HttpError(404, `chief message ${messageId}`);
  return or(
    lt(chiefMessage.createdAt, cursor.createdAt),
    and(eq(chiefMessage.createdAt, cursor.createdAt), sql`rowid < ${cursor.rowid}`),
  );
}

export function readCoordinatorPage(
  deps: ChiefDeps,
  teamId: string,
  query: CoordinatorPageQuery,
): CoordinatorPageResponse {
  const thread = coordinatorThreadRow(deps, ensureChief(deps, teamId));
  const rows = deps.db
    .select({
      id: chiefMessage.id,
      role: chiefMessage.role,
      content: chiefMessage.content,
      createdAt: chiefMessage.createdAt,
      projectId: chiefMessage.projectId,
    })
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, thread.id),
        query.projectId !== undefined ? eq(chiefMessage.projectId, query.projectId) : undefined,
        query.before !== undefined ? earlierThan(deps, thread.id, query.before) : undefined,
      ),
    )
    .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
    .limit(query.limit + 1)
    .all();
  return {
    thread: chiefThreadView(deps, teamId, thread),
    messages: rows.slice(0, query.limit).reverse(),
    hasEarlier: rows.length > query.limit,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function readCoordinatorContext(
  deps: ChiefResourceDeps,
  teamId: string,
): CoordinatorContextResponse {
  const thread = coordinatorThreadRow(deps, ensureChief(deps, teamId));
  const tools = CHIEF_REMOTE_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  return threadContextUsage(deps.db, thread, {
    system: estimateTokens(buildChiefSystemPrompt(deps, teamId, thread.id).text),
    tools: estimateTokens(JSON.stringify(tools)),
  });
}

export function compactCoordinator(
  deps: ChiefDeps,
  teamId: string,
  timeoutMs?: number,
): Promise<CoordinatorCompactResponse> {
  return compactThreadNow(deps, coordinatorThreadRow(deps, ensureChief(deps, teamId)), timeoutMs);
}
