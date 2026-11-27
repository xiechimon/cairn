import { and, eq, isNull } from 'drizzle-orm';
import { build, machine, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { BLOCKED_BY_HOLD } from './blockers.js';
import { waitingSince } from './machine-routing.js';
import {
  type ActiveCondition,
  type NotificationDeps,
  notifyNoMachine,
  raiseConditionNotices,
} from './notifications.js';
import { profileForStep } from './routing-rules.js';
import { stepQueueProjector } from './step-queue.js';

export const NO_MACHINE_ALERT_MS = 10 * 60_000;

type NoMachineReason =
  | 'capability-missing'
  | 'machine-retired'
  | 'github-push-missing'
  | 'runner-cannot-run'
  | 'no-runner';

export function sweepUnplaceableSteps(deps: NotificationDeps, now: number = nowMs()): number {
  const rows = deps.db
    .select({ stepRow: step, todoRow: todo })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'pending'), isNull(todo.archivedAt)))
    .all();
  const projectors = new Map<string, ReturnType<typeof stepQueueProjector>>();
  const unplaceable: ActiveCondition[] = [];
  for (const { stepRow, todoRow } of rows) {
    if (stepRow.holdReason === 'quota' || stepRow.holdReason === BLOCKED_BY_HOLD) continue;
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
    const minutes = Math.floor(waited / 60_000);
    const preferredName =
      homeMachineId === null
        ? null
        : (deps.db.select().from(machine).where(eq(machine.id, homeMachineId)).get()?.name ?? null);
    const runnerName = queue.waitingFor?.name ?? preferredName;
    const reason: NoMachineReason =
      queue.blocked.kind === 'capability-missing'
        ? 'capability-missing'
        : queue.blocked.kind === 'machine-retired'
          ? 'machine-retired'
          : queue.blocked.kind === 'github-push-missing'
            ? 'github-push-missing'
            : preferredName !== null
              ? 'runner-cannot-run'
              : 'no-runner';
    const waitedFor = `步骤已等 ${minutes} 分钟`;
    const snippet = {
      'capability-missing': `没有在线执行机满足要求（缺 ${queue.blocked.missing.join('、')}），${waitedFor}`,
      'machine-retired': `${runnerName ?? '这一步绑定的执行机'} 已删除或注销，这一步不会改派：重新注册这台执行机，或在「设置 → 模型」中重新配置，${waitedFor}`,
      'github-push-missing': `${runnerName ?? '在线执行机'} 无法推送到该 GitHub 仓库，在${runnerName ?? '执行机'}上运行 gh auth login 后自动继续，${waitedFor}`,
      'runner-cannot-run': `${preferredName} 无法运行这一步，不会改派到其他执行机，${waitedFor}`,
      'no-runner': `没有可运行这一步的在线执行机，${waitedFor}`,
    }[reason];
    unplaceable.push({
      subjectId: stepRow.id,
      fingerprint: `${reason}:${since}`,
      notify: () => notifyNoMachine(deps, todoRow, snippet),
    });
  }
  return raiseConditionNotices(deps, 'no_machine', unplaceable, now);
}
