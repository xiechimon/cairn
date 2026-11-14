import { and, eq, isNull } from 'drizzle-orm';
import { build, machine, notification, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { waitingSince } from './machine-routing.js';
import { type NotificationDeps, notifyNoMachine } from './notifications.js';
import { profileForStep } from './routing-rules.js';
import { stepQueueProjector } from './step-queue.js';

export const NO_MACHINE_ALERT_MS = 10 * 60_000;

export function sweepUnplaceableSteps(deps: NotificationDeps, now: number = nowMs()): number {
  const rows = deps.db
    .select({ stepRow: step, todoRow: todo })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'pending'), isNull(todo.archivedAt)))
    .all();
  const projectors = new Map<string, ReturnType<typeof stepQueueProjector>>();
  let raised = 0;
  for (const { stepRow, todoRow } of rows) {
    if (stepRow.holdReason === 'quota') continue;
    const since = waitingSince(stepRow);
    const waited = now - since;
    if (waited < NO_MACHINE_ALERT_MS) continue;
    const projector = projectors.get(todoRow.teamId) ?? stepQueueProjector(deps.db, todoRow.teamId);
    projectors.set(todoRow.teamId, projector);
    const homeMachineId =
      profileForStep(deps.db, todoRow, stepRow.kind, stepRow.id)?.machineId ?? null;
    const queue = projector.project({
      id: stepRow.id,
      createdAt: stepRow.createdAt,
      homeMachineId,
      holdReason: stepRow.holdReason,
      holdUntil: stepRow.holdUntil,
    });
    if (queue?.blocked === undefined) continue;
    if (queue.blocked.kind === 'machine-offline' && queue.waitingFor !== null) continue;
    const existing = deps.db
      .select()
      .from(notification)
      .where(eq(notification.id, `${deps.user.id}:${todoRow.id}`))
      .get();
    if (existing?.type === 'no_machine' && existing.createdAt >= since) continue;
    const minutes = Math.floor(waited / 60_000);
    const preferredName =
      homeMachineId === null
        ? null
        : (deps.db.select().from(machine).where(eq(machine.id, homeMachineId)).get()?.name ?? null);
    const snippet =
      queue.blocked.kind === 'capability-missing'
        ? `没有在线机器满足要求（缺 ${queue.blocked.missing.join('、')}），步骤已等 ${minutes} 分钟`
        : preferredName !== null
          ? `${preferredName} 不能跑这一步，不会改派到其他机器，步骤已等 ${minutes} 分钟`
          : `没有在线机器能跑这一步，步骤已等 ${minutes} 分钟`;
    notifyNoMachine(deps, todoRow, snippet);
    raised += 1;
  }
  return raised;
}
