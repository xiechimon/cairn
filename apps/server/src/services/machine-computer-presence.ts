import type { ComputerPresence } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { computer } from '../db/schema.js';
import { computerMachineName, computerVmName } from './machine-computer.js';

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
          ),
        )
        .get();
      if (!row) continue;
      const adoptsVmRef =
        report.providerRef === computerVmName(report.scopeKey) &&
        row.providerRef === computerMachineName(report.scopeKey);
      if (row.providerRef !== report.providerRef && !adoptsVmRef) continue;
      if (row.state === report.state && !adoptsVmRef) continue;
      db.update(computer)
        .set({
          providerRef: report.providerRef,
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
