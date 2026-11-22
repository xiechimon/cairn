import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine } from '../db/schema.js';

export function teamHasVmComputer(db: Db, teamId: string): boolean {
  return db
    .select({ capabilities: machine.capabilities })
    .from(machine)
    .where(eq(machine.teamId, teamId))
    .all()
    .some((row) => row.capabilities?.computer === true && row.capabilities.computerKind === 'vm');
}
