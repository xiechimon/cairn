import { z } from 'zod';
import { CHIEF_THREAD_ID_PREFIX } from './chief.js';
import { epochMs, phaseSchema, recordId } from './common.js';
import { parseGithubRepoRef } from './project.js';
import { quotaWaitSchema } from './step.js';

export const assignmentSlotSchema = z.object({ agentId: recordId });
export const assignmentSchema = z.object({
  plan: assignmentSlotSchema.nullable(),
  build: assignmentSlotSchema.nullable(),
  review: assignmentSlotSchema.nullish(),
  verify: assignmentSlotSchema.nullish(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const todoAgentRefSchema = z.object({
  id: recordId,
  displayName: z.string(),
});

export const buildHistoryEntrySchema = z.object({
  buildId: recordId,
  createdAt: epochMs,
});

export const TASK_SOURCE_KINDS = ['github-issue', 'github-issue-self', 'orchestration'] as const;
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

export const DELIVERABLE_OUTPUT_KINDS = ['code', 'info'] as const;
export const todoOutputSchema = z.enum(DELIVERABLE_OUTPUT_KINDS);
export type TodoOutputKind = z.infer<typeof todoOutputSchema>;

export const usageCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  total: z.number(),
});
export type UsageCost = z.infer<typeof usageCostSchema>;

export const todoRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  projectId: recordId,
  title: z.string(),
  spec: z.string(),
  phase: phaseSchema,
  phaseAt: epochMs,
  seqNum: z.number().int(),
  orderIndex: z.number(),
  tagIds: z.array(recordId),
  assignment: assignmentSchema.nullable(),
  agent: todoAgentRefSchema.nullable(),
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
  waitingOn: z
    .object({
      on: z.enum(['machine', 'quota']),
      retryAt: epochMs.nullable(),
    })
    .optional(),
  quotaWait: quotaWaitSchema.nullable().optional(),
  usageCost: usageCostSchema.optional(),
});
export type TodoRecord = z.infer<typeof todoRecordSchema>;
export type TodoWaitingOn = NonNullable<TodoRecord['waitingOn']>;

export const createTodoBodySchema = z.object({
  title: z.string(),
  spec: z.string(),
  tagIds: z.array(recordId).optional(),
  output: todoOutputSchema.optional(),
});
export type CreateTodoBody = z.infer<typeof createTodoBodySchema>;
