import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { actionProposal, chiefMessage, type step } from '../db/schema.js';
import { askQuestionContentOf, proposalIdOfCard } from './chief-question-store.js';
import { workerQuestionRows } from './worker-question-store.js';

type StepRow = typeof step.$inferSelect;

export function pendingPermissionWaitIds(db: Db, row: StepRow): string[] {
  const cutoff = (row.claimedAt ?? row.createdAt) - 1_000;
  if (row.kind !== 'chief') {
    return workerQuestionRows(db, row.buildId)
      .filter((entry) => entry.content.status === 'pending' && entry.createdAt >= cutoff)
      .map((entry) => entry.id)
      .sort();
  }
  const rows = db
    .select()
    .from(chiefMessage)
    .where(and(eq(chiefMessage.threadId, row.buildId), gte(chiefMessage.createdAt, cutoff)))
    .all();
  const ids: string[] = [];
  for (const entry of rows) {
    const question = askQuestionContentOf(entry.content);
    if (question === null || question.status !== 'pending') continue;
    const propId = proposalIdOfCard(question);
    if (propId !== null) {
      const prop = db
        .select({ status: actionProposal.status, createdAt: actionProposal.createdAt })
        .from(actionProposal)
        .where(eq(actionProposal.id, propId))
        .get();
      if (prop === undefined || prop.status !== 'pending' || prop.createdAt < cutoff) continue;
    }
    ids.push(question.requestId);
  }
  return ids.sort();
}

export function isStepWaitingPermission(db: Db, row: StepRow): boolean {
  return pendingPermissionWaitIds(db, row).length > 0;
}
