import { z } from 'zod';
import { agentRecordSchema } from './agent.js';
import { epochMs, recordId } from './common.js';
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

export const autonomyPauseWaitsForSchema = z.object({
  kind: z.literal('main-green'),
  repo: z.string(),
  failedSha: z.string(),
});
export type AutonomyPauseWaitsFor = z.infer<typeof autonomyPauseWaitsForSchema>;

export const autonomyPauseEntrySchema = z.object({
  id: z.string(),
  source: z.enum(AUTONOMY_PAUSE_SOURCES),
  reason: z.string(),
  publishError: z.string().nullable(),
  openedAt: epochMs,
  waitsFor: autonomyPauseWaitsForSchema.nullable(),
});
export type AutonomyPauseEntry = z.infer<typeof autonomyPauseEntrySchema>;

export const AUTONOMY_PAUSE_RESOLVERS = ['markers', 'owner', 'condition'] as const;
export type AutonomyPauseResolver = (typeof AUTONOMY_PAUSE_RESOLVERS)[number];

export const autonomyAutoResumeSchema = z.object({
  id: z.string(),
  repo: z.string(),
  resolvedReason: z.string(),
  resolvedAt: epochMs,
});
export type AutonomyAutoResume = z.infer<typeof autonomyAutoResumeSchema>;

export const teamRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  createdAt: epochMs,
  plan: teamPlanSchema,
  avatarStyle: z.string().nullable(),
  autonomyPaused: z.boolean().optional(),
  autonomyPauses: z.array(autonomyPauseEntrySchema).optional(),
  autonomyAutoResume: autonomyAutoResumeSchema.nullable().optional(),
  maxAutonomousMergesPerDay: z.number().int().nonnegative().optional(),
  defaultMachineId: recordId.nullable().optional(),
});
export type TeamRecord = z.infer<typeof teamRecordSchema>;

export const patchTeamBodySchema = z
  .object({
    autonomyPaused: z.boolean().optional(),
    maxAutonomousMergesPerDay: z.number().int().nonnegative().optional(),
  })
  .refine(
    (body) => body.autonomyPaused !== undefined || body.maxAutonomousMergesPerDay !== undefined,
    { message: 'At least one team setting is required' },
  );
export type PatchTeamBody = z.infer<typeof patchTeamBodySchema>;

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
