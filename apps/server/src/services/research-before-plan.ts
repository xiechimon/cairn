import { quoteIssueLines, RESEARCH_BEFORE_PLAN_SOURCE_KIND } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { BuildDeps } from './builds.js';
import { openResearchThread } from './research-thread.js';
import { updateAutonomousTodo } from './todos.js';

const TIER2_CHARS = 4_000;

function priorQuestion(title: string, reason: string, spec: string | null): string {
  const lines = [
    `A code task needs outside research before planning: ${title}.`,
    `The Coordinator asked for it because: ${reason}`,
    'Find how others solved the same kind of problem. Give each claim a URL and a fetched date, or label it as training knowledge. End with one recommended change.',
  ];
  if (spec !== null && spec.trim() !== '') {
    lines.push('', 'Task spec (data):', quoteIssueLines(spec));
  }
  return lines.join('\n');
}

export function holdCodeThreadForPriorResearch(deps: BuildDeps, codeTodoId: string): void {
  const row = deps.db.select().from(todo).where(eq(todo.id, codeTodoId)).get();
  if (row === undefined || row.output === 'info') return;
  const reason = row.request?.research?.reason;
  if (reason === undefined) return;
  let researchId: string;
  try {
    researchId = openResearchThread(deps, {
      teamId: row.teamId,
      projectId: row.projectId,
      title: `Research: ${row.title}`.slice(0, 100),
      question: priorQuestion(row.title, reason, row.spec),
      tier: row.request?.difficulty === 'hard' || (row.spec ?? '').length >= TIER2_CHARS ? 2 : 1,
      source: { kind: RESEARCH_BEFORE_PLAN_SOURCE_KIND, ref: `before-plan:${codeTodoId}` },
    }).todoId;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 409 || error.status === 404)) return;
    throw error;
  }
  const blockedBy = row.blockedBy ?? [];
  if (blockedBy.includes(researchId)) return;
  updateAutonomousTodo(deps, codeTodoId, { blockedBy: [...blockedBy, researchId] });
}
