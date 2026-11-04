import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type agent, machine, project } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { pinAllows, workerIneligibility } from './machine-routing.js';
import { mergedCatalogModels } from './model-liveness.js';
import { applyRoute, policyForStep, type routeForStep } from './routing-rules.js';

export function runnableResearchAgentIds(
  db: Db,
  input: { teamId: string; projectId: string },
  candidates: readonly (typeof agent.$inferSelect)[],
  route: ReturnType<typeof routeForStep>,
): Set<string> {
  const machines = db.select().from(machine).where(eq(machine.teamId, input.teamId)).all();
  const policy = policyForStep(db, { teamId: input.teamId }, 'build');
  const localProject =
    db.select().from(project).where(eq(project.id, input.projectId)).get()?.repoKind === 'local';
  const catalog = mergedCatalogModels();
  const now = nowMs();
  return new Set(
    candidates
      .filter((row) => {
        const effective = applyRoute(row, route, null, policy);
        const facts = {
          agentRow: effective,
          model: effective,
          localProject,
          localMerge: false,
          routed: route !== null,
        };
        return machines.some(
          (host) =>
            host.online &&
            workerIneligibility(db, host, facts, catalog, now) === null &&
            (route !== null ||
              pinAllows({
                machineId: host.id,
                pinnedId: effective.machineId,
                pinned: machines.find((candidate) => candidate.id === effective.machineId),
                model: effective,
                now,
              })),
        );
      })
      .map((row) => row.id),
  );
}
