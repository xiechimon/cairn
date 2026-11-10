import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { tag, todo, todoTag } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';

export function insertLegacyCategory(db: Db, projectId: string, name: string, color = '#123456') {
  const row = { id: newRecordId(), projectId, name, color, createdAt: nowMs(), v: 1 };
  db.insert(tag).values(row).run();
  return row;
}

export function insertLegacyMembership(
  db: Db,
  todoId: string,
  tagIds: readonly string[],
  correctionRequired: boolean,
): void {
  if (tagIds.length > 0) {
    db.insert(todoTag)
      .values(tagIds.map((tagId) => ({ todoId, tagId })))
      .run();
  }
  db.update(todo).set({ correctionRequired }).where(eq(todo.id, todoId)).run();
}
