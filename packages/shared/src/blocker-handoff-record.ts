import { z } from 'zod';
import { phaseSchema } from './records/common.js';

export const BLOCKER_HANDOFF_SUMMARY_MAX_CHARS = 1500;
export const BLOCKER_HANDOFF_MAX_FILES = 30;
const TRUNCATED_MARK = '（已截断）';

export const blockerDeliverySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pr'),
    number: z.number().int(),
    url: z.string().nullable(),
    title: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('branch'),
    branch: z.string(),
    head: z.string().nullable(),
  }),
]);
export type BlockerDelivery = z.infer<typeof blockerDeliverySchema>;

export const blockerHandoffEntrySchema = z.object({
  todoId: z.string(),
  title: z.string(),
  phase: phaseSchema,
  delivery: blockerDeliverySchema.nullable(),
  changedFiles: z.array(z.string()),
  omittedFiles: z.number().int().nonnegative(),
  summary: z.string().nullable(),
});
export type BlockerHandoffEntry = z.infer<typeof blockerHandoffEntrySchema>;

export const blockerHandoffSchema = z.object({
  blockers: z.array(blockerHandoffEntrySchema),
});
export type BlockerHandoffRecord = z.infer<typeof blockerHandoffSchema>;

export function clipHandoffSummary(text: string): string {
  const chars = Array.from(text.trim());
  return chars.length > BLOCKER_HANDOFF_SUMMARY_MAX_CHARS
    ? `${chars.slice(0, BLOCKER_HANDOFF_SUMMARY_MAX_CHARS).join('')}${TRUNCATED_MARK}`
    : chars.join('');
}

export function clipHandoffFiles(paths: readonly string[]): {
  changedFiles: string[];
  omittedFiles: number;
} {
  return {
    changedFiles: paths.slice(0, BLOCKER_HANDOFF_MAX_FILES),
    omittedFiles: Math.max(0, paths.length - BLOCKER_HANDOFF_MAX_FILES),
  };
}
