import { eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { coordinatorConversation } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export function restoreInterruptedMailConversations(db: Db): void {
  const interrupted = db
    .select()
    .from(coordinatorConversation)
    .where(isNotNull(coordinatorConversation.mailOwnerConversationId))
    .all();
  for (const row of interrupted) {
    if (row.mailOwnerConversationId === null) continue;
    db.update(coordinatorConversation)
      .set({
        conversationId: row.mailOwnerConversationId,
        mailOwnerConversationId: null,
        updatedAt: nowMs(),
      })
      .where(eq(coordinatorConversation.threadId, row.threadId))
      .run();
  }
}
