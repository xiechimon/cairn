import {
  orchestratedTodoIdOf,
  parseCoordinatorConversationKey,
  parseCoordinatorTextSourceId,
  parseReplyQuote,
  renderAttachmentTokensToLabels,
  type TaskContextMessage,
  type TaskReplyContext,
  TRANSCRIPT_PROMPT_ROW_ID_PREFIX,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage, coordinatorEntry, coordinatorInput, step } from '../db/schema.js';
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
      const sourceIdentity = parseCoordinatorTextSourceId(id);
      const producerId = sourceIdentity?.stepId;
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
        const nativeInputs = db
          .select()
          .from(coordinatorInput)
          .where(
            and(eq(coordinatorInput.stepId, producer.id), eq(coordinatorInput.threadId, threadId)),
          )
          .all();
        if (nativeInputs.length > 0 || sourceIdentity?.storeId != null) {
          if (
            sourceEntry === undefined ||
            !Number.isSafeInteger(Number(sourceEntry.entryId)) ||
            (sourceIdentity?.storeId != null &&
              parseCoordinatorConversationKey(sourceEntry.conversationId)?.storeId !==
                sourceIdentity.storeId)
          ) {
            incomplete = true;
          } else {
            const eligible = nativeInputs
              .filter(
                (input) =>
                  input.state === 'consumed' &&
                  input.conversationId === sourceEntry.conversationId &&
                  input.entryId !== null &&
                  Number.isSafeInteger(Number(input.entryId)) &&
                  Number(input.entryId) < Number(sourceEntry.entryId),
              )
              .sort((a, b) => Number(a.entryId) - Number(b.entryId));
            if (eligible.length === 0) incomplete = true;
            const ownerIds = new Set(eligible.flatMap((input) => input.ownerMessageIds));
            if (ownerIds.size === 0) incomplete = true;
            for (const ownerId of ownerIds) {
              const owner = db
                .select()
                .from(chiefMessage)
                .where(and(eq(chiefMessage.id, ownerId), eq(chiefMessage.threadId, threadId)))
                .get();
              if (owner?.role === 'user') visit(ownerId);
              else incomplete = true;
            }
          }
        } else {
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
