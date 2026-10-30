import { z } from 'zod';

export const firstPrReportPromptSchema = z.object({
  enabled: z.boolean(),
  due: z.boolean(),
  dismissedAt: z.number().int().nullable(),
  firstPrAt: z.number().int().nullable(),
  firstPrNumber: z.number().int().nullable(),
});
export type FirstPrReportPrompt = z.infer<typeof firstPrReportPromptSchema>;

export const DEFAULT_FIRST_PR_REPORT_PROMPT: FirstPrReportPrompt = {
  enabled: false,
  due: false,
  dismissedAt: null,
  firstPrAt: null,
  firstPrNumber: null,
};

export const patchFirstPrReportPromptSchema = z.object({
  enabled: z.boolean().optional(),
  dismissed: z.boolean().optional(),
});

export const patchTeamBodySchema = z
  .object({
    firstPrReportPrompt: patchFirstPrReportPromptSchema.optional(),
    autonomyPaused: z.boolean().optional(),
    maxAutonomousMergesPerDay: z.number().int().nonnegative().optional(),
  })
  .refine(
    (body) =>
      body.firstPrReportPrompt !== undefined ||
      body.autonomyPaused !== undefined ||
      body.maxAutonomousMergesPerDay !== undefined,
    {
      message: 'At least one team setting is required',
    },
  );
export type PatchTeamBody = z.infer<typeof patchTeamBodySchema>;

export const FIRST_PR_DISCUSSION_CATEGORY = 'Q&A';

export const FIRST_PR_DISCUSSION_TITLE = 'My first gated PR with Cairn';

export const FIRST_PR_DISCUSSION_BODY_FIELDS = ['time-to-first-pr'] as const;

export const FIRST_PR_REPO_OWNER = 'xiechimon';
export const FIRST_PR_REPO_NAME = 'cairn';

const FIRST_PR_DISCUSSION_URL_MAX = 2000;

export function firstPrDiscussionUrl(input: { daysToFirstPr: number | null }): string {
  const base = `https://github.com/${FIRST_PR_REPO_OWNER}/${FIRST_PR_REPO_NAME}/discussions/new`;
  const lines = [
    'A first gated PR merged on my own machine with Cairn.',
    '',
    ...(input.daysToFirstPr === null ? [] : [`- time-to-first-pr: ${input.daysToFirstPr} days`]),
  ];
  const params = new URLSearchParams({
    category: FIRST_PR_DISCUSSION_CATEGORY,
    title: FIRST_PR_DISCUSSION_TITLE,
    body: lines.join('\n'),
  });
  const full = `${base}?${params.toString()}`;
  if (full.length <= FIRST_PR_DISCUSSION_URL_MAX) return full;
  const short = new URLSearchParams({
    category: FIRST_PR_DISCUSSION_CATEGORY,
    title: FIRST_PR_DISCUSSION_TITLE,
    body: 'A first gated PR merged on my own machine with Cairn.',
  });
  return `${base}?${short.toString()}`;
}
