import { closeSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import type { ConnectIntent } from './connect-lifecycle.js';

const intentSchema = z
  .object({
    intent: z.enum(['on', 'off', 'removing']),
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    reservationId: z.uuid().nullable(),
    allocation: z
      .object({ id: z.string().min(1), hostname: z.string().min(1).max(253) })
      .strict()
      .nullable(),
  })
  .strict()
  .refine((state) => state.intent !== 'on' || state.reservationId !== null)
  .refine((state) => state.allocation === null || state.reservationId !== null);

function requirePrivate(path: string, directory: boolean): void {
  const info = lstatSync(path);
  if (
    (directory ? !info.isDirectory() : !info.isFile()) ||
    (info.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
    info.uid !== process.getuid?.()
  ) {
    throw new Error('Connect state must be owned by this user, with directory 0700 and file 0600');
  }
}

export function openConnectStore(homeDir: string) {
  const directory = join(homeDir, 'connect');
  let created = false;
  try {
    mkdirSync(directory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  requirePrivate(directory, true);
  const path = join(directory, 'state.sqlite');
  if (created) closeSync(openSync(path, 'ax', 0o600));
  requirePrivate(path, false);
  const database = new Database(path, { timeout: 0, fileMustExist: true });
  try {
    database.pragma('locking_mode = EXCLUSIVE');
    database.pragma('journal_mode = DELETE');
    database.pragma('synchronous = FULL');
    database.exec('BEGIN EXCLUSIVE; COMMIT');
    if (created) {
      database.transaction(() => {
        database.exec(
          'CREATE TABLE connect_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)',
        );
        database
          .prepare('INSERT INTO connect_state (id, payload) VALUES (1, ?)')
          .run(
            JSON.stringify({ intent: 'off', generation: 0, reservationId: null, allocation: null }),
          );
      })();
    }
    const read = database.prepare('SELECT payload FROM connect_state WHERE id = 1');
    const write = database.prepare('UPDATE connect_state SET payload = ? WHERE id = 1');
    function load(): ConnectIntent {
      const row = read.get() as { payload: string } | undefined;
      if (row === undefined) throw new Error('Connect state is missing; use operator recovery');
      return intentSchema.parse(JSON.parse(row.payload));
    }
    load();
    return {
      load,
      save: (state: ConnectIntent): void => {
        write.run(JSON.stringify(intentSchema.parse(state)));
      },
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
