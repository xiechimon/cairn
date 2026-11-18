import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { dataMigration } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export function runDataMigrationOnce<T>(db: Db, id: string, run: () => T): T | undefined {
  const done = db.select().from(dataMigration).where(eq(dataMigration.id, id)).get();
  if (done !== undefined) return undefined;
  const result = run();
  db.insert(dataMigration)
    .values({ id, doneAt: nowMs(), detail: JSON.stringify(result ?? null) })
    .onConflictDoNothing()
    .run();
  return result;
}
