import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const branchSyncStatusSchema = z.enum(['pending', 'running', 'synced', 'failed']);
export type BranchSyncStatus = z.infer<typeof branchSyncStatusSchema>;

export const branchSyncRecordSchema = z.object({
  id: recordId,
  buildId: recordId,
  machineId: recordId,
  teamId: recordId,
  directory: z.string(),
  ref: z.string(),
  commit: z.string(),
  force: z.boolean(),
  status: branchSyncStatusSchema,
  errorMessage: z.string().nullable(),
  createdAt: epochMs,
  startedAt: epochMs.nullable(),
  finishedAt: epochMs.nullable(),
});
export type BranchSyncRecord = z.infer<typeof branchSyncRecordSchema>;

export const createBranchSyncBodySchema = z.object({
  machineId: recordId,
  directory: z.string().min(1),
  ref: z.string().min(1),
  commit: z.string().min(1),
  force: z.boolean(),
});
export type CreateBranchSyncBody = z.infer<typeof createBranchSyncBodySchema>;
