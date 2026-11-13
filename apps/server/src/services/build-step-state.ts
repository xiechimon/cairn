import type { StepKind } from '@cairn/shared';
import { UNSTARTED_STEP_STATUSES } from '@cairn/shared';
import { and, desc, eq, inArray, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import { type build, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { isFullSha } from '../lib/github.js';
import type { BuildDeps } from './builds.js';
import { retryIsParked } from './retry-parking.js';

type BuildRow = typeof build.$inferSelect;

export const mergingBuilds = new Set<string>();

export function stepKindInFlight(deps: BuildDeps, buildId: string): StepKind | null {
  return (
    deps.db
      .select({ kind: step.kind })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          or(
            eq(step.status, 'claimed'),
            and(
              inArray(step.status, [...UNSTARTED_STEP_STATUSES]),
              notInArray(step.kind, ['verify', 'review']),
            ),
          ),
        ),
      )
      .get()?.kind ?? null
  );
}

export function hasActiveStep(deps: BuildDeps, buildId: string): boolean {
  return mergingBuilds.has(buildId) || stepKindInFlight(deps, buildId) !== null;
}

export function assertParkedBuildIdle(deps: BuildDeps, row: BuildRow): void {
  if (retryIsParked(row.errorMessage ?? '') && hasActiveStep(deps, row.id))
    throw new HttpError(
      409,
      `${row.errorMessage} Wait for active steps to finish before retrying.`,
    );
}

export function lastPushedCheckpoint(
  deps: BuildDeps,
  buildId: string,
  opts: { mergeSteps: boolean },
): string | null {
  return (
    deps.db
      .select({ commit: step.checkpointCommit })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          notInArray(step.kind, opts.mergeSteps ? ['review'] : ['review', 'merge']),
          eq(step.status, 'done'),
          isNotNull(step.checkpointCommit),
        ),
      )
      .orderBy(
        desc(
          sql`coalesce(${step.finishedAt}, ${step.lastHeartbeatAt}, ${step.claimedAt}, ${step.createdAt})`,
        ),
        desc(step.createdAt),
      )
      .get()?.commit ?? null
  );
}

export function dispatchHeadSha(deps: BuildDeps, buildId: string): string | null {
  const rows = deps.db
    .select({ commit: step.checkpointCommit })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        notInArray(step.kind, ['review', 'merge', 'verify']),
        eq(step.status, 'done'),
        isNotNull(step.checkpointCommit),
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${step.finishedAt}, ${step.lastHeartbeatAt}, ${step.claimedAt}, ${step.createdAt})`,
      ),
      desc(step.createdAt),
    )
    .all();
  for (const row of rows) {
    if (row.commit !== null && isFullSha(row.commit)) return row.commit;
  }
  return null;
}
