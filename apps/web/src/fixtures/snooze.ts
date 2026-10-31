import { safeSessionStorage } from '../safe-storage.js';

const STORAGE_KEY = 'cairn.fixture.snooze';

export interface FixtureSnooze {
  snoozeMode: 'needed' | 'until' | null;
  snoozedUntil: number | null;
}

function readOverrides(): Record<string, FixtureSnooze> {
  try {
    const raw = safeSessionStorage()?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, FixtureSnooze>) : {};
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();

export function subscribeFixtureSnooze(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setFixtureSnooze(id: string, snooze: FixtureSnooze): void {
  try {
    safeSessionStorage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readOverrides(), [id]: snooze }),
    );
  } catch {}
  for (const listener of listeners) listener();
}

export function withFixtureSnooze<T extends { id: string }>(
  todos: readonly T[],
): (T & FixtureSnooze)[] {
  const overrides = readOverrides();
  return todos.map((todo) => {
    const override = overrides[todo.id];
    const initial = todo as Partial<FixtureSnooze>;
    return {
      ...todo,
      snoozeMode: override !== undefined ? override.snoozeMode : (initial.snoozeMode ?? null),
      snoozedUntil: override !== undefined ? override.snoozedUntil : (initial.snoozedUntil ?? null),
    };
  });
}
