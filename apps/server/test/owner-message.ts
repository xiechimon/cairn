import type { Db } from '../src/db/client.js';
import { chiefMessage } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';

let clock = 0;

export function seedOwnerMessage(db: Db, threadId: string, content: string): string {
  const id = newRecordId();
  clock += 1;
  db.insert(chiefMessage)
    .values({ id, threadId, role: 'user', content, projectId: null, createdAt: nowMs() + clock })
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
