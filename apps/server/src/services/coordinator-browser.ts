import { COMPUTER_BROWSER_TOOLS } from '@cairn/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computerCall, machine } from '../db/schema.js';
import { isOwner } from './instance-owner.js';
import { localBrowserConnector } from './mcp-servers.js';

type MachineRow = typeof machine.$inferSelect;

export interface BrowserOffer {
  browser: boolean;
  takeover: boolean;
  stealth: boolean;
  ownerChrome: boolean;
}

export interface BrowserAudience {
  teamId: string;
  userId: string;
}

export function teamMachines(db: Pick<Db, 'select'>, teamId: string): MachineRow[] {
  return db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), isNull(machine.retiredAt)))
    .orderBy(desc(machine.lastSeenAt))
    .all();
}

function lastOwnerChromeMachine(db: Pick<Db, 'select'>, teamId: string): string | undefined {
  return db
    .select({ machineId: computerCall.machineId })
    .from(computerCall)
    .where(
      and(
        eq(computerCall.teamId, teamId),
        eq(computerCall.state, 'done'),
        isNull(computerCall.computerId),
        isNull(computerCall.phoneId),
        inArray(computerCall.tool, [...COMPUTER_BROWSER_TOOLS]),
      ),
    )
    .orderBy(desc(computerCall.createdAt))
    .limit(1)
    .get()?.machineId;
}

export function ownerChromeCandidates(db: Db, audience: BrowserAudience): MachineRow[] {
  if (localBrowserConnector(db, audience.teamId) === null) return [];
  const ownerThread = isOwner(db, audience.userId);
  const able = teamMachines(db, audience.teamId).filter((row) => {
    const drives = row.capabilities?.ownerChrome === true;
    if (row.kind === 'local') return drives || row.capabilities?.browser === true;
    return ownerThread && drives;
  });
  const remembered = lastOwnerChromeMachine(db, audience.teamId);
  const rank = (row: MachineRow) => (row.id === remembered ? 0 : row.kind === 'local' ? 1 : 2);
  return able.sort((a, b) => rank(a) - rank(b));
}

export function browserOfferFor(
  db: Db,
  audience: BrowserAudience,
  phones: readonly string[],
): BrowserOffer {
  const fleet = teamMachines(db, audience.teamId);
  const ownerChrome = ownerChromeCandidates(db, audience).length > 0;
  return {
    ownerChrome,
    browser: ownerChrome || fleet.some((row) => row.capabilities?.browser === true),
    takeover: phones.length > 0 || fleet.some((row) => row.capabilities?.screenHandoff === true),
    stealth: fleet.some((row) => row.capabilities?.stealthBrowser === true),
  };
}
