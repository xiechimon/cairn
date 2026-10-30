import { chiefMessage, todo as todoTable } from '../../../apps/server/src/db/schema.js';
import { api } from '../../test/helpers.js';
import type { SeededWorld, Stack } from '../chief-dispatch/stack.mts';
import type { PlanTodoRow, PlanTodoSeed } from './grade.mts';

export async function seedPriorPlan(
  stack: Stack,
  world: Pick<SeededWorld, 'projectId'>,
  priorPlan: PlanTodoSeed[],
): Promise<PlanTodoRow[]> {
  const out: PlanTodoRow[] = [];
  for (const seed of priorPlan) {
    const res = await api(stack.server.url, 'POST', `/api/projects/${world.projectId}/todos`, {
      title: seed.title,
      spec: seed.spec,
    });
    if (res.status !== 201)
      throw new Error(`seed prior plan failed: ${res.status} ${JSON.stringify(res.body)}`);
    const body = res.body as { id: string; title: string; spec?: string | null };
    out.push({ id: body.id, title: body.title, spec: body.spec ?? '' });
  }
  return out;
}

export function readFinalTodos(stack: Stack): PlanTodoRow[] {
  return stack.server.db
    .select()
    .from(todoTable)
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      spec: row.spec ?? '',
    }));
}

export function feedbackPresentInDb(stack: Stack, feedback: string): boolean {
  const needle = feedback.trim().toLowerCase();
  if (needle === '') return false;
  const rows = stack.server.db.select().from(chiefMessage).all();
  for (const row of rows) {
    const content = row.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((part) =>
                part && typeof part === 'object' && 'text' in part
                  ? String((part as { text: unknown }).text)
                  : typeof part === 'string'
                    ? part
                    : '',
              )
              .join('\n')
          : JSON.stringify(content);
    if (text.toLowerCase().includes(needle)) return true;
  }
  return false;
}
