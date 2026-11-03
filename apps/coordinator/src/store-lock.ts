import { readFileSync, rmSync, writeFileSync } from 'node:fs';

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockHolder(lockPath: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(lockPath, 'utf8'), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function acquireStoreLock(
  storePath: string,
  pid: number = process.pid,
  alive: (pid: number) => boolean = processAlive,
): () => void {
  const lockPath = `${storePath}.lock`;
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(lockPath, String(pid), { mode: 0o600, flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw error;
    }
    const holder = lockHolder(lockPath);
    if (holder !== null && holder !== pid && alive(holder)) {
      throw new Error(`${storePath} is in use by another Coordinator sidecar (pid ${holder})`);
    }
    rmSync(lockPath, { force: true });
  }
  return () => {
    if (lockHolder(lockPath) === pid) rmSync(lockPath, { force: true });
  };
}
