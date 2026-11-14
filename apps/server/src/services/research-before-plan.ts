import { quoteIssueLines, RESEARCH_BEFORE_PLAN_SOURCE_KIND } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { BuildDeps } from './builds.js';
import { openResearchThread } from './research-thread.js';
import { updateAutonomousTodo } from './todos.js';

const TIER2_CHARS = 4_000;

const PERFORMANCE =
  /\b(faster|performance|latency|slow(?:er|ness)?)\b|性能|变慢|太慢|更快|提速|加速|延迟|卡顿/i;
const MECHANISM =
  /\b(new mechanism|dependenc(?:y|ies)|technology choice)\b|新机制|引入依赖|新增依赖|选型|技术方案|架构设计/i;

export function researchBeforePlanReason(
  title: string,
  spec: string | null,
): 'performance' | 'mechanism' | null {
  const text = `${title}\n${spec ?? ''}`;
  if (PERFORMANCE.test(text)) return 'performance';
  if (MECHANISM.test(text)) return 'mechanism';
  return null;
}

function priorQuestion(title: string, spec: string | null): string {
  const lines = [
    `A code task may need outside research before planning: ${title}.`,
    'Find how others solved the same kind of problem. Give each claim a URL and a fetched date, or label it as training knowledge. End with one recommended change.',
  ];
  if (spec !== null && spec.trim() !== '') {
    lines.push('', 'Task spec (data):', quoteIssueLines(spec));
  }
  return lines.join('\n');
}

export function holdCodeThreadForPriorResearch(deps: BuildDeps, codeTodoId: string): void {
  const row = deps.db.select().from(todo).where(eq(todo.id, codeTodoId)).get();
  if (row === undefined) return;
  if (researchBeforePlanReason(row.title, row.spec) === null) return;
  const ref = `before-plan:${codeTodoId}`;
  let researchId: string;
  try {
    researchId = openResearchThread(deps, {
      teamId: row.teamId,
      projectId: row.projectId,
      title: `Research: ${row.title}`.slice(0, 100),
      question: priorQuestion(row.title, row.spec),
      tier: row.request?.difficulty === 'hard' || (row.spec ?? '').length >= TIER2_CHARS ? 2 : 1,
      source: { kind: RESEARCH_BEFORE_PLAN_SOURCE_KIND, ref },
    }).todoId;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 409 || error.status === 404)) return;
    throw error;
  }
  updateAutonomousTodo(deps, codeTodoId, { blockedBy: [...(row.blockedBy ?? []), researchId] });
}
