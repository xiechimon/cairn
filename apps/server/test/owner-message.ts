import type { Db } from '../src/db/client.js';
import { chiefMessage } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';

let lastCreatedAt = 0;

export function seedOwnerMessage(db: Db, threadId: string, content: string): string {
  const id = newRecordId();
  lastCreatedAt = Math.max(nowMs(), lastCreatedAt + 1);
  db.insert(chiefMessage)
    .values({ id, threadId, role: 'user', content, projectId: null, createdAt: lastCreatedAt })
    .run();
  return id;
}

export function ownerTodoParams(
  db: Db,
  threadId: string,
  projectId: string,
  words: string,
): { projectId: string; messageIds: string[] } {
  return { projectId, messageIds: [seedOwnerMessage(db, threadId, words)] };
}
