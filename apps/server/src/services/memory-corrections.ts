import {
  MEMORY_CORRECTION_WORDS_MAX_CHARS,
  MEMORY_INDEX_TITLE,
  type MemoryCorrectionsResponse,
  memoryToolParamsSchemas,
  stripTurnContext,
} from '@cairn/shared';
import { and, asc, desc, eq, gt, inArray, lte, max, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentMemory, chiefMessage, memoryCorrection, message, step } from '../db/schema.js';
import { HttpError, parseWith } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { askQuestionContentOf } from './chief-question-store.js';
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
const NOT_RECORDED =
  'not recorded as a correction: no user message in Cairn chat or the task thread started or steered this turn. The memory write itself was applied.';

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
  content: unknown;
}

function saidInCoordinatorTurn(tx: Tx, turn: StepRow): Said[] {
  const ids = turn.ownerMessageIds ?? [];
  if (ids.length === 0) return [];
  const rows = new Map(
    tx
      .select()
      .from(chiefMessage)
      .where(and(eq(chiefMessage.threadId, turn.buildId), inArray(chiefMessage.id, ids)))
      .all()
      .map((row) => [row.id, row]),
  );
  return ids.flatMap((id) => {
    const row = rows.get(id);
    if (row === undefined) return [];
    const said = { messageId: row.id, createdAt: row.createdAt };
    if (row.role === 'user')
      return isDesignCommentRelay(ownerTextOf(row.content))
        ? []
        : [{ ...said, content: row.content }];
    const answers = askQuestionContentOf(row.content)?.answers;
    if (!answers) return [];
    const content = answers.map((each) => each.text ?? each.choices?.join(', ') ?? '').join('\n');
    return [{ ...said, content }];
  });
}

function saidInTask(tx: Tx, turn: StepRow): Said[] {
  const answered = tx
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
    .get()?.at;
  return tx
    .select({ messageId: message.id, createdAt: message.createdAt, content: message.content })
    .from(message)
    .where(
      and(
        eq(message.conversationId, turn.buildId),
        eq(message.role, 'user'),
        eq(message.origin, 'user'),
        answered == null ? undefined : gt(message.createdAt, answered),
      ),
    )
    .orderBy(asc(message.createdAt), sql`rowid`)
    .all();
}

interface UserWords {
  messageId: string;
  savedByThen: number;
  text: string;
}

function userWords(tx: Tx, turn: StepRow): UserWords | null {
  const chief = turn.kind === 'chief';
  const said = chief ? saidInCoordinatorTurn(tx, turn) : saidInTask(tx, turn);
  const identity = said[0];
  if (identity === undefined) return null;
  const text = [...said]
    .reverse()
    .map((each) => stripTurnContext(ownerTextOf(each.content)).trim())
    .join('\n');
  return {
    messageId: identity.messageId,
    savedByThen: Math.min(identity.createdAt, turn.claimedAt ?? turn.createdAt),
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

function inAttachedIndex(tx: Tx, teamId: string, turn: StepRow, entry: Entry): boolean {
  if (entry.file !== MEMORY_INDEX_TITLE) return false;
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
    const output = executeMemoryDocumentTool(tx, owner, name, params) as { id: string };
    if (turn === undefined || said === null) return { ...output, correction: NOT_RECORDED };
    const old =
      named !== null && savedBy(said.savedByThen, named, entryVersions(tx, owner, named))
        ? named
        : null;
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
    return old === null ? output : { ...output, pointedRule: old.text };
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
