import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { DesktopRunnerState, KeepAwakeMode } from '@cairn/shared';
import { isKeepAwakeMode, keepAwakeModeFromPersisted } from '@cairn/shared';

export type SleepBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

export interface SleepBlocker {
  start(type: SleepBlockerType): number;
  stop(id: number): void;
}

export interface KeepAwakeInput {
  runner: DesktopRunnerState;
  inFlight: number;
}

export interface KeepAwake {
  mode(): KeepAwakeMode;
  isHolding(): boolean;
  setMode(mode: KeepAwakeMode): void;
  sync(input: KeepAwakeInput): void;
  stop(): void;
}

function savedChoice(path: string, log: (line: string) => void): KeepAwakeMode {
  try {
    return keepAwakeModeFromPersisted(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(
        `the saved keep-awake choice could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return 'system';
}

export function createKeepAwake(
  blocker: SleepBlocker,
  path: string,
  opts: { platform?: NodeJS.Platform; log?: (line: string) => void } = {},
): KeepAwake {
  const platform = opts.platform ?? process.platform;
  const log = opts.log ?? ((line: string) => console.error(line));
  let mode = savedChoice(path, log);
  let persisted = false;
  let held: { id: number; type: SleepBlockerType } | null = null;
  let input: KeepAwakeInput = { runner: 'off', inFlight: 0 };

  const writeMode = (next: KeepAwakeMode): boolean => {
    try {
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, `${next}\n`);
      renameSync(temporary, path);
      return true;
    } catch (error) {
      log(
        `the keep-awake choice could not be saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  };
  persisted = writeMode(mode);

  const active = (): boolean =>
    (input.runner === 'on' || input.runner === 'starting') && input.inFlight > 0;

  const wanted = (): SleepBlockerType | null => {
    if (platform === 'darwin' || !active()) return null;
    return mode === 'screen-on' ? 'prevent-display-sleep' : 'prevent-app-suspension';
  };

  const release = (): void => {
    const previous = held;
    held = null;
    if (previous !== null) {
      try {
        blocker.stop(previous.id);
      } catch (error) {
        log(
          `the keep-awake blocker could not be released: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  };

  const apply = (): void => {
    const type = wanted();
    if (type === null) {
      release();
      return;
    }
    if (held?.type === type) return;
    release();
    try {
      held = { id: blocker.start(type), type };
    } catch (error) {
      log(
        `the keep-awake blocker could not start: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  return {
    mode: () => mode,
    isHolding: () => held !== null,
    setMode(next) {
      if (!isKeepAwakeMode(next)) return;
      if (next === mode && persisted) return;
      if (!writeMode(next)) return;
      persisted = true;
      mode = next;
      apply();
    },
    sync(next) {
      input = next;
      apply();
    },
    stop: release,
  };
}
