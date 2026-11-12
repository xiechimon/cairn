import { ASK_USER_QUESTION_KIND, isBuildStepKind } from '@cairn/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { type build, message, type step, type todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { writeWorkerQuestion } from './worker-question-store.js';

type BuildRow = typeof build.$inferSelect;

const UNDELIVERED_EXCERPT_MAX = 1_200;

type Undelivered = 'no-commits' | 'no-pr';

export function undeliveredEnd(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  buildRow: BuildRow,
  outcome: { hasChanges?: boolean; workBranchDrift?: unknown },
): Undelivered | null {
  if (!isBuildStepKind(stepRow.kind) || todoRow.output === 'info') return null;
  if (outcome.workBranchDrift !== undefined) return null;
  if (outcome.hasChanges === false) return 'no-commits';
  const githubProject = githubRepoOfProject(projectOfTodo(deps.db, todoRow)) !== null;
  return githubProject && buildRow.prNumber === null ? 'no-pr' : null;
}

function spokenText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block: unknown) => {
      if (block === null || typeof block !== 'object') return [];
      const { type, text } = block as { type?: unknown; text?: unknown };
      return type === 'text' && typeof text === 'string' ? [text] : [];
    })
    .join('\n');
}

function lastAgentMessage(deps: BuildDeps, buildId: string): string | null {
  const rows = deps.db
    .select({ content: message.content })
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'assistant')))
    .orderBy(desc(message.createdAt))
    .all();
  for (const row of rows) {
    const text = spokenText(row.content).trim();
    if (text !== '') return text;
  }
  return null;
}

function excerptOf(text: string | null, missing: string): string {
  if (text === null || text.trim() === '') return missing;
  return text.length > UNDELIVERED_EXCERPT_MAX
    ? `${text.slice(0, UNDELIVERED_EXCERPT_MAX - 1)}…`
    : text;
}

const UNDELIVERED_SUMMARY: Record<Undelivered, string> = {
  'no-commits': 'The step ended without committing anything.',
  'no-pr': 'The step ended without opening a pull request.',
};

export function askUndeliveredOnce(deps: BuildDeps, buildRow: BuildRow, kind: Undelivered): void {
  const asked = deps.db
    .select({ id: message.id })
    .from(message)
    .where(inArray(message.id, [`no-deliverable-${buildRow.id}`, `no-change-${buildRow.id}`]))
    .get();
  if (asked !== undefined) return;
  const reportLine = excerptOf(buildRow.reportLine, '(no report line)');
  const last = excerptOf(lastAgentMessage(deps, buildRow.id), '(the agent left no message)');
  const requestId = `no-deliverable-${buildRow.id}`;
  writeWorkerQuestion(
    deps,
    buildRow.id,
    requestId,
    {
      kind: ASK_USER_QUESTION_KIND,
      requestId,
      status: 'pending',
      questions: [
        {
          header: 'Not delivered',
          question: `Report line: ${reportLine}\n${UNDELIVERED_SUMMARY[kind]} The agent's last message:\n${last}\nAnswer with what is missing and who supplies it, or say what the task should deliver instead.`,
          options: [],
        },
      ],
      answers: null,
    },
    nowMs(),
  );
}
