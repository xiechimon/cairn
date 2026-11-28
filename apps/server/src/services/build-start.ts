import type { BuildRecord, TaskRequest, TriggerSource } from '@cairn/shared';
import {
  isInfoOutput,
  isRegisteredMachine,
  type RouteOverride,
  SESSION_BRIEF,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { build, machine, project, schedule } from '../db/schema.js';
import { HttpError, taskArchived } from '../lib/errors.js';
import { newUuidv7, nowMs } from '../lib/ids.js';
import { type BuildDeps, enqueueStep, NotFoundError, publishBuild } from './builds.js';
import { teamDefaultMachineId } from './machine-routing.js';
import { assertPhaseTransition } from './phase.js';
import { retryLessonsOf } from './retry-lessons.js';
import { assertAutomaticRetryAllowed } from './retry-parking.js';
import { profileForStep } from './routing-rules.js';
import { assertSplitProposalExecutable } from './split-proposal.js';
import { childrenOfTodo, getTodo, setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

export function assertNamedMachineForNewTask(deps: BuildDeps, teamId: string): void {
  namedMachineForStart(deps, { teamId }, undefined);
}

function namedMachineForStart(
  deps: BuildDeps,
  todoRecord: {
    teamId: string;
    projectId?: string;
    routeOverride?: RouteOverride | null;
    request?: TaskRequest | null;
  },
  routeOverride: RouteOverride | undefined,
): { machineId: string; pin: boolean } | null {
  const profile = profileForStep(deps.db, todoRecord, 'session', null);
  const named =
    routeOverride?.machineId ?? todoRecord.routeOverride?.machineId ?? profile?.machineId ?? null;
  if (named !== null) return { machineId: named, pin: false };
  if (
    (routeOverride?.requiredCapabilities?.os ?? profile?.requiredCapabilities?.os) !== undefined
  ) {
    return null;
  }
  if (teamDefaultMachineId(deps.db, todoRecord.teamId) !== null) return null;
  const registered = deps.db
    .select({
      id: machine.id,
      online: machine.online,
      kind: machine.kind,
      lastSeenAt: machine.lastSeenAt,
    })
    .from(machine)
    .where(and(eq(machine.teamId, todoRecord.teamId), isNull(machine.retiredAt)))
    .all()
    .filter(isRegisteredMachine);
  const online = registered.filter((row) => row.online);
  const onlyOnline = online[0];
  if (online.length === 1 && onlyOnline !== undefined)
    return { machineId: onlyOnline.id, pin: true };
  const onlyRegistered = registered[0];
  if (registered.length === 1 && onlyRegistered !== undefined) {
    return { machineId: onlyRegistered.id, pin: true };
  }
  throw new HttpError(409, 'Name a machine before starting this task');
}

export function startBuilds(
  deps: BuildDeps,
  input: {
    projectId: string;
    todoIds: string[];
    routeOverride?: RouteOverride;
    triggerSource?: TriggerSource;
    scheduledBy?: string;
    prompt?: string;
    schedule?: {
      id: string;
      expected: number | null;
      at: number;
      next: number | null;
      triggered: boolean;
    };
  },
): BuildRecord[] {
  const triggerSource = input.triggerSource ?? 'user';
  const projectRow = deps.db.select().from(project).where(eq(project.id, input.projectId)).get();
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord || todoRecord.projectId !== input.projectId) {
      throw new NotFoundError(`todo ${todoId}`);
    }
    if (projectRow?.teamId !== todoRecord.teamId) {
      throw new NotFoundError(`project ${input.projectId}`);
    }
    const overrideMachine = input.routeOverride?.machineId;
    if (overrideMachine !== undefined) {
      const owned = deps.db
        .select({
          id: machine.id,
          kind: machine.kind,
          online: machine.online,
          lastSeenAt: machine.lastSeenAt,
        })
        .from(machine)
        .where(
          and(
            eq(machine.id, overrideMachine),
            eq(machine.teamId, todoRecord.teamId),
            isNull(machine.retiredAt),
          ),
        )
        .get();
      if (owned === undefined || !isRegisteredMachine(owned)) {
        throw new NotFoundError(`machine ${overrideMachine}`);
      }
    }
    const previous =
      todoRecord.latestBuildId === null
        ? undefined
        : deps.db
            .select({ errorMessage: build.errorMessage })
            .from(build)
            .where(eq(build.id, todoRecord.latestBuildId))
            .get();
    if (todoRecord.archivedAt != null) throw taskArchived();
    if (triggerSource !== 'user') assertAutomaticRetryAllowed(deps, todoId);
    assertSplitProposalExecutable(previous?.errorMessage ?? null);
    namedMachineForStart(deps, todoRecord, input.routeOverride);
  }
  const created: BuildRecord[] = [];
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord) throw new NotFoundError(`todo ${todoId}`);
    assertPhaseTransition(todoRecord.phase, 'queued');
    const named = namedMachineForStart(deps, todoRecord, input.routeOverride);
    const routeOverride =
      input.routeOverride === undefined
        ? named?.pin === true
          ? { machineId: named.machineId }
          : undefined
        : {
            ...input.routeOverride,
            ...(input.routeOverride.machineId === undefined && named !== null
              ? { machineId: named.machineId }
              : {}),
          };
    const id = newUuidv7();
    const createdAt = nowMs();
    const previousRetry =
      triggerSource !== 'user' && todoRecord.phase === 'failed' && todoRecord.latestBuildId !== null
        ? deps.db
            .select({
              retryAttempt: build.retryAttempt,
              retryClass: build.retryClass,
              retryWindowStartedAt: build.retryWindowStartedAt,
            })
            .from(build)
            .where(eq(build.id, todoRecord.latestBuildId))
            .get()
        : undefined;
    const nextRetryAttempt =
      previousRetry === undefined
        ? 0
        : previousRetry.retryClass === 'rate_limit'
          ? previousRetry.retryAttempt
          : previousRetry.retryAttempt + 1;
    const nextRetryWindowStartedAt =
      previousRetry === undefined
        ? null
        : (previousRetry.retryWindowStartedAt ?? todoRecord.phaseAt);
    const afterCommit: (() => void)[] = [];
    deps.db.transaction(() => {
      deps.db
        .insert(build)
        .values({
          id,
          todoId,
          withPlan: false,
          prevPhase: todoRecord.phase,
          triggerSource,
          retryAttempt: nextRetryAttempt,
          retryClass: null,
          retryNextAt: null,
          retryWindowStartedAt: nextRetryWindowStartedAt,
          retryParkReason: null,
          scheduledBy: input.scheduledBy ?? null,
          planDocId: null,
          errorMessage: null,
          failureCode: null,
          failureDetail: null,
          prUrl: null,
          prNumber: null,
          changes: null,
          diffHash: null,
          createdAt,
        })
        .run();
      const lessons =
        todoRecord.phase === 'failed' && todoRecord.latestBuildId !== null
          ? retryLessonsOf(deps.db, todoRecord.latestBuildId)
          : null;
      const stepPrompt =
        [isInfoOutput(todoRecord.output) ? null : SESSION_BRIEF, input.prompt, lessons]
          .filter((part) => part != null && part !== '')
          .join('\n\n') || undefined;
      const scheduledStep = enqueueStep(
        deps,
        id,
        'session',
        todoRecord.teamId,
        stepPrompt,
        undefined,
        undefined,
        { kind: 'first-task' },
        input.schedule === undefined ? undefined : { scheduleId: input.schedule.id },
        input.schedule === undefined ? undefined : afterCommit,
      );
      if (input.schedule !== undefined) {
        const wake = input.schedule;
        insertMessageRow({ ...deps, afterCommit }, id, {
          id: `schedule-wake-${scheduledStep.id}`,
          role: 'system',
          content: JSON.stringify({ kind: 'schedule-wake', stepId: scheduledStep.id }),
          createdAt: wake.at,
        });
        const marked = deps.db
          .update(schedule)
          .set({
            lastRunAt: wake.at,
            lastRunStatus: 'started',
            lastRunError: null,
            retryNotBefore: null,
            lastRunStepId: scheduledStep.id,
            nextRunAt: wake.next,
          })
          .where(
            and(
              eq(schedule.id, wake.id),
              eq(schedule.enabled, true),
              wake.expected === null
                ? isNull(schedule.nextRunAt)
                : eq(schedule.nextRunAt, wake.expected),
            ),
          )
          .run().changes;
        if (marked === 0) {
          if (!wake.triggered) {
            throw new HttpError(409, 'Scheduled wake is no longer due');
          }
          const queued = deps.db
            .update(schedule)
            .set({
              lastRunAt: wake.at,
              lastRunStatus: 'started',
              lastRunError: null,
              retryNotBefore: null,
              lastRunStepId: scheduledStep.id,
            })
            .where(and(eq(schedule.id, wake.id), eq(schedule.enabled, true)))
            .run().changes;
          if (queued === 0) throw new HttpError(409, 'Scheduled wake is no longer due');
        }
      }
      setTodoPhase(deps, todoId, 'queued', {
        ...(routeOverride !== undefined ? { routeOverride } : {}),
        latestBuildId: id,
        lastRunAt: createdAt,
      });
    });
    for (const publish of afterCommit) publish();
    const row = deps.db.select().from(build).where(eq(build.id, id)).get();
    if (!row) throw new Error('build missing after insert');
    created.push(publishBuild(deps, row));
  }
  return created;
}

export function dispatchSplitChildren(deps: BuildDeps, parentId: string): number {
  let dispatched = 0;
  for (const child of childrenOfTodo(deps.db, parentId).filter((c) => c.phase === 'todo')) {
    try {
      startBuilds(deps, {
        projectId: child.projectId,
        todoIds: [child.id],
        triggerSource: 'chief',
      });
      dispatched += 1;
    } catch (error) {
      console.warn('Split child not dispatched', { parentId, childId: child.id, error });
    }
  }
  return dispatched;
}
