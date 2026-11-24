import { type ComputerRecord, chiefIdFormat } from '@cairn/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computer, machine } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { privateComputerWhere } from './computer-access.js';
import { computerActivity } from './computer-activity.js';
import { computerMachineName } from './machine-computer.js';

export function ensureCoordinatorComputer(db: Db, teamId: string, userId: string): void {
  const scopeKey = `chief:${chiefIdFormat(userId, teamId)}`;
  if (db.select({ id: computer.id }).from(computer).where(eq(computer.scopeKey, scopeKey)).get())
    return;
  const host = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.online, true)))
    .orderBy(desc(machine.lastSeenAt))
    .all()
    .find((row) => row.capabilities?.computer === true);
  if (host === undefined) return;
  const now = nowMs();
  db.insert(computer)
    .values({
      id: newRecordId(),
      teamId,
      scopeKey,
      machineId: host.id,
      providerRef: computerMachineName(scopeKey),
      state: 'stopped',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
}

export function listComputers(db: Db, teamId: string, userId: string): ComputerRecord[] {
  return db
    .select({
      row: computer,
      machineName: machine.name,
      machineOnline: machine.online,
    })
    .from(computer)
    .innerJoin(machine, eq(machine.id, computer.machineId))
    .where(privateComputerWhere(teamId, userId))
    .orderBy(computer.createdAt, computer.id)
    .all()
    .map(({ row, machineName, machineOnline }) => ({
      id: row.id,
      scopeKey: row.scopeKey,
      state: row.state,
      controlHolder: row.controlHolder,
      handoffReason: row.handoffReason ?? null,
      kind: 'host' as const,
      download: null,
      machine: { id: row.machineId, name: machineName, online: machineOnline },
      activity: computerActivity(db, userId, row),
    }));
}
