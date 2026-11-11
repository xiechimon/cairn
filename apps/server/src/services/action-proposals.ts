import { createHash } from 'node:crypto';
import { ACTION_PROPOSAL_TTL_MS } from '@cairn/shared';
import { and, eq, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  actionJournal,
  actionProposal,
  actionSubscriber,
  actionWakeOutbox,
  step,
} from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { type ChiefDeps, enqueueChiefStep } from './chief.js';
import { dispatchHostedCleanup } from './hosted-cleanup.js';
import { deleteProject, type ProjectTx } from './projects.js';

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
  now?: number;
}

export interface AnswerInput {
  proposalId: string;
  teamId: string;
  decision: Decision;
  decidedBy: string;
  now?: number;
}

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

export function proposeAction(db: Db, input: ProposeInput): { proposalId: string } {
  const now = input.now ?? nowMs();
  const inputHash = hashInput(input.input);
  return db.transaction(
    (tx) => {
      const pending = pendingFor(tx, input.teamId, input.actionId, input.targetId);
      if (pending && pending.inputHash === inputHash) {
        addSubscriber(tx, pending.id, input.threadId, input.scopeProjectId);
        return { proposalId: pending.id };
      }
      if (pending) closeProposal(tx, pending, 'superseded', null, null, now);
      const proposalId = newRecordId();
      tx.insert(actionProposal)
        .values({
          id: proposalId,
          teamId: input.teamId,
          actionId: input.actionId,
          targetId: input.targetId,
          inputJson: JSON.stringify(input.input),
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
      return { proposalId };
    },
    { behavior: 'immediate' },
  );
}

export function answerProposal(
  deps: { db: Db; reposDir: string },
  input: AnswerInput,
): { status: ProposalStatus } {
  const now = input.now ?? nowMs();
  const outcome: { status: ProposalStatus; expired: boolean } = {
    status: 'pending',
    expired: false,
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
      try {
        tx.transaction((savepoint) => {
          const removed = deleteProject(
            deps,
            row.targetId,
            (inner) => {
              journal(inner, row, 'run', now);
            },
            savepoint,
          );
          if (!removed) throw notFound(`project ${row.targetId}`);
        });
        closeProposal(tx, row, 'executed', 'allow-once', input.decidedBy, now);
        outcome.status = 'executed';
      } catch {
        journal(tx, row, 'error', now);
        closeProposal(tx, row, 'failed', 'allow-once', input.decidedBy, now);
        outcome.status = 'failed';
      }
    },
    { behavior: 'immediate' },
  );
  if (outcome.expired) throw new HttpError(409, `proposal ${input.proposalId} expired`);
  if (outcome.status === 'executed') dispatchHostedCleanup(deps.db, deps.reposDir);
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
        prompt: `Action proposal ${row.proposalId} is ${row.outcome}.`,
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
