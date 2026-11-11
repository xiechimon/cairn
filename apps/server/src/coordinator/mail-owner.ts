import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coordinatorConversation } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export function restoreInterruptedMailConversation(db: Db, threadId: string): void {
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
  if (row?.mailOwnerConversationId == null) return;
  db.update(coordinatorConversation)
    .set({
      conversationId: row.mailOwnerConversationId,
      mailOwnerConversationId: null,
      updatedAt: nowMs(),
    })
    .where(eq(coordinatorConversation.threadId, threadId))
    .run();
}
