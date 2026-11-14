import type { ClaimedStep, MachineClaimBody } from '@cairn/shared';
import {
  AGENT_TOOL_TAG,
  appendMergedPrGuard,
  buildMergedPrGuardInstruction,
  buildMergedPrGuardNote,
  buildTaskPromptText,
  claudeLoginBlocksClaim,
  claudeRateBlock,
  confinementDispatchReady,
  fencedTitle,
  isBuildStepKind,
  LOCAL_TOOL_CREATE_TAG,
  MCP_MIN_CLI_VERSION,
  mergedPrGuardNoteRowId,
  parseLocalMergeInstruction,
  parseVerifyPromptMeta,
  type RemoteToolDef,
  type SkillInjectionRecord,
  type StepKind,
  selectSkillsForTask,
  WORKER_ASK_USER_TOOL,
  WORKER_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS_GITHUB,
  WORKER_THREAD_REPORT_TOOL,
} from '@cairn/shared';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import {
  build,
  chief,
  chiefThread,
  machine,
  routingRule,
  skillAudit,
  step,
  todo,
} from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { receivesAnswers, undeliveredAnswers } from './answer-delivery.js';
import { autonomousMergePolicy } from './autonomous-merge.js';
import { blockerHandoffForClaim } from './blocker-handoff.js';
import { holdBlockedBuild } from './blockers.js';
import { failStepWithEvents, mergedPrElsewhere } from './builds.js';
import { turnProvenance } from './chief.js';
import {
  CHIEF_DIGEST_MIN_CLI_VERSION,
  CHIEF_DIGEST_REMOTE_TOOLS,
  isChiefDigestStep,
} from './chief-digest.js';
import { hasEarlierLiveChiefStep } from './chief-turns.js';
import { claudeUsageGatePasses, refreshClaudeRateParks } from './claude-rate-limit.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import { coordinatorInServerEnabled } from './coordinator-context.js';
import { coordinatorRoute } from './coordinator-route.js';
import { chiefTurnContext, claimPendingChiefStep } from './coordinator-steps.js';
import { readDeployLease } from './deploy-lease.js';
import {
  capabilityGatePasses,
  machineRunningCount,
  projectRunningCount,
  runtimeGatePasses,
  stepRuntimeFor,
  unassignedStepReason,
} from './dispatch-eligibility.js';
import { projectOfTodo, projectRepoRef } from './git.js';
import { listProjectGithubLabelVocab } from './github-labels.js';
import { parseHostedMergeInstruction } from './hosted-merge-instruction.js';
import {
  type MachineDeps,
  profileForStep,
  publishStepStatus,
  upsertMessage,
} from './machine-deps.js';
import {
  priorSessionOf,
  routeTargets,
  routeVerdict,
  soleClaimMachineId,
  type WorkerStepFacts,
  workerIneligibility,
} from './machine-routing.js';
import { injectMemories } from './memory.js';
import { effectiveModel } from './model-fallback.js';
import { mergedCatalogModels } from './model-liveness.js';
import { projectMergeConfigOf, projectShipRouteOf } from './projects.js';
import {
  chiefRemoteTools,
  memoryOpsAreTeamScoped,
  memoryOwnerOf,
  type RouteProfile,
  routeProfile,
} from './routing-rules.js';
import { reverifyShip } from './ship-gate.js';
import { scanLocalSkills } from './skills.js';
import { recordStepRoute, routedModelRunsOn } from './step-route.js';
import { stepNamesTask } from './task-naming.js';
import { isThreadScheduleTool } from './thread-schedule-tools.js';
import { setTodoPhase } from './todos.js';

function workerSkillInjection(
  deps: MachineDeps,
  agentRow: { defaultSkill: string | null; skillsAllowlist: readonly string[] | null },
  todoRow: { title: string; spec: string },
): SkillInjectionRecord {
  const scanned = new Map(scanLocalSkills(deps.skillsDir).map((s) => [s.id, s]));
  const granted =
    agentRow.skillsAllowlist === null
      ? [...scanned.keys()]
      : [...new Set(agentRow.skillsAllowlist)];
  const candidates = granted.map((id) => {
    const s = scanned.get(id);
    return s === undefined
      ? { id, name: id, description: null }
      : { id: s.id, name: s.name, description: s.description };
  });
  const hits = selectSkillsForTask(buildTaskPromptText(todoRow.title, todoRow.spec), candidates);
  return { hits };
}

interface ClaimCandidate {
  stepRow: typeof step.$inferSelect;
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
        or(isNull(step.holdUntil), lte(step.holdUntil, sql`${nowMs()}`)),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all();
  return rows;
}

function claimChiefCandidates(deps: MachineDeps, _machineId: string, teamId: string) {
  return deps.db
    .select({ stepRow: step, threadRow: chiefThread, chiefRow: chief, ruleRow: routingRule })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .innerJoin(chief, eq(chiefThread.chiefId, chief.id))
    .innerJoin(
      routingRule,
      and(eq(routingRule.teamId, chiefThread.teamId), eq(routingRule.use, 'coordinator')),
    )
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
    .map((row) => ({ ...row, agentRow: routeProfile(row.ruleRow) }))
    .filter((row) => !serverTakesTurn(deps.db, teamId, row.stepRow));
}

export function serverTakesTurn(
  db: MachineDeps['db'],
  teamId: string,
  stepRow: typeof step.$inferSelect,
): boolean {
  return (
    coordinatorInServerEnabled() &&
    stepRow.kind === 'chief' &&
    !isChiefDigestStep(stepRow) &&
    coordinatorRoute(db, teamId) !== null
  );
}

export const TASK_SEGMENTS_MIN_CLI_VERSION = '0.2.4';

export function meetsMcpVersionGate(latestCliVersion: string | null): boolean {
  return cliVersionAtLeast(latestCliVersion, MCP_MIN_CLI_VERSION);
}

function cliVersionAtLeast(latestCliVersion: string | null, min: string): boolean {
  if (!latestCliVersion) return false;
  const parse = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(latestCliVersion), parse(min)];
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

function claimMcpSlugs(
  latestCliVersion: string | null,
  agentSlugs: readonly string[],
): string[] | undefined {
  if (!meetsMcpVersionGate(latestCliVersion)) return undefined;
  return [...agentSlugs];
}

function claimLocalTools(agentTools: readonly string[]): string[] {
  const tools: string[] = [];
  if (agentTools.includes(AGENT_TOOL_TAG)) {
    tools.push(LOCAL_TOOL_CREATE_TAG);
  }
  return tools;
}

function claudeCodeLoginBlocks(
  deps: MachineDeps,
  machineRow: typeof machine.$inferSelect,
  provider: string | null | undefined,
): boolean {
  if (stepRuntimeFor(provider) !== 'claude-code') return false;
  if (hasActiveClaudeSubscription(deps, machineRow.teamId)) return false;
  return claudeLoginBlocksClaim(machineRow.claudeCodeReport?.login, nowMs());
}

function buildChiefClaim(
  deps: MachineDeps,
  machineId: string,
  stepRow: typeof step.$inferSelect,
  threadRow: typeof chiefThread.$inferSelect,
  agentRow: RouteProfile,
  machineRow?: typeof machine.$inferSelect,
): ClaimedStep | null {
  if (!agentRow.modelId) return null;
  const model = effectiveModel(agentRow, stepRow);
  if (!machineRow || !runtimeGatePasses(machineRow, model.provider)) return null;
  if (!claudeUsageGatePasses(deps, machineRow, model)) return null;
  if (claudeCodeLoginBlocks(deps, machineRow, model.provider)) return null;
  if (!capabilityGatePasses(machineRow, agentRow)) return null;
  if (!claimPendingChiefStep(deps.db, stepRow, machineId)) return null;
  return chiefClaimPayload(deps, machineId, stepRow, threadRow, agentRow, machineRow);
}

function chiefClaimPayload(
  deps: MachineDeps,
  machineId: string,
  stepRow: typeof step.$inferSelect,
  threadRow: typeof chiefThread.$inferSelect,
  agentRow: RouteProfile,
  machineRow?: typeof machine.$inferSelect,
): ClaimedStep {
  const model = effectiveModel(agentRow, stepRow);
  const { digest, trigger, systemPrompt, memories, instruction } = chiefTurnContext(
    deps,
    stepRow,
    threadRow,
    agentRow.id,
  );
  const mailTurn = turnProvenance(stepRow.prompt)?.startsWith('mail:') === true;
  const locked = digest || mailTurn;
  const chiefMcp = locked
    ? []
    : claimMcpSlugs(machineRow?.latestCliVersion ?? null, agentRow.mcpServers);
  return {
    step: {
      id: stepRow.id,
      buildId: stepRow.buildId,
      kind: 'chief',
      machineId,
      createdAt: stepRow.createdAt,
    },
    conversationId: stepRow.buildId,
    session: {
      action: !stepRow.freshSession && threadRow.sessionId !== '' ? 'continue' : 'new',
      sessionId: !stepRow.freshSession && threadRow.sessionId !== '' ? threadRow.sessionId : null,
    },
    ...(instruction !== null
      ? {
          instruction,
        }
      : {}),
    agent: {
      id: agentRow.id,
      displayName: agentRow.displayName,
      description: agentRow.description,
      provider: model.provider,
      modelId: model.modelId,
      thinkingLevel: stepRow.fallback?.model ? null : agentRow.thinkingLevel,
      memories,
    },
    chief: {
      threadId: threadRow.id,
      systemPrompt,
      trigger,
    },
    remoteTools: [...(digest ? CHIEF_DIGEST_REMOTE_TOOLS : mailTurn ? [] : chiefRemoteTools())],
    ...(chiefMcp !== undefined ? { mcpServers: chiefMcp } : {}),
    ...(locked ? { remoteToolsOnly: true as const } : {}),
  };
}

function claudeBlockedReader(db: MachineDeps['db']): (id: string | null) => boolean {
  const cache = new Map<string, boolean>();
  return (id) => {
    if (id === null) return false;
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const row = db.select().from(machine).where(eq(machine.id, id)).get();
    const blocked = claudeRateBlock(row?.claudeRateLimits ?? [], nowMs()) !== null;
    cache.set(id, blocked);
    return blocked;
  };
}

function workerCapOf(machineRow: typeof machine.$inferSelect, maxWorkers?: number): number {
  return Math.min(machineRow.maxConcurrent, ...(maxWorkers !== undefined ? [maxWorkers] : []));
}

function claimChiefTurn(
  deps: MachineDeps,
  machineId: string,
  teamId: string,
  maxWorkers: number | undefined,
  createdUpTo: number,
): ClaimedStep | null {
  const { db } = deps;
  const machineRow = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!machineRow) return null;
  if (machineRunningCount(db, machineId) >= workerCapOf(machineRow, maxWorkers)) return null;
  const claudeBlocked = claudeBlockedReader(db);
  const cands = claimChiefCandidates(deps, machineId, teamId)
    .filter((cand) => cand.stepRow.createdAt <= createdUpTo)
    .sort((a, b) => Number(isChiefDigestStep(a.stepRow)) - Number(isChiefDigestStep(b.stepRow)));
  for (const cand of cands) {
    if (hasEarlierLiveChiefStep(db, cand.stepRow)) continue;
    if (
      (isChiefDigestStep(cand.stepRow) ||
        turnProvenance(cand.stepRow.prompt)?.startsWith('mail:') === true) &&
      !cliVersionAtLeast(machineRow.latestCliVersion, CHIEF_DIGEST_MIN_CLI_VERSION)
    ) {
      continue;
    }
    const chiefRuntime = stepRuntimeFor(cand.agentRow.provider);
    if (chiefRuntime === 'claude-code' && claudeBlocked(machineId)) continue;
    const sole = soleClaimMachineId(
      db
        .select({ id: machine.id, online: machine.online })
        .from(machine)
        .where(eq(machine.teamId, teamId))
        .all(),
    );
    const chiefMachine = cand.agentRow.machineId ?? sole;
    if (chiefMachine !== machineId) continue;
    const claimed = buildChiefClaim(
      deps,
      machineId,
      cand.stepRow,
      cand.threadRow,
      cand.agentRow,
      machineRow,
    );
    if (claimed) {
      publishStepStatus(deps, claimed.step.id);
      return claimed;
    }
  }
  return null;
}

async function tryClaim(
  deps: MachineDeps,
  machineId: string,
  teamId: string,
  origin: string,
  maxWorkers: number | undefined,
  supportsAttachmentVerify: boolean,
  stillAuthorized: () => boolean,
): Promise<ClaimedStep | null> {
  if (!stillAuthorized()) return null;
  const { db } = deps;
  const machineRow = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!machineRow) return null;
  refreshClaudeRateParks(deps, teamId);
  const catalog = mergedCatalogModels();
  const full = machineRunningCount(db, machineId) >= workerCapOf(machineRow, maxWorkers);
  const queued = full ? [] : claimCandidates(deps, machineId, teamId);
  const earliestWorker = queued[0]?.stepRow.createdAt ?? Number.POSITIVE_INFINITY;
  const workerCands = [
    ...queued.filter((cand) => cand.stepRow.byPerson),
    ...queued.filter((cand) => !cand.stepRow.byPerson),
  ];
  const chiefAhead = claimChiefTurn(deps, machineId, teamId, maxWorkers, earliestWorker);
  if (chiefAhead) return chiefAhead;

  for (const cand of workerCands) {
    if (
      cand.stepRow.kind === 'verify' &&
      parseVerifyPromptMeta(cand.stepRow.prompt)?.evidence === 'attachments' &&
      !supportsAttachmentVerify
    )
      continue;
    const shipRefusal = await reverifyShip(deps, cand.stepRow);
    if (!stillAuthorized()) return null;
    if (shipRefusal !== null) {
      failStepWithEvents(deps, cand.stepRow, `Ship refused: ${shipRefusal}`);
      continue;
    }
    const localMerge = parseLocalMergeInstruction(cand.stepRow.prompt);
    if (localMerge !== null) {
      const project = projectOfTodo(db, cand.todoRow);
      const config = project ? projectMergeConfigOf(project) : null;
      if (
        project?.repoKind !== 'local' ||
        project.id !== localMerge.projectId ||
        config === null ||
        (config.mergePolicy !== 'autonomous' && projectShipRouteOf(project) !== 'local-merge') ||
        JSON.stringify(config.localChecks) !== JSON.stringify(localMerge.localChecks) ||
        cand.todoRow.phase !== 'review' ||
        cand.todoRow.latestBuildId !== localMerge.buildId
      ) {
        failStepWithEvents(
          deps,
          cand.stepRow,
          'Local merge authorization changed; a new judgment is required',
        );
        continue;
      }
    }
    const agentRow = profileForStep(deps, cand.todoRow, cand.stepRow.kind, cand.stepRow.id);
    if (agentRow === null) {
      failStepWithEvents(deps, cand.stepRow, unassignedStepReason(cand.stepRow.kind));
      continue;
    }
    if (!agentRow.modelId) continue;
    const model = effectiveModel(agentRow, cand.stepRow);
    const now = nowMs();
    const facts: WorkerStepFacts = {
      agentRow,
      model,
      localProject: projectOfTodo(db, cand.todoRow)?.repoKind === 'local',
      localMerge: localMerge !== null,
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
    const { priorSessionId, priorMachineId, freshSession } = priorSessionOf(
      db,
      cand.stepRow,
      cand.buildRow,
    );
    const sessionOnOtherMachine =
      priorSessionId !== null && priorMachineId !== null && priorMachineId !== machineId;
    const sole = soleClaimMachineId(
      db
        .select({ id: machine.id, online: machine.online })
        .from(machine)
        .where(eq(machine.teamId, teamId))
        .all(),
    );
    const allowed = routeVerdict({
      machineId,
      targets: routeTargets(
        !freshSession && priorSessionId !== null ? priorMachineId : null,
        agentRow.machineId,
        sole,
      ),
    }).claim;
    if (!allowed) continue;
    const skillInjection = workerSkillInjection(deps, agentRow, cand.todoRow);
    const guardPr =
      cand.stepRow.kind === 'plan' || isBuildStepKind(cand.stepRow.kind)
        ? await mergedPrElsewhere(deps, cand.todoRow.id, cand.stepRow.buildId)
        : null;
    if (!stillAuthorized()) return null;
    const blockerHandoff = await blockerHandoffForClaim(deps, cand.stepRow, cand.todoRow);
    if (!stillAuthorized()) return null;
    if (localMerge !== null) {
      const currentProject = projectOfTodo(db, cand.todoRow);
      if (!currentProject) continue;
      const brake = autonomousMergePolicy(
        db,
        cand.todoRow.teamId,
        projectMergeConfigOf(currentProject),
        nowMs(),
        cand.stepRow.buildId,
      );
      if (brake.autonomyPaused || brake.dailyCapReached) continue;
    }
    const claimedAt = nowMs();
    let won = false;
    try {
      won = db.transaction((tx) => {
        if (!stillAuthorized()) return false;
        if (projectFull(tx)) return false;
        holdBlockedBuild(db, cand.stepRow.buildId);
        const res = tx
          .update(step)
          .set({
            status: 'claimed',
            machineId,
            claimedAt,
            lastHeartbeatAt: claimedAt,
            skillInjection,
            blockerHandoff,
            holdReason: null,
            holdUntil: null,
          })
          .where(
            and(
              eq(step.id, cand.stepRow.id),
              eq(step.status, 'pending'),
              or(isNull(step.holdUntil), lte(step.holdUntil, claimedAt)),
            ),
          )
          .run();
        if (res.changes === 0) return false;
        if (
          cand.stepRow.kind !== 'review' &&
          cand.todoRow.sourceKind !== 'research-citation-check'
        ) {
          recordStepRoute(tx, cand.stepRow, cand.todoRow, machineId, agentRow);
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
        return true;
      });
    } catch {
      continue;
    }
    if (!won) continue;
    if (guardPr !== null) {
      upsertMessage(deps, {
        id: mergedPrGuardNoteRowId(cand.stepRow.buildId),
        conversationId: cand.stepRow.buildId,
        role: 'system',
        content: buildMergedPrGuardNote({
          prNumber: guardPr.prNumber,
          prUrl: guardPr.prUrl,
        }),
        createdAt: nowMs(),
      });
    }
    if (cand.todoRow.phase === 'queued') {
      setTodoPhase(deps, cand.todoRow.id, cand.stepRow.kind === 'plan' ? 'planning' : 'building');
    }
    const session = freshSession
      ? { action: 'new' as const, sessionId: null }
      : {
          action: priorSessionId ? ('continue' as const) : ('new' as const),
          sessionId: priorSessionId,
          ...(priorMachineId !== null && sessionOnOtherMachine ? { priorMachineId } : {}),
        };
    const projectRow = projectOfTodo(db, cand.todoRow);
    const repoRef = projectRepoRef(projectRow, origin);
    const mergeTarget =
      cand.stepRow.kind === 'merge' ? parseHostedMergeInstruction(cand.stepRow.prompt) : null;
    const repo =
      repoRef?.kind === 'hosted' && mergeTarget !== null
        ? { ...repoRef, baseBranch: mergeTarget.baseBranch }
        : repoRef;
    const workerMcp = claimMcpSlugs(machineRow.latestCliVersion, agentRow.mcpServers);
    const segmentsDaemon = cliVersionAtLeast(
      machineRow.latestCliVersion,
      TASK_SEGMENTS_MIN_CLI_VERSION,
    );
    const isGithubProject = projectRow?.repoKind === 'github';
    const namesTask = stepNamesTask(db, cand.stepRow);
    const taskMeta =
      isGithubProject && namesTask && projectRow
        ? {
            titleFinal: cand.todoRow.sourceKind === 'github-issue' || cand.todoRow.request !== null,
            vocab: listProjectGithubLabelVocab(db, projectRow.id),
          }
        : undefined;
    publishStepStatus(deps, cand.stepRow.id);
    const instruction =
      guardPr === null
        ? cand.stepRow.prompt
        : cand.stepRow.prompt !== null
          ? appendMergedPrGuard(cand.stepRow.prompt, {
              prNumber: guardPr.prNumber,
              prUrl: guardPr.prUrl,
            })
          : buildMergedPrGuardInstruction({ prNumber: guardPr.prNumber, prUrl: guardPr.prUrl });
    const decided = new Set(cand.todoRow.decisions.map((decision) => decision.requestId));
    const answerIds = receivesAnswers(cand.stepRow.kind)
      ? undeliveredAnswers(db, cand.stepRow.buildId)
          .map((answer) => answer.requestId)
          .filter((requestId) => decided.has(requestId))
      : [];
    const charter =
      db.select({ charter: chief.charter }).from(chief).where(eq(chief.teamId, teamId)).get()
        ?.charter ?? '';
    return {
      step: {
        id: cand.stepRow.id,
        buildId: cand.stepRow.buildId,
        kind: cand.stepRow.kind,
        machineId,
        createdAt: cand.stepRow.createdAt,
      },
      conversationId: cand.stepRow.buildId,
      ...(localMerge !== null ? { localMerge } : {}),
      session,
      ...(instruction !== null ? { instruction } : {}),
      ...(answerIds.length > 0 ? { answerIds } : {}),
      todo: {
        id: cand.todoRow.id,
        seqNum: cand.todoRow.seqNum,
        title:
          cand.todoRow.request !== null && !segmentsDaemon
            ? fencedTitle(cand.todoRow.title, cand.todoRow)
            : cand.todoRow.title,
        spec: cand.todoRow.spec,
        ...(cand.todoRow.decisions.length > 0 ? { decisions: cand.todoRow.decisions } : {}),
        ...(taskMeta !== undefined ? { meta: taskMeta } : {}),
        sourceKind: cand.todoRow.sourceKind,
        sourceRef: cand.todoRow.sourceRef,
        ...(cand.todoRow.request !== null && segmentsDaemon
          ? { request: cand.todoRow.request }
          : {}),
        ...(blockerHandoff !== null ? { blockerHandoff } : {}),
        output: cand.todoRow.output,
      },
      project: {
        id: cand.todoRow.projectId,
        name: projectRow?.name ?? '',
        ...(projectRow?.instructions != null ? { instructions: projectRow.instructions } : {}),
        repo,
      },
      ...(charter.trim() !== '' ? { team: { charter } } : {}),
      agent: {
        id: agentRow.id,
        displayName: agentRow.displayName,
        description: agentRow.description,
        provider: model.provider,
        modelId: model.modelId,
        thinkingLevel: cand.stepRow.fallback?.model ? null : agentRow.thinkingLevel,
        memories: injectMemories(db, {
          agentId: memoryOwnerOf(db, teamId, cand.stepRow.kind),
          teamId,
          teamScoped: memoryOpsAreTeamScoped(cand.stepRow.kind),
          threadId: cand.todoRow.id,
          projectId: cand.todoRow.projectId,
        }),
        defaultSkill: agentRow.defaultSkill,
        skillsAllowlist: agentRow.skillsAllowlist === null ? null : [...agentRow.skillsAllowlist],
        injectedSkills: skillInjection.hits.map((h) => h.id),
        tools: [...agentRow.tools],
      },
      remoteTools: workerRemoteTools(cand.stepRow.kind, isGithubProject, namesTask),
      localTools: claimLocalTools(agentRow.tools),
      ...(workerMcp !== undefined ? { mcpServers: workerMcp } : {}),
    };
  }
  return claimChiefTurn(deps, machineId, teamId, maxWorkers, Number.POSITIVE_INFINITY);
}

export function workerRemoteTools(
  kind: StepKind,
  isGithubProject: boolean,
  namesTask: boolean,
): RemoteToolDef[] {
  const base = (isGithubProject ? WORKER_REMOTE_TOOLS_GITHUB : WORKER_REMOTE_TOOLS).filter(
    (tool) =>
      (kind === 'plan' || isBuildStepKind(kind) || !isThreadScheduleTool(tool.name)) &&
      (namesTask || tool.name !== 'set_task_meta'),
  );
  return kind === 'session'
    ? [...base, WORKER_ASK_USER_TOOL, WORKER_THREAD_REPORT_TOOL]
    : [...base];
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
  const stillAuthorized = () => {
    const capabilities = deps.db
      .select()
      .from(machine)
      .where(eq(machine.id, machineId))
      .get()?.capabilities;
    const report = capabilities?.confinement;
    return (
      authorized() &&
      !signal?.aborted &&
      readDeployLease(deps.db).status === 'accepting' &&
      confinementDispatchReady(capabilities) &&
      (capabilities?.osPlatform !== 'linux' ||
        (report?.generation === body?.confinement?.generation &&
          report?.invocation === body?.confinement?.invocation))
    );
  };
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
  );
}
