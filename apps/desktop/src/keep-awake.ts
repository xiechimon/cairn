import { readFileSync, writeFileSync } from 'node:fs';

export type SleepBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

export interface SleepBlocker {
  start(type: SleepBlockerType): number;
  stop(id: number): void;
}

export interface KeepAwake {
  isOn(): boolean;
  isHolding(): boolean;
  set(on: boolean): void;
  setWakeAhead(on: boolean): void;
}

function savedChoice(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').trim() === 'on';
  } catch {
    return false;
  }
}

export function createKeepAwake(blocker: SleepBlocker, path: string): KeepAwake {
  let held: { id: number; type: SleepBlockerType } | null = null;
  let manual = savedChoice(path);
  let wakeAhead = false;
  const wanted = (): SleepBlockerType | null => {
    if (manual) return 'prevent-display-sleep';
    if (wakeAhead) return 'prevent-app-suspension';
    return null;
  };
  const apply = (): void => {
    const type = wanted();
    if (held?.type === type) return;
    const previous = held;
    held = type === null ? null : { id: blocker.start(type), type };
    if (previous !== null) blocker.stop(previous.id);
  };
  apply();
  return {
    isOn: () => manual,
    isHolding: () => held !== null,
    set(on) {
      writeFileSync(path, on ? 'on\n' : 'off\n');
      manual = on;
      apply();
    },
    setWakeAhead(on) {
      wakeAhead = on;
      apply();
    },
  };
}
