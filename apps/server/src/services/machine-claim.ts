import type { ClaimedStep, MachineClaimBody } from '@cairn/shared';
import {
  buildMergedPrGuardNote,
  CHIEF_MODEL_FALLBACK_KIND,
  isBuildStepKind,
  mergedPrGuardNoteRowId,
  parseLocalFolderActionInstruction,
  parseLocalMergeInstruction,
  parseVerifyPromptMeta,
} from '@cairn/shared';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import {
  build,
  chief,
  chiefThread,
  machine,
  type StepFallbackRow,
  type StepRanModel,
  skillAudit,
  step,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { githubRepoReachable } from '../lib/github.js';
import { type AppTokenReason, tokenValue } from '../lib/github-token.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  antigravitySubscriptionAllowsRunner,
  enabledAntigravitySubscriptionId,
} from './antigravity-subscriptions.js';
import { blockerHandoffForClaim } from './blocker-handoff.js';
import { holdBlockedBuild } from './blockers.js';
import { failStepWithEvents, mergedPrElsewhere } from './builds.js';
import { greetingReadmeSection } from './chief.js';
import { hasEarlierLiveChiefStep } from './chief-turns.js';
import { accountHeld } from './claude-account-hold.js';
import { refreshClaudeRateParks } from './claude-rate-limit.js';
import { enabledSubscriptionId } from './claude-subscriptions.js';
import { coordinatorInServerEnabled } from './coordinator-context.js';
import { coordinatorRoute } from './coordinator-route.js';
import { claimPendingChiefStep } from './coordinator-steps.js';
import { readDeployLease } from './deploy-lease.js';
import { enabledDevinSubscriptionId } from './devin-subscriptions.js';
import {
  githubPushCapable,
  machineRunningCount,
  projectRunningCount,
  requiredGithubPushRepoForStep,
  stepRuntimeFor,
  unassignedStepReason,
} from './dispatch-eligibility.js';
import {
  doubaoSubscriptionAllowsRunner,
  enabledDoubaoSubscriptionId,
} from './doubao-subscriptions.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { githubReadToken } from './github-autonomous-token.js';
import { localFolderActionAuthorizationRefusal } from './local-folder-action.js';
import { localMergeAuthorizationRefusal } from './local-merge.js';
import {
  buildChiefClaimPayload,
  buildWorkerClaimPayload,
  CHIEF_MAIL_MIN_CLI_VERSION,
  chiefTurnLocked,
  cliVersionAtLeast,
  meetsMcpVersionGate,
  stepMcpGrant,
  TASK_SEGMENTS_MIN_CLI_VERSION,
  workerRemoteTools,
  workerSkillInjection,
} from './machine-claim-payload.js';
import { stageTurnAttachments } from './machine-computer.js';
import {
  type MachineDeps,
  profileForStep,
  publishStepStatus,
  upsertChiefRow,
  upsertMessage,
  withFencedTransaction,
} from './machine-deps.js';
import { isDoubaoAccountSwitching } from './machine-doubao-login.js';
import {
  chiefIneligibility,
  priorSessionOf,
  resolveChiefCandidates,
  resolveWorkerCandidates,
  teamDefaultMachineId,
  type WorkerStepFacts,
  workerIneligibility,
} from './machine-routing.js';
import {
  CONNECTOR_TOOL_HYDRATE_BOUND_MS,
  hydrateMissingConnectorTools,
  mcpConnectorDepsOf,
} from './mcp-servers.js';
import { effectiveModel, modelKey } from './model-fallback.js';
import { mergedCatalogModels } from './model-liveness.js';
import { coordinatorProfile, type RouteProfile, routeForStep } from './routing-rules.js';
import { readQuota, type StepQuota } from './step-groups/quota.js';
import { readSubscription, type StepSubscription } from './step-groups/subscription.js';
import {
  acquireWorkerStepLease,
  heartbeatStep,
  nextClaimGeneration,
  pendingClaimPredicate,
  releaseStepLease,
} from './step-lease.js';
import { decideStepRoute, recordStepRoute, routedModelRunsOn } from './step-route.js';
import { setTodoPhase } from './todos.js';
import { turnProvenance } from './turn-provenance.js';

export {
  buildChiefClaimPayload,
  buildWorkerClaimPayload,
  CHIEF_MAIL_MIN_CLI_VERSION,
  chiefTurnLocked,
  heartbeatStep,
  meetsMcpVersionGate,
  releaseStepLease,
  stepMcpGrant,
  TASK_SEGMENTS_MIN_CLI_VERSION,
  workerRemoteTools,
};

interface ClaimCandidate {
  stepRow: typeof step.$inferSelect & StepQuota & StepSubscription;
  buildRow: typeof build.$inferSelect;
  todoRow: typeof todo.$inferSelect;
}

function claimCandidates(deps: MachineDeps, _machineId: string, teamId: string): ClaimCandidate[] {
  const rows = deps.db
    .select({ stepRow: step, buildRow: build, todoRow: todo })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        eq(step.status, 'pending'),
        eq(todo.teamId, teamId),
        isNull(todo.archivedAt),
        sql`coalesce(${todo.sourceKind}, '') NOT IN ('research-intake', 'research-citation-check')`,
        or(isNull(step.holdUntil), lte(step.holdUntil, sql`${nowMs()}`)),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all();
  return rows.map((row) => ({
    ...row,
    stepRow: {
      ...row.stepRow,
      ...readQuota(deps.db, row.stepRow.id),
      ...readSubscription(deps.db, row.stepRow.id),
    },
  }));
}

function claimChiefCandidates(deps: MachineDeps, _machineId: string, teamId: string) {
  return deps.db
    .select({ stepRow: step, threadRow: chiefThread, chiefRow: chief })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .innerJoin(chief, eq(chiefThread.chiefId, chief.id))
    .where(
      and(
        eq(step.status, 'pending'),
        eq(step.kind, 'chief'),
        eq(chiefThread.teamId, teamId),
        or(isNull(step.holdUntil), lte(step.holdUntil, sql`${nowMs()}`)),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all()
    .flatMap((row) => {
      const agentRow = coordinatorProfile(deps.db, teamId, row.threadRow.projectId);
      return agentRow === null
        ? []
        : [
            {
              ...row,
              stepRow: { ...row.stepRow, ...readQuota(deps.db, row.stepRow.id) },
              agentRow,
            },
          ];
    })
    .filter((row) => !serverTakesTurn(deps.db, teamId, row.stepRow));
}

export function serverTurnModel(
  db: MachineDeps['db'],
  teamId: string,
  stepRow: typeof step.$inferSelect,
): StepRanModel | null {
  if (!coordinatorInServerEnabled() || stepRow.kind !== 'chief') return null;
  const route = coordinatorRoute(db, teamId, chiefThreadProject(db, stepRow.buildId));
  const pin = readQuota(db, stepRow.id).fallback?.model ?? null;
  const model = pin ?? route;
  if (
    model === null ||
    model.provider === null ||
    model.modelId === null ||
    stepRuntimeFor(model.provider) !== 'pi'
  )
    return null;
  return {
    provider: model.provider,
    modelId: model.modelId,
    thinkingLevel: pin === null ? (route?.thinkingLevel ?? null) : null,
  };
}

export function serverTakesTurn(
  db: MachineDeps['db'],
  teamId: string,
  stepRow: typeof step.$inferSelect,
): boolean {
  return serverTurnModel(db, teamId, stepRow) !== null;
}

function chiefThreadProject(db: MachineDeps['db'], threadId: string): string | null {
  return (
    db
      .select({ projectId: chiefThread.projectId })
      .from(chiefThread)
      .where(eq(chiefThread.id, threadId))
      .get()?.projectId ?? null
  );
}

async function buildChiefClaim(
  deps: MachineDeps,
  machineId: string,
  stepRow: typeof step.$inferSelect,
  threadRow: typeof chiefThread.$inferSelect,
  agentRow: RouteProfile,
  stillAuthorized: () => boolean,
  signal: AbortSignal | undefined,
  machineRow?: typeof machine.$inferSelect,
  failover?: { fromMachineId: string; reason: 'offline' | 'busy' },
): Promise<ClaimedStep | null> {
  if (!stillAuthorized() || !agentRow.modelId) return null;
  const quota = readQuota(deps.db, stepRow.id);
  const model = effectiveModel(agentRow, quota);
  const runtime = stepRuntimeFor(model.provider);
  if (
    runtime === 'doubao' &&
    deps.machineHub !== undefined &&
    isDoubaoAccountSwitching(deps.machineHub, machineId)
  ) {
    return null;
  }
  if (
    !machineRow ||
    chiefIneligibility(deps.db, machineRow, agentRow, model.provider, nowMs()) !== null
  )
    return null;
  const readmeSection = await greetingReadmeSection(deps, stepRow, threadRow, signal);
  if (!stillAuthorized()) return null;
  if (
    runtime === 'doubao' &&
    deps.machineHub !== undefined &&
    isDoubaoAccountSwitching(deps.machineHub, machineId)
  ) {
    return null;
  }
  const freshMachine = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (
    !freshMachine ||
    chiefIneligibility(deps.db, freshMachine, agentRow, model.provider, nowMs()) !== null
  )
    return null;
  const bindSubscription =
    runtime === 'claude-code' ||
    runtime === 'devin' ||
    runtime === 'antigravity' ||
    runtime === 'doubao'
      ? { runtime, teamId: threadRow.teamId }
      : null;
  const routeSwitch =
    quota.fallback === null &&
    agentRow.switchedFrom !== undefined &&
    model.provider !== null &&
    model.modelId !== null
      ? agentRow.switchedFrom
      : null;
  const switchedFallback: StepFallbackRow | null =
    routeSwitch === null || model.provider === null || model.modelId === null
      ? null
      : {
          model: { provider: model.provider, modelId: model.modelId },
          tried: [
            modelKey(routeSwitch),
            modelKey({ provider: model.provider, modelId: model.modelId }),
          ],
          zeroUsageRetried: false,
        };
  const locked = chiefTurnLocked(stepRow);
  const chiefMcp = stepMcpGrant(deps.db, freshMachine, locked);
  const claimed = claimPendingChiefStep(deps.db, stepRow, {
    machineId,
    bind: bindSubscription,
    model:
      model.provider === null || model.modelId === null
        ? null
        : {
            provider: model.provider,
            modelId: model.modelId,
            thinkingLevel:
              quota.fallback?.model || switchedFallback !== null ? null : agentRow.thinkingLevel,
          },
    ...(switchedFallback !== null ? { fallback: switchedFallback } : {}),
    mcpGrant: chiefMcp ?? null,
    ...(failover !== undefined
      ? { routedFromMachineId: failover.fromMachineId, routedReason: failover.reason }
      : {}),
    stillAuthorized,
  });
  if (claimed === null) return null;
  if (
    switchedFallback !== null &&
    routeSwitch !== null &&
    model.provider !== null &&
    model.modelId !== null
  ) {
    upsertChiefRow(deps, {
      id: `chief-route-fallback-${claimed.id}`,
      threadId: threadRow.id,
      projectId: threadRow.projectId,
      role: 'system',
      content: JSON.stringify({
        kind: CHIEF_MODEL_FALLBACK_KIND,
        from: modelKey(routeSwitch),
        to: modelKey({ provider: model.provider, modelId: model.modelId }),
        stepId: claimed.id,
        announced: true,
      }),
      createdAt: claimed.claimedAt ?? nowMs(),
    });
  }
  const stagedUploads =
    claimed.prompt !== null
      ? await stageTurnAttachments(deps, claimed, threadRow, claimed.prompt, signal).catch(
          () => null,
        )
      : null;
  return buildChiefClaimPayload(deps, {
    machineId,
    stepRow: claimed,
    threadRow,
    agentRow,
    readmeSection,
    stagedUploads,
    machineRow: freshMachine,
    ...(chiefMcp !== undefined ? { mcpServers: chiefMcp } : {}),
    hasMcpServers: true,
  });
}

function runnerFull(
  db: MachineDeps['db'],
  machineId: string,
  maxWorkers: number | undefined,
): boolean {
  return maxWorkers !== undefined && machineRunningCount(db, machineId) >= maxWorkers;
}

async function claimChiefTurn(
  deps: MachineDeps,
  machineId: string,
  teamId: string,
  maxWorkers: number | undefined,
  createdUpTo: number,
  stillAuthorized: () => boolean,
  signal: AbortSignal | undefined,
): Promise<ClaimedStep | null> {
  if (!stillAuthorized()) return null;
  const { db } = deps;
  const initialMachine = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!initialMachine) return null;
  let machineRow = initialMachine;
  if (runnerFull(db, machineRow.id, maxWorkers)) return null;
  let cands = claimChiefCandidates(deps, machineId, teamId).filter(
    (cand) => cand.stepRow.createdAt <= createdUpTo,
  );
  const teamMachinesNow = () => db.select().from(machine).where(eq(machine.teamId, teamId)).all();
  const initialTeamMachines = teamMachinesNow();
  const needsConnectorTools = cands.some((cand) => {
    if (chiefTurnLocked(cand.stepRow) || !cand.agentRow.modelId) return false;
    if (hasEarlierLiveChiefStep(db, cand.stepRow)) return false;
    const model = effectiveModel(cand.agentRow, cand.stepRow);
    const resolution = resolveChiefCandidates({
      db,
      teamId,
      teamMachines: initialTeamMachines,
      pinnedMachineId: cand.agentRow.machineId,
      targetMachineId: cand.stepRow.targetMachineId ?? null,
      agentRow: cand.agentRow,
      provider: model.provider,
      stepCreatedAt: cand.stepRow.createdAt,
      now: nowMs(),
      claimingMachineId: machineId,
    });
    if (!resolution.claimableIds.includes(machineId)) return false;
    return chiefIneligibility(db, initialMachine, cand.agentRow, model.provider, nowMs()) === null;
  });
  if (needsConnectorTools) {
    await hydrateMissingConnectorTools(mcpConnectorDepsOf(deps), {
      teamId,
      boundMs: CONNECTOR_TOOL_HYDRATE_BOUND_MS,
    });
    if (!stillAuthorized()) return null;
    const freshMachine = db.select().from(machine).where(eq(machine.id, machineId)).get();
    if (!freshMachine) return null;
    machineRow = freshMachine;
    if (runnerFull(db, machineRow.id, maxWorkers)) return null;
    cands = claimChiefCandidates(deps, machineId, teamId).filter(
      (cand) => cand.stepRow.createdAt <= createdUpTo,
    );
  }
  const currentTeamMachines = teamMachinesNow();
  for (const cand of cands) {
    if (!stillAuthorized()) return null;
    if (
      cand.stepRow.stallState?.lastRecoveredAt != null &&
      machineRow.capabilities?.claimGeneration !== true
    ) {
      continue;
    }
    if (hasEarlierLiveChiefStep(db, cand.stepRow)) continue;
    if (
      turnProvenance(cand.stepRow.prompt)?.startsWith('mail:') === true &&
      !cliVersionAtLeast(machineRow.latestCliVersion, CHIEF_MAIL_MIN_CLI_VERSION)
    ) {
      continue;
    }
    const resolution = resolveChiefCandidates({
      db,
      teamId,
      teamMachines: currentTeamMachines,
      pinnedMachineId: cand.agentRow.machineId,
      targetMachineId: cand.stepRow.targetMachineId ?? null,
      agentRow: cand.agentRow,
      provider: effectiveModel(cand.agentRow, cand.stepRow).provider,
      stepCreatedAt: cand.stepRow.createdAt,
      now: nowMs(),
      claimingMachineId: machineId,
    });
    if (!resolution.claimableIds.includes(machineId)) continue;
    const claimed = await buildChiefClaim(
      deps,
      machineId,
      cand.stepRow,
      cand.threadRow,
      cand.agentRow,
      stillAuthorized,
      signal,
      machineRow,
      resolution.failover,
    );
    if (claimed) {
      publishStepStatus(deps, claimed.step.id);
      return claimed;
    }
  }
  return null;
}

function failPendingClaim(deps: MachineDeps, candidate: typeof step.$inferSelect, reason: string) {
  const current = deps.db
    .select()
    .from(step)
    .where(pendingClaimPredicate(candidate, nowMs()))
    .get();
  if (current === undefined) return false;
  failStepWithEvents(deps, current, reason);
  return true;
}

async function tryClaim(
  deps: MachineDeps,
  machineId: string,
  teamId: string,
  origin: string,
  maxWorkers: number | undefined,
  supportsAttachmentVerify: boolean,
  stillAuthorized: () => boolean,
  signal: AbortSignal | undefined,
): Promise<ClaimedStep | null> {
  if (!stillAuthorized()) return null;
  const { db } = deps;
  let machineRow = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!machineRow) return null;
  refreshClaudeRateParks(deps, teamId);
  const catalog = mergedCatalogModels(teamId);
  const queued = runnerFull(db, machineRow.id, maxWorkers)
    ? []
    : claimCandidates(deps, machineId, teamId);
  const earliestWorker = queued[0]?.stepRow.createdAt ?? Number.POSITIVE_INFINITY;
  const workerCands = [
    ...queued.filter((cand) => cand.stepRow.byPerson),
    ...queued.filter((cand) => !cand.stepRow.byPerson),
  ];
  const chiefAhead = await claimChiefTurn(
    deps,
    machineId,
    teamId,
    maxWorkers,
    earliestWorker,
    stillAuthorized,
    signal,
  );
  if (chiefAhead) return chiefAhead;
  if (!stillAuthorized()) return null;
  machineRow = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!machineRow || runnerFull(db, machineRow.id, maxWorkers)) return null;

  for (const cand of workerCands) {
    if (
      cand.stepRow.stallState?.lastRecoveredAt != null &&
      machineRow.capabilities?.claimGeneration !== true
    ) {
      continue;
    }
    if (
      cand.stepRow.kind === 'verify' &&
      parseVerifyPromptMeta(cand.stepRow.prompt)?.evidence === 'attachments' &&
      !supportsAttachmentVerify
    )
      continue;
    if (!stillAuthorized()) return null;
    const localMerge = parseLocalMergeInstruction(cand.stepRow.prompt);
    if (
      localMerge !== null &&
      localMergeAuthorizationRefusal(db, localMerge, cand.todoRow) !== null
    ) {
      withFencedTransaction(deps, (settleDeps) =>
        failPendingClaim(
          settleDeps,
          cand.stepRow,
          'Local merge authorization changed; request the merge again',
        ),
      );
      continue;
    }
    const localFolderAction = parseLocalFolderActionInstruction(cand.stepRow.prompt);
    if (
      localFolderAction !== null &&
      localFolderActionAuthorizationRefusal(db, localFolderAction, cand.todoRow) !== null
    ) {
      withFencedTransaction(deps, (settleDeps) =>
        failPendingClaim(
          settleDeps,
          cand.stepRow,
          'Local folder action authorization changed; try again from the task panel',
        ),
      );
      continue;
    }
    const agentRow = profileForStep(deps, cand.todoRow, cand.stepRow.kind, cand.stepRow.id);
    if (agentRow === null) {
      withFencedTransaction(deps, (settleDeps) =>
        failPendingClaim(settleDeps, cand.stepRow, unassignedStepReason(cand.stepRow.kind)),
      );
      continue;
    }
    if (!agentRow.modelId) continue;
    const baseModel = effectiveModel(agentRow, cand.stepRow);
    let model = baseModel;
    let advancedFallback: StepFallbackRow | null = null;
    if (
      cand.stepRow.fallback?.model != null &&
      cand.stepRow.sessionId === null &&
      cand.stepRow.checkpointCommit === null
    ) {
      const onlineHosts = db
        .select()
        .from(machine)
        .where(and(eq(machine.teamId, teamId), eq(machine.online, true), isNull(machine.retiredAt)))
        .all();
      const baseProject = projectOfTodo(db, cand.todoRow);
      const baseRunnable =
        onlineHosts.length === 0 ||
        onlineHosts.some(
          (host) =>
            workerIneligibility(
              db,
              host,
              {
                agentRow,
                model: baseModel,
                localProject: baseProject?.repoKind === 'local',
                localMerge: localMerge !== null || localFolderAction !== null,
                githubPushRepo: requiredGithubPushRepoForStep({
                  project: baseProject,
                  step: cand.stepRow,
                  todo: cand.todoRow,
                  agentTools: agentRow.tools,
                }),
              },
              catalog,
              nowMs(),
            ) === null &&
            (!agentRow.routed || routedModelRunsOn(db, host, baseModel)),
        );
      if (!baseRunnable) {
        const tried = new Set(cand.stepRow.fallback.tried);
        if (baseModel.provider !== null && baseModel.modelId !== null) {
          tried.add(modelKey({ provider: baseModel.provider, modelId: baseModel.modelId }));
        }
        const fromChain = (agentRow.fallbackModels ?? []).find(
          (candidate) =>
            !tried.has(modelKey(candidate)) &&
            onlineHosts.some(
              (host) =>
                workerIneligibility(
                  db,
                  host,
                  {
                    agentRow,
                    model: candidate,
                    localProject: baseProject?.repoKind === 'local',
                    localMerge: localMerge !== null || localFolderAction !== null,
                    githubPushRepo: requiredGithubPushRepoForStep({
                      project: baseProject,
                      step: cand.stepRow,
                      todo: cand.todoRow,
                      agentTools: agentRow.tools,
                    }),
                  },
                  catalog,
                  nowMs(),
                ) === null &&
                (!agentRow.routed || routedModelRunsOn(db, host, candidate)),
            ),
        );
        const nextChoice =
          fromChain ??
          (agentRow.routed
            ? decideStepRoute(
                db,
                cand.todoRow,
                cand.stepRow.kind,
                null,
                { machineId: agentRow.machineId, required: agentRow.requiredCapabilities },
                {
                  primaryProvider:
                    routeForStep(db, cand.todoRow, cand.stepRow.kind)?.provider ?? null,
                  preferredModelId:
                    routeForStep(db, cand.todoRow, cand.stepRow.kind)?.modelId ?? null,
                  excludedKeys: tried,
                  githubPushRepo: requiredGithubPushRepoForStep({
                    project: baseProject,
                    step: cand.stepRow,
                    todo: cand.todoRow,
                    agentTools: agentRow.tools,
                  }),
                },
              ).chosen
            : null);
        if (nextChoice != null) {
          const picked = { provider: nextChoice.provider, modelId: nextChoice.modelId };
          model = picked;
          advancedFallback = {
            model: picked,
            tried: [...tried, modelKey(picked)],
            zeroUsageRetried: cand.stepRow.fallback.zeroUsageRetried,
          };
        }
      }
    }
    const pinnedModel =
      model.provider !== null && model.modelId !== null
        ? { provider: model.provider, modelId: model.modelId }
        : null;
    const routeSwitch =
      cand.stepRow.fallback === null && agentRow.switchedFrom !== undefined && pinnedModel !== null
        ? agentRow.switchedFrom
        : null;
    const switchedFallback: StepFallbackRow | null =
      advancedFallback ??
      (routeSwitch === null || pinnedModel === null
        ? null
        : {
            model: pinnedModel,
            tried: [modelKey(routeSwitch), modelKey(pinnedModel)],
            zeroUsageRetried: false,
          });
    const now = nowMs();
    const todoProject = projectOfTodo(db, cand.todoRow);
    const facts: WorkerStepFacts = {
      agentRow,
      model,
      localProject: todoProject?.repoKind === 'local',
      localMerge: localMerge !== null || localFolderAction !== null,
      githubPushRepo: requiredGithubPushRepoForStep({
        project: todoProject,
        step: cand.stepRow,
        todo: cand.todoRow,
        agentTools: agentRow.tools,
      }),
    };
    if (workerIneligibility(db, machineRow, facts, catalog, now) !== null) continue;
    const fallbackActive =
      model.provider !== agentRow.provider || model.modelId !== agentRow.modelId;
    if (agentRow.routed && !fallbackActive && !routedModelRunsOn(db, machineRow, model)) continue;
    const projectCap = projectOfTodo(db, cand.todoRow)?.maxConcurrent ?? null;
    const projectFull = (reader: Pick<typeof db, 'select'>) =>
      projectCap !== null &&
      projectRunningCount(reader, cand.todoRow.projectId) >=
        projectCap + (cand.stepRow.byPerson ? 1 : 0);
    if (projectFull(db)) continue;
    const claimRuntimeIsClaudeCode = stepRuntimeFor(model.provider) === 'claude-code';
    const claimRuntimeIsDevin = stepRuntimeFor(model.provider) === 'devin';
    const claimRuntimeIsAntigravity = stepRuntimeFor(model.provider) === 'antigravity';
    const claimRuntimeIsDoubao = stepRuntimeFor(model.provider) === 'doubao';
    const enabledId = enabledSubscriptionId({ db }, teamId);
    const enabledDevinId = enabledDevinSubscriptionId({ db }, teamId);
    const enabledAntigravityId = enabledAntigravitySubscriptionId({ db }, teamId);
    const enabledDoubaoId = enabledDoubaoSubscriptionId({ db }, teamId);
    if (claimRuntimeIsAntigravity && enabledAntigravityId === null) continue;
    if (
      claimRuntimeIsDoubao &&
      (enabledDoubaoId === null ||
        (deps.machineHub !== undefined && isDoubaoAccountSwitching(deps.machineHub, machineId)))
    )
      continue;
    const prior = priorSessionOf(
      db,
      cand.stepRow,
      cand.buildRow,
      {
        claude: enabledId,
        devin: enabledDevinId,
        antigravity: enabledAntigravityId,
        doubao: enabledDoubaoId,
      },
      model.provider,
    );
    const { priorSessionId, priorMachineId, priorMachineLiveId, priorStepAt } = prior;
    const switchedAfterPrior =
      claimRuntimeIsDoubao &&
      machineRow.capabilities?.doubao?.switchedAt !== undefined &&
      (priorStepAt ?? 0) < machineRow.capabilities.doubao.switchedAt;
    const freshSession = prior.freshSession || switchedAfterPrior;
    if (claimRuntimeIsClaudeCode && accountHeld(cand.stepRow, prior, enabledId)) continue;
    const sessionOnOtherMachine =
      priorSessionId !== null && priorMachineId !== null && priorMachineId !== machineId;
    const teamMachines = db.select().from(machine).where(eq(machine.teamId, teamId)).all();
    const explicitOverrideMachineId = cand.todoRow.routeOverride?.machineId ?? null;
    const resolution = resolveWorkerCandidates({
      db,
      teamId,
      teamMachines,
      facts,
      catalog,
      sessionMachineId: !freshSession && priorSessionId !== null ? priorMachineLiveId : null,
      explicitOverrideMachineId,
      ruleMachineId: explicitOverrideMachineId === null ? agentRow.machineId : null,
      defaultMachineId: teamDefaultMachineId(db, teamId),
      stepCreatedAt: cand.stepRow.createdAt,
      now,
      claimingMachineId: machineId,
    });
    if (!resolution.claimableIds.includes(machineId)) continue;
    const skillInjection = workerSkillInjection(deps, agentRow, cand.todoRow);
    const guardPr =
      cand.stepRow.kind === 'plan' || isBuildStepKind(cand.stepRow.kind)
        ? await mergedPrElsewhere(deps, cand.todoRow.id, cand.stepRow.buildId)
        : null;
    if (!stillAuthorized()) return null;
    const blockerHandoff = await blockerHandoffForClaim(deps, cand.stepRow, cand.todoRow);
    if (!stillAuthorized()) return null;
    const claimRepoRef = githubRepoOfProject(projectOfTodo(db, cand.todoRow));
    const repoResolution =
      claimRepoRef === null
        ? { id: null, error: null }
        : await resolveClaimRepoId(deps, teamId, claimRepoRef);
    let won: boolean | Error;
    let claimedAt = 0;
    let claimProject: ReturnType<typeof projectOfTodo>;
    let resolvedMachine = machineRow;
    let workerMcp: string[] | undefined;
    try {
      won = withFencedTransaction(deps, (settleDeps) => {
        const tx = settleDeps.db;
        if (!stillAuthorized()) return false;
        if (projectFull(tx)) return false;
        const boundId = enabledSubscriptionId({ db: tx }, teamId);
        const boundDevinId = enabledDevinSubscriptionId({ db: tx }, teamId);
        const boundAntigravityId = enabledAntigravitySubscriptionId(
          { db: tx },
          teamId,
          Math.max(claimedAt, nowMs()),
        );
        const boundDoubaoId = enabledDoubaoSubscriptionId({ db: tx }, teamId);
        if (claimRuntimeIsClaudeCode) {
          if (boundId !== enabledId) return false;
          const fresh = priorSessionOf(
            tx,
            cand.stepRow,
            cand.buildRow,
            {
              claude: boundId,
              devin: boundDevinId,
              antigravity: boundAntigravityId,
            },
            model.provider,
          );
          if (
            accountHeld(
              { ...cand.stepRow, ...readSubscription(tx, cand.stepRow.id) },
              fresh,
              boundId,
            )
          )
            return false;
        }
        if (claimRuntimeIsDevin && boundDevinId !== enabledDevinId) return false;
        if (
          claimRuntimeIsAntigravity &&
          (boundAntigravityId === null ||
            boundAntigravityId !== enabledAntigravityId ||
            !antigravitySubscriptionAllowsRunner(tx, teamId, machineId))
        )
          return false;
        if (
          claimRuntimeIsDoubao &&
          (boundDoubaoId === null ||
            boundDoubaoId !== enabledDoubaoId ||
            !doubaoSubscriptionAllowsRunner(tx, teamId, machineId) ||
            (deps.machineHub !== undefined && isDoubaoAccountSwitching(deps.machineHub, machineId)))
        )
          return false;
        const latestTodo = tx.select().from(todo).where(eq(todo.id, cand.todoRow.id)).get();
        if (latestTodo === undefined) return false;
        if (
          cand.stepRow.kind === 'merge' &&
          (latestTodo.latestBuildId !== cand.buildRow.id ||
            latestTodo.archivedAt !== null ||
            latestTodo.projectId !== cand.todoRow.projectId ||
            (localFolderAction?.action !== 'undo' &&
              !['done', 'review', 'failed'].includes(latestTodo.phase)))
        )
          return false;
        if (
          localMerge !== null &&
          localMergeAuthorizationRefusal(db, localMerge, latestTodo) !== null
        )
          return false;
        if (
          localFolderAction !== null &&
          localFolderActionAuthorizationRefusal(tx, localFolderAction, latestTodo) !== null
        )
          return false;
        holdBlockedBuild(tx, cand.stepRow.buildId);
        claimProject = projectOfTodo(tx, latestTodo);
        const freshMachine = tx.select().from(machine).where(eq(machine.id, machineId)).get();
        if (!freshMachine) return false;
        resolvedMachine = freshMachine;
        workerMcp = stepMcpGrant(tx, freshMachine, false);
        if (
          claimRuntimeIsDoubao &&
          freshSession !==
            (prior.freshSession ||
              (freshMachine?.capabilities?.doubao?.switchedAt !== undefined &&
                (priorStepAt ?? 0) < freshMachine.capabilities.doubao.switchedAt))
        ) {
          return false;
        }
        const txGithubPushRepo = requiredGithubPushRepoForStep({
          project: claimProject,
          step: cand.stepRow,
          todo: latestTodo,
          agentTools: agentRow.tools,
        });
        if (
          txGithubPushRepo !== null &&
          !githubPushCapable(freshMachine?.capabilities, txGithubPushRepo, nowMs())
        )
          return false;
        const claimRepo = githubRepoOfProject(claimProject);
        if (
          (claimRepo === null) !== (claimRepoRef === null) ||
          (claimRepo !== null &&
            claimRepoRef !== null &&
            `${claimRepo.owner}/${claimRepo.repo}`.toLowerCase() !==
              `${claimRepoRef.owner}/${claimRepoRef.repo}`.toLowerCase())
        )
          return false;
        claimedAt = nextClaimGeneration(cand.stepRow, nowMs());
        if (repoResolution.error !== null) {
          return failPendingClaim(settleDeps, cand.stepRow, repoResolution.error.message)
            ? repoResolution.error
            : false;
        }
        // withFencedTransaction holds this connection in a transaction but types it as Db.
        const lease = acquireWorkerStepLease(
          tx as Parameters<typeof acquireWorkerStepLease>[0],
          cand.stepRow,
          {
            machineId,
            claimedAt,
            claimedRepo: claimRepo === null ? null : `${claimRepo.owner}/${claimRepo.repo}`,
            claimedRepoId: repoResolution.id,
            skillInjection,
            blockerHandoff,
            claudeSubscriptionId: claimRuntimeIsClaudeCode ? boundId : null,
            devinSubscriptionId: claimRuntimeIsDevin ? boundDevinId : null,
            antigravitySubscriptionId: claimRuntimeIsAntigravity ? boundAntigravityId : null,
            doubaoSubscriptionId: claimRuntimeIsDoubao ? boundDoubaoId : null,
            ranModel: pinnedModel,
            ...(switchedFallback !== null ? { fallback: switchedFallback } : {}),
            mcpGrant: workerMcp ?? null,
            ...(resolution.failover !== undefined
              ? {
                  routedFromMachineId: resolution.failover.fromMachineId,
                  routedReason: resolution.failover.reason,
                }
              : {}),
          },
        );
        if (lease === null) return false;
        if (switchedFallback !== null && routeSwitch !== null && pinnedModel !== null) {
          upsertMessage(settleDeps, {
            id: `route-fallback-${cand.stepRow.id}`,
            conversationId: cand.stepRow.buildId,
            role: 'system',
            content: `已换备用模型：${modelKey(routeSwitch)}（${routeSwitch.reason}），改用 ${modelKey(pinnedModel)} 运行。`,
            createdAt: claimedAt,
          });
        }
        if (cand.stepRow.kind !== 'review') {
          const baseRule = routeForStep(tx, cand.todoRow, cand.stepRow.kind);
          recordStepRoute(tx, cand.stepRow, cand.todoRow, machineId, {
            provider: model.provider,
            modelId: model.modelId,
            machineId: agentRow.machineId,
            requiredCapabilities: agentRow.requiredCapabilities,
            primaryProvider: baseRule?.provider ?? null,
            preferredModelId: baseRule?.modelId ?? null,
            githubPushRepo: txGithubPushRepo,
            routed: agentRow.routed && !fallbackActive,
            ...(routeSwitch !== null
              ? { switchReason: routeSwitch.reason }
              : cand.stepRow.fallback?.model != null || advancedFallback !== null
                ? { switchReason: 'declared fallback' }
                : {}),
          });
        }
        if (skillInjection.hits.length > 0) {
          tx.insert(skillAudit)
            .values(
              skillInjection.hits.map((hit) => ({
                id: newRecordId(),
                skillId: hit.id,
                actorType: 'agent',
                actorId: agentRow.id,
                action: 'inject',
                bytes: Buffer.byteLength(hit.reason, 'utf8'),
                createdAt: claimedAt,
              })),
            )
            .run();
        }
        if (guardPr !== null) {
          upsertMessage(settleDeps, {
            id: mergedPrGuardNoteRowId(cand.stepRow.buildId),
            conversationId: cand.stepRow.buildId,
            role: 'system',
            content: buildMergedPrGuardNote({ prNumber: guardPr.prNumber, prUrl: guardPr.prUrl }),
            createdAt: nowMs(),
          });
        }
        if (latestTodo.phase === 'queued' && latestTodo.latestBuildId === cand.stepRow.buildId) {
          setTodoPhase(
            settleDeps,
            latestTodo.id,
            cand.stepRow.kind === 'plan' ? 'planning' : 'building',
          );
        }
        publishStepStatus(settleDeps, cand.stepRow.id);
        return true;
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      continue;
    }
    if (won !== true) {
      if (won instanceof HttpError) throw won;
      continue;
    }
    return buildWorkerClaimPayload(deps, {
      machineId,
      teamId,
      origin,
      stepRow: cand.stepRow,
      buildRow: cand.buildRow,
      todoRow: cand.todoRow,
      projectRow: claimProject,
      machineRow: resolvedMachine,
      agentRow,
      model,
      claimedAt,
      switchedFallback,
      skillInjection,
      blockerHandoff,
      guardPr,
      localMerge,
      localFolderAction,
      priorSessionId,
      priorMachineId,
      freshSession,
      sessionOnOtherMachine,
      mcpServers: workerMcp,
    });
  }
  if (!stillAuthorized()) return null;
  return claimChiefTurn(
    deps,
    machineId,
    teamId,
    maxWorkers,
    Number.POSITIVE_INFINITY,
    stillAuthorized,
    signal,
  );
}

async function resolveClaimRepoId(
  deps: MachineDeps,
  teamId: string,
  ref: { owner: string; repo: string },
): Promise<{ id: number | null; error: Error | null }> {
  let appReason: AppTokenReason = 'app-token-unavailable';
  try {
    const token = await githubReadToken(deps, teamId, ref, (reason) => {
      appReason = reason;
    });
    if (token === null)
      return {
        id: null,
        error: new HttpError(
          503,
          `GitHub repository lookup has no read credential (${appReason})`,
          appReason,
        ),
      };
    const probe = await githubRepoReachable(
      deps.githubFetch ?? fetch,
      tokenValue(token),
      ref.owner,
      ref.repo,
    );
    return { id: probe.id, error: null };
  } catch (error) {
    return {
      id: null,
      error: new Error(
        error instanceof HttpError && error.status === 429
          ? 'GitHub repository lookup was rate limited; retry the step'
          : 'GitHub repository lookup failed; retry the step',
      ),
    };
  }
}

export async function claimStep(
  deps: MachineDeps,
  machineId: string,
  teamId: string,
  holdMs: number,
  origin: string,
  signal?: AbortSignal,
  body?: MachineClaimBody,
  authorized: () => boolean = () => true,
): Promise<ClaimedStep | null> {
  const stillAuthorized = () =>
    authorized() && !signal?.aborted && readDeployLease(deps.db).status === 'accepting';
  if (signal?.aborted || !stillAuthorized()) return null;
  const sinceWake = deps.machineHub.wakeSeq(teamId);
  const first = await tryClaim(
    deps,
    machineId,
    teamId,
    origin,
    body?.maxWorkers,
    body?.verifyAttachments === true,
    stillAuthorized,
    signal,
  );
  if (first) return first;
  await deps.machineHub.waitWake(teamId, holdMs, signal, sinceWake);
  if (signal?.aborted || !stillAuthorized()) return null;
  return tryClaim(
    deps,
    machineId,
    teamId,
    origin,
    body?.maxWorkers,
    body?.verifyAttachments === true,
    stillAuthorized,
    signal,
  );
}
