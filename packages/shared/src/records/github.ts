import { z } from 'zod';

export const githubRepoSummarySchema = z.object({
  id: z.number(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
});
export type GithubRepoSummary = z.infer<typeof githubRepoSummarySchema>;

export const githubReposResponseSchema = z.object({
  repos: z.array(githubRepoSummarySchema),
});
export type GithubReposResponse = z.infer<typeof githubReposResponseSchema>;

export const GITHUB_CONNECTION_OAUTH = {
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scope: 'read:user repo',
} as const;

export const githubConnectionStatusSchema = z.object({
  connected: z.boolean(),
  login: z.string().optional(),
  scope: z.string().optional(),
});
export type GithubConnectionStatus = z.infer<typeof githubConnectionStatusSchema>;

export const githubIssueLabelSchema = z.object({
  name: z.string(),
  color: z.string(),
});
export type GithubIssueLabel = z.infer<typeof githubIssueLabelSchema>;

export const githubIssueSummarySchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  labels: z.array(githubIssueLabelSchema),
});
export type GithubIssueSummary = z.infer<typeof githubIssueSummarySchema>;

export const GITHUB_ISSUE_STATES = ['open', 'closed', 'all'] as const;
export const githubIssueStateSchema = z.enum(GITHUB_ISSUE_STATES);
export type GithubIssueState = z.infer<typeof githubIssueStateSchema>;

export const githubIssuesResponseSchema = z.object({
  issues: z.array(githubIssueSummarySchema),
  page: z.number().int(),
  hasMore: z.boolean(),
});
export type GithubIssuesResponse = z.infer<typeof githubIssuesResponseSchema>;

export const importGithubIssueBodySchema = z.object({
  number: z.number().int().positive(),
});
export type ImportGithubIssueBody = z.infer<typeof importGithubIssueBodySchema>;

export const githubIssueEchoSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
});
export type GithubIssueEcho = z.infer<typeof githubIssueEchoSchema>;
