import { z } from 'zod';
import { recordId } from './common.js';

export const TOKEN_USAGE_PARTS = ['输入', '输出', '缓存读取', '缓存写入'] as const;

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
