import { coordinatorConversationKey } from '@cairn/shared';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coordinatorConversation, coordinatorInput } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { releaseCoordinatorInput } from '../services/coordinator-inputs.js';

function interruptedMail(db: Db, threadId: string) {
  const row = db
    .select()
    .from(coordinatorConversation)
    .where(
      and(
        eq(coordinatorConversation.threadId, threadId),
        isNotNull(coordinatorConversation.mailOwnerConversationId),
      ),
    )
    .get();
  return row?.mailOwnerConversationId == null ? undefined : row;
}

function registeredConversationId(row: { storeId: string | null; conversationId: string }): string {
  return row.storeId === null
    ? row.conversationId
    : coordinatorConversationKey(row.storeId, row.conversationId);
}

export async function settleInterruptedMailConversation(
  db: Db,
  threadId: string,
  recover: () => Promise<void>,
): Promise<void> {
  const row = interruptedMail(db, threadId);
  if (row === undefined) return;
  const isolated = registeredConversationId(row);
  try {
    await recover();
  } catch (error) {
    if (error instanceof HttpError) throw error;
  }
  for (const input of db
    .select()
    .from(coordinatorInput)
    .where(
      and(
        eq(coordinatorInput.threadId, threadId),
        eq(coordinatorInput.state, 'pending'),
        eq(coordinatorInput.conversationId, isolated),
      ),
    )
    .all()) {
    releaseCoordinatorInput(db, input.id, input.conversationId);
  }
  restoreInterruptedMailConversation(db, threadId);
}

export function restoreInterruptedMailConversation(db: Db, threadId: string): void {
  const row = interruptedMail(db, threadId);
  const ownerId = row?.mailOwnerConversationId;
  if (row === undefined || ownerId == null) return;
  db.update(coordinatorConversation)
    .set({
      conversationId: ownerId,
      mailOwnerConversationId: null,
      updatedAt: nowMs(),
    })
    .where(eq(coordinatorConversation.threadId, threadId))
    .run();
}
