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
import { feedOf } from './machine-computer.js';

export function clampCommandsLimit(raw: string | undefined): number {
  const asked = Number(raw);
  if (!Number.isInteger(asked) || asked < 1) return COMPUTER_COMMANDS_LIMIT_DEFAULT;
  return Math.min(asked, COMPUTER_COMMANDS_LIMIT_MAX);
}

export function listComputers(db: Db, teamId: string): ComputerRecord[] {
  return db
    .select({ row: computer, machineName: machine.name, machineOnline: machine.online })
    .from(computer)
    .innerJoin(machine, eq(machine.id, computer.machineId))
    .where(eq(computer.teamId, teamId))
    .orderBy(computer.createdAt, computer.id)
    .all()
    .map(({ row, machineName, machineOnline }) => ({
      id: row.id,
      scopeKey: row.scopeKey,
      state: row.state,
      controlHolder: row.controlHolder,
      machine: { id: row.machineId, name: machineName, online: machineOnline },
    }));
}

export function computerInTeam(db: Db, teamId: string, computerId: string): boolean {
  return (
    db
      .select({ id: computer.id })
      .from(computer)
      .where(and(eq(computer.id, computerId), eq(computer.teamId, teamId)))
      .get() !== undefined
  );
}

export function recentComputerCommands(
  db: Db,
  teamId: string,
  computerId: string,
  limit: number,
): ComputerCommand[] {
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
    .map(feedOf)
    .filter((command): command is ComputerCommand => command !== null);
}
