import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const UPDATE_LOCK_FILE = 'update.lock';
export const STALE_LOCK_MS = 10 * 60_000;
const POLL_MS = 100;

export type LockHolder = 'app' | 'background-updater';

interface LockRecord {
  pid: number;
  holder: LockHolder;
  at: number;
}

export function updateLockPath(userData: string): string {
  return join(userData, UPDATE_LOCK_FILE);
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(path: string): LockRecord | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>;
    if (typeof raw.pid !== 'number' || typeof raw.at !== 'number') return null;
    if (raw.holder !== 'app' && raw.holder !== 'background-updater') return null;
    return raw as LockRecord;
  } catch {
    return null;
  }
}

function held(record: LockRecord | null, now: number): boolean {
  return record !== null && now - record.at < STALE_LOCK_MS && pidAlive(record.pid);
}

function tryCreate(path: string, record: LockRecord): boolean {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const draft = `${path}.${record.pid}`;
  writeFileSync(draft, JSON.stringify(record), { mode: 0o600 });
  try {
    linkSync(draft, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    unlinkSync(draft);
  }
}

export async function acquireUpdateLock(
  path: string,
  holder: LockHolder,
  waitMs: number,
): Promise<(() => void) | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const record = { pid: process.pid, holder, at: Date.now() };
    if (tryCreate(path, record)) {
      return () => {
        if (readLock(path)?.pid !== process.pid) return;
        try {
          unlinkSync(path);
        } catch (error) {
          console.debug('cairn: recoverable operation failed', error);
        }
      };
    }
    if (!held(readLock(path), Date.now())) {
      try {
        unlinkSync(path);
      } catch (error) {
        console.debug('cairn: recoverable operation failed', error);
      }
      continue;
    }
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}
