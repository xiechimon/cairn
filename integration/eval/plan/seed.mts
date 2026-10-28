import { eq } from 'drizzle-orm';
import { todo as todoTable } from '../../../apps/server/src/db/schema.js';
import { api } from '../../../integration/test/helpers.js';
import type { Stack } from '../chief-dispatch/stack.mts';
import type { PlanRowSeed, PlanTodoRow } from './grade.mts';

export async function seedPriorPlan(
  stack: Stack,
  projectId: string,
  rows: PlanRowSeed[],
): Promise<PlanTodoRow[]> {
  const seeded: PlanTodoRow[] = [];
  for (const row of rows) {
    const res = await api(stack.server.url, 'POST', `/api/projects/${projectId}/todos`, {
      title: row.title,
      spec: row.spec,
    });
    if (res.status !== 201)
      throw new Error(`seed prior plan failed: ${res.status} ${JSON.stringify(res.body)}`);
    const id = (res.body as { id: string }).id;
    seeded.push({ id, title: row.title, spec: row.spec });
  }
  return seeded;
}

export function readPlanTodos(stack: Stack, projectId: string): PlanTodoRow[] {
  return stack.server.db
    .select()
    .from(todoTable)
    .where(eq(todoTable.projectId, projectId))
    .all()
    .filter((row) => row.phase !== 'closed')
    .map((row) => ({
      id: row.id,
      title: row.title,
      spec: row.spec ?? '',
    }));
}
