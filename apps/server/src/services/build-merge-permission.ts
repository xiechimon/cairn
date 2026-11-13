import type { BuildMergePermission } from '@cairn/shared';
import { AGENT_TOOL_MERGE, AGENT_TOOL_PUSH } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { type BuildDeps, NotFoundError } from './builds.js';
import { policyForStep } from './routing-rules.js';

type TodoRow = typeof todo.$inferSelect;

export function buildMergePermission(deps: BuildDeps, buildId: string): BuildMergePermission {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${buildRow.todoId}`);
  const missingTools = missingMergeTools(deps, todoRow);
  return { permitted: missingTools.length === 0, missingTools, prUrl: buildRow.prUrl };
}

function missingMergeTools(deps: BuildDeps, todoRow: TodoRow): string[] {
  const policy = policyForStep(deps.db, todoRow, 'session');
  if (policy === null || policy.seededFromAgentId === null) return [];
  return [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter((tool) => !policy.tools.includes(tool));
}

export function assertMergeTools(deps: BuildDeps, todoRow: TodoRow): void {
  const missingTools = missingMergeTools(deps, todoRow);
  if (missingTools.length > 0) {
    throw new HttpError(
      403,
      `The session work policy lacks 「${missingTools.join('」「')}」, so it cannot start a merge (routing settings, work policies)`,
    );
  }
}
