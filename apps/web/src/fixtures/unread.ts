import { safeSessionStorage } from '../safe-storage.js';

const STORAGE_KEY = 'cairn.fixture.unread';

function readOverrides(): Record<string, boolean> {
  try {
    const raw = safeSessionStorage()?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();

export function subscribeFixtureUnread(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setFixtureUnread(id: string, unread: boolean): void {
  try {
    safeSessionStorage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readOverrides(), [id]: unread }),
    );
  } catch {}
  for (const listener of listeners) listener();
}

export function isFixtureUnread(id: string, initial: readonly string[] | undefined): boolean {
  return readOverrides()[id] ?? initial?.includes(id) ?? false;
}
