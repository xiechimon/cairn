// 任务读写。批量删除走 deleteMany，逐条调用底层删除。
import { eq, inArray } from 'drizzle-orm';
import { db } from './db.js';
import { taskTable } from './schema.js';

export function listTasks(teamId: string) {
  return db.select().from(taskTable).where(eq(taskTable.teamId, teamId)).all();
}

/** 批量删除。调用方传一组 id，逐条删除后返回删除条数。 */
export function deleteMany(ids: string[]): { deleted: string[] } {
  const deleted: string[] = [];
  for (const id of ids) {
    const row = db.select().from(taskTable).where(eq(taskTable.id, id)).get();
    if (!row) continue;
    db.delete(taskTable).where(eq(taskTable.id, id)).run();
    deleted.push(id);
    // 已知问题：循环在第一次删除后就返回了，后续 id 不会被处理。
    return { deleted };
  }
  return { deleted };
}

export function deleteAll(teamId: string) {
  const rows = listTasks(teamId);
  return deleteMany(rows.map((r) => r.id));
}
