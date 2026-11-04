import { z } from 'zod';

export const BACKUP_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const backupStatusSchema = z.object({
  host: z.string(),
  lastRunAt: z.number().int(),
  lastRunResult: z.string().min(1),
  lastRunExitStatus: z.string(),
  lastSuccessAt: z.number().int().nullable(),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

export const backupHealthSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }),
  z.object({ state: z.literal('unreadable') }),
  z.object({ state: z.literal('recorded'), status: backupStatusSchema }),
]);
export type BackupHealth = z.infer<typeof backupHealthSchema>;

export type BackupNotice =
  | { kind: 'failing'; host: string; detail: string; hours: number | null }
  | { kind: 'stale'; host: string; hours: number }
  | { kind: 'unreadable' };

export function backupNotice(
  health: BackupHealth | null | undefined,
  nowMs: number,
): BackupNotice | null {
  if (health == null || health.state === 'none') return null;
  if (health.state === 'unreadable') return { kind: 'unreadable' };
  const { status } = health;
  if (status.lastRunResult !== 'success') {
    return {
      kind: 'failing',
      host: status.host,
      detail: [status.lastRunResult, status.lastRunExitStatus].filter(Boolean).join(' '),
      hours:
        status.lastSuccessAt === null ? null : Math.floor((nowMs - status.lastSuccessAt) / HOUR_MS),
    };
  }
  const since = nowMs - (status.lastSuccessAt ?? status.lastRunAt);
  if (since <= BACKUP_STALE_AFTER_MS) return null;
  return { kind: 'stale', host: status.host, hours: Math.floor(since / HOUR_MS) };
}
