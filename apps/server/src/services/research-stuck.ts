import {
  type InfoReportMessage,
  infoReportMessageSchema,
  quoteIssueLines,
  RESEARCH_DATA_NOTE,
  RESEARCH_REPORT_KIND,
  RESEARCH_REQUESTED_KIND,
  RESEARCH_STUCK_SOURCE_KIND,
  type ResearchReportMessage,
  type ResearchRequestedMessage,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { build, message, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { type OpenedResearchThread, openResearchThread } from './research-thread.js';
import { researchRoundOf, retryLessonsOf } from './retry-lessons.js';
import { insertMessageRow } from './transcript.js';

const TITLE_MAX = 100;

export interface StuckResearch extends OpenedResearchThread {
  round: number;
}

export function stuckResearchSourceRef(buildId: string, round: number): string {
  return `${buildId}:${round}`;
}

function appendOnce(
  deps: BuildDeps,
  buildId: string,
  id: string,
  content: ResearchRequestedMessage | ResearchReportMessage,
): boolean {
  if (
    deps.db.select({ id: message.id }).from(message).where(eq(message.id, id)).get() !== undefined
  ) {
    return false;
  }
  insertMessageRow(deps, buildId, {
    id,
    role: 'system',
    content: JSON.stringify(content),
    createdAt: nowMs(),
  });
  return true;
}

function stuckQuestion(title: string, failureContext: string | null): string {
  const lines = [
    `一个代码任务「${title}」在自动重试中反复失败。请调研别人遇到同类问题时是怎么解决的：先找出失败的根因类别，再找已有的修复做法、官方文档、issue 讨论或可复用的方案，最后给出针对这个失败的一条建议改动。`,
  ];
  if (failureContext !== null) {
    lines.push('', RESEARCH_DATA_NOTE, quoteIssueLines(failureContext));
  }
  return lines.join('\n');
}

export function openStuckResearch(deps: BuildDeps, buildId: string): StuckResearch {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const todoRow =
    buildRow === undefined
      ? undefined
      : deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow === undefined) throw new HttpError(404, `build ${buildId}`);
  const round = researchRoundOf(deps.db, buildId);
  const opened = openResearchThread(deps, {
    teamId: todoRow.teamId,
    projectId: todoRow.projectId,
    title: `Research: ${todoRow.title}`.slice(0, TITLE_MAX),
    question: stuckQuestion(todoRow.title, retryLessonsOf(deps.db, buildId)),
    tier: 1,
    source: { kind: RESEARCH_STUCK_SOURCE_KIND, ref: stuckResearchSourceRef(buildId, round) },
  });
  appendOnce(deps, buildId, `${RESEARCH_REQUESTED_KIND}-${buildId}-${round}`, {
    kind: RESEARCH_REQUESTED_KIND,
    todoId: opened.todoId,
    round,
  });
  return { ...opened, round };
}

export function deliverStuckResearch(deps: BuildDeps, researchTodoId: string): boolean {
  const researchTodo = deps.db.select().from(todo).where(eq(todo.id, researchTodoId)).get();
  if (
    researchTodo?.sourceKind !== RESEARCH_STUCK_SOURCE_KIND ||
    researchTodo.sourceRef === null ||
    researchTodo.latestBuildId === null
  ) {
    return false;
  }
  const split = researchTodo.sourceRef.lastIndexOf(':');
  const stuckBuildId = researchTodo.sourceRef.slice(0, split);
  const round = Number(researchTodo.sourceRef.slice(split + 1));
  if (split < 1 || !Number.isInteger(round)) return false;
  const row = deps.db
    .select({ content: message.content })
    .from(message)
    .where(eq(message.id, `info-report-${researchTodo.latestBuildId}`))
    .get();
  if (row === undefined || typeof row.content !== 'string') return false;
  let report: InfoReportMessage | undefined;
  try {
    const parsed = infoReportMessageSchema.safeParse(JSON.parse(row.content));
    report = parsed.success ? parsed.data : undefined;
  } catch {
    report = undefined;
  }
  if (report === undefined) return false;
  if (
    deps.db.select({ id: build.id }).from(build).where(eq(build.id, stuckBuildId)).get() ===
    undefined
  ) {
    return false;
  }
  return appendOnce(deps, stuckBuildId, `${RESEARCH_REPORT_KIND}-${stuckBuildId}-${round}`, {
    kind: RESEARCH_REPORT_KIND,
    attachmentId: report.attachmentId,
    todoId: researchTodoId,
    round,
  });
}
