import { z } from 'zod';

export const scriptStep = z
  .object({
    text: z.string().optional(),
    toolCalls: z
      .array(z.object({ name: z.string(), args: z.record(z.string(), z.unknown()) }))
      .optional(),
  })
  .refine((s) => s.text !== undefined || (s.toolCalls?.length ?? 0) > 0);

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
const safeRelPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'));

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

export const laneTask = z
  .object({
    kind: z.literal('lane'),
    id: taskId,
    instruction: z.string().min(1),
    timeoutMs: z.number().int().min(10_000).default(600_000),
    checks: z
      .object({
        files: z
          .array(z.object({ path: safeRelPath, contains: z.string().optional() }))
          .default([]),
        commands: z.array(z.string()).default([]),
        allowPaths: z.array(z.string()).optional(),
      })
      .strict(),
    gate: z.boolean().default(true),
  })
  .strict();

export const canaryTask = runtimeTask.extend({ kind: z.literal('canary') });

export const suiteTask = z.discriminatedUnion('kind', [runtimeTask, laneTask, canaryTask]);
export type SuiteTask = z.infer<typeof suiteTask>;
export type RuntimeTask = z.infer<typeof runtimeTask>;
export type LaneTask = z.infer<typeof laneTask>;

export const turnRecord = z
  .object({
    caseId: z.string(),
    kind: z.enum(['runtime', 'canary', 'lane']),
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
  })
  .strict();
export type TurnRecord = z.infer<typeof turnRecord>;

export interface CheckResult {
  name: string;
  value: 0 | 1;
  comment?: string;
  gate: boolean;
}
