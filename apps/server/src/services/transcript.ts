import type { Db } from '../db/client.js';
import { message } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { ConversationStreamHub } from './events.js';

export function insertMessageRow(
  deps: { db: Db; convHub?: ConversationStreamHub },
  conversationId: string,
  row: {
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: unknown;
    createdAt: number;
    actor?: string | null;
  },
): void {
  deps.db
    .insert(message)
    .values({ ...row, actor: row.actor ?? null, conversationId })
    .run();
  deps.convHub?.publishMessage(conversationId, { ...row, actor: row.actor ?? null });
}

export function insertGateAnnouncement(
  deps: { db: Db; convHub?: ConversationStreamHub },
  conversationId: string,
  content: string,
  actor: string,
): void {
  insertMessageRow(deps, conversationId, {
    id: newRecordId(),
    role: 'user',
    content,
    createdAt: nowMs(),
    actor,
  });
}
