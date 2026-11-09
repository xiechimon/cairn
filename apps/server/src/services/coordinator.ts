import type { CoordinatorPageQuery, CoordinatorPageResponse } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { chiefMessage } from '../db/schema.js';
import { type ChiefDeps, chiefThreadView, coordinatorThreadRow, ensureChief } from './chief.js';
import { newestMessagePage } from './message-page.js';

export function readCoordinatorPage(
  deps: ChiefDeps,
  teamId: string,
  query: CoordinatorPageQuery,
): CoordinatorPageResponse {
  const thread = coordinatorThreadRow(deps, ensureChief(deps, teamId));
  const page = newestMessagePage(
    deps.db,
    chiefMessage,
    thread.id,
    query,
    query.projectId !== undefined ? eq(chiefMessage.projectId, query.projectId) : undefined,
  );
  return {
    thread: chiefThreadView(deps, teamId, thread),
    messages: page.messages.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
      projectId: r.projectId,
    })),
    hasEarlier: page.hasEarlier,
  };
}
