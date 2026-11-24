import type { Db } from '../db/client.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';

export function claimRateWindow(
  store: WeakMap<Db, Map<string, number>>,
  db: Db,
  key: string,
  action: string,
  windowMs = 10_000,
): void {
  const now = nowMs();
  const windows = store.get(db) ?? new Map<string, number>();
  for (const [id, retryAt] of windows) {
    if (retryAt <= now) windows.delete(id);
  }
  if (windows.has(key)) {
    throw new HttpError(
      429,
      `Please wait ${windowMs / 1000} seconds between ${action} for this connection.`,
    );
  }
  windows.set(key, now + windowMs);
  store.set(db, windows);
}

export function refuseWhileRunning(runningCount: () => number, action: string): void {
  const running = runningCount();
  if (running > 0) {
    throw new HttpError(
      409,
      `Cannot ${action} this account while ${running} task(s) are running on it; finish or stop them first.`,
      undefined,
      { code: 'running-tasks', running },
    );
  }
}

export function assertLabelHidesToken(label: string | undefined, token: string | null): void {
  if (token !== null && label?.includes(token) === true) {
    throw new HttpError(400, 'Connection label must not contain the token');
  }
}

export function dedupeSubscriptionModels<T extends { id: string }>(
  models: readonly T[],
  dropEmpty = false,
): T[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if ((dropEmpty && model.id === '') || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}
