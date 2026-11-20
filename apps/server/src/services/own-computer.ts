import {
  OWN_COMPUTER_NO_ACCESSIBILITY,
  OWN_COMPUTER_NO_MAC,
  OWN_COMPUTER_NOT_OWNER,
  type OwnComputerTool,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefThread, machine } from '../db/schema.js';
import { isOwner } from './instance-owner.js';
import type { MachineDeps } from './machine-deps.js';

type ThreadRow = typeof chiefThread.$inferSelect;
type MachineRow = typeof machine.$inferSelect;

function servesTool(row: MachineRow, tool: OwnComputerTool): boolean {
  if (row.kind !== 'local') return false;
  return tool === 'user_computer_shell'
    ? row.capabilities?.ownComputerShell === true
    : row.capabilities?.ownComputer === true;
}

export function teamOffersOwnComputer(db: Db, teamId: string): boolean {
  return db
    .select()
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()
    .some((row) => servesTool(row, 'user_computer_shell') || servesTool(row, 'user_computer_act'));
}

export function ownComputerOffered(db: Db, threadId: string): boolean {
  const thread = db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  return (
    thread !== undefined && isOwner(db, thread.userId) && teamOffersOwnComputer(db, thread.teamId)
  );
}

export type OwnComputerTarget =
  | { kind: 'refused'; text: string }
  | { kind: 'ready'; machineId: string };

export function ownComputerTarget(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  thread: ThreadRow,
  tool: OwnComputerTool,
): OwnComputerTarget {
  if (!isOwner(deps.db, thread.userId)) return { kind: 'refused', text: OWN_COMPUTER_NOT_OWNER };
  const host = deps.db
    .select()
    .from(machine)
    .where(eq(machine.teamId, thread.teamId))
    .all()
    .find((row) => servesTool(row, tool) && deps.machineHub.isConnected(row.id));
  if (host === undefined) return { kind: 'refused', text: OWN_COMPUTER_NO_MAC };
  if (
    tool !== 'user_computer_shell' &&
    host.capabilities?.hostPermissions?.accessibility !== 'granted'
  )
    return { kind: 'refused', text: OWN_COMPUTER_NO_ACCESSIBILITY(host.name) };
  return { kind: 'ready', machineId: host.id };
}
