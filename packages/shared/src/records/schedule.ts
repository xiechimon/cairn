import { z } from 'zod';
import { epochMs, phaseSchema, recordId } from './common.js';

export const scheduleKindSchema = z.enum([
  'once',
  'hourly',
  'daily',
  'weekly',
  'cron',
  'event',
  'webhook',
]);
export type ScheduleKind = z.infer<typeof scheduleKindSchema>;

export const SCHEDULE_MINUTE_STEPS = [0, 15, 30, 45] as const;

export const scheduleEventTopicSchema = z.enum(['todo.build.completed']);
export type ScheduleEventTopic = z.infer<typeof scheduleEventTopicSchema>;

export const scheduleTriggerSpecSchema = z.strictObject({
  topic: scheduleEventTopicSchema,
});
export type ScheduleTriggerSpec = z.infer<typeof scheduleTriggerSpecSchema>;

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
  missedRunWindowMs: z.number().int().positive().optional(),
});

export const createScheduleBodySchema = z.discriminatedUnion('kind', [
  scheduleInputSchema.extend({
    kind: scheduleKindSchema.exclude(['cron', 'event', 'webhook']),
    at: epochMs,
    cron: z.never().optional(),
    triggerSpec: z.never().optional(),
  }),
  scheduleInputSchema.extend({
    kind: z.literal('cron'),
    cron: z.string().trim().min(1),
    at: z.null().optional(),
    triggerSpec: z.never().optional(),
  }),
  scheduleInputSchema.extend({
    kind: z.literal('event'),
    triggerSpec: scheduleTriggerSpecSchema,
    at: z.null().optional(),
    cron: z.never().optional(),
  }),
  scheduleInputSchema.extend({
    kind: z.literal('webhook'),
    triggerSpec: z.never().optional(),
    at: z.null().optional(),
    cron: z.never().optional(),
  }),
]);
export type CreateScheduleBody = z.infer<typeof createScheduleBodySchema>;

const updateScheduleInputSchema = scheduleInputSchema.extend({
  todoId: recordId.optional(),
});

export const updateScheduleBodySchema = z.discriminatedUnion('kind', [
  updateScheduleInputSchema.extend({
    kind: scheduleKindSchema.exclude(['cron', 'event', 'webhook']),
    at: epochMs,
    cron: z.never().optional(),
    triggerSpec: z.never().optional(),
    rotateWebhook: z.never().optional(),
  }),
  updateScheduleInputSchema.extend({
    kind: z.literal('cron'),
    cron: z.string().trim().min(1),
    at: z.null().optional(),
    triggerSpec: z.never().optional(),
    rotateWebhook: z.never().optional(),
  }),
  updateScheduleInputSchema.extend({
    kind: z.literal('event'),
    triggerSpec: scheduleTriggerSpecSchema,
    at: z.null().optional(),
    cron: z.never().optional(),
    rotateWebhook: z.never().optional(),
  }),
  updateScheduleInputSchema.extend({
    kind: z.literal('webhook'),
    triggerSpec: z.never().optional(),
    at: z.null().optional(),
    cron: z.never().optional(),
    rotateWebhook: z.boolean().optional(),
  }),
]);
export type UpdateScheduleBody = z.infer<typeof updateScheduleBodySchema>;

export const patchScheduleBodySchema = z.object({ enabled: z.boolean() }).strict();
export type PatchScheduleBody = z.infer<typeof patchScheduleBodySchema>;

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
  triggerSpec: scheduleTriggerSpecSchema.nullable(),
  webhookMasked: z.string().nullable(),
  webhookLastUsedAt: epochMs.nullable(),
  missedRunWindowMs: z.number().int().nullable(),
  createdAt: epochMs.nullable(),
  createdBy: recordId,
  todo: scheduleTodoEmbedSchema,
});
export type ScheduleRecord = z.infer<typeof scheduleRecordSchema>;
