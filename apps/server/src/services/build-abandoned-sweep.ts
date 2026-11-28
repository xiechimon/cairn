import { UNSTARTED_STEP_STATUSES } from '@cairn/shared';
import { and, eq, inArray, isNotNull, ne, or } from 'drizzle-orm';
import { build, machine, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { applyStoppedStep, stopStepKeepPhase } from './build-stop.js';
import { applyStepFailure, type BuildDeps } from './builds.js';
import { ABANDONED_CLAIM_QUARANTINE_LIMIT, stepActivityAt } from './dispatch-timeouts.js';
import { readSkillInjection } from './step-groups/skill-injection.js';
import { releaseStepLease } from './step-lease.js';
import { isStepWaitingPermission } from './step-permission-wait.js';

export const BUILD_ABANDONED_STEP_MS = 120_000;

export function sweepAbandonedBuildSteps(deps: BuildDeps, now: number = nowMs()): void {
  const exitedLeftovers = deps.db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        or(
          isNotNull(todo.archivedAt),
          eq(todo.phase, 'closed'),
          and(eq(todo.phase, 'done'), ne(step.kind, 'merge')),
        ),
        inArray(step.status, [...UNSTARTED_STEP_STATUSES]),
      ),
    )
    .all();
  for (const { id } of exitedLeftovers) stopStepKeepPhase(deps, id);
  const candidates = deps.db
    .select()
    .from(step)
    .where(
      and(
        inArray(step.kind, ['plan', 'build', 'session', 'merge', 'review', 'verify']),
        inArray(step.status, ['pending', 'claimed']),
      ),
    )
    .all();
  for (const row of candidates) {
    if (row.status === 'pending') continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
    if (!buildRow) continue;
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (!todoRow) continue;
    const ending = abandonedEnding(deps, row, todoRow, now);
    if (ending === null) continue;
    applyAbandonedEnding(deps, row, todoRow, ending);
  }
}

type AbandonedEnding = 'stop' | 'release';

function abandonedEnding(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  now: number,
): AbandonedEnding | null {
  if (now - stepActivityAt(row) <= BUILD_ABANDONED_STEP_MS) return null;
  const machineRow = row.machineId
    ? deps.db.select().from(machine).where(eq(machine.id, row.machineId)).get()
    : undefined;
  const progressed =
    row.lastHeartbeatAt !== null && row.lastHeartbeatAt > (row.claimedAt ?? row.createdAt);
  const live = machineRow?.online === true && !deps.machineHub?.silentSinceDrop(machineRow.id);
  if (live && isStepWaitingPermission(deps.db, row)) return null;
  if (live && progressed) return null;
  return row.archiveStop !== null ||
    todoRow.archivedAt !== null ||
    todoRow.latestBuildId !== row.buildId ||
    todoRow.phase === 'closed' ||
    (todoRow.phase === 'done' && row.kind !== 'merge')
    ? 'stop'
    : 'release';
}

function applyAbandonedEnding(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  ending: AbandonedEnding,
): void {
  if (ending === 'stop') stopStepKeepPhase(deps, row.id);
  else releaseClaimedStep(deps, row, todoRow);
}

function releaseClaimedStep(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
): void {
  if (row.archiveStop !== null) {
    applyStoppedStep(deps, row.id);
    return;
  }
  if (
    row.kind === 'merge' &&
    (row.prompt?.includes('"local-merge"') || row.prompt?.includes('"local-folder-action"'))
  )
    return;
  const noProgress =
    row.lastHeartbeatAt === null || row.lastHeartbeatAt <= (row.claimedAt ?? row.createdAt);
  const claims = noProgress ? row.claimCount + 1 : row.claimCount;
  if (noProgress && claims >= ABANDONED_CLAIM_QUARANTINE_LIMIT) {
    applyStepFailure(
      deps,
      row,
      `crashed ${claims} times after being claimed without progress; quarantined`,
      undefined,
      { code: 'runner_disconnect' },
    );
  } else if (
    !releaseStepLease(deps.db, row.id, {
      claimCount: claims,
      expectedMachineId: row.machineId,
      expectedClaimedAt: row.claimedAt,
    })
  ) {
    return;
  }
  const released = deps.db.select().from(step).where(eq(step.id, row.id)).get();
  if (released) {
    deps.convHub?.publishStep(row.buildId, {
      id: released.id,
      buildId: released.buildId,
      kind: released.kind,
      machineId: released.machineId,
      createdAt: released.createdAt,
      status: released.status,
      checkpointCommit: released.checkpointCommit,
      skillInjection: readSkillInjection(deps.db, released.id).skillInjection,
    });
  }
  deps.machineHub?.wake(todoRow.teamId);
}
