import { z } from 'zod';
import { epochMs, phaseSchema, recordId } from './common.js';

export const scheduleKindSchema = z.enum(['once', 'hourly', 'daily', 'weekly']);
export type ScheduleKind = z.infer<typeof scheduleKindSchema>;

export const SCHEDULE_MINUTE_STEPS = [0, 15, 30, 45] as const;

export const scheduleTodoEmbedSchema = z.object({
  seqNum: z.number().int(),
  title: z.string(),
  phase: phaseSchema,
  projectName: z.string(),
  ownerId: recordId,
});

export const createScheduleBodySchema = z.object({
  todoId: recordId,
  projectId: recordId.optional(),
  kind: scheduleKindSchema,
  at: epochMs,
  tz: z.string().optional(),
});
export type CreateScheduleBody = z.infer<typeof createScheduleBodySchema>;

export const scheduleRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  projectId: recordId,
  todoId: recordId,
  kind: scheduleKindSchema,
  at: epochMs.nullable(),
  tz: z.string(),
  nextRunAt: epochMs.nullable(),
  createdBy: recordId,
  todo: scheduleTodoEmbedSchema,
});
export type ScheduleRecord = z.infer<typeof scheduleRecordSchema>;
