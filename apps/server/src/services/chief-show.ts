import {
  type ChatBlockResult,
  chartTableMarkdown,
  chatChartSchema,
  diffGlanceMarkdown,
  glanceFocusSchema,
  glanceOf,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { readBuildChanges } from './git.js';

const showDiffParamsSchema = z.object({
  todoId: z.string().min(1),
  focus: z.array(glanceFocusSchema).optional(),
});

const problemOf = (error: z.ZodError) =>
  error.issues.map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`).join('; ');

export async function showDiff(
  deps: { db: Db; reposDir: string },
  teamId: string,
  params: Record<string, unknown>,
): Promise<string> {
  const parsed = showDiffParamsSchema.safeParse(params);
  if (!parsed.success) throw new HttpError(400, `show_diff rejected: ${problemOf(parsed.error)}`);
  const row = deps.db
    .select({ latestBuildId: todo.latestBuildId })
    .from(todo)
    .where(and(eq(todo.id, parsed.data.todoId), eq(todo.teamId, teamId)))
    .get();
  if (row === undefined) throw new HttpError(404, `todo ${parsed.data.todoId}`);
  if (row.latestBuildId === null)
    throw new HttpError(409, `show_diff rejected: todo ${parsed.data.todoId} has no build yet`);
  const { files } = await readBuildChanges(deps, row.latestBuildId);
  const picked = glanceOf(files, parsed.data.focus ?? []);
  if (picked === null)
    throw new HttpError(
      409,
      `show_diff rejected: the build of ${parsed.data.todoId} changed no file`,
    );
  const glance = { ...picked, todoId: parsed.data.todoId };
  return JSON.stringify({
    block: 'diff',
    glance,
    fallbackMarkdown: diffGlanceMarkdown(glance),
  } satisfies ChatBlockResult);
}

export function showChart(params: Record<string, unknown>): string {
  const parsed = chatChartSchema.safeParse(params);
  if (!parsed.success) throw new HttpError(400, `show_chart rejected: ${problemOf(parsed.error)}`);
  return JSON.stringify({
    block: 'chart',
    chart: parsed.data,
    fallbackMarkdown: chartTableMarkdown(parsed.data),
  } satisfies ChatBlockResult);
}
