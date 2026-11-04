import {
  infoReportMessageSchema,
  quoteIssueLines,
  RESEARCH_BEFORE_PLAN_SOURCE_KIND,
} from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { build, message, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { openResearchThread } from './research-thread.js';

export const RESEARCH_BEFORE_PLAN_HOLD = 'research-before-plan';
const HOLD_MS = 100 * 365 * 24 * 60 * 60 * 1000;
const TIER2_CHARS = 4_000;
const TERMINAL = new Set(['done', 'failed', 'closed']);

const PERFORMANCE = /\b(faster|performance|latency|slow(?:er|ness)?)\b/i;
const MECHANISM = /\b(new mechanism|dependenc(?:y|ies)|technology choice)\b/i;

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

export function holdCodeThreadForPriorResearch(
  deps: BuildDeps,
  codeTodoId: string,
  buildId: string,
): void {
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
      tier: (row.spec ?? '').length >= TIER2_CHARS ? 2 : 1,
      source: { kind: RESEARCH_BEFORE_PLAN_SOURCE_KIND, ref },
    }).todoId;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 409 || error.status === 404)) return;
    throw error;
  }
  const blocked = new Set(row.blockedBy ?? []);
  blocked.add(researchId);
  deps.db
    .update(todo)
    .set({ blockedBy: [...blocked] })
    .where(eq(todo.id, codeTodoId))
    .run();
  const pending = deps.db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.status, 'pending'),
        inArray(step.kind, ['plan', 'session']),
      ),
    )
    .all()
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (pending === undefined) return;
  deps.db
    .update(step)
    .set({
      holdReason: RESEARCH_BEFORE_PLAN_HOLD,
      holdUntil: nowMs() + HOLD_MS,
    })
    .where(eq(step.id, pending.id))
    .run();
}

function researchSettled(deps: BuildDeps, blocker: typeof todo.$inferSelect): boolean {
  if (TERMINAL.has(blocker.phase)) return true;
  return blocker.phase === 'review' && reportLesson(deps, blocker.id) !== null;
}

function reportLesson(deps: BuildDeps, researchTodoId: string): string | null {
  const research = deps.db.select().from(todo).where(eq(todo.id, researchTodoId)).get();
  if (research?.latestBuildId == null) return null;
  const buildRow = deps.db.select().from(build).where(eq(build.id, research.latestBuildId)).get();
  const row = deps.db
    .select({ content: message.content })
    .from(message)
    .where(eq(message.id, `info-report-${research.latestBuildId}`))
    .get();
  if (typeof row?.content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.content);
  } catch {
    return null;
  }
  const report = infoReportMessageSchema.safeParse(parsed);
  if (!report.success || report.data.attachmentId !== buildRow?.reportAttachmentId) return null;
  return `Prior research (data):\n${quoteIssueLines(report.data.content)}`;
}

export function releaseResearchBeforePlanHolds(deps: BuildDeps): void {
  const held = deps.db
    .select()
    .from(step)
    .where(eq(step.holdReason, RESEARCH_BEFORE_PLAN_HOLD))
    .all();
  for (const row of held) {
    const code = deps.db.select().from(todo).where(eq(todo.latestBuildId, row.buildId)).get();
    const ids = code?.blockedBy ?? [];
    const research =
      ids.length === 0
        ? []
        : deps.db
            .select()
            .from(todo)
            .where(inArray(todo.id, ids))
            .all()
            .filter((blocker) => blocker.sourceKind === RESEARCH_BEFORE_PLAN_SOURCE_KIND);
    if (research.length > 0 && research.some((blocker) => !researchSettled(deps, blocker)))
      continue;
    const lesson = research
      .map((blocker) => reportLesson(deps, blocker.id))
      .filter((text): text is string => text !== null)
      .join('\n\n');
    const prompt =
      lesson !== '' && !(row.prompt ?? '').includes(lesson)
        ? `${row.prompt ?? ''}\n\n${lesson}`
        : row.prompt;
    deps.db
      .update(step)
      .set({ holdReason: null, holdUntil: null, prompt })
      .where(eq(step.id, row.id))
      .run();
  }
}
