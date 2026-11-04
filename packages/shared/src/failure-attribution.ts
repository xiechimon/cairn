import { z } from 'zod';
import { epochMs, recordId } from './records/common.js';

export const FAILURE_WHERE = [
  'prompt',
  'knowledge',
  'runtime',
  'config',
  'infra',
  'unknown',
] as const;

export const FAILURE_WHY = [
  'premature_finish',
  'thinking_runaway',
  'wrong_tool',
  'ignored_instruction',
  'context_missing',
  'ci_misread',
  'other',
] as const;

export const failureWhereSchema = z.enum(FAILURE_WHERE);
export const failureWhySchema = z.enum(FAILURE_WHY);

export const failureAttributionSchema = z.object({
  where: failureWhereSchema,
  why: failureWhySchema,
  evidence: z.array(
    z.object({
      stepId: recordId,
      messageIndex: z.number().int().nonnegative(),
    }),
  ),
  labeler: z.string().min(1),
  labeledAt: epochMs,
});

export type FailureWhere = z.infer<typeof failureWhereSchema>;
export type FailureWhy = z.infer<typeof failureWhySchema>;
export type FailureAttribution = z.infer<typeof failureAttributionSchema>;
