import { COMPUTER_BROWSER_TOOLS } from '@cairn/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computerCall, machine, step } from '../db/schema.js';
import { browserScopeFor, type ComputerThread, computerThreadOf } from './computer-thread.js';
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

export interface BrowserProducer {
  machineId: string;
  ownerChrome: boolean;
}

export function lastBrowserProducer(
  db: Pick<Db, 'select'>,
  thread: ComputerThread,
): BrowserProducer | undefined {
  const rows = db
    .select({
      machineId: computerCall.machineId,
      computerId: computerCall.computerId,
      phoneId: computerCall.phoneId,
      kind: step.kind,
      buildId: step.buildId,
    })
    .from(computerCall)
    .innerJoin(step, eq(step.id, computerCall.stepId))
    .where(
      and(
        eq(computerCall.teamId, thread.teamId),
        eq(computerCall.state, 'done'),
        inArray(computerCall.tool, [...COMPUTER_BROWSER_TOOLS]),
      ),
    )
    .orderBy(desc(sql`"computer_call"."rowid"`))
    .limit(100)
    .all();
  const wanted = browserScopeFor(thread);
  for (const row of rows) {
    const producedIn = computerThreadOf(db, { kind: row.kind, buildId: row.buildId });
    if (producedIn === null || browserScopeFor(producedIn) !== wanted) continue;
    return {
      machineId: row.machineId,
      ownerChrome: row.computerId === null && row.phoneId === null,
    };
  }
  return undefined;
}

function lastOwnerChromeMachine(
  db: Pick<Db, 'select'>,
  thread: ComputerThread | undefined,
): string | undefined {
  if (thread === undefined) return undefined;
  const producer = lastBrowserProducer(db, thread);
  return producer?.ownerChrome === true ? producer.machineId : undefined;
}

export function ownerChromeCandidates(
  db: Db,
  audience: BrowserAudience,
  thread?: ComputerThread,
): MachineRow[] {
  if (localBrowserConnector(db, audience.teamId) === null) return [];
  const ownerThread = isOwner(db, audience.userId);
  const able = teamMachines(db, audience.teamId).filter((row) => {
    const drives = row.capabilities?.ownerChrome === true;
    return ownerThread && drives;
  });
  const remembered = lastOwnerChromeMachine(db, thread);
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
