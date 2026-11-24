import { createHash } from 'node:crypto';
import {
  ACTION_PROPOSAL_TTL_MS,
  type ActionEntry,
  ASK_USER_QUESTION_KIND,
  type AskUserQuestion,
  type AskUserQuestionContent,
  connectorActionForId,
  isConnectorActionId,
  isExternalActionClass,
  SLICE1_ACTIONS,
  type UserRecord,
} from '@cairn/shared';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne } from 'drizzle-orm';
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
import { BROWSER_PASSWORD_ACTION, validateBrowserPasswordApproval } from './browser-passwords.js';
import { type ChiefDeps, enqueueChiefStep } from './chief.js';
import {
  ACTION_PROPOSAL_CARD_MARKER,
  APPROVAL_CARD_ID_PREFIX,
  askQuestionContentOf,
  proposalIdOfCard,
} from './chief-question-store.js';
import type { TeamStreamHub } from './events.js';
import {
  HOST_SHELL_ESCALATION_ACTION,
  hostShellEscalationWakePrompt,
  parseHostShellEscalationInput,
  pollOrStartApprovedHostShellEscalation,
  validateHostShellEscalationApproval,
} from './host-shell-escalation.js';
import { dispatchHostedCleanup } from './hosted-cleanup.js';
import { isOwner } from './instance-owner.js';
import { deleteProject, type ProjectTx } from './projects.js';
import { deleteTodo } from './todos.js';

export const APPROVE_CHOICE = '批准执行';
export const REFUSE_CHOICE = '不执行';
export const ALWAYS_CHOICE = '以后都允许';
export const SEND_CHOICE = '发送';
export const DECLINE_SEND_CHOICE = '不发';

type ProposalStatus = 'pending' | 'refused' | 'executed' | 'failed' | 'expired' | 'superseded';
export type Decision = 'refuse' | 'allow-once' | 'always';
type ProposalRow = typeof actionProposal.$inferSelect;

export interface ProposeInput {
  teamId: string;
  actionId: string;
  targetId: string;
  input: unknown;
  threadId: string;
  scopeProjectId: string | null;
  card?: readonly AskUserQuestion[];
  untrusted?: boolean;
  subscribe?: boolean;
  now?: number;
}

export interface AnswerInput {
  proposalId: string;
  teamId: string;
  decision: Decision;
  decidedBy: string;
  viaCard?: boolean;
  interactive?: 'page' | 'im';
  now?: number;
}

export interface AnswerDeps {
  db: Db;
  reposDir: string;
  hub: TeamStreamHub;
  user: UserRecord;
  registry?: readonly ActionEntry[];
}

function entryOf(deps: AnswerDeps, actionId: string): ActionEntry | undefined {
  return (
    (deps.registry ?? SLICE1_ACTIONS).find((entry) => entry.id === actionId) ??
    connectorActionForId(actionId)
  );
}

function sendsOutside(deps: AnswerDeps, actionId: string): boolean {
  const entry = entryOf(deps, actionId);
  return (
    (entry !== undefined && isExternalActionClass(entry.class)) || isConnectorActionId(actionId)
  );
}

function approvedOnlyInteractively(deps: AnswerDeps, actionId: string): boolean {
  return (
    sendsOutside(deps, actionId) ||
    actionId === BROWSER_PASSWORD_ACTION ||
    actionId === HOST_SHELL_ESCALATION_ACTION
  );
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

export const CARD_ENDINGS: Record<ProposalStatus, string> = {
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

function choiceOf(actionId: string, decision: Decision): string {
  if (isConnectorActionId(actionId))
    return decision === 'allow-once' ? SEND_CHOICE : DECLINE_SEND_CHOICE;
  if (decision === 'allow-once') return APPROVE_CHOICE;
  if (decision === 'always') return ALWAYS_CHOICE;
  return REFUSE_CHOICE;
}

function settledCardCreatedAt(
  tx: ProjectTx,
  row: typeof chiefMessage.$inferSelect,
  decision: Decision | null,
  now: number,
): number {
  if (decision !== null) {
    const latest = tx
      .select({ createdAt: chiefMessage.createdAt })
      .from(chiefMessage)
      .where(and(eq(chiefMessage.threadId, row.threadId), ne(chiefMessage.id, row.id)))
      .orderBy(desc(chiefMessage.createdAt))
      .limit(1)
      .get();
    return Math.max(now, row.createdAt, latest === undefined ? 0 : latest.createdAt + 1);
  }
  const nextUser = tx
    .select({ createdAt: chiefMessage.createdAt })
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, row.threadId),
        eq(chiefMessage.role, 'user'),
        gt(chiefMessage.createdAt, row.createdAt),
      ),
    )
    .orderBy(asc(chiefMessage.createdAt))
    .limit(1)
    .get();
  const turnEnd = tx
    .select({ createdAt: chiefMessage.createdAt })
    .from(chiefMessage)
    .where(
      and(
        eq(chiefMessage.threadId, row.threadId),
        ne(chiefMessage.id, row.id),
        eq(chiefMessage.role, 'assistant'),
        gte(chiefMessage.createdAt, row.createdAt),
        nextUser === undefined ? undefined : lt(chiefMessage.createdAt, nextUser.createdAt),
      ),
    )
    .orderBy(desc(chiefMessage.createdAt))
    .limit(1)
    .get();
  if (turnEnd === undefined) return row.createdAt;
  return turnEnd.createdAt + 1;
}

function settleCard(
  tx: ProjectTx,
  proposalId: string,
  actionId: string,
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
            choices: [choiceOf(actionId, decision)],
          })),
          answeredAt: now,
          answeredBy: 'person',
          cancelReason: CARD_ENDINGS[status],
        };
  const createdAt = settledCardCreatedAt(tx, row, decision, now);
  tx.update(chiefMessage)
    .set({ content: JSON.stringify(next), createdAt })
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
  settleCard(tx, row.id, row.actionId, status, decision, now);
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
  const carded =
    input.card === undefined
      ? input.input
      : { ...(input.input as Record<string, unknown>), cardDigest: cardDigest(input.card) };
  const stored =
    input.untrusted === true
      ? { ...(carded as Record<string, unknown>), untrustedTurn: true }
      : carded;
  const inputHash = hashInput(stored);
  return db.transaction(
    (tx) => {
      const pending = pendingFor(tx, input.teamId, input.actionId, input.targetId);
      const cardLost =
        pending !== undefined && input.card !== undefined && cardRow(tx, pending.id) === undefined;
      if (pending && pending.inputHash === inputHash && !cardLost) {
        if (input.subscribe !== false)
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
      if (input.subscribe !== false)
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
  if (row.actionId === BROWSER_PASSWORD_ACTION) {
    validateBrowserPasswordApproval(tx, row.teamId, JSON.parse(row.inputJson));
    journal(tx, row, 'run', now);
    return;
  }
  if (row.actionId === HOST_SHELL_ESCALATION_ACTION) {
    validateHostShellEscalationApproval(tx, row.teamId, JSON.parse(row.inputJson));
    journal(tx, row, 'run', now);
    return;
  }
  if (sendsOutside(deps, row.actionId)) return;
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
      if (row.actionId === BROWSER_PASSWORD_ACTION && !isOwner(deps.db, input.decidedBy)) {
        throw new HttpError(403, 'only the owner can authorize a browser password website');
      }
      if (row.actionId === HOST_SHELL_ESCALATION_ACTION && !isOwner(deps.db, input.decidedBy)) {
        throw new HttpError(
          403,
          'only the owner can approve running a command without the sandbox',
        );
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
      if (
        input.decision !== 'refuse' &&
        input.interactive === undefined &&
        approvedOnlyInteractively(deps, row.actionId)
      ) {
        throw new HttpError(
          403,
          `proposal ${input.proposalId} is approved only by the owner on its card`,
        );
      }
      const standing =
        input.decision === 'always' && entryOf(deps, row.actionId)?.standingGrant === true;
      if (input.decision === 'always' && !standing)
        throw new HttpError(409, 'standing grant not offered');
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
      const granted = standing ? input.decision : 'allow-once';
      if (handlerFailed) {
        journal(tx, row, 'error', now);
        closeProposal(tx, row, 'failed', granted, input.decidedBy, now);
        outcome.status = 'failed';
        return;
      }
      closeProposal(tx, row, 'executed', granted, input.decidedBy, now);
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

function approvedArguments(row: ProposalRow | undefined): unknown {
  if (row === undefined) return null;
  const stored = JSON.parse(row.inputJson) as unknown;
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return stored;
  const {
    cardDigest: _card,
    untrustedTurn: _untrusted,
    ...arguments_
  } = stored as Record<string, unknown>;
  return arguments_;
}

export function dispatchActionWakes(deps: ChiefDeps & { registry?: readonly ActionEntry[] }): {
  delivered: number;
  undeliverable: number;
} {
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
    const approved = row.outcome === 'executed';
    const proposal = deps.db
      .select()
      .from(actionProposal)
      .where(eq(actionProposal.id, row.proposalId))
      .get();
    const actionId = proposal?.actionId;
    let prompt: string;
    if (actionId === HOST_SHELL_ESCALATION_ACTION && proposal !== undefined) {
      let binding = null;
      try {
        binding = parseHostShellEscalationInput(JSON.parse(proposal.inputJson));
      } catch {}
      if (approved) {
        const poll = pollOrStartApprovedHostShellEscalation(deps, proposal, () => {
          dispatchActionWakes(deps);
        });
        if (poll.state === 'pending') continue;
        prompt = hostShellEscalationWakePrompt('executed', binding, poll.resultText);
      } else {
        prompt = hostShellEscalationWakePrompt(row.outcome, binding);
      }
    } else {
      const entry =
        actionId === undefined
          ? undefined
          : ((deps.registry ?? SLICE1_ACTIONS).find((item) => item.id === actionId) ??
            connectorActionForId(actionId));
      prompt = approved
        ? entry !== undefined && isExternalActionClass(entry.class)
          ? `审批 ${row.proposalId} 已由用户批准：以已批准的输入重新发起该动作即会执行。审批卡上的文字经过规整，不能照卡重写参数；必须逐字复制下面的参数，任何标点、空白的改动都会被当成新的动作重新审批。\n已批准的参数：${JSON.stringify(approvedArguments(proposal))}`
          : `审批 ${row.proposalId} 已由用户批准，服务端已执行。`
        : `审批 ${row.proposalId} 的结果是 ${row.outcome}：没有执行。除非用户重新要求，不要再次发起同一动作。`;
    }
    try {
      enqueueChiefStep(deps, subscriber.threadId, {
        id: subscriber.wakeStepId,
        prompt,
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
