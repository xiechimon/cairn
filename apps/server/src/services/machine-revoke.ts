import { eq } from 'drizzle-orm';
import { machine, team } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import type { MachineDeps } from './machine-deps.js';
import { markOffline } from './machines.js';

export function revokeMachineToken(
  deps: Pick<MachineDeps, 'db' | 'hub' | 'machineHub'>,
  machineId: string,
): void {
  deps.db
    .update(machine)
    .set({ tokenHash: null, retiredAt: nowMs() })
    .where(eq(machine.id, machineId))
    .run();
  deps.db
    .update(team)
    .set({ defaultMachineId: null })
    .where(eq(team.defaultMachineId, machineId))
    .run();
  markOffline(deps, machineId);
  deps.machineHub.revokeMachine(machineId);
}
