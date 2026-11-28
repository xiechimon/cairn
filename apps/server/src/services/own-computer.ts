import {
  OWN_COMPUTER_NO_ACCESSIBILITY,
  OWN_COMPUTER_NO_MAC,
  OWN_COMPUTER_NOT_OWNER,
  type OwnComputerTool,
  WORKSPACE_FILE_CWD,
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

function selectedOwnComputerHost(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  thread: Pick<ThreadRow, 'teamId'>,
  tool: OwnComputerTool,
): MachineRow | undefined {
  return deps.db
    .select()
    .from(machine)
    .where(eq(machine.teamId, thread.teamId))
    .all()
    .find((row) => servesTool(row, tool) && deps.machineHub.isConnected(row.id));
}

/**
 * Whether `:step-workspace` may be advertised: only when the very host runner that
 * `ownComputerTarget` would pick for a shell call can read the files back.
 */
export function ownComputerWorkspaceOffered(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  threadId: string,
): boolean {
  const thread = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (thread === undefined || !isOwner(deps.db, thread.userId)) return false;
  return (
    selectedOwnComputerHost(deps, thread, 'user_computer_shell')?.capabilities
      ?.workspaceFileRead === true
  );
}

export const WORKSPACE_CWD_UNSUPPORTED =
  'This computer’s Cairn runner is too old to give a step its own workspace folder, so cwd ":step-workspace" is not available. Run the command again with the default working folder or another cwd. Nothing ran.';

/** Defensive guard: the sentinel never reaches a runner that does not advertise support. */
export function workspaceCwdRefusal(
  db: Pick<Db, 'select'>,
  machineId: string,
  params: Record<string, unknown>,
): string | null {
  if (params.cwd !== WORKSPACE_FILE_CWD) return null;
  const host = db.select().from(machine).where(eq(machine.id, machineId)).get();
  return host?.capabilities?.workspaceFileRead === true ? null : WORKSPACE_CWD_UNSUPPORTED;
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
  const host = selectedOwnComputerHost(deps, thread, tool);
  if (host === undefined) return { kind: 'refused', text: OWN_COMPUTER_NO_MAC };
  if (
    tool !== 'user_computer_shell' &&
    host.capabilities?.hostPermissions?.accessibility !== 'granted'
  )
    return { kind: 'refused', text: OWN_COMPUTER_NO_ACCESSIBILITY(host.name) };
  return { kind: 'ready', machineId: host.id };
}
