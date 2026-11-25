import { z } from 'zod';

export const BACKUP_STALE_AFTER_MS = 2 * 60 * 60 * 1000;
export const DAILY_BACKUP_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const backupSnapshotKindSchema = z.enum(['scheduled', 'manual', 'pre-restore']);
export type BackupSnapshotKind = z.infer<typeof backupSnapshotKindSchema>;

export const backupStorageKindSchema = z.enum(['local', 'cloud']);
export type BackupStorageKind = z.infer<typeof backupStorageKindSchema>;

export const BACKUP_SNAPSHOT_ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{3,79}$/;

export function isValidBackupSnapshotId(id: string): boolean {
  return BACKUP_SNAPSHOT_ID_RE.test(id) && !id.includes('..');
}

export const backupSnapshotSummarySchema = z.object({
  id: z.string().refine(isValidBackupSnapshotId, 'invalid backup snapshot id'),
  createdAt: z.number().int(),
  sizeBytes: z.number().int().nonnegative(),
  kind: backupSnapshotKindSchema,
  storage: backupStorageKindSchema,
  verified: z.boolean(),
});
export type BackupSnapshotSummary = z.infer<typeof backupSnapshotSummarySchema>;

export const backupManagedInfoSchema = z.object({
  enabled: z.boolean(),
  storage: backupStorageKindSchema,
  schedule: z.literal('daily'),
  inProgress: z.boolean(),
  snapshots: z.array(backupSnapshotSummarySchema),
});
export type BackupManagedInfo = z.infer<typeof backupManagedInfoSchema>;

export const backupRestoreResultSchema = z.object({
  restoredId: z.string().min(1),
  undoBackupId: z.string().min(1),
  restarting: z.boolean(),
});
export type BackupRestoreResult = z.infer<typeof backupRestoreResultSchema>;

export const backupStatusSchema = z.object({
  host: z.string(),
  lastRunAt: z.number().int(),
  lastRunResult: z.string().min(1),
  lastRunExitStatus: z.string(),
  lastSuccessAt: z.number().int().nullable(),
  staleAfterMs: z.number().int().positive().optional(),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

export const backupHealthSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none'), managed: backupManagedInfoSchema.optional() }),
  z.object({ state: z.literal('unreadable'), managed: backupManagedInfoSchema.optional() }),
  z.object({
    state: z.literal('recorded'),
    status: backupStatusSchema,
    managed: backupManagedInfoSchema.optional(),
  }),
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
  const staleAfter = status.staleAfterMs ?? BACKUP_STALE_AFTER_MS;
  if (since <= staleAfter) return null;
  return { kind: 'stale', host: status.host, hours: Math.floor(since / HOUR_MS) };
}
