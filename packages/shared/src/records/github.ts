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
  disconnectReason: z.string().optional(),
});
export type GithubConnectionStatus = z.infer<typeof githubConnectionStatusSchema>;

export const githubConnectionDeviceStartSchema = z.object({
  attemptId: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  intervalSeconds: z.number().int().positive(),
  expiresInSeconds: z.number().int().positive(),
});
export type GithubConnectionDeviceStart = z.infer<typeof githubConnectionDeviceStartSchema>;

export const githubConnectionDevicePollSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending'), intervalSeconds: z.number().int().positive() }),
  z.object({ status: z.literal('complete'), login: z.string() }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('denied') }),
  z.object({ status: z.literal('failed') }),
]);
export type GithubConnectionDevicePoll = z.infer<typeof githubConnectionDevicePollSchema>;

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
