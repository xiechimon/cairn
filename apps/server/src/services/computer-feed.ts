import {
  COMPUTER_COMMANDS_LIMIT_DEFAULT,
  COMPUTER_COMMANDS_LIMIT_MAX,
  COMPUTER_FEED_TOOLS,
  type ComputerCommand,
  type ComputerRecord,
} from '@cairn/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computer, computerCall, machine } from '../db/schema.js';
import {
  computerCallOwnerUserId,
  ownedPrivateComputer,
  privateComputerWhere,
} from './computer-access.js';
import { feedOf } from './machine-computer.js';

export function clampCommandsLimit(raw: string | undefined): number {
  const asked = Number(raw);
  if (!Number.isInteger(asked) || asked < 1) return COMPUTER_COMMANDS_LIMIT_DEFAULT;
  return Math.min(asked, COMPUTER_COMMANDS_LIMIT_MAX);
}

export function listComputers(db: Db, teamId: string, userId: string): ComputerRecord[] {
  return db
    .select({ row: computer, machineName: machine.name, machineOnline: machine.online })
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
      browserEnabled: row.browserEnabled,
      machine: { id: row.machineId, name: machineName, online: machineOnline },
    }));
}

export function setComputerBrowserEnabled(
  db: Db,
  teamId: string,
  userId: string,
  computerId: string,
  browserEnabled: boolean,
): ComputerRecord | null {
  if (!ownedPrivateComputer(db, teamId, userId, computerId)) return null;
  db.update(computer)
    .set({ browserEnabled, updatedAt: Date.now() })
    .where(eq(computer.id, computerId))
    .run();
  return listComputers(db, teamId, userId).find((row) => row.id === computerId) ?? null;
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
