import { z } from 'zod';
import { blockerHandoffSchema } from '../blocker-handoff-record.js';
import { skillFactSchema } from '../skill-facts.js';
import { skillInjectionSchema } from '../skill-inject.js';
import { epochMs, recordId } from './common.js';
import { stepQueueBlockedSchema } from './machine-capabilities.js';

export const stepKindSchema = z.enum(['plan', 'build', 'merge', 'chief', 'review', 'verify']);
export type StepKind = z.infer<typeof stepKindSchema>;

export const SECRET_STEP_KINDS: readonly StepKind[] = ['build', 'merge'];

export function stepTakesSecrets(kind: StepKind): boolean {
  return SECRET_STEP_KINDS.includes(kind);
}

export const stepRecordSchema = z.object({
  id: recordId,
  buildId: recordId,
  kind: stepKindSchema,
  machineId: recordId.nullable(),
  createdAt: epochMs,
});
export type StepRecord = z.infer<typeof stepRecordSchema>;

export const stepStatusSchema = z.enum([
  'pending',
  'claimed',
  'done',
  'failed',
  'stopped',
  'waiting_quota',
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const quotaWaitSchema = z.object({
  kind: z.enum(['quota', 'capacity']),
  providerId: z.string(),
  label: z.string().nullable(),
  retryAfterMs: z.number().int().nullable(),
  probeAt: z.number().int(),
});
export type QuotaWait = z.infer<typeof quotaWaitSchema>;

export const stepJournalRowSchema = stepRecordSchema.extend({
  status: stepStatusSchema,
  checkpointCommit: recordId.nullable(),
  queue: z
    .object({
      position: z.number().int().min(1),
      waitingFor: z
        .object({
          machineId: recordId,
          name: z.string(),
          running: z.number().int(),
          capacity: z.number().int(),
        })
        .nullable(),
      hold: z
        .object({
          reason: z.literal('quota'),
          retryAt: epochMs,
        })
        .optional(),
      blocked: stepQueueBlockedSchema.optional(),
    })
    .optional(),
  skillInjection: skillInjectionSchema.nullable(),
  blockerHandoff: blockerHandoffSchema.optional(),
  quotaWait: quotaWaitSchema.optional(),
});
export type StepJournalRow = z.infer<typeof stepJournalRowSchema>;

export type StepQueueInfo = NonNullable<StepJournalRow['queue']>;

export const buildStepActionBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('revision'),
    side: z.literal('plan'),
    feedback: z.string(),
    clientMessageId: z.string(),
  }),
  z.object({ action: z.literal('confirm') }),
  z.object({
    action: z.literal('review'),
    agentId: z.string().optional(),
    focus: z.string().optional(),
  }),
  z.object({
    action: z.literal('restart'),
    feedback: z.string().min(1),
    clientMessageId: z.string(),
  }),
]);
export type BuildStepActionBody = z.infer<typeof buildStepActionBodySchema>;

export const STEP_ACTIVITY_PHASES = [
  'preparing',
  'starting',
  'thinking',
  'responding',
  'tool',
  'retrying',
  'compacting',
  'awaiting_model',
] as const;
export const stepActivityPhaseSchema = z.enum(STEP_ACTIVITY_PHASES);
export type StepActivityPhase = z.infer<typeof stepActivityPhaseSchema>;

export const stepActivityReportSchema = z.object({
  phase: stepActivityPhaseSchema,
  tool: z.string().optional(),
  attempt: z.number().int().optional(),
  resetLive: z.boolean().optional(),
  skills: z.array(skillFactSchema).optional(),
});
export type StepActivityReport = z.infer<typeof stepActivityReportSchema>;

export const stepActivitySchema = stepActivityReportSchema.extend({
  stepId: recordId,
  at: epochMs,
});
export type StepActivity = z.infer<typeof stepActivitySchema>;
