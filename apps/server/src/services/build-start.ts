import type { BuildRecord, TriggerSource } from '@cairn/shared';
import { type RouteOverride, SESSION_BRIEF } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { build, machine, project } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newUuidv7, nowMs } from '../lib/ids.js';
import { type BuildDeps, enqueueStep, NotFoundError, publishBuild } from './builds.js';
import { teamDefaultMachineId } from './machine-routing.js';
import { assertPhaseTransition } from './phase.js';
import { retryLessonsOf } from './retry-lessons.js';
import { assertAutomaticRetryAllowed } from './retry-parking.js';
import { profileForStep } from './routing-rules.js';
import { assertSplitProposalExecutable } from './split-proposal.js';
import { childrenOfTodo, getTodo, setTodoPhase } from './todos.js';

export function assertNamedMachineForNewTask(deps: BuildDeps, teamId: string): void {
  namedMachineForStart(deps, { teamId }, undefined);
}

function namedMachineForStart(
  deps: BuildDeps,
  todoRecord: { teamId: string; routeOverride?: RouteOverride | null },
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
    .select({ id: machine.id, online: machine.online })
    .from(machine)
    .where(eq(machine.teamId, todoRecord.teamId))
    .all();
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
    if (
      overrideMachine !== undefined &&
      deps.db
        .select({ id: machine.id })
        .from(machine)
        .where(and(eq(machine.id, overrideMachine), eq(machine.teamId, todoRecord.teamId)))
        .get() === undefined
    ) {
      throw new NotFoundError(`machine ${overrideMachine}`);
    }
    const previous =
      todoRecord.latestBuildId === null
        ? undefined
        : deps.db
            .select({ errorMessage: build.errorMessage })
            .from(build)
            .where(eq(build.id, todoRecord.latestBuildId))
            .get();
    if (todoRecord.archivedAt != null) throw new HttpError(409, 'Unarchive to continue');
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
    deps.db
      .insert(build)
      .values({
        id,
        todoId,
        withPlan: false,
        prevPhase: todoRecord.phase,
        triggerSource,
        scheduledBy: input.scheduledBy ?? null,
        planDocId: null,
        errorMessage: null,
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
    enqueueStep(
      deps,
      id,
      'session',
      todoRecord.teamId,
      [SESSION_BRIEF, input.prompt, lessons].filter((part) => part != null).join('\n\n'),
    );
    setTodoPhase(deps, todoId, 'queued', {
      ...(routeOverride !== undefined ? { routeOverride } : {}),
      latestBuildId: id,
      lastRunAt: createdAt,
    });
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
