import {
  buildPlanFirstRoundInstruction,
  buildPlanRewritePrompt,
  buildTaskPromptText,
  CONTINUE_PROMPTS,
  LEGACY_PLAN_PROMPTS,
  MERGED_PR_GUARD_PROMPT_SHAPE,
  PLAN_CONTRACT_REWRITE_PROMPT_SHAPES,
  parseReviewPromptMeta,
  REPLAN_PROMPT_SHAPE,
  RESTART_PROMPT_SHAPE,
  RETRY_LESSONS_SHAPE,
  REVIEW_REJECT_PROMPT_SHAPE,
  SESSION_BRIEF,
  SESSION_REWORK_BRIEF,
  type TaskSource,
  type TranscriptUserOrigin,
  transcriptPromptRowId,
  wrappedBy,
} from '@cairn/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, message, step, todo } from '../db/schema.js';

const UPDATE_CHUNK = 400;

const EXACT_SYNTHETIC_TEXTS: ReadonlySet<string> = new Set([
  ...Object.values(CONTINUE_PROMPTS).filter((text) => text !== ''),
  buildPlanRewritePrompt(),
  buildPlanFirstRoundInstruction(),
  ...LEGACY_PLAN_PROMPTS,
]);

function isGeneratedInstruction(text: string): boolean {
  return (
    EXACT_SYNTHETIC_TEXTS.has(text) ||
    text === SESSION_BRIEF ||
    text.startsWith(`${SESSION_BRIEF}\n\n`) ||
    text.startsWith(SESSION_REWORK_BRIEF) ||
    wrappedBy(text, REPLAN_PROMPT_SHAPE.head, REPLAN_PROMPT_SHAPE.tail) ||
    wrappedBy(text, REVIEW_REJECT_PROMPT_SHAPE.head, REVIEW_REJECT_PROMPT_SHAPE.tail) ||
    wrappedBy(text, RESTART_PROMPT_SHAPE.head, RESTART_PROMPT_SHAPE.tail) ||
    wrappedBy(text, MERGED_PR_GUARD_PROMPT_SHAPE.head, MERGED_PR_GUARD_PROMPT_SHAPE.tail) ||
    PLAN_CONTRACT_REWRITE_PROMPT_SHAPES.some((shape) => wrappedBy(text, shape.head, shape.tail)) ||
    wrappedBy(text, RETRY_LESSONS_SHAPE.head, RETRY_LESSONS_SHAPE.tail) ||
    parseReviewPromptMeta(text) !== null
  );
}

function userRowText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) => {
      if (block === null || typeof block !== 'object') return [];
      const { type, text } = block as { type?: unknown; text?: unknown };
      return type === 'text' && typeof text === 'string' ? [text] : [];
    })
    .join('\n')
    .trim();
}

function legacyOrigin(input: {
  text: string;
  taskTexts: readonly string[];
  promptRow: boolean;
}): TranscriptUserOrigin {
  if (input.promptRow) return 'task-prompt';
  for (const taskText of input.taskTexts) {
    if (input.text === taskText) return 'task-prompt';
    if (taskText !== '' && input.text.startsWith(`${taskText}\n`)) {
      return isGeneratedInstruction(input.text.slice(taskText.length).trim())
        ? 'synthetic'
        : 'task-prompt';
    }
  }
  const tailAt = input.text.lastIndexOf('\n\n');
  if (tailAt !== -1 && isGeneratedInstruction(input.text.slice(tailAt + 2).trim())) {
    return 'synthetic';
  }
  return isGeneratedInstruction(input.text) ? 'synthetic' : 'user';
}

function taskTextsOf(row: {
  title: string;
  spec: string;
  sourceKind: string | null;
  sourceRef: string | null;
  request: TaskSource['request'];
}): string[] {
  const source: TaskSource = {
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    request: row.request ?? null,
  };
  const raw = buildTaskPromptText(row.title, row.spec).trim();
  const delivered = buildTaskPromptText(row.title, row.spec, source).trim();
  return delivered === raw ? [raw] : [delivered, raw];
}

/**
 * Stamps `origin` on user transcript rows written before the server recorded it, from the shapes
 * that wrote them; the caller runs it once per database.
 */
export function backfillTranscriptOrigins(db: Db): Record<TranscriptUserOrigin, number> {
  const rows = db
    .select({
      id: message.id,
      conversationId: message.conversationId,
      content: message.content,
      title: todo.title,
      spec: todo.spec,
      sourceKind: todo.sourceKind,
      sourceRef: todo.sourceRef,
      request: todo.request,
    })
    .from(message)
    .innerJoin(build, eq(build.id, message.conversationId))
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(and(eq(message.role, 'user'), isNull(message.origin)))
    .all();
  const promptRowIds = new Set(
    db
      .select({ id: step.id, buildId: step.buildId })
      .from(step)
      .all()
      .map((row) => `${row.buildId}/${transcriptPromptRowId(row.id)}`),
  );
  const taskTextsByConversation = new Map<string, string[]>();
  const idsByOrigin = new Map<TranscriptUserOrigin, string[]>([
    ['task-prompt', []],
    ['synthetic', []],
    ['user', []],
  ]);
  for (const row of rows) {
    let taskTexts = taskTextsByConversation.get(row.conversationId);
    if (taskTexts === undefined) {
      taskTexts = taskTextsOf(row);
      taskTextsByConversation.set(row.conversationId, taskTexts);
    }
    const origin = legacyOrigin({
      text: userRowText(row.content),
      taskTexts,
      promptRow: promptRowIds.has(`${row.conversationId}/${row.id}`),
    });
    idsByOrigin.get(origin)?.push(row.id);
  }
  const counts: Record<TranscriptUserOrigin, number> = { 'task-prompt': 0, synthetic: 0, user: 0 };
  for (const [origin, ids] of idsByOrigin) {
    counts[origin] = ids.length;
    for (let at = 0; at < ids.length; at += UPDATE_CHUNK) {
      const chunk = ids.slice(at, at + UPDATE_CHUNK);
      if (chunk.length === 0) continue;
      db.update(message).set({ origin }).where(inArray(message.id, chunk)).run();
    }
  }
  return counts;
}
