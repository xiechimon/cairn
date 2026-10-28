import { z } from 'zod';
import { epochMs, recordId } from './records/common.js';

export const FAILURE_REPLAY_EVENTS = [
  'plan-rejection',
  'review-blocking',
  'post-merge-revert',
] as const;
export const failureReplayEventSchema = z.enum(FAILURE_REPLAY_EVENTS);
export type FailureReplayEvent = z.infer<typeof failureReplayEventSchema>;

export const FAILURE_REPLAY_STATUSES = ['pending', 'confirmed', 'dismissed'] as const;
export const failureReplayStatusSchema = z.enum(FAILURE_REPLAY_STATUSES);
export type FailureReplayStatus = z.infer<typeof failureReplayStatusSchema>;

export const failureReplayPromptSchema = z.object({
  spec: z.string().min(1),
  baseSha: z.string().min(1),
});
export type FailureReplayPrompt = z.infer<typeof failureReplayPromptSchema>;

export const failureReplayCandidateSchema = z.object({
  id: z.string().min(1),
  event: failureReplayEventSchema,
  buildId: recordId,
  baseSha: z.string().min(1),
  prompt: failureReplayPromptSchema,
  feedback: z.string().min(1),
  draftAssertions: z.array(z.string().min(1)).min(1),
  status: failureReplayStatusSchema,
  createdAt: epochMs,
});
export type FailureReplayCandidate = z.infer<typeof failureReplayCandidateSchema>;

export const failureReplayBankCaseSchema = z.object({
  id: z.string().min(1),
  event: failureReplayEventSchema,
  sourceBuildId: recordId,
  prompt: failureReplayPromptSchema,
  assertions: z.array(z.string().min(1)).min(1),
  confirmedAt: epochMs,
});
export type FailureReplayBankCase = z.infer<typeof failureReplayBankCaseSchema>;

export const FAILURE_REPLAY_BANK_RELATIVE = 'integration/eval/failure-replay';
