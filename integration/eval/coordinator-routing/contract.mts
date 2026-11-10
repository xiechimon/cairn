import {
  askUserQuestionSchema,
  buildRecordSchema,
  buildStopSchema,
  projectRepoKindSchema,
  taskRequestSchema,
  taskSegmentSchema,
  taskSegmentSourceSchema,
  todoOutputSchema,
  todoRecordSchema,
} from '@cairn/shared';
import { z } from 'zod';

export const replayTodo = todoRecordSchema
  .pick({
    id: true,
    projectId: true,
    title: true,
    spec: true,
    phase: true,
    phaseAt: true,
    archivedAt: true,
    seqNum: true,
    orderIndex: true,
    blockedBy: true,
    latestBuildId: true,
    sourceKind: true,
    sourceRef: true,
    request: true,
    output: true,
  })
  .required()
  .extend({
    output: todoOutputSchema,
    request: taskRequestSchema
      .extend({
        segments: z
          .array(
            taskSegmentSchema
              .extend({
                source: z.discriminatedUnion('kind', [
                  taskSegmentSourceSchema.options[0].strict(),
                  taskSegmentSourceSchema.options[1].strict(),
                  taskSegmentSourceSchema.options[2].strict(),
                  taskSegmentSourceSchema.options[3].strict(),
                ]),
              })
              .strict(),
          )
          .min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const replayThread = buildRecordSchema
  .required()
  .extend({ stop: buildStopSchema.strict().nullable(), reportLine: z.string().nullable() })
  .strict();
export const replaySnapshot = z
  .object({
    source: z.enum(['trace', 'harvest-db']),
    sourceTraceId: z.string().min(1),
    capturedAt: z.number().int().nonnegative(),
    todos: z.array(replayTodo).max(10_000),
    threads: z.array(replayThread).max(10_000),
    visible: z
      .array(
        z
          .object({
            id: z.string().min(1),
            ownership: z
              .object({
                owner: z.enum(['owner', 'coordinator']),
                reason: z.enum(['question', 'failed', 'review', 'blocked', 'confirm', 'handoff']),
              })
              .strict()
              .nullable(),
            blocks: z.boolean(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();

export const replayInput = z
  .object({
    request: z.string().min(1),
    projects: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          description: z.string().nullable(),
          repoKind: projectRepoKindSchema.nullable(),
          archivedAt: z.number().int().nullable(),
        })
        .strict(),
    ),
    chip: z.string().optional(),
    snapshot: replaySnapshot,
  })
  .strict()
  .refine(
    (v) => new Set(v.projects.map((p) => p.name)).size === v.projects.length,
    'Duplicate project names',
  )
  .refine((v) => {
    const ids = v.projects.map((p) => p.id);
    const todos = v.snapshot.todos.map((t) => t.id);
    const threads = v.snapshot.threads.map((t) => t.id);
    return (
      (v.chip === undefined || v.projects.some((p) => p.name === v.chip)) &&
      new Set(ids).size === ids.length &&
      new Set(todos).size === todos.length &&
      new Set(threads).size === threads.length &&
      v.snapshot.visible.length === todos.length &&
      new Set(v.snapshot.visible.map((v) => v.id)).size === todos.length &&
      v.snapshot.visible.every((v) => todos.includes(v.id)) &&
      v.snapshot.todos.every(
        (t) =>
          ids.includes(t.projectId) &&
          (t.latestBuildId === null ||
            v.snapshot.threads.some((b) => b.id === t.latestBuildId && b.todoId === t.id)) &&
          (t.blockedBy ?? []).every((id) => id !== t.id && todos.includes(id)),
      ) &&
      v.snapshot.threads.every((b) => todos.includes(b.todoId))
    );
  }, 'Invalid snapshot references');
export type ReplayInput = z.infer<typeof replayInput>;
export function normalize(status: string, placed: readonly string[], asked: boolean, text: string) {
  if (placed.length && asked) throw new Error('Mixed routing effects');
  if (asked && ['done', 'claimed'].includes(status)) return 'ask';
  if (status !== 'done') throw new Error('Turn did not complete');
  if (placed.length) return 'route';
  if (text.trim()) return 'answer';
  throw new Error('Empty turn');
}

export const decisionOutput = z.object({
  decision: z.enum(['route', 'ask', 'answer']),
  parts: z.array(z.object({ project: z.string().min(1), title: z.string() })),
  questions: z.array(askUserQuestionSchema),
  askCandidates: z.array(z.string()),
  blockedBy: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])),
  stepStatus: z.string(),
  turnTraceId: z.string().regex(/^[a-f0-9]{32}$/),
  promptSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const turnObservations = z
  .object({
    protocol: z.literal('cairn.routing.observations.v1'),
    todos: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            project: z.string().min(1).max(200),
            title: z.string().max(20_000),
            blockedBy: z.array(z.string().min(1).max(200)).max(60),
          })
          .strict(),
      )
      .max(60),
    toolCalls: z.array(z.string().min(1).max(200)).max(1000),
    questions: z.array(askUserQuestionSchema).max(60),
    text: z.string().max(100_000),
    stepStatus: z.enum(['done', 'claimed', 'failed', 'cancelled']),
    turnTraceId: z.string().regex(/^[a-f0-9]{32}$/),
    promptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export function observeTurn(raw: unknown, input: ReplayInput) {
  replayInput.parse(input);
  const observed = turnObservations.parse(raw);
  const allowed = new Set(['projects', 'create_todo', 'ask_user']);
  if (observed.toolCalls.some((name) => !allowed.has(name)))
    throw new Error('Case used uncaptured state');
  const ids = observed.todos.map((t) => t.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate todo IDs');
  const blockedBy = observed.todos.flatMap((t, n) =>
    t.blockedBy.map((id): [number, number] => {
      const dependency = ids.indexOf(id);
      if (dependency < 0 || dependency === n) throw new Error('Invalid persisted dependency');
      return [n, dependency];
    }),
  );
  if (observed.todos.some((t) => !input.projects.some((p) => p.name === t.project)))
    throw new Error('Unknown observed project');
  return decisionOutput.parse({
    decision: normalize(observed.stepStatus, ids, observed.questions.length > 0, observed.text),
    parts: observed.todos.map(({ project, title }) => ({ project, title })),
    questions: observed.questions,
    askCandidates: [...new Set(observed.questions.flatMap((q) => q.options.map((o) => o.label)))],
    blockedBy,
    stepStatus: observed.stepStatus,
    turnTraceId: observed.turnTraceId,
    promptSha256: observed.promptSha256,
  });
}
