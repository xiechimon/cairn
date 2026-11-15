import { createHash } from 'node:crypto';
import {
  ACTION_PROPOSAL_TTL_MS,
  ASK_USER_QUESTION_KIND,
  type AskUserQuestion,
  type AskUserQuestionContent,
  type UserRecord,
} from '@cairn/shared';
import { and, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  actionJournal,
  actionProposal,
  actionSubscriber,
  actionWakeOutbox,
  build,
  chiefMessage,
  project,
  step,
  todo,
} from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { type ChiefDeps, enqueueChiefStep } from './chief.js';
import {
  ACTION_PROPOSAL_CARD_MARKER,
  APPROVAL_CARD_ID_PREFIX,
  askQuestionContentOf,
  proposalIdOfCard,
} from './chief-questions.js';
import type { TeamStreamHub } from './events.js';
import { dispatchHostedCleanup } from './hosted-cleanup.js';
import { deleteProject, type ProjectTx } from './projects.js';
import { deleteTodo } from './todos.js';

export const APPROVE_CHOICE = '批准执行';
export const REFUSE_CHOICE = '不执行';

type ProposalStatus = 'pending' | 'refused' | 'executed' | 'failed' | 'expired' | 'superseded';
type Decision = 'refuse' | 'allow-once' | 'always';
type ProposalRow = typeof actionProposal.$inferSelect;

export interface ProposeInput {
  teamId: string;
  actionId: string;
  targetId: string;
  input: unknown;
  threadId: string;
  scopeProjectId: string | null;
  card?: readonly AskUserQuestion[];
  now?: number;
}

export interface AnswerInput {
  proposalId: string;
  teamId: string;
  decision: Decision;
  decidedBy: string;
  viaCard?: boolean;
  now?: number;
}

export interface AnswerDeps {
  db: Db;
  reposDir: string;
  hub: TeamStreamHub;
  user: UserRecord;
}

export const proposalCardId = (proposalId: string) => `${APPROVAL_CARD_ID_PREFIX}${proposalId}`;

const cardDigest = (questions: readonly AskUserQuestion[]) => hashInput(questions);

function storedCardDigest(row: ProposalRow): string | null {
  const stored = JSON.parse(row.inputJson) as { cardDigest?: unknown };
  return typeof stored.cardDigest === 'string' ? stored.cardDigest : null;
}

function requireIntactCard(tx: ProjectTx, row: ProposalRow, digest: string) {
  const card = cardRow(tx, row.id);
  const content = card === undefined ? null : askQuestionContentOf(card.content);
  if (
    content === null ||
    content.status !== 'pending' ||
    proposalIdOfCard(content) !== row.id ||
    cardDigest(content.questions) !== digest
  ) {
    throw new HttpError(409, `approval card for proposal ${row.id} does not match it`);
  }
}

const CARD_ENDINGS: Record<ProposalStatus, string> = {
  pending: '',
  refused: '你选择了不执行，没有执行。',
  executed: '已按你的批准执行。',
  failed: '批准后执行失败，没有改动任何数据。',
  expired: '审批已过期，没有执行。',
  superseded: '这张审批已被新的审批替换，没有执行。',
};

const hashInput = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');
const wakeId = (proposalId: string, threadId: string) => `wake:${proposalId}:${threadId}`;

function pendingFor(tx: ProjectTx, teamId: string, actionId: string, targetId: string) {
  return tx
    .select()
    .from(actionProposal)
    .where(
      and(
        eq(actionProposal.teamId, teamId),
        eq(actionProposal.actionId, actionId),
        eq(actionProposal.targetId, targetId),
        eq(actionProposal.status, 'pending'),
      ),
    )
    .get();
}

function addSubscriber(
  tx: ProjectTx,
  proposalId: string,
  threadId: string,
  scopeProjectId: string | null,
) {
  const existing = tx
    .select({ id: actionSubscriber.id })
    .from(actionSubscriber)
    .where(
      and(eq(actionSubscriber.proposalId, proposalId), eq(actionSubscriber.threadId, threadId)),
    )
    .get();
  if (existing) {
    tx.update(actionSubscriber)
      .set({ scopeProjectId })
      .where(eq(actionSubscriber.id, existing.id))
      .run();
    return;
  }
  tx.insert(actionSubscriber)
    .values({
      id: newRecordId(),
      proposalId,
      threadId,
      wakeStepId: wakeId(proposalId, threadId),
      scopeProjectId,
    })
    .run();
}

function writeWakes(tx: ProjectTx, proposalId: string, outcome: ProposalStatus) {
  for (const subscriber of tx
    .select()
    .from(actionSubscriber)
    .where(eq(actionSubscriber.proposalId, proposalId))
    .all()) {
    const existing = tx
      .select({ id: actionWakeOutbox.id })
      .from(actionWakeOutbox)
      .where(
        and(
          eq(actionWakeOutbox.proposalId, proposalId),
          eq(actionWakeOutbox.threadId, subscriber.threadId),
        ),
      )
      .get();
    if (existing) continue;
    tx.insert(actionWakeOutbox)
      .values({
        id: newRecordId(),
        proposalId,
        threadId: subscriber.threadId,
        outcome,
        state: 'pending',
      })
      .run();
  }
}

function cardRow(tx: ProjectTx, proposalId: string) {
  return tx
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.id, proposalCardId(proposalId)))
    .get();
}

function settleCard(
  tx: ProjectTx,
  proposalId: string,
  status: ProposalStatus,
  decision: Decision | null,
  now: number,
) {
  const row = cardRow(tx, proposalId);
  const content = row === undefined ? null : askQuestionContentOf(row.content);
  if (row === undefined || content === null || content.status !== 'pending') return;
  const next: AskUserQuestionContent =
    decision === null
      ? { ...content, status: 'cancelled', cancelReason: CARD_ENDINGS[status] }
      : {
          ...content,
          status: 'answered',
          answers: content.questions.map((question) => ({
            header: question.header,
            choices: [decision === 'allow-once' ? APPROVE_CHOICE : REFUSE_CHOICE],
          })),
          answeredAt: now,
          answeredBy: 'person',
          cancelReason: CARD_ENDINGS[status],
        };
  tx.update(chiefMessage)
    .set({ content: JSON.stringify(next) })
    .where(eq(chiefMessage.id, row.id))
    .run();
}

function insertCard(
  tx: ProjectTx,
  proposalId: string,
  threadId: string,
  scopeProjectId: string | null,
  questions: readonly AskUserQuestion[],
  now: number,
) {
  const content: AskUserQuestionContent = {
    kind: ASK_USER_QUESTION_KIND,
    requestId: proposalCardId(proposalId),
    status: 'pending',
    questions: [...questions],
    answers: null,
    parkedAt: now,
    askedFor: [`${ACTION_PROPOSAL_CARD_MARKER}${proposalId}`],
  };
  tx.insert(chiefMessage)
    .values({
      id: content.requestId,
      threadId,
      role: 'assistant',
      content: JSON.stringify(content),
      projectId: scopeProjectId,
      createdAt: now,
    })
    .run();
}

function journal(tx: ProjectTx, row: ProposalRow, kind: 'run' | 'error', now: number) {
  tx.insert(actionJournal)
    .values({
      id: newRecordId(),
      teamId: row.teamId,
      actionId: row.actionId,
      targetId: row.targetId,
      actor: 'user',
      surface: 'web',
      kind,
      inputHash: row.inputHash,
      createdAt: now,
    })
    .run();
}

function closeProposal(
  tx: ProjectTx,
  row: ProposalRow,
  status: ProposalStatus,
  decision: Decision | null,
  decidedBy: string | null,
  now: number,
) {
  tx.update(actionProposal)
    .set({ status, decision, decidedBy, decidedAt: now })
    .where(eq(actionProposal.id, row.id))
    .run();
  settleCard(tx, row.id, status, decision, now);
  writeWakes(tx, row.id, status);
}

export function settlePendingProposal(
  tx: ProjectTx,
  teamId: string,
  actionId: string,
  targetId: string,
) {
  const pending = pendingFor(tx, teamId, actionId, targetId);
  if (pending) closeProposal(tx, pending, 'executed', 'allow-once', null, nowMs());
}

export function proposeAction(
  db: Db,
  input: ProposeInput,
): { proposalId: string; created: boolean } {
  const now = input.now ?? nowMs();
  const stored =
    input.card === undefined
      ? input.input
      : { ...(input.input as Record<string, unknown>), cardDigest: cardDigest(input.card) };
  const inputHash = hashInput(stored);
  return db.transaction(
    (tx) => {
      const pending = pendingFor(tx, input.teamId, input.actionId, input.targetId);
      if (pending && pending.inputHash === inputHash) {
        addSubscriber(tx, pending.id, input.threadId, input.scopeProjectId);
        return { proposalId: pending.id, created: false };
      }
      if (pending) closeProposal(tx, pending, 'superseded', null, null, now);
      const proposalId = newRecordId();
      tx.insert(actionProposal)
        .values({
          id: proposalId,
          teamId: input.teamId,
          actionId: input.actionId,
          targetId: input.targetId,
          inputJson: JSON.stringify(stored),
          inputHash,
          status: 'pending',
          decision: null,
          expiresAt: now + ACTION_PROPOSAL_TTL_MS,
          createdAt: now,
          decidedBy: null,
          decidedAt: null,
        })
        .run();
      addSubscriber(tx, proposalId, input.threadId, input.scopeProjectId);
      if (input.card !== undefined) {
        insertCard(tx, proposalId, input.threadId, input.scopeProjectId, input.card, now);
      }
      return { proposalId, created: true };
    },
    { behavior: 'immediate' },
  );
}

function runTodoDelete(deps: AnswerDeps, tx: ProjectTx, row: ProposalRow, now: number) {
  const bound = JSON.parse(row.inputJson) as {
    todoIds: string[];
    versions: Record<string, number>;
  };
  const present = tx
    .select({ id: todo.id, v: todo.v, archivedAt: project.archivedAt })
    .from(todo)
    .innerJoin(project, eq(project.id, todo.projectId))
    .where(and(inArray(todo.id, bound.todoIds), eq(todo.teamId, row.teamId)))
    .all();
  for (const current of present) {
    if (bound.versions[current.id] !== current.v) {
      throw new HttpError(409, `todo ${current.id} changed after the approval was asked`);
    }
    if (current.archivedAt !== null) {
      throw new HttpError(409, `todo ${current.id} is in an archived project`);
    }
  }
  const running = tx
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(build.id, step.buildId))
    .where(
      and(
        inArray(
          build.todoId,
          present.map((current) => current.id),
        ),
        eq(step.status, 'claimed'),
      ),
    )
    .get();
  if (running !== undefined) throw new HttpError(409, 'cannot delete a todo while work is running');
  for (const current of present) deleteTodo(deps, current.id);
  journal(tx, row, 'run', now);
}

function runHandler(deps: AnswerDeps, tx: ProjectTx, row: ProposalRow, now: number) {
  if (row.actionId === 'todo.delete') {
    runTodoDelete(deps, tx, row, now);
    return;
  }
  if (row.actionId !== 'project.delete') throw new HttpError(400, `no handler for ${row.actionId}`);
  const removed = deleteProject(
    deps,
    row.targetId,
    (inner) => {
      journal(inner, row, 'run', now);
    },
    tx,
  );
  if (!removed) throw notFound(`project ${row.targetId}`);
}

export function answerProposal(deps: AnswerDeps, input: AnswerInput): { status: ProposalStatus } {
  const now = input.now ?? nowMs();
  const outcome: { status: ProposalStatus; expired: boolean; actionId: string | null } = {
    status: 'pending',
    expired: false,
    actionId: null,
  };
  deps.db.transaction(
    (tx) => {
      const row = tx
        .select()
        .from(actionProposal)
        .where(
          and(eq(actionProposal.id, input.proposalId), eq(actionProposal.teamId, input.teamId)),
        )
        .get();
      if (row?.status !== 'pending') {
        throw new HttpError(409, `proposal ${input.proposalId} is not pending`);
      }
      const digest = storedCardDigest(row);
      if (digest !== null && input.viaCard !== true) {
        throw new HttpError(409, `proposal ${input.proposalId} is answered on its card`);
      }
      if (digest !== null) requireIntactCard(tx, row, digest);
      outcome.actionId = row.actionId;
      if (row.expiresAt <= now) {
        closeProposal(tx, row, 'expired', null, null, now);
        outcome.expired = true;
        return;
      }
      if (input.decision === 'always') throw new HttpError(409, 'standing grant not offered');
      if (input.decision === 'refuse') {
        closeProposal(tx, row, 'refused', 'refuse', input.decidedBy, now);
        outcome.status = 'refused';
        return;
      }
      let handlerFailed = false;
      try {
        tx.transaction((savepoint) => {
          runHandler(deps, savepoint, row, now);
        });
      } catch {
        handlerFailed = true;
      }
      if (handlerFailed) {
        journal(tx, row, 'error', now);
        closeProposal(tx, row, 'failed', 'allow-once', input.decidedBy, now);
        outcome.status = 'failed';
        return;
      }
      closeProposal(tx, row, 'executed', 'allow-once', input.decidedBy, now);
      outcome.status = 'executed';
    },
    { behavior: 'immediate' },
  );
  if (outcome.expired) throw new HttpError(409, `proposal ${input.proposalId} expired`);
  if (outcome.status === 'executed' && outcome.actionId === 'project.delete') {
    dispatchHostedCleanup(deps.db, deps.reposDir);
  }
  return { status: outcome.status };
}

export function sweepExpiredActionProposals(db: Db, now = nowMs()): number {
  return db.transaction((tx) => {
    const due = tx
      .select()
      .from(actionProposal)
      .where(and(eq(actionProposal.status, 'pending'), lte(actionProposal.expiresAt, now)))
      .all();
    for (const row of due) closeProposal(tx, row, 'expired', null, null, now);
    return due.length;
  });
}

function markWake(db: Db, id: string, state: 'delivered' | 'undeliverable') {
  db.update(actionWakeOutbox).set({ state }).where(eq(actionWakeOutbox.id, id)).run();
}

export function dispatchActionWakes(deps: ChiefDeps): { delivered: number; undeliverable: number } {
  let delivered = 0;
  let undeliverable = 0;
  for (const row of deps.db
    .select()
    .from(actionWakeOutbox)
    .where(eq(actionWakeOutbox.state, 'pending'))
    .all()) {
    const subscriber = deps.db
      .select()
      .from(actionSubscriber)
      .where(
        and(
          eq(actionSubscriber.proposalId, row.proposalId),
          eq(actionSubscriber.threadId, row.threadId),
        ),
      )
      .get();
    if (!subscriber) {
      markWake(deps.db, row.id, 'undeliverable');
      undeliverable += 1;
      continue;
    }
    try {
      enqueueChiefStep(deps, subscriber.threadId, {
        id: subscriber.wakeStepId,
        prompt:
          row.outcome === 'executed'
            ? `审批 ${row.proposalId} 已由用户批准，服务端已执行。`
            : `审批 ${row.proposalId} 的结果是 ${row.outcome}：没有执行。除非用户重新要求，不要再次发起同一动作。`,
        scopeProjectId: subscriber.scopeProjectId,
        ownerMessageIds: [],
        trigger: 'wake',
        provenance: `action-proposal:${row.proposalId}`,
      });
      markWake(deps.db, row.id, 'delivered');
      delivered += 1;
    } catch (error) {
      const existing = deps.db
        .select({ id: step.id })
        .from(step)
        .where(eq(step.id, subscriber.wakeStepId))
        .get();
      if (existing || (error instanceof Error && /UNIQUE|PRIMARY KEY/.test(error.message))) {
        markWake(deps.db, row.id, 'delivered');
        delivered += 1;
      } else if (error instanceof HttpError && error.status === 404) {
        markWake(deps.db, row.id, 'undeliverable');
        undeliverable += 1;
      }
    }
  }
  return { delivered, undeliverable };
}

export function proposalById(db: Db, id: string) {
  return db.select().from(actionProposal).where(eq(actionProposal.id, id)).get();
}
