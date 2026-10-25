import { isChiefConversationId } from '@cairn/shared';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, message } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';

const CONVERSATION_MAX_CHARS = 60000;

function summary(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(summary).join('\n');
  if (content === null || typeof content !== 'object') return '';
  const block = content as Record<string, unknown>;
  if (block.type === 'text' && typeof block.text === 'string') return block.text;
  if (block.kind === 'toolcall' && block.call !== null && typeof block.call === 'object') {
    const call = block.call as Record<string, unknown>;
    return `[toolcall: ${typeof call.name === 'string' ? call.name : 'unknown'}${call.isError === true ? ' (error)' : ''}; payload omitted]`;
  }
  if (typeof block.type === 'string' && /tool/i.test(block.type)) {
    return `[${block.type}: ${typeof block.name === 'string' ? block.name : 'payload omitted'}]`;
  }
  return '[structured payload omitted]';
}

export function readConversationPage(db: Db, conversationId: string, before?: string) {
  const table = isChiefConversationId(conversationId) ? chiefMessage : message;
  const conversation = 'threadId' in table ? table.threadId : table.conversationId;
  const scope = eq(conversation, conversationId);
  const fields = {
    id: table.id,
    role: table.role,
    content: table.content,
    createdAt: table.createdAt,
    rowid: sql<number>`rowid`,
  };
  let cursor =
    before === undefined
      ? undefined
      : db
          .select(fields)
          .from(table)
          .where(and(scope, eq(table.id, before)))
          .get();
  if (before !== undefined && cursor === undefined)
    throw new HttpError(404, `conversation message ${before}`);
  const messages: { id: string; role: string; content: string; createdAt: number }[] = [];
  const page = { messages, truncated: false, nextBefore: null as string | null };
  for (;;) {
    const row = db
      .select(fields)
      .from(table)
      .where(
        and(
          scope,
          cursor === undefined
            ? undefined
            : or(
                lt(table.createdAt, cursor.createdAt),
                and(eq(table.createdAt, cursor.createdAt), sql`rowid < ${cursor.rowid}`),
              ),
        ),
      )
      .orderBy(desc(table.createdAt), sql`rowid desc`)
      .limit(1)
      .get();
    if (!row) break;
    const item = {
      id: row.id,
      role: row.role,
      content: summary(row.content),
      createdAt: row.createdAt,
    };
    messages.push(item);
    page.nextBefore = row.id;
    page.truncated = true;
    if (JSON.stringify(page).length > CONVERSATION_MAX_CHARS) {
      messages.pop();
      if (messages.length > 0) {
        page.nextBefore = messages.at(-1)?.id ?? null;
        break;
      }
      item.content = '';
      messages.push(item);
      const available = CONVERSATION_MAX_CHARS - JSON.stringify(page).length;
      let low = 0;
      let high = Math.max(0, available);
      const text = summary(row.content);
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        item.content = text.slice(0, mid);
        if (JSON.stringify(page).length <= CONVERSATION_MAX_CHARS) low = mid;
        else high = mid - 1;
      }
      item.content = text.slice(0, low);
      break;
    }
    page.truncated = false;
    page.nextBefore = null;
    cursor = row;
  }
  return page;
}
