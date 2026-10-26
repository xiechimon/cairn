import { z } from 'zod';
import { todoRecordSchema } from './todo.js';

export const NEEDS_YOU_REASONS = ['failed', 'confirm', 'review'] as const;
export const needsYouReasonSchema = z.enum(NEEDS_YOU_REASONS);
export type NeedsYouReason = z.infer<typeof needsYouReasonSchema>;

export const needsYouEntrySchema = z.object({
  todo: todoRecordSchema,
  reason: needsYouReasonSchema,
});
export type NeedsYouEntry = z.infer<typeof needsYouEntrySchema>;

export const needsYouQuerySchema = z.object({
  current: z.array(needsYouEntrySchema),
  stale: z.array(needsYouEntrySchema),
});
export type NeedsYouQuery = z.infer<typeof needsYouQuerySchema>;
