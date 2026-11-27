import type { SpawnOptions } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { type KeepAwakeMode, keepAwakeModeFromPersisted } from '@cairn/shared';

export interface CaffeinateChild {
  kill(signal?: number | NodeJS.Signals): unknown;
  once(event: 'error' | 'exit', listener: () => void): unknown;
  unref?: () => void;
}

export type CaffeinateSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => CaffeinateChild;

interface ModeState {
  mode: KeepAwakeMode;
  signature: string;
}

export interface TaskSleepPrevention {
  claim(): void;
  sync(): void;
  stop(): void;
  isHolding(): boolean;
}

function modeState(path: string | undefined, fallback: ModeState): ModeState {
  if (path === undefined) return { mode: 'system', signature: 'standalone' };
  try {
    const raw = readFileSync(path, 'utf8').trim();
    const stat = statSync(path);
    return {
      mode: keepAwakeModeFromPersisted(raw),
      signature: `${stat.mtimeMs}:${stat.size}:${raw}`,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { mode: 'system', signature: 'missing' };
    }
    return fallback;
  }
}

function caffeinateArgs(mode: KeepAwakeMode, pid: number): string[] {
  const leading =
    mode === 'screen-on' ? ['-d', '-i'] : mode === 'lid-closed' ? ['-s', '-i'] : ['-i'];
  return [...leading, '-w', String(pid)];
}

export function createTaskSleepPrevention(opts: {
  enabled: boolean;
  platform: NodeJS.Platform;
  pid: number;
  hasPending: () => boolean;
  spawn: CaffeinateSpawn;
  modeFile?: string;
  log?: (line: string) => void;
}): TaskSleepPrevention {
  const log = opts.log ?? (() => {});
  let fallback: ModeState = { mode: 'system', signature: 'empty' };
  let current: { child: CaffeinateChild; signature: string } | null = null;

  const clear = (child: CaffeinateChild): void => {
    if (current?.child === child) current = null;
  };

  const release = (): void => {
    const previous = current;
    current = null;
    if (previous === null) return;
    try {
      previous.child.kill();
    } catch (error) {
      log(
        `caffeinate could not be stopped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const spawnFor = (state: ModeState): void => {
    try {
      const child = opts.spawn('caffeinate', caffeinateArgs(state.mode, opts.pid), {
        stdio: 'ignore',
      });
      current = { child, signature: state.signature };
      child.once('error', () => clear(child));
      child.once('exit', () => clear(child));
      child.unref?.();
    } catch (error) {
      log(`caffeinate could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  let pendingReadFailed = false;
  const hasPending = (): boolean => {
    try {
      const pending = opts.hasPending();
      pendingReadFailed = false;
      return pending;
    } catch (error) {
      if (!pendingReadFailed) {
        log(
          `the step journal could not be read for sleep prevention: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      pendingReadFailed = true;
      return false;
    }
  };

  const sync = (claimed = false): void => {
    if (!opts.enabled || opts.platform !== 'darwin') return;
    if (!claimed && !hasPending()) {
      release();
      return;
    }
    fallback = modeState(opts.modeFile, fallback);
    if (current?.signature === fallback.signature) return;
    release();
    spawnFor(fallback);
  };

  return {
    claim: () => sync(true),
    sync: () => sync(),
    stop: release,
    isHolding: () => current !== null,
  };
}
