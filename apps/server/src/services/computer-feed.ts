import {
  COMPUTER_COMMANDS_LIMIT_DEFAULT,
  COMPUTER_COMMANDS_LIMIT_MAX,
  COMPUTER_FEED_TOOLS,
  type ComputerCommand,
  type ComputerRecord,
  chiefIdFormat,
} from '@cairn/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computer, computerCall, machine } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  computerCallOwnerUserId,
  ownedPrivateComputer,
  privateComputerWhere,
} from './computer-access.js';
import { computerMachineName, feedOf } from './machine-computer.js';

export function clampCommandsLimit(raw: string | undefined): number {
  const asked = Number(raw);
  if (!Number.isInteger(asked) || asked < 1) return COMPUTER_COMMANDS_LIMIT_DEFAULT;
  return Math.min(asked, COMPUTER_COMMANDS_LIMIT_MAX);
}

export function listComputers(db: Db, teamId: string, userId: string): ComputerRecord[] {
  return db
    .select({
      row: computer,
      host: machine,
      machineName: machine.name,
      machineOnline: machine.online,
    })
    .from(computer)
    .innerJoin(machine, eq(machine.id, computer.machineId))
    .where(privateComputerWhere(teamId, userId))
    .orderBy(computer.createdAt, computer.id)
    .all()
    .map(({ row, host, machineName, machineOnline }) => ({
      id: row.id,
      scopeKey: row.scopeKey,
      state: row.state,
      controlHolder: row.controlHolder,
      browserEnabled: compatibilityBrowserEnabled(host),
      machine: { id: row.machineId, name: machineName, online: machineOnline },
    }));
}

function compatibilityBrowserEnabled(host: typeof machine.$inferSelect): boolean {
  if (host.browserOverride === true) return true;
  return host.browserOverride !== false && host.capabilities?.browser === true;
}

function machineOffersBrowser(
  row: typeof machine.$inferSelect | undefined,
): row is typeof machine.$inferSelect {
  return row !== undefined && row.capabilities?.browser === true;
}

export function setComputerBrowserEnabled(
  db: Db,
  teamId: string,
  userId: string,
  computerId: string,
  browserEnabled: boolean,
): ComputerRecord | null {
  const owned = ownedPrivateComputer(db, teamId, userId, computerId);
  if (!owned) return null;
  const host = db.select().from(machine).where(eq(machine.id, owned.machineId)).get();
  if (browserEnabled && !machineOffersBrowser(host)) return null;
  if (browserEnabled && host?.browserOverride === false)
    throw new HttpError(409, 'machine browser grant is off');
  db.update(machine)
    .set({ browserOverride: browserEnabled })
    .where(eq(machine.id, owned.machineId))
    .run();
  db.update(computer)
    .set({ browserEnabled, updatedAt: nowMs() })
    .where(eq(computer.id, computerId))
    .run();
  return listComputers(db, teamId, userId).find((row) => row.id === computerId) ?? null;
}

export type EnsureComputerBrowserResult =
  | { ok: true; computer: ComputerRecord }
  | { ok: false; reason: 'missing_machine' | 'unsupported' | 'machine_mismatch' };

export function ensureComputerBrowserEnabled(
  db: Db,
  teamId: string,
  userId: string,
  machineId: string,
  browserEnabled: boolean,
): EnsureComputerBrowserResult {
  const host = db
    .select()
    .from(machine)
    .where(and(eq(machine.id, machineId), eq(machine.teamId, teamId)))
    .get();
  if (host === undefined) return { ok: false, reason: 'missing_machine' };
  if (browserEnabled && !machineOffersBrowser(host)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (browserEnabled && host.browserOverride === false)
    throw new HttpError(409, 'machine browser grant is off');
  const scopeKey = `chief:${chiefIdFormat(userId, teamId)}`;
  const existing = db.select().from(computer).where(eq(computer.scopeKey, scopeKey)).get();
  const now = nowMs();
  if (existing === undefined) {
    if (!browserEnabled) return { ok: false, reason: 'missing_machine' };
    const id = newRecordId();
    db.insert(computer)
      .values({
        id,
        teamId,
        scopeKey,
        machineId,
        providerRef: computerMachineName(scopeKey),
        state: 'stopped',
        browserEnabled,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.update(machine)
      .set({ browserOverride: browserEnabled })
      .where(eq(machine.id, machineId))
      .run();
    const created = listComputers(db, teamId, userId).find((row) => row.id === id);
    if (created === undefined) return { ok: false, reason: 'missing_machine' };
    return { ok: true, computer: created };
  }
  if (existing.machineId !== machineId) {
    return { ok: false, reason: 'machine_mismatch' };
  }
  db.update(machine)
    .set({ browserOverride: browserEnabled })
    .where(eq(machine.id, machineId))
    .run();
  db.update(computer)
    .set({ browserEnabled, updatedAt: now })
    .where(eq(computer.id, existing.id))
    .run();
  const updated = listComputers(db, teamId, userId).find((row) => row.id === existing.id);
  if (updated === undefined) return { ok: false, reason: 'missing_machine' };
  return { ok: true, computer: updated };
}

export function recentComputerCommands(
  db: Db,
  teamId: string,
  userId: string,
  computerId: string,
  limit: number,
): ComputerCommand[] {
  if (!ownedPrivateComputer(db, teamId, userId, computerId)) return [];
  const rows = db
    .select()
    .from(computerCall)
    .where(
      and(
        eq(computerCall.teamId, teamId),
        eq(computerCall.computerId, computerId),
        inArray(computerCall.tool, [...COMPUTER_FEED_TOOLS]),
      ),
    )
    .orderBy(desc(computerCall.createdAt), desc(computerCall.id))
    .limit(limit)
    .all();
  return rows
    .reverse()
    .filter((row) => computerCallOwnerUserId(db, row) === userId)
    .map(feedOf)
    .filter((command): command is ComputerCommand => command !== null);
}
