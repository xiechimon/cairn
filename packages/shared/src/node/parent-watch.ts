import { ENV_VARS } from '../brand.js';

const DEFAULT_INTERVAL_MS = 2_000;

export function parentPidFromEnv(env: NodeJS.ProcessEnv): number | null {
  const raw = env[ENV_VARS.parentPid];
  if (raw === undefined) return null;
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
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
