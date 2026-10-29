import { z } from 'zod';

export const SCHEDULE_GROUPS = ['now', 'next', 'later', 'close'] as const;
export const scheduleGroupSchema = z.enum(SCHEDULE_GROUPS);
export type ScheduleGroup = z.infer<typeof scheduleGroupSchema>;

export const SCHEDULE_CLOSE_REASONS = ['done', 'superseded', 'outdated', 'duplicate'] as const;
export const scheduleCloseReasonSchema = z.enum(SCHEDULE_CLOSE_REASONS);
export type ScheduleCloseReason = z.infer<typeof scheduleCloseReasonSchema>;

export const SCHEDULE_EVIDENCE_KINDS = [
  'merged-pull',
  'ledger-line',
  'superseding-issue',
  'in-progress',
  'handover',
] as const;
export const scheduleEvidenceKindSchema = z.enum(SCHEDULE_EVIDENCE_KINDS);
export type ScheduleEvidenceKind = z.infer<typeof scheduleEvidenceKindSchema>;

export const scheduleEvidenceSchema = z.object({
  kind: scheduleEvidenceKindSchema,
  ref: z.string().min(1),
  url: z.string().min(1).nullable(),
});
export type ScheduleEvidence = z.infer<typeof scheduleEvidenceSchema>;

export const scheduleLabelChangeSchema = z.object({
  add: z.array(z.string().min(1)),
  remove: z.array(z.string().min(1)),
});
export type ScheduleLabelChange = z.infer<typeof scheduleLabelChangeSchema>;

export const scheduleItemSchema = z.object({
  issue: z.number().int().positive(),
  title: z.string(),
  group: scheduleGroupSchema,
  reason: z.string().min(1),
  deps: z.array(z.number().int().positive()),
  executor: z.string().nullable(),
  updatedAt: z.number().nullable(),
  evidence: z.array(scheduleEvidenceSchema),
  closeReason: scheduleCloseReasonSchema.nullable(),
  labelChange: scheduleLabelChangeSchema.nullable(),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

export const scheduleReportSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  generatedAt: z.number(),
  mainSha: z.string().min(1),
  groups: z.object({
    now: z.array(z.number().int()),
    next: z.array(z.number().int()),
    later: z.array(z.number().int()),
    close: z.array(z.number().int()),
  }),
  items: z.array(scheduleItemSchema),
  unparsedDeps: z.array(z.object({ issue: z.number().int().positive(), text: z.string() })),
  decidedAt: z.number().nullable(),
  decidedBy: z.string().nullable(),
  appliedAt: z.number().nullable(),
});
export type ScheduleReport = z.infer<typeof scheduleReportSchema>;

export const executeScheduleBodySchema = z
  .object({ reportId: z.string().min(1), issues: z.array(z.number().int().positive()).min(1) })
  .strict();
export type ExecuteScheduleBody = z.infer<typeof executeScheduleBodySchema>;

export const scheduleExecuteSkippedSchema = z.object({
  issue: z.number().int().positive(),
  reason: z.enum(['stale', 'missing', 'already-applied']),
});
export type ScheduleExecuteSkipped = z.infer<typeof scheduleExecuteSkippedSchema>;

export const scheduleExecuteResultSchema = z.object({
  applied: z.array(z.number().int().positive()),
  skipped: z.array(scheduleExecuteSkippedSchema),
});
export type ScheduleExecuteResult = z.infer<typeof scheduleExecuteResultSchema>;
