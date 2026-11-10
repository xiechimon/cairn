import {
  orchestratedTodoIdOf,
  parseReplyQuote,
  renderAttachmentTokensToLabels,
  type TaskContextMessage,
  type TaskReplyContext,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, coordinatorEntry, step } from '../db/schema.js';
import { extractText } from './chief.js';

export function resolveTaskReplyContext(
  db: Db,
  threadId: string,
  messageId: string,
  text: string,
): TaskReplyContext | undefined {
  const reply = parseReplyQuote(text);
  if (reply === null) return undefined;
  const messages: TaskContextMessage[] = [];
  const visiting = new Set([messageId]);
  const visited = new Set<string>();
  let incomplete = false;

  const visit = (id: string | null): void => {
    if (id === null || visiting.has(id) || id.startsWith(TRANSCRIPT_PROMPT_ROW_ID_PREFIX)) {
      incomplete = true;
      return;
    }
    if (visited.has(id)) return;
    const row = db
      .select()
      .from(chiefMessage)
      .where(and(eq(chiefMessage.id, id), eq(chiefMessage.threadId, threadId)))
      .get();
    const body = row === undefined ? null : extractText(row.content);
    if (
      row === undefined ||
      row.role === 'system' ||
      body === null ||
      (typeof row.content === 'string' && orchestratedTodoIdOf(row.content) !== null)
    ) {
      incomplete = true;
      return;
    }
    visiting.add(id);
    if (row.role === 'user') {
      const nested = parseReplyQuote(body);
      if (nested !== null) visit(nested.sourceMessageId);
    } else {
      const producerId = /^(.+)-e\d+$/.exec(id)?.[1];
      const producer =
        producerId === undefined
          ? undefined
          : db
              .select()
              .from(step)
              .where(
                and(eq(step.id, producerId), eq(step.buildId, threadId), eq(step.kind, 'chief')),
              )
              .get();
      if (producer === undefined) incomplete = true;
      else {
        const sourceEntry = db
          .select()
          .from(coordinatorEntry)
          .where(
            and(eq(coordinatorEntry.chiefMessageId, id), eq(coordinatorEntry.threadId, threadId)),
          )
          .get();
        const ownerIds = producer.ownerMessageIds ?? [producer.id];
        if (ownerIds.length === 0) incomplete = true;
        for (const ownerId of new Set(ownerIds)) {
          const owner = db
            .select()
            .from(chiefMessage)
            .where(and(eq(chiefMessage.id, ownerId), eq(chiefMessage.threadId, threadId)))
            .get();
          if (owner?.role !== 'user') {
            incomplete = true;
            continue;
          }
          const ownerEntry = db
            .select()
            .from(coordinatorEntry)
            .where(
              and(
                eq(coordinatorEntry.chiefMessageId, ownerId),
                eq(coordinatorEntry.threadId, threadId),
              ),
            )
            .get();
          if (
            sourceEntry !== undefined &&
            ownerEntry?.conversationId === sourceEntry.conversationId &&
            Number.isSafeInteger(Number(ownerEntry.entryId)) &&
            Number.isSafeInteger(Number(sourceEntry.entryId))
          ) {
            if (Number(ownerEntry.entryId) < Number(sourceEntry.entryId)) visit(ownerId);
          } else if (ownerId === producer.id) visit(ownerId);
          else incomplete = true;
        }
      }
    }
    messages.push({
      threadId,
      messageId: id,
      role: row.role,
      text: row.role === 'assistant' ? renderAttachmentTokensToLabels(body) : body,
    });
    visiting.delete(id);
    visited.add(id);
  };

  visit(reply.sourceMessageId);
  return { messages, incomplete };
}
