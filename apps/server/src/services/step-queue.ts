import {
  type ChiefThread,
  isChiefSideThreadId,
  isRegisteredMachine,
  type MachineQueuedThread,
  MODEL_SOURCE_RUNTIME_LABELS,
  parseLocalFolderActionInstruction,
  parseLocalMergeInstruction,
  RUNNER_OS_LABELS,
  type StepQueueBlocked,
  type StepQueueInfo,
} from '@cairn/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, chiefThread, machine, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { enabledAntigravitySubscriptionId } from './antigravity-subscriptions.js';
import { BLOCKED_BY_HOLD, unmetBlockerTitles } from './blockers.js';
import { accountHeld } from './claude-account-hold.js';
import { enabledSubscriptionId } from './claude-subscriptions.js';
import { coordinatorInServerEnabled } from './coordinator-context.js';
import { type CoordinatorRouteRefusal, coordinatorRouteVerdict } from './coordinator-route.js';
import { enabledDevinSubscriptionId } from './devin-subscriptions.js';
import {
  type MachineIneligibility,
  requiredGithubPushRepoForStep,
  stepRuntimeFor,
} from './dispatch-eligibility.js';
import { activeDoubaoSource, enabledDoubaoSubscriptionId } from './doubao-subscriptions.js';
import { projectOfTodo } from './git.js';
import {
  chiefIneligibility,
  machineCanReturn,
  priorSessionOf,
  type RouteLockReason,
  type RouteVerdict,
  resolveChiefCandidates,
  resolveWorkerCandidates,
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

function ineligibleBlocked(
  gap: MachineIneligibility,
  runtime: string,
  machineName?: string,
): StepQueueBlocked {
  switch (gap.kind) {
    case 'runner-outdated':
      return { kind: 'runner-outdated', missing: [] };
    case 'capability':
      return { kind: 'capability-missing', missing: gap.missing };
    case 'runtime':
      return { kind: 'runtime-disabled', missing: [runtime] };
    case 'model':
      return { kind: 'model-unavailable', missing: [] };
    case 'local-path':
      return { kind: 'local-path', missing: [] };
    case 'claude-blocked':
      return { kind: 'claude-rate-limited', missing: [] };
    case 'claude-login':
      return { kind: 'claude-logged-out', missing: [] };
    case 'devin-subscription':
      return { kind: 'devin-subscription', missing: [] };
    case 'antigravity-subscription':
      return { kind: 'antigravity-subscription', missing: [] };
    case 'doubao-subscription':
      return { kind: 'doubao-subscription', missing: [] };
    case 'doubao-login-required':
      return { kind: 'doubao-login-required', missing: machineName ? [machineName] : [] };
    case 'github-push':
      return { kind: 'github-push-missing', missing: [] };
  }
}

function coordinatorRefusalBlocked(
  refusal: CoordinatorRouteRefusal,
  rule: { provider: string; modelId: string } | undefined,
): StepQueueBlocked {
  switch (refusal) {
    case 'no-api-key-provider':
    case 'rule-provider-missing':
      return {
        kind: 'coordinator-provider-missing',
        missing: rule === undefined ? [] : [rule.provider],
      };
    case 'rule-provider-has-no-key':
      return {
        kind: 'coordinator-provider-no-key',
        missing: rule === undefined ? [] : [rule.provider],
      };
  }
}

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
      byPerson: step.byPerson,
      claudeSubscriptionId: step.claudeSubscriptionId,
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
      targetMachineId: step.targetMachineId,
      chiefId: chiefThread.chiefId,
      projectId: chiefThread.projectId,
    })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .where(and(eq(step.status, 'pending'), eq(step.kind, 'chief'), eq(chiefThread.teamId, teamId)))
    .all()
    .flatMap((row) => {
      const profile = coordinatorProfile(db, teamId, row.projectId);
      return profile === null ? [] : [{ ...row, home: profile.machineId ?? null }];
    });
  const queue = [...workerQueue, ...chiefRows].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
  );

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
    return coordinatorProfile(db, teamId, row.projectId);
  }

  const catalog = mergedCatalogModels(teamId);
  const enabledId = enabledSubscriptionId({ db }, teamId);
  const enabledDevinId = enabledDevinSubscriptionId({ db }, teamId);
  const enabledAntigravityId = enabledAntigravitySubscriptionId({ db }, teamId);
  const enabledDoubaoId = enabledDoubaoSubscriptionId({ db }, teamId);

  interface WorkerRouting {
    verdict: RouteVerdict;
    waitingForId: string | null;
    blocked: StepQueueBlocked | undefined;
    alternateMachines: Array<{ machineId: string; name: string }>;
    lockReason?: RouteLockReason;
  }

  function workerRouting(
    target: QueueTargetStep,
    row: (typeof workerQueue)[number],
  ): WorkerRouting | null {
    const agentRow = agentForRow(row);
    if (agentRow === null || agentRow.modelId == null) return null;
    const now = nowMs();
    const projectRow = projectOfTodo(db, row.todoRow);
    const facts: WorkerStepFacts = {
      agentRow,
      model: effectiveModel(agentRow, row),
      localProject: projectRow?.repoKind === 'local',
      localMerge:
        parseLocalMergeInstruction(row.prompt) !== null ||
        parseLocalFolderActionInstruction(row.prompt) !== null,
      githubPushRepo: requiredGithubPushRepoForStep({
        project: projectRow,
        step: row,
        todo: row.todoRow,
        agentTools: agentRow.tools,
      }),
    };
    const unavailable = (id: string) =>
      targetUnavailable(db, machineRowOf(id), teamId, facts, catalog, now);
    const prior = priorSessionOf(
      db,
      row,
      row.buildRow,
      {
        claude: enabledId,
        devin: enabledDevinId,
        antigravity: enabledAntigravityId,
        doubao: enabledDoubaoId,
      },
      facts.model.provider,
    );
    const need = agentRow.requiredCapabilities?.os;
    const homeRetired =
      target.homeMachineId !== null && !machineCanReturn(db, target.homeMachineId);
    const homePin = homeRetired && !facts.localProject ? null : target.homeMachineId;
    const explicitOverrideMachineId = row.todoRow.routeOverride?.machineId ?? null;
    const resolution = resolveWorkerCandidates({
      db,
      teamId,
      teamMachines,
      facts,
      catalog,
      sessionMachineId:
        !prior.freshSession && prior.priorSessionId !== null ? prior.priorMachineLiveId : null,
      explicitOverrideMachineId,
      ruleMachineId: explicitOverrideMachineId === null ? homePin : null,
      defaultMachineId,
      stepCreatedAt: row.createdAt,
      now,
    });
    const verdict: RouteVerdict =
      resolution.claimableIds.length > 0
        ? { claim: true }
        : { claim: false, waitingFor: resolution.waitingForId };
    const waitingForId = resolution.claimableIds[0] ?? resolution.waitingForId;
    const extra = {
      waitingForId,
      alternateMachines: resolution.alternateMachines,
      ...(resolution.lockReason !== undefined ? { lockReason: resolution.lockReason } : {}),
    };
    if (
      stepRuntimeFor(facts.model.provider) === 'claude-code' &&
      accountHeld(row, prior, enabledId)
    ) {
      return { verdict, blocked: { kind: 'account-switched', missing: [] }, ...extra };
    }
    if (verdict.claim) return { verdict, blocked: undefined, ...extra };
    const doubaoNoTargetBlocked = (
      checkOnline: (m: (typeof teamMachines)[number]) => MachineIneligibility | null,
    ): StepQueueBlocked => {
      if (activeDoubaoSource(db, teamId).kind === 'none') {
        return { kind: 'doubao-subscription', missing: [] };
      }
      const onlineRunners = teamMachines.filter(
        (m) => m.retiredAt === null && isRegisteredMachine(m) && m.online,
      );
      if (onlineRunners.length === 0) return { kind: 'machine-offline', missing: [] };
      const gaps = onlineRunners.map(checkOnline);
      if (gaps.every((gap) => gap?.kind === 'runtime')) {
        return { kind: 'runtime-disabled', missing: [MODEL_SOURCE_RUNTIME_LABELS.doubao] };
      }
      if (gaps.some((gap) => gap?.kind === 'model')) {
        return { kind: 'model-unavailable', missing: [] };
      }
      return { kind: 'machine-offline', missing: [] };
    };
    const named = verdict.waitingFor;
    if (homeRetired && facts.localProject && named === target.homeMachineId) {
      return { verdict, blocked: { kind: 'machine-retired', missing: [] }, ...extra };
    }
    const platform = need === undefined ? {} : { platform: need };
    if (named === null) {
      if (facts.githubPushRepo != null) {
        const onlineRunners = teamMachines.filter(
          (m) => m.retiredAt === null && isRegisteredMachine(m) && m.online,
        );
        if (
          onlineRunners.some(
            (m) => workerIneligibility(db, m, facts, catalog, now)?.kind === 'github-push',
          )
        ) {
          return {
            verdict,
            blocked: { kind: 'github-push-missing', missing: [] },
            ...extra,
          };
        }
      }
      if (stepRuntimeFor(facts.model.provider) === 'doubao') {
        return {
          verdict,
          blocked: doubaoNoTargetBlocked((m) => workerIneligibility(db, m, facts, catalog, now)),
          ...extra,
        };
      }
      return {
        verdict,
        blocked:
          need === undefined
            ? { kind: 'machine-offline', missing: [] }
            : { kind: 'capability-missing', missing: [RUNNER_OS_LABELS[need]], ...platform },
        ...extra,
      };
    }
    if (!unavailable(named)) return { verdict, blocked: undefined, ...extra };
    const home = machineRowOf(named);
    if (home === undefined || !home.online) {
      return {
        verdict,
        blocked: { kind: 'machine-offline', missing: [], ...platform },
        ...extra,
      };
    }
    const gap = workerIneligibility(db, home, facts, catalog, now);
    return {
      verdict,
      blocked:
        gap === null
          ? undefined
          : ineligibleBlocked(
              gap,
              MODEL_SOURCE_RUNTIME_LABELS[stepRuntimeFor(facts.model.provider)],
              home.name,
            ),
      ...extra,
    };
  }

  const serverRoutes = new Map<string | null, ReturnType<typeof coordinatorRouteVerdict>>();
  const serverRouteOf = (projectId: string | null) => {
    if (!serverRoutes.has(projectId)) {
      serverRoutes.set(projectId, coordinatorRouteVerdict(db, teamId, projectId));
    }
    return serverRoutes.get(projectId) ?? null;
  };
  function chiefQueueOutcome(
    target: QueueTargetStep,
    row: (typeof queue)[number],
  ): {
    blocked: StepQueueBlocked | undefined;
    waitingOn: string | null;
    alternateMachines: Array<{ machineId: string; name: string }>;
    lockReason?: RouteLockReason;
  } {
    if (!('todoRow' in row) && coordinatorInServerEnabled() && !isChiefSideThreadId(row.threadId)) {
      const serverRoute = serverRouteOf(row.projectId);
      if (serverRoute !== null) {
        if (!('refusal' in serverRoute)) {
          return { blocked: undefined, waitingOn: null, alternateMachines: [] };
        }
        if (target.homeMachineId === null) {
          return {
            blocked: coordinatorRefusalBlocked(serverRoute.refusal, serverRoute.rule),
            waitingOn: null,
            alternateMachines: [],
          };
        }
      }
    }
    const agentRow = agentForRow(row);
    const provider =
      ('fallback' in row ? row.fallback?.model?.provider : undefined) ?? agentRow?.provider;
    const now = nowMs();
    const resolution = resolveChiefCandidates({
      db,
      teamId,
      teamMachines,
      pinnedMachineId: target.homeMachineId,
      targetMachineId: 'targetMachineId' in row ? (row.targetMachineId ?? null) : null,
      agentRow: agentRow ?? { requiredCapabilities: null },
      provider,
      stepCreatedAt: row.createdAt,
      now,
    });
    const extra = {
      alternateMachines: resolution.alternateMachines,
      ...(resolution.lockReason !== undefined ? { lockReason: resolution.lockReason } : {}),
    };
    if (resolution.claimableIds.length > 0) {
      return { blocked: undefined, waitingOn: resolution.claimableIds[0] ?? null, ...extra };
    }
    const waitingOn = resolution.waitingForId;
    const home = waitingOn === null ? undefined : teamMachines.find((m) => m.id === waitingOn);
    if (waitingOn === null && stepRuntimeFor(provider) === 'doubao') {
      if (activeDoubaoSource(db, teamId).kind === 'none') {
        return { blocked: { kind: 'doubao-subscription', missing: [] }, waitingOn, ...extra };
      }
      const onlineRunners = teamMachines.filter(
        (m) => m.retiredAt === null && isRegisteredMachine(m) && m.online,
      );
      if (onlineRunners.length === 0) {
        return { blocked: { kind: 'machine-offline', missing: [] }, waitingOn, ...extra };
      }
      const gaps = onlineRunners.map((m) =>
        chiefIneligibility(db, m, agentRow ?? { requiredCapabilities: null }, provider, now),
      );
      if (gaps.every((gap) => gap?.kind === 'runtime')) {
        return {
          blocked: { kind: 'runtime-disabled', missing: [MODEL_SOURCE_RUNTIME_LABELS.doubao] },
          waitingOn,
          ...extra,
        };
      }
      return { blocked: { kind: 'machine-offline', missing: [] }, waitingOn, ...extra };
    }
    if (home === undefined || !home.online) {
      return { blocked: { kind: 'machine-offline', missing: [] }, waitingOn, ...extra };
    }
    if (agentRow?.modelId != null) {
      const gap = chiefIneligibility(db, home, agentRow, provider, now);
      if (gap !== null) {
        return {
          blocked: ineligibleBlocked(
            gap,
            MODEL_SOURCE_RUNTIME_LABELS[stepRuntimeFor(provider)],
            home.name,
          ),
          waitingOn,
          ...extra,
        };
      }
    }
    return { blocked: undefined, waitingOn, ...extra };
  }

  function project(target: QueueTargetStep): StepQueueInfo | null {
    const queueRow = queue.find((r) => r.id === target.id);
    if (queueRow === undefined) return null;
    const pool = queue.filter((r) => r.home === target.homeMachineId);
    const position = pool.findIndex((r) => r.id === target.id) + 1;
    if (position === 0) return null;
    if (target.holdReason === BLOCKED_BY_HOLD) {
      return {
        position,
        waitingFor: null,
        blocked: {
          kind: 'blocked-by',
          missing: 'todoRow' in queueRow ? unmetBlockerTitles(db, queueRow.todoRow) : [],
        },
      };
    }
    const routing =
      'todoRow' in queueRow && routeForStep(db, queueRow.todoRow, queueRow.kind) !== null
        ? workerRouting(target, queueRow)
        : null;
    const chiefOutcome = routing === null ? chiefQueueOutcome(target, queueRow) : null;
    const waitingOn =
      routing !== null ? routing.waitingForId : (chiefOutcome?.waitingOn ?? target.homeMachineId);
    let waitingFor: StepQueueInfo['waitingFor'] = null;
    if (waitingOn !== null) {
      const row = machineRowOf(waitingOn);
      if (row !== undefined) {
        waitingFor = {
          machineId: row.id,
          name: row.name,
        };
      }
    }
    const hold: StepQueueInfo['hold'] =
      target.holdReason === 'quota' && target.holdUntil != null
        ? { reason: 'quota', retryAt: target.holdUntil }
        : undefined;
    const blocked = routing !== null ? routing.blocked : chiefOutcome?.blocked;
    const alternateMachines =
      routing !== null ? routing.alternateMachines : (chiefOutcome?.alternateMachines ?? []);
    const lockReason = routing !== null ? routing.lockReason : chiefOutcome?.lockReason;
    return {
      position,
      waitingFor,
      ...(hold !== undefined ? { hold } : {}),
      ...(blocked !== undefined ? { blocked } : {}),
      ...(alternateMachines.length > 0 ? { alternateMachines } : {}),
      ...(lockReason !== undefined ? { lockReason } : {}),
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

export function queuedThreadsByMachine(db: Db, teamId: string): Map<string, MachineQueuedThread[]> {
  const rows = db
    .select({ stepRow: step, todoRow: todo })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(and(eq(step.status, 'pending'), eq(todo.teamId, teamId), isNull(todo.archivedAt)))
    .orderBy(asc(step.createdAt), sql`${step}.rowid`)
    .all();
  const machines = new Map(
    db
      .select()
      .from(machine)
      .where(eq(machine.teamId, teamId))
      .all()
      .map((row) => [row.id, row]),
  );
  const projector = stepQueueProjector(db, teamId);
  const grouped = new Map<string, MachineQueuedThread[]>();
  for (const { stepRow, todoRow } of rows) {
    const queue = projector.project({
      id: stepRow.id,
      createdAt: stepRow.createdAt,
      homeMachineId: profileForStep(db, todoRow, stepRow.kind, stepRow.id)?.machineId ?? null,
      holdReason: stepRow.holdReason,
      holdUntil: stepRow.holdUntil,
    });
    const waitingFor = queue?.waitingFor;
    const machineRow = waitingFor == null ? undefined : machines.get(waitingFor.machineId);
    if (waitingFor == null || machineRow === undefined) continue;
    const threads = grouped.get(machineRow.id) ?? [];
    if (threads.some((thread) => thread.threadId === todoRow.id)) continue;
    threads.push({
      threadId: todoRow.id,
      title: todoRow.title,
      projectId: todoRow.projectId,
      reason: queue?.hold !== undefined ? 'quota' : 'waiting',
      retryAt: queue?.hold?.retryAt ?? null,
    });
    grouped.set(machineRow.id, threads);
  }
  return grouped;
}
