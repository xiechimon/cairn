import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const tagRecordSchema = z.object({
  id: recordId,
  projectId: recordId,
  name: z.string(),
  color: z.string(),
  createdAt: epochMs,
  v: z.number().int(),
});
export type TagRecord = z.infer<typeof tagRecordSchema>;

export const createTagBodySchema = z.object({
  name: z.string().min(1),
  color: z.string(),
});
export type CreateTagBody = z.infer<typeof createTagBodySchema>;

export const TAG_DEFAULT_COLOR = '#6366f1';
