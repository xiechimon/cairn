import { z } from 'zod';
import { recordId } from './common.js';
import { diffFileSchema } from './document-diff.js';
import { mergePolicySchema } from './merge-gate.js';

export const PROJECT_REPO_KINDS = ['hosted', 'github', 'local'] as const;
export const projectRepoKindSchema = z.enum(PROJECT_REPO_KINDS);
export type ProjectRepoKind = z.infer<typeof projectRepoKindSchema>;

export const projectRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  teamId: recordId,
  description: z.string().optional(),
  repoKind: projectRepoKindSchema.optional(),
  repoName: z.string().optional(),
  githubRepo: z.string().optional(),
  localPath: z.string().optional(),
  mergePolicy: mergePolicySchema.optional(),
  localChecks: z.array(z.string().min(1)).optional(),
  cloneUrl: z.string().optional(),
});
export type ProjectRecord = z.infer<typeof projectRecordSchema>;

export const projectMergeConfigSchema = z.object({
  mergePolicy: mergePolicySchema.default('autonomous'),
  localChecks: z.array(z.string().min(1)).default([]),
});
export type ProjectMergeConfig = z.infer<typeof projectMergeConfigSchema>;
export const patchProjectMergeConfigSchema = projectMergeConfigSchema.partial().strict();
export type PatchProjectMergeConfig = z.infer<typeof patchProjectMergeConfigSchema>;
export const githubRepoRefSchema = z.object({
  owner: z.string(),
  repo: z.string(),
});
export type GithubRepoRef = z.infer<typeof githubRepoRefSchema>;

export function parseGithubRepoRef(value: string): GithubRepoRef | null {
  const m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(value);
  const owner = m?.[1];
  const repo = m?.[2];
  if (owner === undefined || repo === undefined) return null;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

export function isGithubRepoRef(value: string): boolean {
  return parseGithubRepoRef(value) !== null;
}

export const createProjectBodySchema = z.object({
  name: z.string(),
  teamId: z.string().optional(),
  kind: projectRepoKindSchema.optional(),
  repoKind: projectRepoKindSchema.optional(),
  localPath: z.string().nullish(),
  githubRepo: z.union([z.string(), githubRepoRefSchema]).optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const patchProjectBodySchema = z
  .object({
    name: z.string().optional(),
    description: z.string().nullish(),
    repoKind: projectRepoKindSchema.optional(),
    githubRepo: z.string().optional(),
    localPath: z.string().nullish(),
  })
  .strict();
export type PatchProjectBody = z.infer<typeof patchProjectBodySchema>;

export const PROJECT_LOCAL_ERROR_REASONS = ['not_found', 'not_git', 'not_absolute'] as const;
export type LocalErrorReason = (typeof PROJECT_LOCAL_ERROR_REASONS)[number];

export const LOCAL_ERROR_REASON_COPY: LocalErrorReasonMap<string> = {
  not_found: '路径不存在',
  not_git: '不是 git 仓库',
  not_absolute: '需要绝对路径',
};

export type LocalErrorBody = { error: string; reason?: LocalErrorReason };

export type LocalErrorReasonMap<T> = Record<LocalErrorReason, T>;

export const PROJECT_TABS = ['Tasks', 'Files'] as const;

export const projectTreeResponseSchema = z.object({
  ref: z.string(),
  commit: z.string(),
  path: z.string(),
  entries: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      type: z.enum(['blob', 'tree']),
      size: z.number().int().nullable(),
    }),
  ),
});
export type ProjectTreeResponse = z.infer<typeof projectTreeResponseSchema>;

export const projectFilesResponseSchema = z.object({
  ref: z.string(),
  commit: z.string(),
  truncated: z.boolean(),
  files: z.array(
    z.object({
      path: z.string(),
      type: z.enum(['blob', 'tree']),
      size: z.number().int().nullable(),
    }),
  ),
});
export type ProjectFilesResponse = z.infer<typeof projectFilesResponseSchema>;

export const projectFileResponseSchema = z.object({
  ref: z.string(),
  commit: z.string(),
  path: z.string(),
  size: z.number().int(),
  encoding: z.enum(['utf-8', 'base64']),
  content: z.string(),
});
export type ProjectFileResponse = z.infer<typeof projectFileResponseSchema>;

export const projectBranchesResponseSchema = z.object({
  defaultBranch: recordId.nullable(),
  branches: z.array(
    z.object({
      name: z.string(),
      isDefault: z.boolean(),
    }),
  ),
});
export type ProjectBranchesResponse = z.infer<typeof projectBranchesResponseSchema>;

export const projectCommitsResponseSchema = z.object({
  ref: z.string(),
  commits: z.array(
    z.object({
      sha: z.string(),
      shortSha: z.string(),
      message: z.string(),
      authorName: z.string(),
      at: z.number(),
    }),
  ),
});
export type ProjectCommitsResponse = z.infer<typeof projectCommitsResponseSchema>;

export const projectCommitDetailResponseSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  message: z.string(),
  authorName: z.string(),
  at: z.number(),
  files: z.array(diffFileSchema),
});
export type ProjectCommitDetailResponse = z.infer<typeof projectCommitDetailResponseSchema>;
