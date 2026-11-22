import { chiefDigestThreadId, chiefIdFormat, chiefMemoryThreadId } from '@cairn/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chief, chiefThread } from '../db/schema.js';

type ChiefRow = typeof chief.$inferSelect;
type ThreadRow = typeof chiefThread.$inferSelect;

export function chiefRowOf(
  deps: { db: Db; user: { id: string } },
  teamId: string,
): ChiefRow | undefined {
  return deps.db
    .select()
    .from(chief)
    .where(eq(chief.id, chiefIdFormat(deps.user.id, teamId)))
    .get();
}

export function existingCoordinatorThread(
  deps: { db: Db },
  chiefRow: ChiefRow,
  projectId: string | null = null,
): ThreadRow | undefined {
  return deps.db
    .select()
    .from(chiefThread)
    .where(
      and(
        eq(chiefThread.chiefId, chiefRow.id),
        ne(chiefThread.id, chiefDigestThreadId(chiefRow.id)),
        ne(chiefThread.id, chiefMemoryThreadId(chiefRow.id)),
        isNull(chiefThread.archivedAt),
        projectId === null ? isNull(chiefThread.projectId) : eq(chiefThread.projectId, projectId),
      ),
    )
    .get();
}
