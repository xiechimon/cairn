import { createHash } from 'node:crypto';
import {
  type ActionEntry,
  type ActionSurface,
  projectArchiveAction,
  projectDeleteAction,
  projectUnarchiveAction,
  SLICE1_ACTIONS,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { actionJournal, project } from '../db/schema.js';
import { HttpError, notFound, parseWith } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
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
  registry?: readonly ActionEntry[];
}

export interface ExecutedAction {
  journalId: string;
  output: unknown;
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
  if (row === undefined || row.teamId !== teamId) throw notFound(`project ${projectId}`);
  return row;
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
): ExecutedAction {
  const registry = request.registry ?? SLICE1_ACTIONS;
  const entry = registry.find((item) => item.id === request.id);
  if (entry === undefined) throw new HttpError(400, `unknown action ${request.id}`);
  const input = parseWith(entry.inputSchema, request.input, 'input');
  const parsed = input as { projectId: string };
  if (entry.class === 'owner-only') throw new HttpError(403, `action ${entry.id} is owner-only`);
  if (!entry.surfaces.includes(request.surface)) {
    throw new HttpError(403, `action ${entry.id} is not on surface ${request.surface}`);
  }
  if (request.actor === 'coordinator' && entry.class === 'confirm-once') {
    throw new HttpError(400, `action ${entry.id} requires a proposal`);
  }
  const targetId = entry.targetOf(parsed);
  requireOwnedProject(deps.db, targetId, request.teamId);
  const hash = inputHash(input);
  if (entry.id === projectDeleteAction.id) {
    const output = projectDeleteAction.outputSchema.parse({ projectId: targetId, deleted: true });
    const row = journalRow(request, entry.id, targetId, hash);
    const removed = deleteProject(deps, targetId, (tx, deleted) => {
      if (deleted.teamId !== request.teamId) throw notFound(`project ${targetId}`);
      tx.insert(actionJournal).values(row).run();
    });
    if (!removed) throw notFound(`project ${targetId}`);
    return { journalId: row.id, output };
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
  return { journalId: row.id, output };
}
