import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ENV_VARS } from '../brand.js';

const DEFAULT_INTERVAL_MS = 2_000;

export function parentPidFromEnv(env: NodeJS.ProcessEnv): number | null {
  const raw = env[ENV_VARS.parentPid];
  if (raw === undefined) return null;
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function processLiveness(pid: number): 'alive' | 'gone' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ESRCH' ? 'gone' : code === 'EPERM' ? 'alive' : 'unknown';
  }
}

export function pidAlive(pid: number): boolean {
  return processLiveness(pid) === 'alive';
}

export function processStartTime(pid: number): string | null {
  try {
    if (process.platform === 'darwin') {
      const time = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).trim();
      return time || null;
    }
    if (process.platform === 'linux') {
      const status = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = status.lastIndexOf(')');
      if (close < 0) return null;
      const start = status.slice(close + 2).split(' ')[19];
      return start !== undefined && /^\d+$/.test(start) ? start : null;
    }
  } catch {}
  return null;
}

export function watchParentProcess(opts: {
  pid: number;
  onDead: () => void;
  intervalMs?: number;
  isAlive?: (pid: number) => boolean;
}): () => void {
  const alive = opts.isAlive ?? pidAlive;
  let fired = false;
  const check = (): void => {
    if (fired || alive(opts.pid)) return;
    fired = true;
    clearInterval(timer);
    opts.onDead();
  };
  const timer = setInterval(check, opts.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();
  check();
  return () => clearInterval(timer);
}
