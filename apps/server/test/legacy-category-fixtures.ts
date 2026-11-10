import type { Db } from '../src/db/client.js';
import { tag } from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';

export function insertLegacyCategory(db: Db, projectId: string, name: string, color = '#123456') {
  const row = { id: newRecordId(), projectId, name, color, createdAt: nowMs(), v: 1 };
  db.insert(tag).values(row).run();
  return row;
}
