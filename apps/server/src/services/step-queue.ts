import {
  type ChiefThread,
  parseLocalMergeInstruction,
  RUNNER_OS_LABELS,
  type StepQueueBlocked,
  type StepQueueInfo,
} from '@cairn/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, machine, routingRule, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { missingCapabilities, runtimeGatePasses } from './dispatch-eligibility.js';
import { projectOfTodo } from './git.js';
import {
  platformFallbackMachineId,
  priorSessionOf,
  type RouteVerdict,
  routeTargets,
  routeVerdict,
  targetUnavailable,
  teamDefaultMachineId,
  type WorkerStepFacts,
  workerIneligibility,
} from './machine-routing.js';
import { effectiveModel } from './model-fallback.js';
import { mergedCatalogModels } from './model-liveness.js';
import {
  coordinatorProfile,
  profileForStep,
  type RouteProfile,
  routeForStep,
} from './routing-rules.js';

export interface QueueTargetStep {
  id: string;
  createdAt: number;
  homeMachineId: string | null;
  holdReason?: string | null;
  holdUntil?: number | null;
}

export function stepQueueProjector(db: Db, teamId: string) {
  const workerRows = db
    .select({
      id: step.id,
      createdAt: step.createdAt,
      kind: step.kind,
      prompt: step.prompt,
      fallback: step.fallback,
      buildId: step.buildId,
      freshSession: step.freshSession,
      holdUntil: step.holdUntil,
      buildRow: build,
      todoRow: todo,
    })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'pending'), eq(todo.teamId, teamId)))
    .all();
  const workerQueue = workerRows.map((r) => ({
    ...r,
    home: profileForStep(db, r.todoRow, r.kind, r.id)?.machineId ?? null,
  }));
  const chiefRows = db
    .select({
      id: step.id,
      createdAt: step.createdAt,
      threadId: step.buildId,
      teamId: chiefThread.teamId,
      holdReason: step.holdReason,
      holdUntil: step.holdUntil,
      chiefId: chiefThread.chiefId,
    })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .innerJoin(
      routingRule,
      and(eq(routingRule.teamId, chiefThread.teamId), eq(routingRule.use, 'coordinator')),
    )
    .where(and(eq(step.status, 'pending'), eq(step.kind, 'chief'), eq(chiefThread.teamId, teamId)))
    .all()
    .map((row) => ({
      ...row,
      home: coordinatorProfile(db, teamId)?.machineId ?? null,
    }));
  const queue = [...workerQueue, ...chiefRows].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );

  const claimedCountCache = new Map<string, number>();
  const claimedCount = (machineId: string): number => {
    const hit = claimedCountCache.get(machineId);
    if (hit !== undefined) return hit;
    const n = db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
      .all().length;
    claimedCountCache.set(machineId, n);
    return n;
  };
  const machineCache = new Map<string, typeof machine.$inferSelect | undefined>();
  const machineRowOf = (machineId: string) => {
    if (!machineCache.has(machineId)) {
      machineCache.set(machineId, db.select().from(machine).where(eq(machine.id, machineId)).get());
    }
    return machineCache.get(machineId);
  };

  const teamMachines = db.select().from(machine).where(eq(machine.teamId, teamId)).all();
  const defaultMachineId = teamDefaultMachineId(db, teamId);
  function agentForRow(row: (typeof queue)[number]): RouteProfile | null {
    if ('todoRow' in row) return profileForStep(db, row.todoRow, row.kind, row.id);
    return coordinatorProfile(db, teamId);
  }

  const catalog = mergedCatalogModels();

  interface WorkerRouting {
    verdict: RouteVerdict;
    blocked: StepQueueBlocked | undefined;
  }

  function workerRouting(
    target: QueueTargetStep,
    row: (typeof workerQueue)[number],
  ): WorkerRouting | null {
    const agentRow = agentForRow(row);
    if (agentRow === null || agentRow.modelId == null) return null;
    const now = nowMs();
    const facts: WorkerStepFacts = {
      agentRow,
      model: effectiveModel(agentRow, row),
      localProject: projectOfTodo(db, row.todoRow)?.repoKind === 'local',
      localMerge: parseLocalMergeInstruction(row.prompt) !== null,
    };
    const unavailable = (id: string) =>
      targetUnavailable(db, machineRowOf(id), teamId, facts, catalog, now);
    const prior = priorSessionOf(db, row, row.buildRow);
    const need = agentRow.requiredCapabilities?.os;
    const sole = platformFallbackMachineId(db, teamMachines, defaultMachineId, need);
    const verdict = routeVerdict({
      machineId: null,
      targets: routeTargets(
        !prior.freshSession && prior.priorSessionId !== null ? prior.priorMachineId : null,
        target.homeMachineId,
        sole,
      ),
    });
    if (verdict.claim) return { verdict, blocked: undefined };
    const named = verdict.waitingFor;
    const platform = need === undefined ? {} : { platform: need };
    if (named === null) {
      return {
        verdict,
        blocked:
          need === undefined
            ? { kind: 'machine-offline', missing: [] }
            : { kind: 'capability-missing', missing: [RUNNER_OS_LABELS[need]], ...platform },
      };
    }
    if (!unavailable(named)) return { verdict, blocked: undefined };
    const home = machineRowOf(named);
    if (home === undefined || !home.online) {
      return { verdict, blocked: { kind: 'machine-offline', missing: [], ...platform } };
    }
    const gap = workerIneligibility(db, home, facts, catalog, now);
    return {
      verdict,
      blocked:
        gap?.kind === 'capability'
          ? { kind: 'capability-missing', missing: gap.missing }
          : undefined,
    };
  }

  function blockedFor(
    target: QueueTargetStep,
    row: (typeof queue)[number],
  ): StepQueueBlocked | undefined {
    if (target.homeMachineId === null) {
      return { kind: 'machine-offline', missing: [] };
    }
    const home = teamMachines.find((m) => m.id === target.homeMachineId);
    if (home === undefined || !home.online) {
      return { kind: 'machine-offline', missing: [] };
    }
    const agentRow = agentForRow(row);
    const provider =
      ('fallback' in row ? row.fallback?.model?.provider : undefined) ?? agentRow?.provider;
    if (agentRow?.modelId != null && runtimeGatePasses(home, provider)) {
      const missing = missingCapabilities(home, agentRow);
      if (missing.length > 0) return { kind: 'capability-missing', missing };
    }
    return undefined;
  }

  function project(target: QueueTargetStep): StepQueueInfo | null {
    const queueRow = queue.find((r) => r.id === target.id);
    if (queueRow === undefined) return null;
    const pool = queue.filter((r) => r.home === target.homeMachineId);
    const position = pool.findIndex((r) => r.id === target.id) + 1;
    if (position === 0) return null;
    const routing =
      'todoRow' in queueRow && routeForStep(db, queueRow.todoRow, queueRow.kind) !== null
        ? workerRouting(target, queueRow)
        : null;
    const waitingOn =
      routing === null
        ? target.homeMachineId
        : routing.verdict.claim
          ? null
          : routing.verdict.waitingFor;
    let waitingFor: StepQueueInfo['waitingFor'] = null;
    if (waitingOn !== null) {
      const row = machineRowOf(waitingOn);
      if (row !== undefined) {
        waitingFor = {
          machineId: row.id,
          name: row.name,
          running: claimedCount(row.id),
          capacity: row.maxConcurrent,
        };
      }
    }
    const hold: StepQueueInfo['hold'] =
      target.holdReason === 'quota' && target.holdUntil != null
        ? { reason: 'quota', retryAt: target.holdUntil }
        : undefined;
    const blocked = routing !== null ? routing.blocked : blockedFor(target, queueRow);
    return {
      position,
      waitingFor,
      ...(hold !== undefined ? { hold } : {}),
      ...(blocked !== undefined ? { blocked } : {}),
    };
  }

  function pendingChiefOf(threadId: string): QueueTargetStep | null {
    const turnRunning = db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, threadId), eq(step.kind, 'chief'), eq(step.status, 'claimed')))
      .get();
    if (turnRunning !== undefined) return null;
    const rows = chiefRows.filter((r) => r.threadId === threadId);
    const last = rows[rows.length - 1];
    if (last === undefined) return null;
    return {
      id: last.id,
      createdAt: last.createdAt,
      homeMachineId: last.home,
      holdReason: last.holdReason,
      holdUntil: last.holdUntil,
    };
  }

  function chiefTurnQueueOf(threadId: string): ChiefThread['turnQueue'] {
    if (pendingChiefOf(threadId) === null) return null;
    const oldest = db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, threadId), eq(step.kind, 'chief'), eq(step.status, 'pending')))
      .orderBy(asc(step.createdAt), sql`rowid`)
      .get();
    const head = chiefRows.find((r) => r.id === oldest?.id);
    if (head === undefined) return null;
    const info = project({
      id: head.id,
      createdAt: head.createdAt,
      homeMachineId: head.home,
      holdReason: head.holdReason,
      holdUntil: head.holdUntil,
    });
    return info === null ? null : { ...info, stepId: head.id };
  }

  return { project, pendingChiefOf, chiefTurnQueueOf };
}
