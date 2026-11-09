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
