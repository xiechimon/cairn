import { createHash } from 'node:crypto';
import {
  type ActionEntry,
  type ActionSurface,
  type AskUserQuestion,
  type ExternalActionClass,
  isExternalActionClass,
  projectArchiveAction,
  projectDeleteAction,
  projectUnarchiveAction,
  SLICE1_ACTIONS,
  type TodoDeleteInput,
  todoDeleteAction,
} from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { actionJournal, actionProposal, project, todo } from '../db/schema.js';
import { HttpError, notFound, parseWith } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  ALWAYS_CHOICE,
  APPROVE_CHOICE,
  proposeAction,
  REFUSE_CHOICE,
  settlePendingProposal,
} from './action-proposals.js';
import { actionTierOf } from './autonomy-gates.js';
import { isOwner } from './instance-owner.js';
import { isPersonalSpace } from './personal-space.js';
import { deleteProject } from './projects.js';

export interface ExecuteActionDeps {
  db: Db;
  reposDir: string;
}

export interface ExecuteActionRequest {
  id: string;
  input: unknown;
  actor: 'user' | 'coordinator';
  surface: ActionSurface;
  teamId: string;
  threadId?: string;
  scopeProjectId?: string | null;
  registry?: readonly ActionEntry[];
}

export type ExecuteActionResult =
  | { status: 'executed'; journalId: string; output: unknown }
  | { status: 'pending'; proposalId: string; created: boolean };

const CARD_TITLE_MAX_CHARS = 80;
const CARD_PROJECT_MAX_CHARS = 40;
const CARD_TARGET_MAX_CHARS = 60;

const EXTERNAL_CLASS_VERBS: Record<ExternalActionClass, string> = {
  send: '对外发送',
  submit: '对外提交',
};

function cardText(raw: string, max: number): string {
  const plain = raw
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s\-_.,:/@]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

interface BoundProposal {
  input: unknown;
  card?: AskUserQuestion[];
}

function bindTodoDelete(db: Db, input: TodoDeleteInput, teamId: string): BoundProposal {
  const rows = db
    .select({
      id: todo.id,
      v: todo.v,
      seqNum: todo.seqNum,
      title: todo.title,
      phase: todo.phase,
      projectName: project.name,
    })
    .from(todo)
    .innerJoin(project, eq(project.id, todo.projectId))
    .where(and(inArray(todo.id, input.todoIds), eq(todo.teamId, teamId)))
    .all();
  const missing = input.todoIds.find((id) => !rows.some((row) => row.id === id));
  if (missing !== undefined) throw notFound(`todo ${missing}`);
  const lines = rows
    .sort((a, b) => a.seqNum - b.seqNum)
    .map(
      (row) =>
        `「${cardText(row.title, CARD_TITLE_MAX_CHARS)}」（项目 ${cardText(row.projectName, CARD_PROJECT_MAX_CHARS)}，${row.phase}）`,
    );
  return {
    input: {
      todoIds: input.todoIds,
      versions: Object.fromEntries(rows.map((row) => [row.id, row.v])),
    },
    card: [
      {
        header: '审批',
        question: `删除 ${rows.length} 个任务：${lines.join('；')}。它们的构建、对话和定时会一起删除，无法恢复。`,
        options: [{ label: APPROVE_CHOICE }, { label: REFUSE_CHOICE }],
      },
    ],
  };
}

function externalCard(entry: ActionEntry, targetId: string): AskUserQuestion[] {
  const actionClass = entry.class;
  const verb = isExternalActionClass(actionClass) ? EXTERNAL_CLASS_VERBS[actionClass] : actionClass;
  const options = entry.standingGrant
    ? [{ label: APPROVE_CHOICE }, { label: ALWAYS_CHOICE }, { label: REFUSE_CHOICE }]
    : [{ label: APPROVE_CHOICE }, { label: REFUSE_CHOICE }];
  return [
    {
      header: '审批',
      question: `${verb}到「${cardText(targetId, CARD_TARGET_MAX_CHARS)}」，发出后无法收回。`,
      options,
    },
  ];
}

function bindProposal(db: Db, entry: ActionEntry, input: unknown, teamId: string): BoundProposal {
  if (entry.id === todoDeleteAction.id) return bindTodoDelete(db, input as TodoDeleteInput, teamId);
  const targetId = entry.targetOf(input);
  if (isExternalActionClass(entry.class)) {
    if (entry.scope === 'project') requireOwnedProject(db, targetId, teamId);
    return { input, card: externalCard(entry, targetId) };
  }
  requireOwnedProject(db, targetId, teamId);
  return { input };
}

type JournalTx = Parameters<Parameters<Db['transaction']>[0]>[0];

function inputHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function journalRow(
  request: ExecuteActionRequest,
  actionId: string,
  targetId: string,
  hash: string,
): typeof actionJournal.$inferInsert {
  return {
    id: newRecordId(),
    teamId: request.teamId,
    actionId,
    targetId,
    actor: request.actor,
    surface: request.surface,
    kind: 'run',
    inputHash: hash,
    createdAt: nowMs(),
  };
}

function requireOwnedProject(db: Pick<Db, 'select'>, projectId: string, teamId: string) {
  const row = db.select().from(project).where(eq(project.id, projectId)).get();
  if (row === undefined || row.teamId !== teamId || isPersonalSpace(row)) {
    throw notFound(`project ${projectId}`);
  }
  return row;
}

type ProposalRow = typeof actionProposal.$inferSelect;

function storedInputOf(row: ProposalRow): unknown {
  const stored = JSON.parse(row.inputJson) as unknown;
  if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
    const { cardDigest: _, ...rest } = stored as Record<string, unknown>;
    return rest;
  }
  return stored;
}

function grantConsumed(
  db: Db,
  teamId: string,
  actionId: string,
  targetId: string,
  hash: string,
  since: number,
): boolean {
  return db
    .select({ createdAt: actionJournal.createdAt })
    .from(actionJournal)
    .where(
      and(
        eq(actionJournal.teamId, teamId),
        eq(actionJournal.actionId, actionId),
        eq(actionJournal.targetId, targetId),
        eq(actionJournal.inputHash, hash),
        eq(actionJournal.kind, 'run'),
        eq(actionJournal.actor, 'coordinator'),
      ),
    )
    .all()
    .some((run) => run.createdAt >= since);
}

function coveringGrant(
  db: Db,
  teamId: string,
  entry: ActionEntry,
  targetId: string,
  input: unknown,
): ProposalRow | undefined {
  const rows = db
    .select()
    .from(actionProposal)
    .where(
      and(
        eq(actionProposal.teamId, teamId),
        eq(actionProposal.actionId, entry.id),
        eq(actionProposal.targetId, targetId),
        eq(actionProposal.status, 'executed'),
      ),
    )
    .all()
    .filter((row) => row.decidedBy !== null && isOwner(db, row.decidedBy));
  const standing = rows.find((row) => row.decision === 'always');
  if (standing !== undefined) return standing;
  const hash = inputHash(input);
  const approved = rows
    .filter((row) => row.decision === 'allow-once' && inputHash(storedInputOf(row)) === hash)
    .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt));
  return approved.find(
    (row) => !grantConsumed(db, teamId, entry.id, targetId, hash, row.decidedAt ?? row.createdAt),
  );
}

function archiveOn(
  tx: JournalTx,
  projectId: string,
  teamId: string,
  archived: boolean,
): { projectId: string; archivedAt: number | null } {
  const row = requireOwnedProject(tx, projectId, teamId);
  if ((row.archivedAt !== null) === archived) {
    return { projectId: row.id, archivedAt: row.archivedAt };
  }
  const archivedAt = archived ? nowMs() : null;
  tx.update(project).set({ archivedAt }).where(eq(project.id, row.id)).run();
  return { projectId: row.id, archivedAt };
}

export function executeAction(
  deps: ExecuteActionDeps,
  request: ExecuteActionRequest,
): ExecuteActionResult {
  const registry: readonly ActionEntry[] = request.registry ?? SLICE1_ACTIONS;
  const entry = registry.find((item) => item.id === request.id);
  if (entry === undefined) throw new HttpError(400, `unknown action ${request.id}`);
  const input = parseWith(entry.inputSchema, request.input, 'input');
  if (entry.class === 'owner-only') throw new HttpError(403, `action ${entry.id} is owner-only`);
  if (!entry.surfaces.includes(request.surface)) {
    throw new HttpError(403, `action ${entry.id} is not on surface ${request.surface}`);
  }
  const targetId = entry.targetOf(input);
  const asks = entry.class === 'confirm-once' || isExternalActionClass(entry.class);
  if (request.actor === 'coordinator' && asks) {
    const covered =
      isExternalActionClass(entry.class) &&
      (actionTierOf(deps.db, request.teamId, request.scopeProjectId ?? null) === 'full' ||
        coveringGrant(deps.db, request.teamId, entry, targetId, input) !== undefined);
    if (!covered) {
      if (!request.threadId)
        throw new HttpError(400, 'coordinator confirm-once requires a threadId');
      const bound = bindProposal(deps.db, entry, input, request.teamId);
      const proposed = proposeAction(deps.db, {
        teamId: request.teamId,
        actionId: entry.id,
        targetId,
        input: bound.input,
        threadId: request.threadId,
        scopeProjectId: request.scopeProjectId ?? null,
        ...(bound.card === undefined ? {} : { card: bound.card }),
      });
      return { status: 'pending', ...proposed };
    }
  }
  if (entry.id === todoDeleteAction.id) {
    throw new HttpError(403, `action ${entry.id} runs only through an approved proposal`);
  }
  if (entry.scope === 'project') requireOwnedProject(deps.db, targetId, request.teamId);
  const hash = inputHash(input);
  if (isExternalActionClass(entry.class)) {
    const row = journalRow(request, entry.id, targetId, hash);
    deps.db.transaction(
      (tx) => {
        tx.insert(actionJournal).values(row).run();
        settlePendingProposal(tx, request.teamId, entry.id, targetId);
      },
      { behavior: 'immediate' },
    );
    return {
      status: 'executed',
      journalId: row.id,
      output: entry.outputSchema.parse({ authorized: true }),
    };
  }
  if (entry.id === projectDeleteAction.id) {
    const output = projectDeleteAction.outputSchema.parse({ projectId: targetId, deleted: true });
    const row = journalRow(request, entry.id, targetId, hash);
    const removed = deleteProject(deps, targetId, (tx, deleted) => {
      if (deleted.teamId !== request.teamId) throw notFound(`project ${targetId}`);
      tx.insert(actionJournal).values(row).run();
      settlePendingProposal(tx, request.teamId, entry.id, targetId);
    });
    if (!removed) throw notFound(`project ${targetId}`);
    return { status: 'executed', journalId: row.id, output };
  }
  const archived = entry.id === projectArchiveAction.id;
  if (entry.id !== projectArchiveAction.id && entry.id !== projectUnarchiveAction.id) {
    throw new HttpError(400, `unknown action ${entry.id}`);
  }
  const row = journalRow(request, entry.id, targetId, hash);
  const output = deps.db.transaction(
    (tx) => {
      const next = archiveOn(tx, targetId, request.teamId, archived);
      tx.insert(actionJournal).values(row).run();
      return entry.outputSchema.parse(next);
    },
    { behavior: 'immediate' },
  );
  return { status: 'executed', journalId: row.id, output };
}
