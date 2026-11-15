import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema.js';

export type SyncDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
