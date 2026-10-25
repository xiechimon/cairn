import { parseAttachmentTokenLines } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { todo } from '../db/schema.js';

export function attachmentIdsInUserText(text: string, teamId: string): string[] {
  const ids: string[] = [];
  for (const ref of parseAttachmentTokenLines(text)) {
    const slash = ref.key.indexOf('/');
    if (slash < 0 || ref.key.slice(0, slash) !== teamId) continue;
    if (ref.attachmentId === '' || ids.includes(ref.attachmentId)) continue;
    ids.push(ref.attachmentId);
  }
  return ids;
}

export function addUserMessageAttachmentGrants(
  db: Db,
  todoId: string,
  teamId: string,
  text: string,
): void {
  const found = attachmentIdsInUserText(text, teamId);
  if (found.length === 0) return;
  const row = db
    .select({ ids: todo.userMessageAttachmentIds })
    .from(todo)
    .where(eq(todo.id, todoId))
    .get();
  if (!row) return;
  const next = [...row.ids];
  for (const id of found) {
    if (!next.includes(id)) next.push(id);
  }
  if (next.length === row.ids.length) return;
  db.update(todo).set({ userMessageAttachmentIds: next }).where(eq(todo.id, todoId)).run();
}

export function todoAuthorizesAttachment(db: Db, todoId: string, attachmentId: string): boolean {
  const row = db
    .select({
      spec: todo.userSpecAttachmentIds,
      message: todo.userMessageAttachmentIds,
    })
    .from(todo)
    .where(eq(todo.id, todoId))
    .get();
  if (!row) return false;
  return row.spec.includes(attachmentId) || row.message.includes(attachmentId);
}
