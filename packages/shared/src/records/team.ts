import { z } from 'zod';
import { claudeUsageSchema } from '../model-routing.js';
import { agentRecordSchema } from './agent.js';
import { epochMs, recordId } from './common.js';
import { firstPrReportPromptSchema } from './first-pr-report.js';
import { userRecordSchema } from './user.js';

export const teamPlanSchema = z.string();

export const autonomyPauseMarkerSchema = z.object({
  repo: z.string(),
  number: z.number().int().positive(),
});
export type AutonomyPauseMarker = z.infer<typeof autonomyPauseMarkerSchema>;

export const AUTONOMY_PAUSE_SOURCES = [
  'settings',
  'main-red',
  'unjudged-landing',
  'legacy',
] as const;
export type AutonomyPauseSource = (typeof AUTONOMY_PAUSE_SOURCES)[number];

export const autonomyPauseEntrySchema = z.object({
  id: z.string(),
  source: z.enum(AUTONOMY_PAUSE_SOURCES),
  reason: z.string(),
  publishError: z.string().nullable(),
  openedAt: epochMs,
});
export type AutonomyPauseEntry = z.infer<typeof autonomyPauseEntrySchema>;

export const teamRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  createdAt: epochMs,
  plan: teamPlanSchema,
  claudeUsage: claudeUsageSchema.optional(),
  avatarStyle: z.string().nullable(),
  autonomyPaused: z.boolean().optional(),
  autonomyPauses: z.array(autonomyPauseEntrySchema).optional(),
  coAuthorTrailer: z.boolean().default(true),
  requestInstructorReview: z.boolean().default(false),
  maxAutonomousMergesPerDay: z.number().int().nonnegative().optional(),
  firstPrReportPrompt: firstPrReportPromptSchema.optional(),
  defaultMachineId: recordId.nullable().optional(),
});
export type TeamRecord = z.infer<typeof teamRecordSchema>;

export const memberTypeSchema = z.enum(['user', 'agent']);
export const teamMemberSchema = z
  .object({
    id: recordId,
    teamId: recordId,
    actorId: recordId,
    memberType: memberTypeSchema,
    actor: z.union([userRecordSchema.loose(), agentRecordSchema.loose()]).optional(),
  })
  .loose();
export type TeamMember = z.infer<typeof teamMemberSchema>;
