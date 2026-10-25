import { z } from 'zod';
import { recordId } from './common.js';

export const userRecordSchema = z.object({
  id: recordId,
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  type: z.literal('user').optional(),
});
export type UserRecord = z.infer<typeof userRecordSchema>;

export const patchUserBodySchema = z.object({
  displayName: z.string().trim().min(1),
});
export type PatchUserBody = z.infer<typeof patchUserBodySchema>;

export const AUTH_SESSION_NOTE = '单用户 seed + 自动登录（02 §2.1）；无登录页复刻';
