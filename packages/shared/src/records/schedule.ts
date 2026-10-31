import { z } from 'zod';
import { epochMs, phaseSchema, recordId } from './common.js';

export const scheduleKindSchema = z.enum(['once', 'hourly', 'daily', 'weekly', 'cron']);
export type ScheduleKind = z.infer<typeof scheduleKindSchema>;

export const SCHEDULE_MINUTE_STEPS = [0, 15, 30, 45] as const;

export const scheduleTodoEmbedSchema = z.object({
  seqNum: z.number().int(),
  title: z.string(),
  phase: phaseSchema,
  projectName: z.string(),
  ownerId: recordId,
});

const scheduleInputSchema = z.object({
  todoId: recordId,
  projectId: recordId.optional(),
  tz: z.string().optional(),
  prompt: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const createScheduleBodySchema = z.discriminatedUnion('kind', [
  scheduleInputSchema.extend({
    kind: scheduleKindSchema.exclude(['cron']),
    at: epochMs,
    cron: z.never().optional(),
  }),
  scheduleInputSchema.extend({
    kind: z.literal('cron'),
    cron: z.string().trim().min(1),
    at: z.null().optional(),
  }),
]);
export type CreateScheduleBody = z.infer<typeof createScheduleBodySchema>;

export const scheduleRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  projectId: recordId,
  todoId: recordId,
  kind: scheduleKindSchema,
  cron: z.string().nullable(),
  prompt: z.string(),
  enabled: z.boolean(),
  at: epochMs.nullable(),
  tz: z.string(),
  nextRunAt: epochMs.nullable(),
  lastRunAt: epochMs.nullable(),
  lastRunStatus: z.string().nullable(),
  lastRunError: z.string().nullable().optional(),
  pausedReason: z.string().nullable(),
  createdBy: recordId,
  todo: scheduleTodoEmbedSchema,
});
export type ScheduleRecord = z.infer<typeof scheduleRecordSchema>;
