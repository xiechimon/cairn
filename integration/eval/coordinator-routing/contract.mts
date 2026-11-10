import { askUserQuestionSchema } from '@cairn/shared';
import { z } from 'zod';

export const replayInput = z
  .object({
    request: z.string().min(1),
    projects: z.array(
      z.object({ name: z.string().min(1), description: z.string().nullable() }).strict(),
    ),
    chip: z.string().optional(),
  })
  .strict()
  .refine(
    (v) => new Set(v.projects.map((p) => p.name)).size === v.projects.length,
    'Duplicate project names',
  );
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
  const observed = turnObservations.parse(raw);
  const allowed = new Set(['projects', 'todos', 'create_todo', 'open_thread', 'ask_user']);
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
