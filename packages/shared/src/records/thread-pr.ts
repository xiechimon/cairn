import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const PR_PANEL_STATES = ['open', 'draft', 'merged', 'closed'] as const;
export type PrPanelState = (typeof PR_PANEL_STATES)[number];
export const prPanelStateSchema = z.enum(PR_PANEL_STATES);

export const PR_MERGE_STATES = [
  'clean',
  'behind',
  'dirty',
  'blocked',
  'unstable',
  'unknown',
] as const;
export type PrMergeState = (typeof PR_MERGE_STATES)[number];
export const prMergeStateSchema = z.enum(PR_MERGE_STATES);

const count = z.number().int().min(0);

export const prPanelRowSchema = z.object({
  buildId: recordId,
  threadId: recordId,
  repo: z.string(),
  number: z.number().int().min(1),
  title: z.string(),
  url: z.string(),
  state: prPanelStateSchema,
  mergeState: prMergeStateSchema,
  additions: count,
  deletions: count,
  branch: z.string(),
  base: z.string(),
  checks: z.object({
    passed: count,
    failed: count,
    running: count,
    total: count,
    failedNames: z.array(z.string()),
  }),
  head: z.string(),
  verdict: z.object({ result: z.enum(['pass', 'block']), judgedHead: z.string() }).nullable(),
  autoFix: z.boolean(),
  mergeWhenReady: z.boolean(),
  autoArchive: z.boolean(),
  dismissed: z.boolean(),
  blockedSince: epochMs.nullable(),
  wakeRounds: count,
  lastReadAt: epochMs,
});
export type PrPanelRow = z.infer<typeof prPanelRowSchema>;

export const prPanelListSchema = z.array(prPanelRowSchema);

export const prPanelQuerySchema = z.object({ threadId: recordId.min(1).optional() });
