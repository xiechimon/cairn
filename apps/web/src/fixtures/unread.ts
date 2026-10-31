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

export function setFixtureUnread(id: string, unread: boolean): void {
  try {
    safeSessionStorage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readOverrides(), [id]: unread }),
    );
  } catch {}
}

export function isFixtureUnread(id: string, initial: readonly string[] | undefined): boolean {
  return readOverrides()[id] ?? initial?.includes(id) ?? false;
}
