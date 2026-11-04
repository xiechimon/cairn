import type { BranchSyncRecord, BranchSyncStatus, MachineSyncCommand } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { branchSync, build as buildTable, machine } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';

export interface MachineSyncHub {
  pushSync(machineId: string, cmd: MachineSyncCommand): boolean;
}

export interface BranchSyncCreateDeps {
  db: Db;
  hub: TeamStreamHub;
  machineHub: MachineSyncHub;
}

export interface BranchSyncTransitionDeps {
  db: Db;
  hub: TeamStreamHub;
}

export function createBranchSync(
  deps: BranchSyncCreateDeps,
  input: {
    buildId: string;
    machineId: string;
    teamId: string;
    projectId: string | null;
    cloneUrl: string | null;
    directory: string;
    ref: string;
    commit: string;
    force: boolean;
  },
): BranchSyncRecord {
  const { db, hub, machineHub } = deps;
  const buildRow = db.select().from(buildTable).where(eq(buildTable.id, input.buildId)).get();
  if (!buildRow) throw new HttpError(404, `build ${input.buildId} not found`);
  const machineRow = db.select().from(machine).where(eq(machine.id, input.machineId)).get();
  if (!machineRow) throw new HttpError(404, `machine ${input.machineId} not found`);
  if (!machineRow.online) throw new HttpError(409, 'machine offline');

  const id = newRecordId();
  const now = nowMs();
  db.insert(branchSync)
    .values({
      id,
      buildId: input.buildId,
      machineId: input.machineId,
      teamId: input.teamId,
      directory: input.directory,
      ref: input.ref,
      commit: input.commit,
      force: input.force,
      status: 'pending',
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    })
    .run();
  const row = toBranchSyncRecord({
    id,
    buildId: input.buildId,
    machineId: input.machineId,
    teamId: input.teamId,
    directory: input.directory,
    ref: input.ref,
    commit: input.commit,
    force: input.force,
    status: 'pending',
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  });

  hub.publish(input.teamId, () => ({ type: 'branch_sync', sync: row }));

  const dispatched = machineHub.pushSync(input.machineId, {
    syncId: id,
    buildId: input.buildId,
    projectId: input.projectId ?? '',
    cloneUrl: input.cloneUrl ?? '',
    directory: input.directory,
    ref: input.ref,
    commit: input.commit,
    force: input.force,
  });
  if (!dispatched) {
    db.update(branchSync)
      .set({
        status: 'failed',
        errorMessage: 'machine stream disconnected before pickup',
        finishedAt: nowMs(),
      })
      .where(eq(branchSync.id, id))
      .run();
    const updated = toBranchSyncRecord({
      ...row,
      status: 'failed',
      errorMessage: 'machine stream disconnected before pickup',
      finishedAt: nowMs(),
    });
    hub.publish(input.teamId, () => ({ type: 'branch_sync', sync: updated }));
    throw new HttpError(409, 'machine stream disconnected');
  }
  return row;
}

export function transitionBranchSync(
  deps: BranchSyncTransitionDeps,
  input: {
    syncId: string;
    machineId: string;
    status: Extract<BranchSyncStatus, 'running' | 'synced' | 'failed'>;
    errorMessage?: string;
  },
): BranchSyncRecord {
  const { db, hub } = deps;
  const row = db.select().from(branchSync).where(eq(branchSync.id, input.syncId)).get();
  if (!row) throw new HttpError(404, `sync ${input.syncId} not found`);
  if (row.machineId !== input.machineId) {
    throw new HttpError(403, `sync ${input.syncId} not owned by machine ${input.machineId}`);
  }
  if (row.status === 'synced' || row.status === 'failed') {
    return toBranchSyncRecord(row);
  }
  const valid =
    (row.status === 'pending' && input.status === 'running') ||
    (row.status === 'running' && (input.status === 'synced' || input.status === 'failed')) ||
    (row.status === 'pending' && (input.status === 'synced' || input.status === 'failed'));
  if (!valid) {
    throw new HttpError(409, `invalid sync transition: ${row.status} -> ${input.status}`);
  }
  const now = nowMs();
  const update: Partial<typeof branchSync.$inferInsert> = { status: input.status };
  if (input.status === 'running') {
    update.startedAt = row.startedAt ?? now;
  }
  if (input.status === 'synced' || input.status === 'failed') {
    update.finishedAt = now;
    update.errorMessage = input.errorMessage ?? null;
  }
  db.update(branchSync).set(update).where(eq(branchSync.id, input.syncId)).run();
  const next = db.select().from(branchSync).where(eq(branchSync.id, input.syncId)).get();
  if (!next) throw new HttpError(500, `sync ${input.syncId} vanished`);
  const record = toBranchSyncRecord(next);
  hub.publish(record.teamId, () => ({ type: 'branch_sync', sync: record }));
  return record;
}

export function latestBranchSyncForBuild(
  deps: { db: Db },
  buildId: string,
): BranchSyncRecord | null {
  const { db } = deps;
  const row = db
    .select()
    .from(branchSync)
    .where(eq(branchSync.buildId, buildId))
    .orderBy(branchSync.createdAt)
    .all()
    .at(-1);
  return row ? toBranchSyncRecord(row) : null;
}

function toBranchSyncRecord(r: typeof branchSync.$inferSelect): BranchSyncRecord {
  return {
    id: r.id,
    buildId: r.buildId,
    machineId: r.machineId,
    teamId: r.teamId,
    directory: r.directory,
    ref: r.ref,
    commit: r.commit,
    force: r.force,
    status: r.status,
    errorMessage: r.errorMessage ?? null,
    createdAt: r.createdAt,
    startedAt: r.startedAt ?? null,
    finishedAt: r.finishedAt ?? null,
  };
}
