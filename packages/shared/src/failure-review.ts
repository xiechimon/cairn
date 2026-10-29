import { z } from 'zod';
import { failureWhereSchema, failureWhySchema } from './failure-attribution.js';

export const FAILURE_REVIEW_SOURCES = ['eval', 'pack'] as const;
export const FAILURE_VERDICT_CLASSES = ['agent-mistake', 'grader-bug', 'unfair-task'] as const;
export const FAILURE_REVIEW_VENDORS = ['anthropic', 'z.ai', 'openai', 'xai', 'unknown'] as const;

export const failureReviewSourceSchema = z.enum(FAILURE_REVIEW_SOURCES);
export const failureVerdictClassSchema = z.enum(FAILURE_VERDICT_CLASSES);
export const failureReviewVendorSchema = z.enum(FAILURE_REVIEW_VENDORS);

export const failureReviewReaderSchema = z.object({
  model: z.string(),
  vendor: failureReviewVendorSchema,
});

export const failureReviewRecordSchema = z.object({
  itemId: z.string().min(1),
  source: failureReviewSourceSchema,
  flow: z.string().min(1).nullable(),
  buildId: z.string().min(1).nullable(),
  verdictClass: failureVerdictClassSchema.nullable(),
  where: failureWhereSchema.nullable(),
  why: failureWhySchema.nullable(),
  note: z.string(),
  reader: failureReviewReaderSchema,
});

export const failureReviewAnswersItemSchema = z.object({
  where: failureWhereSchema,
  why: failureWhySchema,
  labeler: z.string().min(1),
});

export const failureReviewAnswersSchema = z.object({
  week: z.string().min(1),
  seed: z.string().min(1),
  items: z.record(z.string(), failureReviewAnswersItemSchema),
});

export type FailureReviewSource = z.infer<typeof failureReviewSourceSchema>;
export type FailureVerdictClass = z.infer<typeof failureVerdictClassSchema>;
export type FailureReviewVendor = z.infer<typeof failureReviewVendorSchema>;
export type FailureReviewReader = z.infer<typeof failureReviewReaderSchema>;
export type FailureReviewRecord = z.infer<typeof failureReviewRecordSchema>;
export type FailureReviewAnswers = z.infer<typeof failureReviewAnswersSchema>;

export function modelVendor(modelId: string): FailureReviewVendor {
  const id = modelId.toLowerCase();
  if (id.includes('claude')) return 'anthropic';
  if (id.includes('glm')) return 'z.ai';
  if (id.includes('gpt') || id.includes('codex')) return 'openai';
  if (id.includes('grok')) return 'xai';
  return 'unknown';
}

export function blankFailureReviewRecord(
  input: Pick<FailureReviewRecord, 'itemId' | 'source' | 'flow' | 'buildId'>,
): FailureReviewRecord {
  return failureReviewRecordSchema.parse({
    itemId: input.itemId,
    source: input.source,
    flow: input.flow,
    buildId: input.buildId,
    verdictClass: null,
    where: null,
    why: null,
    note: '',
    reader: { model: '', vendor: 'unknown' },
  });
}
