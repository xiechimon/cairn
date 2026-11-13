import { UNSTARTED_STEP_STATUSES } from '@cairn/shared';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { build, machine, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { applyStoppedStep, stopStepKeepPhase } from './build-stop.js';
import { applyStepFailure, type BuildDeps } from './builds.js';
import { stepActivityAt } from './dispatch-timeouts.js';
import { projectOfTodo } from './git.js';
import { projectMergeConfigOf } from './projects.js';
import { parseShipGateInstruction, settleAbandonedShip } from './ship-gate.js';

export const BUILD_ABANDONED_STEP_MS = 120_000;
export const ABANDONED_CLAIM_QUARANTINE_LIMIT = 3;

export function sweepAbandonedBuildSteps(deps: BuildDeps, now: number = nowMs()): void {
  const exitedLeftovers = deps.db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        or(isNotNull(todo.archivedAt), inArray(todo.phase, ['closed', 'done'])),
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
    if (ending === null || parseShipGateInstruction(row.prompt) !== null) continue;
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
  if (machineRow?.online && progressed) return null;
  return row.archiveStop !== null ||
    todoRow.archivedAt !== null ||
    todoRow.phase === 'closed' ||
    todoRow.phase === 'done'
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

export async function sweepAbandonedShipSteps(
  deps: BuildDeps,
  now: number = nowMs(),
): Promise<void> {
  const candidates = deps.db
    .select()
    .from(step)
    .where(and(eq(step.kind, 'merge'), eq(step.status, 'claimed')))
    .all()
    .filter((row) => parseShipGateInstruction(row.prompt) !== null);
  for (const row of candidates) {
    const todoRow = todoOfBuild(deps, row.buildId);
    if (todoRow === undefined || abandonedEnding(deps, row, todoRow, now) === null) continue;
    const violation = await settleAbandonedShip(deps, row);
    const current = deps.db.select().from(step).where(eq(step.id, row.id)).get();
    const currentTodo = todoOfBuild(deps, row.buildId);
    if (
      current?.status !== 'claimed' ||
      current.claimedAt !== row.claimedAt ||
      currentTodo === undefined
    )
      continue;
    if (violation !== null) {
      applyStepFailure(deps, current, violation);
      continue;
    }
    const ending = abandonedEnding(deps, current, currentTodo, now);
    if (ending !== null) applyAbandonedEnding(deps, current, currentTodo, ending);
  }
}

function todoOfBuild(deps: BuildDeps, buildId: string): typeof todo.$inferSelect | undefined {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  return buildRow && deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
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
  if (row.kind === 'merge' && row.prompt?.includes('"local-merge"')) {
    const projectRow = projectOfTodo(deps.db, todoRow);
    if (projectRow && projectMergeConfigOf(projectRow).mergePolicy === 'autonomous') return;
  }
  const noProgress =
    row.lastHeartbeatAt === null || row.lastHeartbeatAt <= (row.claimedAt ?? row.createdAt);
  const claims = noProgress ? row.claimCount + 1 : row.claimCount;
  if (noProgress && claims >= ABANDONED_CLAIM_QUARANTINE_LIMIT) {
    applyStepFailure(
      deps,
      row,
      `crashed ${claims} times after being claimed without progress; quarantined`,
    );
  } else {
    deps.db
      .update(step)
      .set({ status: 'pending', machineId: null, claimCount: claims })
      .where(eq(step.id, row.id))
      .run();
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
      skillInjection: released.skillInjection ?? null,
    });
  }
  deps.machineHub?.wake(todoRow.teamId);
}
