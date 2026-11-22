import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function updateLogPath(userData: string): string {
  return join(userData, 'logs', 'update.log');
}

export function appendUpdateLog(userData: string, line: string, at: Date = new Date()): void {
  const path = updateLogPath(userData);
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${at.toISOString()} ${line}\n`, { mode: 0o600 });
  } catch {}
}
