import { z } from 'zod';

const at = z.number().int();

export const runTraceItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string(), at, text: z.string() }),
  z.object({ kind: z.literal('prompt'), id: z.string(), at, text: z.string() }),
  z.object({ kind: z.literal('thinking'), id: z.string(), at, text: z.string() }),
  z.object({ kind: z.literal('reply'), id: z.string(), at, text: z.string() }),
  z.object({
    kind: z.literal('tool'),
    id: z.string(),
    at,
    name: z.string(),
    arguments: z.unknown(),
    result: z.unknown(),
    isError: z.boolean(),
    endedAt: at.nullable(),
    truncated: z.boolean(),
  }),
  z.object({ kind: z.literal('error'), id: z.string(), at, text: z.string() }),
  z.object({ kind: z.literal('stopped'), id: z.string(), at }),
  z.object({ kind: z.literal('note'), id: z.string(), at, text: z.string() }),
  z.object({
    kind: z.literal('step'),
    id: z.string(),
    at,
    stepKind: z.string(),
    status: z.string(),
  }),
]);
export type RunTraceItem = z.infer<typeof runTraceItemSchema>;

export const runUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});
export type RunUsage = z.infer<typeof runUsageSchema>;

export const runTraceSchema = z.object({
  kind: z.enum(['coordinator', 'task']),
  id: z.string(),
  title: z.string(),
  threadId: z.string().nullable(),
  todoId: z.string().nullable(),
  status: z.string(),
  startedAt: at,
  finishedAt: at.nullable(),
  models: z.array(z.string()),
  usage: runUsageSchema,
  previousId: z.string().nullable(),
  nextId: z.string().nullable(),
  failure: z.object({ text: z.string(), itemId: z.string().nullable() }).nullable(),
  items: z.array(runTraceItemSchema),
});

export const RUN_TRACE_VALUE_CAP = 4_000;
export type RunTrace = z.infer<typeof runTraceSchema>;

export const RUN_TURN_PROBLEMS = ['failed', 'stopped', 'quota'] as const;
export type RunTurnProblem = (typeof RUN_TURN_PROBLEMS)[number];

export const runTurnRowSchema = z.object({
  stepId: z.string(),
  at,
  problem: z.enum(RUN_TURN_PROBLEMS).nullable(),
  firstLine: z.string(),
  woke: z.boolean(),
  toolCount: z.number().int(),
  durationMs: z.number().int().nullable(),
});
export type RunTurnRow = z.infer<typeof runTurnRowSchema>;

export const runTurnPageSchema = z.object({
  turns: z.array(runTurnRowSchema),
  nextCursor: z.string().nullable(),
});
export type RunTurnPage = z.infer<typeof runTurnPageSchema>;

export const RUN_TURN_PAGE_SIZE = 20;

export const runTurnsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(RUN_TURN_PAGE_SIZE),
  before: z.string().min(1).optional(),
  problems: z.enum(['0', '1']).default('0'),
});
