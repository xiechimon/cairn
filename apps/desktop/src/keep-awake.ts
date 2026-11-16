import { readFileSync, writeFileSync } from 'node:fs';

export interface SleepBlocker {
  start(type: 'prevent-app-suspension'): number;
  stop(id: number): void;
}

export interface KeepAwake {
  isOn(): boolean;
  set(on: boolean): void;
}

function savedChoice(path: string): boolean {
  try {
    return readFileSync(path, 'utf8').trim() === 'on';
  } catch {
    return false;
  }
}

export function createKeepAwake(blocker: SleepBlocker, path: string): KeepAwake {
  let blockId: number | null = null;
  const apply = (on: boolean): void => {
    if (on && blockId === null) blockId = blocker.start('prevent-app-suspension');
    if (!on && blockId !== null) {
      blocker.stop(blockId);
      blockId = null;
    }
  };
  apply(savedChoice(path));
  return {
    isOn: () => blockId !== null,
    set(on) {
      writeFileSync(path, on ? 'on\n' : 'off\n');
      apply(on);
    },
  };
}
