import { z } from 'zod';
import { epochMs, recordId } from './records/common.js';
import { SKILL_DIR_NAME_RE } from './records/skill.js';

export const EXPERIENCE_KINDS = ['memory', 'skill', 'guard'] as const;
export const experienceKindSchema = z.enum(EXPERIENCE_KINDS);

export const MEMORY_CANDIDATE_STATUSES = ['pending', 'promoted', 'dismissed'] as const;
export type MemoryCandidateStatus = (typeof MEMORY_CANDIDATE_STATUSES)[number];

export const PROMOTION_MIN_BUILDS = 2;

const stepRefSchema = z.object({
  stepId: z.string().min(1),
  messageIndex: z.number().int().nonnegative(),
});

export const experienceProposalSchema = z
  .object({
    kind: experienceKindSchema,
    title: z.string().trim().min(1),
    content: z.string().trim().min(1),
    skill: z.string().nullish(),
    evidence: z.array(stepRefSchema).min(1),
  })
  .superRefine((proposal, ctx) => {
    if (proposal.kind === 'skill' && !SKILL_DIR_NAME_RE.test(proposal.skill ?? ''))
      ctx.addIssue({ code: 'custom', path: ['skill'], message: 'skill name required' });
  })
  .transform((proposal) => ({
    ...proposal,
    skill: proposal.kind === 'skill' ? (proposal.skill as string) : null,
  }));

export const experienceCandidateSchema = z.object({
  kind: experienceKindSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  skill: z.string().regex(SKILL_DIR_NAME_RE).nullable(),
  evidence: z.array(stepRefSchema).min(1),
  buildId: recordId,
  agentId: recordId,
  buildSucceeded: z.boolean(),
  reflector: z.string().min(1),
  reflectedAt: epochMs,
});
export type ExperienceCandidate = z.infer<typeof experienceCandidateSchema>;

export const buildEvidenceSchema = stepRefSchema.extend({ buildId: recordId });
export type BuildEvidence = z.infer<typeof buildEvidenceSchema>;

export const guardCandidateSchema = z.object({
  id: z.string().min(1),
  teamId: recordId,
  project: recordId,
  agentId: recordId,
  title: z.string().min(1),
  content: z.string().min(1),
  buildIds: z.array(recordId),
  evidence: z.array(buildEvidenceSchema),
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type GuardCandidate = z.infer<typeof guardCandidateSchema>;

export const skillDraftSchema = guardCandidateSchema.extend({
  skill: z.string().regex(SKILL_DIR_NAME_RE),
  patch: z.string().min(1),
});
export type SkillDraft = z.infer<typeof skillDraftSchema>;
