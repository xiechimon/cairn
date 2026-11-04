import type { ComputerPresence } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computer } from '../db/schema.js';

export function applyComputerPresence(
  db: Db,
  machineId: string,
  teamId: string,
  reports: readonly ComputerPresence[] | undefined,
  now: number,
): boolean {
  if (!reports?.length) return false;
  return db.transaction(() => {
    let changed = false;
    for (const report of reports) {
      const row = db
        .select()
        .from(computer)
        .where(
          and(
            eq(computer.machineId, machineId),
            eq(computer.teamId, teamId),
            eq(computer.scopeKey, report.scopeKey),
            eq(computer.providerRef, report.providerRef),
          ),
        )
        .get();
      if (!row || row.state === report.state) continue;
      db.update(computer)
        .set({
          state: report.state,
          runningSince: report.state === 'running' ? now : null,
          updatedAt: now,
        })
        .where(eq(computer.id, row.id))
        .run();
      changed = true;
    }
    return changed;
  });
}
