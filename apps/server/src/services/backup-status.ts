import { readFileSync } from 'node:fs';
import { type BackupHealth, backupStatusSchema } from '@cairn/shared';

export function readBackupHealth(path: string | undefined): BackupHealth {
  if (path === undefined) return { state: 'none' };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'none' };
    return { state: 'unreadable' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: 'unreadable' };
  }
  const status = backupStatusSchema.safeParse(parsed);
  return status.success ? { state: 'recorded', status: status.data } : { state: 'unreadable' };
}
