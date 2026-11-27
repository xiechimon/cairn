import { z } from 'zod';
import { RETRY_FAILURE_CLASSES, RETRY_REASON_CODES } from '../task-failure.js';
import { CHIEF_THREAD_ID_PREFIX } from './chief.js';
import { epochMs, phaseSchema, recordId } from './common.js';
import { parseGithubRepoRef } from './project.js';
import { deliverablesMessageSchema } from './report.js';
import { routeOverrideSchema } from './routing-rule.js';
import { quotaWaitSchema } from './step.js';
import { taskRequestSchema } from './task-request.js';
import { contextCacheSchema } from './token-usage.js';

export const buildHistoryEntrySchema = z.object({
  buildId: recordId,
  createdAt: epochMs,
});

export const RESEARCH_BEFORE_PLAN_SOURCE_KIND = 'research-before-plan';
export const RESEARCH_STUCK_SOURCE_KIND = 'research-stuck';
export const TASK_SOURCE_KINDS = [
  'github-issue',
  'github-issue-self',
  'orchestration',
  'research-intake',
  'research-citation-check',
  RESEARCH_BEFORE_PLAN_SOURCE_KIND,
  RESEARCH_STUCK_SOURCE_KIND,
] as const;
export const todoSourceKindSchema = z.enum(TASK_SOURCE_KINDS);
export type TodoSourceKind = z.infer<typeof todoSourceKindSchema>;

export function githubIssueSourceRef(owner: string, repo: string, issueNumber: number): string {
  return `github:${owner}/${repo}#${issueNumber}`;
}

export function parseGithubIssueSourceRef(
  ref: string,
): { owner: string; repo: string; issueNumber: number } | null {
  const m = /^github:([^/#]+\/[^/#]+)#(\d+)$/.exec(ref);
  if (m === null) return null;
  const repoRef = parseGithubRepoRef(m[1] as string);
  if (repoRef === null) return null;
  return { ...repoRef, issueNumber: Number(m[2]) };
}

export function orchestrationSourceRef(threadId: string): string {
  if (!threadId.startsWith(CHIEF_THREAD_ID_PREFIX)) {
    throw new Error(`orchestrationSourceRef: not a chief thread id: ${threadId}`);
  }
  return `chief:${threadId.slice(CHIEF_THREAD_ID_PREFIX.length)}`;
}

export function parseOrchestrationSourceRef(ref: string): { threadId: string } | null {
  const m = /^chief:(.+)$/.exec(ref);
  if (m === null) return null;
  return { threadId: `${CHIEF_THREAD_ID_PREFIX}${m[1]}` };
}

export const INFO_OUTPUT_KINDS = ['info', 'report', 'dataset', 'link'] as const;
export const DELIVERABLE_OUTPUT_KINDS = ['code', ...INFO_OUTPUT_KINDS] as const;
export const todoOutputSchema = z.enum(DELIVERABLE_OUTPUT_KINDS);
export type TodoOutputKind = z.infer<typeof todoOutputSchema>;
export type InfoOutputKind = Exclude<TodoOutputKind, 'code'>;
export function isInfoOutput(output: string | null | undefined): output is InfoOutputKind {
  return (INFO_OUTPUT_KINDS as readonly string[]).includes(output ?? '');
}

export const usageCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  total: z.number(),
  priced: z.boolean().optional(),
});
export type UsageCost = z.infer<typeof usageCostSchema>;

export const taskDecisionSchema = z.object({
  requestId: z.string(),
  question: z.string(),
  answer: z.string(),
  by: z.enum(['person', 'coordinator']),
  at: epochMs,
});
export type TaskDecision = z.infer<typeof taskDecisionSchema>;

export const THREAD_OWNERS = ['owner', 'coordinator'] as const;

export const todoDeliverablesSchema = z.object({
  items: z.array(deliverablesMessageSchema.shape.items.element.omit({ attachmentToken: true })),
  skipped: deliverablesMessageSchema.shape.skipped,
});
export type TodoDeliverables = z.infer<typeof todoDeliverablesSchema>;

export const todoSectionSchema = z.enum([
  'needs_input',
  'ready_for_review',
  'up_next',
  'working',
  'resolved',
]);
export type TodoSection = z.infer<typeof todoSectionSchema>;

export const retryFailureClassSchema = z.enum(RETRY_FAILURE_CLASSES);
export const retryReasonCodeSchema = z.enum(RETRY_REASON_CODES);

export const todoRetryStateSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('scheduled'),
    failureClass: z.enum(['transient', 'rate_limit', 'unknown']),
    reasonCode: retryReasonCodeSchema,
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1).nullable(),
    nextRetryAt: epochMs,
    windowEndsAt: epochMs,
  }),
  z.object({
    state: z.literal('parked'),
    failureClass: retryFailureClassSchema,
    reasonCode: retryReasonCodeSchema,
    attemptsMade: z.number().int().min(0),
    detail: z.string().nullable(),
  }),
]);
export type TodoRetryState = z.infer<typeof todoRetryStateSchema>;

export const todoRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  projectId: recordId,
  title: z.string(),
  spec: z.string(),
  phase: phaseSchema,
  phaseAt: epochMs,
  archivedAt: epochMs.nullish(),
  seqNum: z.number().int(),
  orderIndex: z.number(),
  githubLabelIds: z.array(recordId).optional(),
  latestBuildId: recordId.nullable(),
  lastRunAt: epochMs.nullable(),
  hasChanges: z.boolean(),
  hasPlan: z.boolean(),
  buildHistory: z.array(buildHistoryEntrySchema),
  sourceTodo: recordId.nullable(),
  blockedBy: z.array(recordId).nullish(),
  v: z.number().int(),
  createdBy: recordId.nullable(),
  ownerId: recordId.nullable(),
  sourceBuildId: z.string().nullable(),
  sourceKind: todoSourceKindSchema.nullable(),
  sourceRef: z.string().nullable(),
  output: todoOutputSchema.default('code'),
  owner: z.enum(THREAD_OWNERS).nullable().default(null),
  section: todoSectionSchema.nullable().optional(),
  waitingOn: z
    .object({
      on: z.enum(['machine', 'quota']),
      retryAt: epochMs.nullable(),
    })
    .optional(),
  quotaWait: quotaWaitSchema.nullable().optional(),
  retry: todoRetryStateSchema.nullable().optional(),
  missingCommand: z.string().nullable().optional(),
  lastProgressAt: epochMs.optional(),
  usageCost: usageCostSchema.optional(),
  context: z
    .object({
      tokens: z.number().int(),
      contextWindow: z.number().int(),
      compactAt: z.number().int().positive().optional(),
      resumeExpiresAt: epochMs.optional(),
      cache: contextCacheSchema.optional(),
    })
    .nullable()
    .optional(),
  deliverables: todoDeliverablesSchema.optional(),
  verified: z.boolean().optional(),
  decisions: z.array(taskDecisionSchema).optional(),
  routeOverride: routeOverrideSchema.nullable().optional(),
  request: z
    .lazy(() => taskRequestSchema)
    .nullable()
    .optional(),
});
export type TodoRecord = z.infer<typeof todoRecordSchema>;
export type TodoOwner = TodoRecord['owner'];
export type TodoWaitingOn = NonNullable<TodoRecord['waitingOn']>;

export const createTodoBodySchema = z.object({
  title: z.string(),
  spec: z.string(),
  output: todoOutputSchema.optional(),
  machineId: recordId.optional(),
});
export type CreateTodoBody = z.infer<typeof createTodoBodySchema>;
