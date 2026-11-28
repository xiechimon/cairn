import { z } from 'zod';

export const scriptStep = z
  .object({
    text: z.string().optional(),
    toolCalls: z
      .array(z.object({ name: z.string(), args: z.record(z.string(), z.unknown()) }))
      .optional(),
  })
  .refine((s) => s.text !== undefined || (s.toolCalls?.length ?? 0) > 0);
export type ScriptStep = z.infer<typeof scriptStep>;

export const worldSeed = z
  .object({
    projects: z.array(z.string().min(1)).default([]),
    todos: z
      .array(z.object({ project: z.string(), title: z.string(), status: z.string().optional() }))
      .default([]),
  })
  .strict();

export const expected = z
  .object({
    decision: z.enum(['route', 'ask', 'answer', 'any']).default('any'),
    projects: z.array(z.string()).optional(),
    parts: z.number().int().min(0).optional(),
    ask: z.boolean().optional(),
    askCandidates: z.array(z.string()).optional(),
    promptContains: z.array(z.string()).default([]),
    promptExcludes: z.array(z.string()).default([]),
    boundModel: z.string().optional(),
    checks: z.array(z.string()).optional(),
  })
  .strict();

const taskId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const commitSha = z.string().regex(/^[0-9a-f]{40}$/);
const safeRelPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..'));

export const runtimeTask = z
  .object({
    kind: z.literal('runtime'),
    id: taskId,
    request: z.string().min(1),
    event: z.string().optional(),
    world: worldSeed,
    script: z.array(scriptStep).min(1),
    expected,
    gate: z.boolean().default(true),
  })
  .strict();

export const laneSource = z
  .object({
    parentCommit: commitSha,
    fixCommit: commitSha,
    testFiles: z.array(safeRelPath).min(1),
    existingTestFiles: z.array(safeRelPath).default([]),
  })
  .strict();

const laneChecks = z
  .object({
    files: z.array(z.object({ path: safeRelPath, contains: z.string().optional() })).default([]),
    commands: z.array(z.string().min(1)).min(1),
    allowPaths: z.array(z.string()).optional(),
  })
  .strict();

export const laneTask = z
  .object({
    kind: z.literal('lane'),
    id: taskId,
    instruction: z.string().min(1),
    timeoutMs: z.number().int().min(10_000).max(240_000).default(240_000),
    source: laneSource,
    checks: laneChecks,
    gate: z.boolean().default(true),
  })
  .strict();

export const journeyTask = z
  .object({
    kind: z.literal('journey'),
    id: taskId,
    request: z.string().min(1),
    world: worldSeed,
    script: z.array(scriptStep).min(1),
    expected: expected,
    source: laneSource,
    checks: laneChecks,
    gate: z.boolean().default(true),
  })
  .strict();

export const canaryTask = runtimeTask.extend({ kind: z.literal('canary') });

export const suiteTask = z.discriminatedUnion('kind', [
  runtimeTask,
  laneTask,
  journeyTask,
  canaryTask,
]);
export type SuiteTask = z.infer<typeof suiteTask>;
export type RuntimeTask = z.infer<typeof runtimeTask>;
export type LaneTask = z.infer<typeof laneTask>;
export type JourneyTask = z.infer<typeof journeyTask>;

export const turnRecord = z
  .object({
    caseId: z.string(),
    kind: z.enum(['runtime', 'canary', 'lane', 'journey']),
    incomplete: z.string().optional(),
    stepStatus: z.string().optional(),
    decision: z.enum(['route', 'ask', 'answer', 'mixed', 'failed']).optional(),
    todos: z.array(z.object({ project: z.string(), title: z.string() })).optional(),
    asked: z.boolean().optional(),
    askCandidates: z.array(z.string()).optional(),
    toolCalls: z.array(z.object({ name: z.string(), argsValid: z.boolean() })).optional(),
    text: z.string().optional(),
    boundModels: z.array(z.string()).optional(),
    promptSystem: z.array(z.string()).optional(),
    promptSha256: z.string().optional(),
    durationMs: z.number().optional(),
    diagnostics: z.string().optional(),
    lane: z
      .object({
        exitCode: z.number(),
        changedFiles: z.array(z.string()),
        fileChecks: z.array(z.object({ path: z.string(), ok: z.boolean() })),
        commandChecks: z.array(z.object({ command: z.string(), ok: z.boolean() })),
        costUsd: z.number().optional(),
      })
      .optional(),
    journey: z
      .object({
        routed: z.boolean(),
        todoId: z.string().nullable(),
        todoTitle: z.string().nullable(),
        buildId: z.string().nullable(),
        stepId: z.string().nullable(),
        claimed: z.boolean(),
        claimedMachine: z.string().nullable(),
        delivered: z.boolean(),
        acceptanceBlocked: z.boolean(),
        changedFiles: z.array(z.string()),
        fileChecks: z.array(z.object({ path: z.string(), ok: z.boolean() })),
        commandChecks: z.array(z.object({ command: z.string(), ok: z.boolean() })),
      })
      .optional(),
  })
  .strict();
export type TurnRecord = z.infer<typeof turnRecord>;
export type JourneyRecord = NonNullable<TurnRecord['journey']>;

export interface CheckResult {
  name: string;
  value: 0 | 1;
  comment?: string;
  gate: boolean;
}
