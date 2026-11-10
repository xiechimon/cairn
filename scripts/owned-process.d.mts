import type { ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export function spawnOwned(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: ['pipe', 'pipe', 'ignore' | 'pipe'];
    graceMs?: number;
    maxRuntimeSec?: number;
  },
): {
  child: ChildProcess & { stdin: Writable; stdout: Readable };
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>;
  stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>;
};
