import {
  type AskUserQuestionContent,
  askUserQuestionContentSchema,
  MEMORY_CORRECTION_WORDS_MAX_CHARS,
  MEMORY_INDEX_TITLE,
  type MemoryCorrectionsResponse,
  memoryToolParamsSchemas,
  replyQuoteText,
  stripTurnContext,
} from '@cairn/shared';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agentMemory,
  chiefMessage,
  coordinatorInput,
  memoryCorrection,
  message,
  steerPending,
  step,
} from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { askQuestionContentOf } from './chief-question-store.js';
import { STEER_HOLDS } from './chief-turns.js';
import { ownerTextOf } from './coordinator-steps.js';
import { isDesignCommentRelay } from './design-comments.js';
import { boundMemoryIndex, memoryIndexText } from './memory.js';
import {
  currentMemoryDocument,
  executeMemoryDocumentTool,
  type MemoryDocumentOwner,
  memoryDocumentRows,
} from './memory-documents.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Row = typeof agentMemory.$inferSelect;
type StepRow = typeof step.$inferSelect;

const LISTED_MAX = 200;
const NOT_RECORDED = 'correction not recorded. The memory write itself was applied.';
export function hasCheckPointerText(text: string): boolean {
  const lastClose = text.lastIndexOf(')');
  if (lastClose < 0) return false;
  return /\(todo:[^)]/i.test(text.slice(0, lastClose));
}
const RECURRENCE_NEXT =
  'This rule was repeated. If a repository check (regression test, lint rule, or CI gate) can stop it, call ask_user offering to create a task to add that check (recommended) or keep it as advice — never install a check unasked. On accept, call create_todo citing both the correction message and the answered question card in messageIds, then update_memory on this rule to add one pointer to the task link. On decline, leave the rule unmarked. If no check can enforce it, state so plainly and keep it as advice.';

interface Entry {
  projectId: string | null;
  file: string;
  text: string;
}

function entryLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

const bare = (line: string) => line.replace(/^[-*]\s+/, '').trim();

function namedEntry(tx: Tx, owner: MemoryDocumentOwner, scope: string, repeats: string): Entry {
  const scopes = [...new Set([scope, 'team'])];
  for (const candidate of scopes) {
    const projectId = candidate === 'team' ? null : candidate;
    const index = currentMemoryDocument(tx, owner, candidate, MEMORY_INDEX_TITLE);
    const line = entryLines(memoryIndexText(index)).find((each) => bare(each) === bare(repeats));
    if (line !== undefined) return { projectId, file: MEMORY_INDEX_TITLE, text: line };
    const file = memoryDocumentRows(tx, owner, candidate).find(
      (row) => row.layer === 'searchable' && row.invalidAt === null && row.title === repeats,
    );
    if (file !== undefined) return { projectId, file: file.title, text: file.title };
  }
  throw new HttpError(
    400,
    'invalid params.repeats: copy a saved MEMORY.md line or a memory file name exactly; read it with memories first',
  );
}

interface Said {
  messageId: string;
  createdAt: number;
  insertedAt: number | null;
  content: unknown;
}

function saidWithoutMessageRow(turn: StepRow): Said[] {
  return turn.ownerSaid === null
    ? []
    : [
        {
          messageId: turn.id,
          createdAt: turn.createdAt,
          insertedAt: null,
          content: turn.ownerSaid,
        },
      ];
}

function saidInCoordinatorTurn(tx: Tx, turn: StepRow): Said[] {
  const ids = turn.ownerMessageIds ?? [];
  if (ids.length === 0) return saidWithoutMessageRow(turn);
  const rows = new Map(
    tx
      .select()
      .from(chiefMessage)
      .where(and(eq(chiefMessage.threadId, turn.buildId), inArray(chiefMessage.id, ids)))
      .all()
      .map((row) => [row.id, row]),
  );
  const sent = ids.flatMap((id) => {
    const row = rows.get(id);
    if (row === undefined) return [];
    const said = {
      messageId: row.id,
      createdAt: row.typedAt ?? row.createdAt,
      insertedAt: row.createdAt,
    };
    if (row.sentByAgent === true) return [];
    if (row.role === 'user')
      return isDesignCommentRelay(ownerTextOf(row.content))
        ? []
        : [{ ...said, content: row.content }];
    const answers = askQuestionContentOf(row.content)?.answers;
    if (!answers) return [];
    const content = answers.map((each) => each.text ?? each.choices?.join(', ') ?? '').join('\n');
    return [{ ...said, content }];
  });
  return [...saidWithoutMessageRow(turn), ...sent];
}

function lastDoneWorkerStepAt(tx: Tx, turn: StepRow): number | undefined {
  return (
    tx
      .select({ at: max(step.finishedAt) })
      .from(step)
      .where(
        and(
          eq(step.buildId, turn.buildId),
          eq(step.status, 'done'),
          ne(step.id, turn.id),
          lte(step.finishedAt, turn.createdAt),
        ),
      )
      .get()?.at ?? undefined
  );
}

function saidInTask(tx: Tx, turn: StepRow, answered: number | undefined): Said[] {
  const sent = tx
    .select({
      messageId: message.id,
      createdAt: sql<number>`coalesce(${message.typedAt}, ${message.createdAt})`,
      insertedAt: message.createdAt,
      content: message.content,
    })
    .from(message)
    .where(
      and(
        eq(message.conversationId, turn.buildId),
        eq(message.role, 'user'),
        eq(message.origin, 'user'),
        or(isNull(message.sentByAgent), eq(message.sentByAgent, false)),
        answered == null ? undefined : gt(message.createdAt, answered),
      ),
    )
    .orderBy(asc(message.createdAt), sql`rowid`)
    .all();
  const starter = answered == null ? threadStarter(tx, turn) : undefined;
  return [...(starter === undefined ? [] : saidWithoutMessageRow(starter)), ...sent];
}

function threadStarter(tx: Tx, turn: StepRow): StepRow | undefined {
  return tx
    .select()
    .from(step)
    .where(and(eq(step.buildId, turn.buildId), isNotNull(step.ownerSaid)))
    .get();
}

function textOf(content: unknown): string {
  return replyQuoteText(stripTurnContext(ownerTextOf(content))).trim();
}

function typedAnswerTexts(question: AskUserQuestionContent): string[] {
  if (question.status !== 'answered' || question.answeredBy === 'coordinator') return [];
  return (question.answers ?? []).flatMap((answer, index) => {
    if (answer.text !== undefined) {
      const text = answer.text.trim();
      return text === '' ? [] : [text];
    }
    const predefined = new Set(
      question.questions[index]?.options.map((option) => option.label) ?? [],
    );
    return (answer.choices ?? []).filter((choice) => !predefined.has(choice));
  });
}

function chiefTurnIsUnclear(tx: Tx, turn: StepRow, said: readonly Said[]): boolean {
  const ownerIds = [...new Set(turn.ownerMessageIds ?? [])];
  if (
    ownerIds.length > 0 &&
    tx
      .select({ id: chiefMessage.id })
      .from(chiefMessage)
      .where(
        and(
          eq(chiefMessage.threadId, turn.buildId),
          inArray(chiefMessage.id, ownerIds),
          isNotNull(chiefMessage.delivery),
        ),
      )
      .limit(1)
      .get() !== undefined
  ) {
    return true;
  }
  if (
    tx
      .select({ id: coordinatorInput.id })
      .from(coordinatorInput)
      .where(and(eq(coordinatorInput.stepId, turn.id), eq(coordinatorInput.kind, 'steer')))
      .limit(1)
      .get() !== undefined
  ) {
    return true;
  }
  if (
    tx
      .select({ conversationId: steerPending.conversationId })
      .from(steerPending)
      .where(and(eq(steerPending.conversationId, turn.buildId), eq(steerPending.stepId, turn.id)))
      .limit(1)
      .get() !== undefined
  ) {
    return true;
  }
  if (
    turn.status === 'claimed' &&
    tx
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, turn.buildId),
          eq(step.status, 'pending'),
          inArray(step.holdReason, STEER_HOLDS),
        ),
      )
      .limit(1)
      .get() !== undefined
  ) {
    return true;
  }
  const started = turn.claimedAt ?? turn.createdAt;
  const ownerIdSet = new Set(ownerIds);
  const turns = tx.select().from(step).where(eq(step.buildId, turn.buildId)).all();
  const rows = tx.select().from(chiefMessage).where(eq(chiefMessage.threadId, turn.buildId)).all();
  return rows.some((row) => {
    if (row.sentByAgent === true) return false;
    const question = askQuestionContentOf(row.content);
    if (question === null) return false;
    const typed = typedAnswerTexts(question);
    if (typed.length === 0) return false;
    if (ownerIdSet.has(row.id)) return true;
    const answeredAt = question.answeredAt;
    if (answeredAt === undefined) return false;
    const answeredDuringThisTurn =
      answeredAt >= started &&
      (turn.finishedAt === null || answeredAt <= turn.finishedAt) &&
      !turns.some(
        (other) => other.id !== turn.id && (other.ownerMessageIds ?? []).includes(row.id),
      );
    if (answeredDuringThisTurn) return true;
    return said.some(
      (each) =>
        each.insertedAt !== null &&
        answeredAt >= each.insertedAt &&
        answeredAt <= started &&
        typed.includes(textOf(each.content)),
    );
  });
}

function workerQuestionOf(content: unknown): AskUserQuestionContent | null {
  if (content === null || typeof content !== 'object') return null;
  const parsed = askUserQuestionContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
}

function workerTurnIsUnclear(tx: Tx, turn: StepRow, answered: number | undefined): boolean {
  const midTurnSteer = tx
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        eq(message.conversationId, turn.buildId),
        or(like(message.id, 'human-steer-%'), like(message.id, 'steer-%')),
        answered === undefined ? undefined : gt(message.createdAt, answered),
      ),
    )
    .limit(1)
    .get();
  if (midTurnSteer !== undefined) return true;
  if (
    tx
      .select({ conversationId: steerPending.conversationId })
      .from(steerPending)
      .where(and(eq(steerPending.conversationId, turn.buildId), eq(steerPending.stepId, turn.id)))
      .limit(1)
      .get() !== undefined
  ) {
    return true;
  }
  const turnStarted = turn.claimedAt ?? turn.createdAt;
  return tx
    .select({ createdAt: message.createdAt, content: message.content })
    .from(message)
    .where(eq(message.conversationId, turn.buildId))
    .all()
    .some((row) => {
      const question = workerQuestionOf(row.content);
      if (question === null || typedAnswerTexts(question).length === 0) return false;
      if (question.deliveredStepId === turn.id) return true;
      const answeredAt = question.answeredAt ?? row.createdAt;
      if (
        turn.promptOrigin?.kind === 'continue' &&
        (answered === undefined || answeredAt >= answered)
      )
        return true;
      if (answered === undefined ? true : answeredAt > answered) return true;
      return (
        question.answeredAt !== undefined &&
        question.answeredAt >= turnStarted &&
        row.createdAt >= turn.createdAt
      );
    });
}

interface UserWords {
  messageId: string;
  savedByThen: number;
  text: string;
}

function userWords(tx: Tx, turn: StepRow): UserWords | null {
  const chief = turn.kind === 'chief';
  const answered = chief ? undefined : lastDoneWorkerStepAt(tx, turn);
  const said = chief ? saidInCoordinatorTurn(tx, turn) : saidInTask(tx, turn, answered);
  const identity = said[0];
  if (identity === undefined) return null;
  if (chief ? chiefTurnIsUnclear(tx, turn, said) : workerTurnIsUnclear(tx, turn, answered))
    return null;
  const text = [...said]
    .reverse()
    .map((each) => textOf(each.content))
    .join('\n');
  return {
    messageId: identity.messageId,
    savedByThen: Math.min(...said.map((each) => each.createdAt), turn.claimedAt ?? turn.createdAt),
    text: text.slice(0, MEMORY_CORRECTION_WORDS_MAX_CHARS),
  };
}

function entryVersions(tx: Tx, owner: MemoryDocumentOwner, entry: Entry): Row[] {
  const rows = memoryDocumentRows(tx, owner, entry.projectId ?? 'team');
  if (entry.file === MEMORY_INDEX_TITLE)
    return rows.filter((row) => row.layer === 'core' && row.title === MEMORY_INDEX_TITLE);
  const files = rows.filter((row) => row.layer === 'searchable');
  const chain = new Map(
    files
      .filter((row) => row.title === entry.file && row.invalidAt === null)
      .map((row) => [row.id, row]),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of files) {
      if (!chain.has(row.id) && row.supersededBy !== null && chain.has(row.supersededBy)) {
        chain.set(row.id, row);
        grew = true;
      }
    }
  }
  return [...chain.values()];
}

const holds = (row: Row, entry: Entry) => entryLines(memoryIndexText(row)).includes(entry.text);

function savedBy(time: number, entry: Entry, versions: readonly Row[]): boolean {
  const index = entry.file === MEMORY_INDEX_TITLE;
  return versions.some((row) =>
    index ? holds(row, entry) && row.updatedAt < time : row.createdAt < time,
  );
}

function promptMayNotBeResent(tx: Tx, turn: StepRow): boolean {
  if (turn.antigravitySubscriptionId === null) return false;
  if (turn.sessionId !== null) return true;
  return (
    tx
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, turn.buildId),
          ne(step.id, turn.id),
          lt(step.claimedAt, turn.claimedAt ?? turn.createdAt),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function inAttachedIndex(tx: Tx, teamId: string, turn: StepRow, entry: Entry): boolean | null {
  if (entry.file !== MEMORY_INDEX_TITLE) return false;
  if (promptMayNotBeResent(tx, turn)) return null;
  const attached = [
    ...(turn.memoryTrace?.teamMemoryIds ?? []),
    ...(turn.memoryTrace?.projectMemoryIds ?? []),
  ];
  return tx
    .select()
    .from(agentMemory)
    .where(and(eq(agentMemory.teamId, teamId), inArray(agentMemory.id, attached)))
    .all()
    .some((row) =>
      entryLines(boundMemoryIndex(memoryIndexText(row)).content)
        .map(bare)
        .includes(bare(entry.text)),
    );
}

function hasCheckPointer(tx: Tx, owner: MemoryDocumentOwner, entry: Entry): boolean {
  if (entry.file === MEMORY_INDEX_TITLE) return hasCheckPointerText(entry.text);
  try {
    const doc = currentMemoryDocument(tx, owner, entry.projectId ?? 'team', entry.file);
    return hasCheckPointerText(memoryIndexText(doc));
  } catch {
    return false;
  }
}

export function executeMemoryToolForStep(
  db: Db,
  owner: MemoryDocumentOwner,
  stepId: string | undefined,
  name: string,
  params: Record<string, unknown>,
): unknown {
  if (
    (name !== 'save_memory' && name !== 'update_memory') ||
    (params.correction !== true && params.repeats === undefined)
  )
    return executeMemoryDocumentTool(db, owner, name, params);
  const input = parseWith(memoryToolParamsSchemas[name], params, 'params');
  if (input.correction !== true)
    throw new HttpError(400, 'invalid params.repeats: repeats requires correction: true');
  return db.transaction((tx) => {
    const turn =
      stepId === undefined ? undefined : tx.select().from(step).where(eq(step.id, stepId)).get();
    const said = turn === undefined ? null : userWords(tx, turn);
    const named =
      input.repeats === undefined ? null : namedEntry(tx, owner, input.scope, input.repeats);
    const savedByThen =
      said !== null
        ? said.savedByThen
        : turn === undefined
          ? undefined
          : (turn.claimedAt ?? turn.createdAt);
    const old =
      named !== null &&
      savedByThen !== undefined &&
      savedBy(savedByThen, named, entryVersions(tx, owner, named))
        ? named
        : null;
    const output = executeMemoryDocumentTool(tx, owner, name, params) as { id: string };
    const next =
      old !== null &&
      turn !== undefined &&
      turn.kind === 'chief' &&
      !hasCheckPointer(tx, owner, old)
        ? RECURRENCE_NEXT
        : undefined;
    if (turn === undefined || said === null) {
      return {
        ...output,
        correction: NOT_RECORDED,
        ...(old === null ? {} : { pointedRule: old.text }),
        ...(next === undefined ? {} : { next }),
      };
    }
    const exchange = tx
      .select()
      .from(memoryCorrection)
      .where(
        and(
          eq(memoryCorrection.teamId, owner.teamId),
          eq(memoryCorrection.ownerMessageId, said.messageId),
        ),
      )
      .all();
    const recorded =
      old === null
        ? exchange.length > 0
        : exchange.some(
            (row) =>
              row.pointedRule === old.text &&
              row.pointedFile === old.file &&
              row.projectId === old.projectId,
          );
    if (!recorded) {
      for (const row of exchange.filter((each) => each.pointedRule === null))
        tx.delete(memoryCorrection).where(eq(memoryCorrection.id, row.id)).run();
      const writeProject = input.scope === 'team' ? null : input.scope;
      tx.insert(memoryCorrection)
        .values({
          id: newRecordId(),
          teamId: owner.teamId,
          projectId: old === null ? writeProject : old.projectId,
          pointedFile: old?.file ?? null,
          pointedRule: old?.text ?? null,
          inTurnIndex: old === null ? null : inAttachedIndex(tx, owner.teamId, turn, old),
          buildId: turn.buildId,
          stepId: turn.id,
          ownerMessageId: said.messageId,
          ownerWords: said.text,
          createdAt: nowMs(),
        })
        .run();
    }
    return {
      ...output,
      ...(old === null ? {} : { pointedRule: old.text }),
      ...(next === undefined ? {} : { next }),
    };
  });
}

export function listMemoryCorrections(db: Db, teamId: string): MemoryCorrectionsResponse {
  const corrections = db
    .select()
    .from(memoryCorrection)
    .where(eq(memoryCorrection.teamId, teamId))
    .orderBy(desc(memoryCorrection.createdAt), sql`rowid desc`)
    .limit(LISTED_MAX)
    .all()
    .map(({ teamId: _team, ...record }) => record);
  return { corrections };
}
