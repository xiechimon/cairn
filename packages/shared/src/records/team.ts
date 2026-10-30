import { z } from 'zod';
import { agentRecordSchema } from './agent.js';
import { epochMs, recordId } from './common.js';
import { firstPrReportPromptSchema } from './first-pr-report.js';
import { userRecordSchema } from './user.js';

export const teamPlanSchema = z.string();

export const teamRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  createdAt: epochMs,
  plan: teamPlanSchema,
  avatarStyle: z.string().nullable(),
  autonomyPaused: z.boolean().optional(),
  maxAutonomousMergesPerDay: z.number().int().nonnegative().optional(),
  firstPrReportPrompt: firstPrReportPromptSchema.optional(),
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
