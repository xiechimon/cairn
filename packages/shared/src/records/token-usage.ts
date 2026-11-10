import { z } from 'zod';
import { recordId } from './common.js';

export const tokenUsageSchema = z.object({
  buildId: recordId,
  model: z.string(),
  input: z.number().int(),
  output: z.number().int(),
  cacheRead: z.number().int(),
  cacheWrite: z.number().int(),
  costInput: z.number().nullable(),
  costOutput: z.number().nullable(),
  costCacheRead: z.number().nullable(),
  costCacheWrite: z.number().nullable(),
  costTotal: z.number().nullable(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
