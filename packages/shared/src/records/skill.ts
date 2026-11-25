import { z } from 'zod';
import { recordId } from './common.js';

export const SKILL_ENTRY_FILE = 'SKILL.md';

export const MAX_SKILL_FILE_BYTES = 512_000;

export const MAX_SKILL_TOTAL_BYTES = 2_000_000;

export const skillRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  name: z.string(),
  description: z.string().nullable(),
});
export type SkillRecord = z.infer<typeof skillRecordSchema>;

export const skillFileBodySchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});
export type SkillFileBody = z.infer<typeof skillFileBodySchema>;

export const createSkillBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  files: z.array(skillFileBodySchema).min(1),
});
export type CreateSkillBody = z.infer<typeof createSkillBodySchema>;

export const updateSkillBodySchema = createSkillBodySchema;
export type UpdateSkillBody = CreateSkillBody;

export const updateSkillToolParamsSchema = updateSkillBodySchema.extend({
  skillId: z.string().min(1),
});
export type UpdateSkillToolParams = z.infer<typeof updateSkillToolParamsSchema>;

export const importSkillBodySchema = z
  .object({
    localPath: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
  })
  .refine((b) => (b.localPath !== undefined) !== (b.url !== undefined), {
    message: 'invalid body: exactly one of localPath or url is required',
  });
export type ImportSkillBody = z.infer<typeof importSkillBodySchema>;

export const skillImportCandidateSchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  sourcePath: z.string(),
  alreadyImported: z.boolean(),
  problem: z.enum(['missing-name', 'invalid-name', 'missing-description']).nullable(),
});
export type SkillImportCandidate = z.infer<typeof skillImportCandidateSchema>;

export const skillImportCandidatesResponseSchema = z.object({
  candidates: z.array(skillImportCandidateSchema),
  skippedSources: z.array(
    z.object({ root: z.string(), reason: z.enum(['missing', 'unreadable']) }),
  ),
});
export type SkillImportCandidatesResponse = z.infer<typeof skillImportCandidatesResponseSchema>;

export const skillGithubCandidateSchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  path: z.string(),
  url: z.string(),
  alreadyImported: z.boolean(),
  problem: skillImportCandidateSchema.shape.problem,
});
export type SkillGithubCandidate = z.infer<typeof skillGithubCandidateSchema>;

export const skillGithubCandidatesResponseSchema = z.object({
  repo: z.string(),
  defaultBranch: z.string(),
  candidates: z.array(skillGithubCandidateSchema),
  truncated: z.boolean(),
});
export type SkillGithubCandidatesResponse = z.infer<typeof skillGithubCandidatesResponseSchema>;

export const SKILL_DIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const SKILL_PAGE_COPY = {
  empty: '尚无技能',
  hint: '用「导入」或「新建技能」添加。',
} as const;
