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
