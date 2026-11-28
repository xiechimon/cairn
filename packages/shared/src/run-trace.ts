import { z } from 'zod';

const at = z.number().int();

export const runUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});
export type RunUsage = z.infer<typeof runUsageSchema>;

export const modelCallRowSchema = z.object({
  kind: z.literal('modelCall'),
  model: z.string().nullable(),
  usage: runUsageSchema.nullable(),
  startedAt: at.nullable(),
  endedAt: at.nullable(),
});

export const runTraceItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string(), at, text: z.string() }),
  z.object({ kind: z.literal('wake'), id: z.string(), at, reason: z.string() }),
  z.object({ kind: z.literal('prompt'), id: z.string(), at, text: z.string() }),
  z.object({ kind: z.literal('thinking'), id: z.string(), at, text: z.string() }),
  z.object({ kind: z.literal('reply'), id: z.string(), at, text: z.string() }),
  modelCallRowSchema.omit({ kind: true }).extend({ kind: z.literal('model'), id: z.string(), at }),
  z.object({
    kind: z.literal('tool'),
    id: z.string(),
    at,
    name: z.string(),
    parentId: z.string().optional(),
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
  failure: z.object({ text: z.string(), itemId: z.string().nullable() }).nullable(),
  items: z.array(runTraceItemSchema),
});

export const RUN_TRACE_VALUE_CAP = 4_000;
export type RunTrace = z.infer<typeof runTraceSchema>;

export const RUN_STATUSES = ['running', 'done', 'failed', 'stopped', 'quota'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_PROBLEM_STATUSES: readonly RunStatus[] = ['failed', 'stopped', 'quota'];

export const runListRowSchema = z.object({
  id: z.string(),
  kind: z.enum(['coordinator', 'task']),
  threadId: z.string().nullable(),
  at,
  status: z.enum(RUN_STATUSES),
  firstLine: z.string(),
  woke: z.boolean(),
  source: z.string().nullable(),
  toolCount: z.number().int(),
  durationMs: z.number().int().nullable(),
});
export type RunListRow = z.infer<typeof runListRowSchema>;

export const runListPageSchema = z.object({
  runs: z.array(runListRowSchema),
  nextCursor: z.string().nullable(),
  problemCounts: z.array(z.object({ threadId: z.string(), count: z.number().int() })).optional(),
});
export type RunListPage = z.infer<typeof runListPageSchema>;

export const RUN_LIST_PAGE_SIZE = 20;

export const runListQuerySchema = z
  .object({
    thread: z.string().min(1).optional(),
    todo: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(RUN_LIST_PAGE_SIZE),
    before: z.string().min(1).optional(),
    problems: z.enum(['0', '1']).default('0'),
    includeCounts: z.enum(['0', '1']).default('0'),
  })
  .refine((query) => !(query.thread && query.todo), { message: 'thread and todo are exclusive' });
