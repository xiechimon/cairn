import type { ClaimedStep, MachineClaimBody } from '@cairn/shared';
import {
  AGENT_TOOL_TAG,
  appendMergedPrGuard,
  buildMergedPrGuardInstruction,
  buildMergedPrGuardNote,
  buildTaskPromptText,
  CORE_COORDINATOR_TOOLS,
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
  SUGGEST_REPLIES_TOOL_NAME,
  selectSkillsForTask,
  WORKER_ASK_USER_TOOL,
  WORKER_CLOSE_AS_DUPLICATE_TOOL,
  WORKER_MEMORY_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS_GITHUB,
  WORKER_THREAD_REPORT_TOOL,
} from '@cairn/shared';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build,
  chief,
  chiefThread,
  machine,
  type StepRanModel,
  skillAudit,
  step,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { githubRepoReachable } from '../lib/github.js';
import { type AppTokenReason, tokenValue } from '../lib/github-token.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { receivesAnswers, undeliveredAnswers } from './answer-delivery.js';
import {
  antigravitySubscriptionAllowsRunner,
  enabledAntigravitySubscriptionId,
} from './antigravity-subscriptions.js';
import { blockerHandoffForClaim } from './blocker-handoff.js';
import { holdBlockedBuild } from './blockers.js';
import { failStepWithEvents, mergedPrElsewhere } from './builds.js';
import { greetingReadmeSection } from './chief.js';
import { chiefHistoryFor } from './chief-claim-history.js';
import { hasEarlierLiveChiefStep } from './chief-turns.js';
import { accountHeld, chiefLastRanOnOtherAccount } from './claude-account-hold.js';
import { refreshClaudeRateParks } from './claude-rate-limit.js';
import { enabledSubscriptionId } from './claude-subscriptions.js';
import { coordinatorInServerEnabled, rotatesPastCompaction } from './coordinator-context.js';
import { resolveCoordinatorRemoteTools } from './coordinator-diagnostics.js';
import { coordinatorRoute } from './coordinator-route.js';
import { chiefTurnContext, claimPendingChiefStep } from './coordinator-steps.js';
import { captureCoordinatorClaim } from './coordinator-turn-capture.js';
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
import { interruptedEffectsNote } from './external-effects.js';
import { githubRepoOfProject, projectOfTodo, projectRepoRef } from './git.js';
import { githubReadToken } from './github-autonomous-token.js';
import { listProjectGithubLabelVocab } from './github-labels.js';
import { parseHostedMergeInstruction } from './hosted-merge-instruction.js';
import { localMergeAuthorizationRefusal } from './local-merge.js';
import { stageTurnAttachments } from './machine-computer.js';
import {
  type MachineDeps,
  profileForStep,
  publishStepStatus,
  upsertMessage,
  withFencedTransaction,
} from './machine-deps.js';
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
  connectorSlugs,
  hydrateMissingConnectorTools,
  mcpConnectorDepsOf,
} from './mcp-servers.js';
import { injectMemoryDocuments } from './memory.js';
import { memoryEditIdOfPrompt } from './memory-edit-turns.js';
import { effectiveModel } from './model-fallback.js';
import { mergedCatalogModels } from './model-liveness.js';
import {
  coordinatorMemoryOwner,
  coordinatorProfile,
  memoryOpsAreTeamScoped,
  memoryOwnerOf,
  type RouteProfile,
} from './routing-rules.js';
import { scanLocalSkills } from './skills.js';
import { recordStepRoute, routedModelRunsOn } from './step-route.js';
import { stepNamesTask } from './task-naming.js';
import { isThreadScheduleTool } from './thread-schedule-tools.js';
import { setTodoPhase } from './todos.js';
import { turnProvenance } from './turn-provenance.js';

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
        sql`coalesce(${todo.sourceKind}, '') NOT IN ('research-intake', 'research-citation-check')`,
        or(isNull(step.holdUntil), lte(step.holdUntil, sql`${nowMs()}`)),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all();
  return rows;
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
      return agentRow === null ? [] : [{ ...row, agentRow }];
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
  const pin = stepRow.fallback?.model ?? null;
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

export const TASK_SEGMENTS_MIN_CLI_VERSION = '0.2.4';
export const CHIEF_MAIL_MIN_CLI_VERSION = '0.2.2';

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

export function stepMcpGrant(
  db: MachineDeps['db'],
  machineRow: Pick<typeof machine.$inferSelect, 'teamId' | 'latestCliVersion' | 'capabilities'>,
  locked = false,
): string[] | undefined {
  if (locked) return [];
  if (!meetsMcpVersionGate(machineRow.latestCliVersion)) return undefined;
  const local = machineRow.capabilities?.mcpServers ?? [];
  const connectors =
    machineRow.capabilities?.mcpConnectors === true ? connectorSlugs(db, machineRow.teamId) : [];
  return [...new Set([...local, ...connectors].map((slug) => slug.toLowerCase()))];
}

export function chiefTurnLocked(stepRow: typeof step.$inferSelect): boolean {
  return (
    turnProvenance(stepRow.prompt)?.startsWith('mail:') === true ||
    memoryEditIdOfPrompt(stepRow.prompt) !== null
  );
}

function claimLocalTools(agentTools: readonly string[]): string[] {
  const tools: string[] = [];
  if (agentTools.includes(AGENT_TOOL_TAG)) {
    tools.push(LOCAL_TOOL_CREATE_TAG);
  }
  return tools;
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
  const model = effectiveModel(agentRow, stepRow);
  if (
    !machineRow ||
    chiefIneligibility(deps.db, machineRow, agentRow, model.provider, nowMs()) !== null
  )
    return null;
  const readmeSection = await greetingReadmeSection(deps, stepRow, threadRow, signal);
  if (!stillAuthorized()) return null;
  const freshMachine = deps.db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (
    !freshMachine ||
    chiefIneligibility(deps.db, freshMachine, agentRow, model.provider, nowMs()) !== null
  )
    return null;
  const runtime = stepRuntimeFor(model.provider);
  const bindSubscription =
    runtime === 'claude-code' || runtime === 'devin' || runtime === 'antigravity'
      ? { runtime, teamId: threadRow.teamId }
      : null;
  const claimed = claimPendingChiefStep(deps.db, stepRow, {
    machineId,
    bind: bindSubscription,
    model:
      model.provider === null || model.modelId === null
        ? null
        : {
            provider: model.provider,
            modelId: model.modelId,
            thinkingLevel: stepRow.fallback?.model ? null : agentRow.thinkingLevel,
          },
    mcpGrant: stepMcpGrant(deps.db, freshMachine, chiefTurnLocked(stepRow)) ?? null,
    ...(failover !== undefined
      ? { routedFromMachineId: failover.fromMachineId, routedReason: failover.reason }
      : {}),
    stillAuthorized,
  });
  if (claimed === null) return null;
  const stagedUploads =
    claimed.prompt !== null
      ? await stageTurnAttachments(deps, claimed, threadRow, claimed.prompt, signal).catch(
          () => null,
        )
      : null;
  return chiefClaimPayload(
    deps,
    machineId,
    claimed,
    threadRow,
    agentRow,
    readmeSection,
    stagedUploads,
    freshMachine,
  );
}

const DAEMON_QUICK_REPLIES_GUIDANCE = [
  '<quick_replies>',
  `On user turns (never on [wake:…] event turns), answer the user directly first; never call ${SUGGEST_REPLIES_TOOL_NAME} before answering, and skip it on simple questions, short replies, or if you called ask_user. Only after finishing a substantive multi-step reply where 1 to 3 concrete next actions genuinely help, optionally call ${SUGGEST_REPLIES_TOOL_NAME} once in the conversation's language (never suggest destructive or irreversible actions).`,
  '</quick_replies>',
].join('\n');

function chiefClaimPayload(
  deps: MachineDeps,
  machineId: string,
  stepRow: typeof step.$inferSelect,
  threadRow: typeof chiefThread.$inferSelect,
  agentRow: RouteProfile,
  readmeSection: string | null,
  stagedUploads: string | null,
  machineRow?: typeof machine.$inferSelect,
): ClaimedStep {
  const model = effectiveModel(agentRow, stepRow);
  const { trigger, systemPrompt, memories, instruction, sections, memoryTrace } = chiefTurnContext(
    deps,
    stepRow,
    threadRow,
    coordinatorMemoryOwner(deps.db, threadRow.teamId) ?? null,
  );
  const baseInstruction =
    instruction !== null && readmeSection !== null
      ? `${instruction}\n\n${readmeSection}`
      : (instruction ?? readmeSection);
  const fullInstruction =
    stagedUploads === null
      ? baseInstruction
      : baseInstruction !== null && baseInstruction !== ''
        ? `${baseInstruction}\n\n${stagedUploads}`
        : stagedUploads;
  deps.db.update(step).set({ memoryTrace }).where(eq(step.id, stepRow.id)).run();
  const runtime = stepRuntimeFor(model.provider);
  const boundSubscriptionId =
    runtime === 'claude-code'
      ? (deps.db
          .select({ id: step.claudeSubscriptionId })
          .from(step)
          .where(eq(step.id, stepRow.id))
          .get()?.id ?? null)
      : runtime === 'devin'
        ? (deps.db
            .select({ id: step.devinSubscriptionId })
            .from(step)
            .where(eq(step.id, stepRow.id))
            .get()?.id ?? null)
        : runtime === 'antigravity'
          ? (deps.db
              .select({ id: step.antigravitySubscriptionId })
              .from(step)
              .where(eq(step.id, stepRow.id))
              .get()?.id ?? null)
          : null;
  const continuesSession =
    !stepRow.freshSession &&
    threadRow.sessionId !== '' &&
    threadRow.sessionRuntime === runtime &&
    !rotatesPastCompaction(deps.db, threadRow.id, runtime) &&
    (runtime !== 'claude-code' && runtime !== 'devin' && runtime !== 'antigravity'
      ? true
      : !chiefLastRanOnOtherAccount(
          deps.db,
          threadRow.id,
          stepRow.id,
          boundSubscriptionId,
          runtime,
        ));
  const mailTurn = turnProvenance(stepRow.prompt)?.startsWith('mail:') === true;
  const memoryEditTurn = memoryEditIdOfPrompt(stepRow.prompt) !== null;
  const effectiveSystemPrompt =
    mailTurn || memoryEditTurn
      ? systemPrompt
      : `${systemPrompt}\n\n${DAEMON_QUICK_REPLIES_GUIDANCE}`;
  const volatileParts = [
    ...sections,
    ...(readmeSection !== null ? [readmeSection] : []),
    ...(stagedUploads !== null ? [stagedUploads] : []),
  ];
  captureCoordinatorClaim(deps.db, stepRow.id, threadRow.teamId, {
    systemPrompt: effectiveSystemPrompt,
    instruction: stepRow.prompt,
    trigger,
    memories: memories.map((m) => `- ${m.title}：${m.content}`),
    provider: model.provider ?? '',
    modelId: model.modelId ?? '',
    thinkingLevel: stepRow.fallback?.model ? null : (agentRow.thinkingLevel ?? null),
    volatileText: volatileParts.length === 0 ? null : volatileParts.join('\n\n'),
  });
  const locked = chiefTurnLocked(stepRow);
  const history = locked ? null : chiefHistoryFor(deps.db, threadRow, stepRow);
  const chiefMcp = machineRow ? stepMcpGrant(deps.db, machineRow, locked) : locked ? [] : undefined;
  return {
    step: {
      id: stepRow.id,
      buildId: stepRow.buildId,
      kind: 'chief',
      machineId,
      createdAt: stepRow.createdAt,
      generation: stepRow.claimedAt ?? undefined,
    },
    conversationId: stepRow.buildId,
    session: {
      action: continuesSession ? 'continue' : 'new',
      sessionId: continuesSession ? threadRow.sessionId : null,
    },
    ...(fullInstruction !== null
      ? {
          instruction: fullInstruction,
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
      systemPrompt: effectiveSystemPrompt,
      trigger,
      ...(history !== null ? { history } : {}),
    },
    remoteTools: [
      ...(mailTurn
        ? []
        : memoryEditTurn
          ? [...WORKER_MEMORY_REMOTE_TOOLS]
          : resolveCoordinatorRemoteTools(deps, {
              teamId: threadRow.teamId,
              threadRow,
            }).tools.map((def) =>
              CORE_COORDINATOR_TOOLS.has(def.name) || def.name === SUGGEST_REPLIES_TOOL_NAME
                ? def
                : { ...def, deferred: true },
            )),
    ],
    ...(chiefMcp !== undefined ? { mcpServers: chiefMcp } : {}),
    ...(locked ? { remoteToolsOnly: true as const } : {}),
  };
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

function pendingClaim(stepRow: typeof step.$inferSelect, now: number) {
  return and(
    eq(step.id, stepRow.id),
    eq(step.status, 'pending'),
    stepRow.claimedAt === null ? isNull(step.claimedAt) : eq(step.claimedAt, stepRow.claimedAt),
    or(isNull(step.holdUntil), lte(step.holdUntil, now)),
  );
}

function failPendingClaim(deps: MachineDeps, candidate: typeof step.$inferSelect, reason: string) {
  const current = deps.db.select().from(step).where(pendingClaim(candidate, nowMs())).get();
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
    const agentRow = profileForStep(deps, cand.todoRow, cand.stepRow.kind, cand.stepRow.id);
    if (agentRow === null) {
      withFencedTransaction(deps, (settleDeps) =>
        failPendingClaim(settleDeps, cand.stepRow, unassignedStepReason(cand.stepRow.kind)),
      );
      continue;
    }
    if (!agentRow.modelId) continue;
    const model = effectiveModel(agentRow, cand.stepRow);
    const pinnedModel =
      model.provider !== null && model.modelId !== null
        ? { provider: model.provider, modelId: model.modelId }
        : null;
    const now = nowMs();
    const todoProject = projectOfTodo(db, cand.todoRow);
    const facts: WorkerStepFacts = {
      agentRow,
      model,
      localProject: todoProject?.repoKind === 'local',
      localMerge: localMerge !== null,
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
    const enabledId = enabledSubscriptionId({ db }, teamId);
    const enabledDevinId = enabledDevinSubscriptionId({ db }, teamId);
    const enabledAntigravityId = enabledAntigravitySubscriptionId({ db }, teamId);
    if (claimRuntimeIsAntigravity && enabledAntigravityId === null) continue;
    const prior = priorSessionOf(
      db,
      cand.stepRow,
      cand.buildRow,
      {
        claude: enabledId,
        devin: enabledDevinId,
        antigravity: enabledAntigravityId,
      },
      model.provider,
    );
    const { priorSessionId, priorMachineId, priorMachineLiveId, freshSession } = prior;
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
    const workerMcp = stepMcpGrant(db, machineRow, false);
    const claimRepoRef = githubRepoOfProject(projectOfTodo(db, cand.todoRow));
    const repoResolution =
      claimRepoRef === null
        ? { id: null, error: null }
        : await resolveClaimRepoId(deps, teamId, claimRepoRef);
    let won: boolean | Error;
    let claimedAt = 0;
    let claimProject: ReturnType<typeof projectOfTodo>;
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
          if (accountHeld(cand.stepRow, fresh, boundId)) return false;
        }
        if (claimRuntimeIsDevin && boundDevinId !== enabledDevinId) return false;
        if (
          claimRuntimeIsAntigravity &&
          (boundAntigravityId === null ||
            boundAntigravityId !== enabledAntigravityId ||
            !antigravitySubscriptionAllowsRunner(tx, teamId, machineId))
        )
          return false;
        const latestTodo = tx.select().from(todo).where(eq(todo.id, cand.todoRow.id)).get();
        if (latestTodo === undefined) return false;
        if (
          cand.stepRow.kind === 'merge' &&
          (latestTodo.latestBuildId !== cand.buildRow.id ||
            latestTodo.archivedAt !== null ||
            latestTodo.projectId !== cand.todoRow.projectId ||
            !['done', 'review', 'failed'].includes(latestTodo.phase))
        )
          return false;
        if (
          localMerge !== null &&
          localMergeAuthorizationRefusal(db, localMerge, latestTodo) !== null
        )
          return false;
        holdBlockedBuild(tx, cand.stepRow.buildId);
        claimProject = projectOfTodo(tx, latestTodo);
        const freshMachine = tx.select().from(machine).where(eq(machine.id, machineId)).get();
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
        claimedAt = Math.max(nowMs(), (cand.stepRow.claimedAt ?? 0) + 1);
        if (repoResolution.error !== null) {
          return failPendingClaim(settleDeps, cand.stepRow, repoResolution.error.message)
            ? repoResolution.error
            : false;
        }
        const res = tx
          .update(step)
          .set({
            status: 'claimed',
            machineId,
            claimedAt,
            claimedRepo: claimRepo === null ? null : `${claimRepo.owner}/${claimRepo.repo}`,
            claimedRepoId: repoResolution.id,
            lastHeartbeatAt: claimedAt,
            skillInjection,
            blockerHandoff,
            claudeSubscriptionId: claimRuntimeIsClaudeCode ? boundId : null,
            devinSubscriptionId: claimRuntimeIsDevin ? boundDevinId : null,
            antigravitySubscriptionId: claimRuntimeIsAntigravity ? boundAntigravityId : null,
            holdReason: null,
            holdUntil: null,
            ranModel: pinnedModel,
            mcpGrant: workerMcp ?? null,
            ...(resolution.failover !== undefined
              ? {
                  routedFromMachineId: resolution.failover.fromMachineId,
                  routedReason: resolution.failover.reason,
                }
              : {}),
          })
          .where(pendingClaim(cand.stepRow, claimedAt))
          .run();
        if (res.changes === 0) return false;
        if (cand.stepRow.kind !== 'review') {
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
    const session = freshSession
      ? { action: 'new' as const, sessionId: null }
      : {
          action: priorSessionId ? ('continue' as const) : ('new' as const),
          sessionId: priorSessionId,
          ...(priorMachineId !== null && sessionOnOtherMachine ? { priorMachineId } : {}),
        };
    const projectRow = claimProject;
    const repoRef = projectRepoRef(projectRow, origin);
    const mergeTarget =
      cand.stepRow.kind === 'merge' ? parseHostedMergeInstruction(cand.stepRow.prompt) : null;
    const repo =
      repoRef?.kind === 'hosted' && mergeTarget !== null
        ? { ...repoRef, baseBranch: mergeTarget.baseBranch }
        : repoRef;
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
    const guardInstruction =
      guardPr === null
        ? cand.stepRow.prompt
        : cand.stepRow.prompt !== null
          ? appendMergedPrGuard(cand.stepRow.prompt, {
              prNumber: guardPr.prNumber,
              prUrl: guardPr.prUrl,
            })
          : buildMergedPrGuardInstruction({ prNumber: guardPr.prNumber, prUrl: guardPr.prUrl });
    const effectNote = interruptedEffectsNote(db, cand.todoRow.id);
    const instruction =
      guardInstruction !== null && effectNote !== null
        ? `${guardInstruction}\n\n${effectNote}`
        : (guardInstruction ?? effectNote);
    const decided = new Set(cand.todoRow.decisions.map((decision) => decision.requestId));
    const answerIds = receivesAnswers(cand.stepRow.kind)
      ? undeliveredAnswers(db, cand.stepRow.buildId)
          .map((answer) => answer.requestId)
          .filter((requestId) => decided.has(requestId))
      : [];
    return {
      step: {
        id: cand.stepRow.id,
        buildId: cand.stepRow.buildId,
        kind: cand.stepRow.kind,
        machineId,
        createdAt: cand.stepRow.createdAt,
        generation: claimedAt,
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
      agent: {
        id: agentRow.id,
        displayName: agentRow.displayName,
        description: agentRow.description,
        provider: model.provider,
        modelId: model.modelId,
        thinkingLevel: cand.stepRow.fallback?.model ? null : agentRow.thinkingLevel,
        memories: injectWorkerStepMemories(db, cand.stepRow.id, {
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

function injectWorkerStepMemories(
  db: Db,
  stepId: string,
  scope: Parameters<typeof injectMemoryDocuments>[1],
) {
  const { memories, indexes } = injectMemoryDocuments(db, scope);
  const teamIndexes = indexes.filter((index) => index.projectId === null);
  const projectIndexes = indexes.filter((index) => index.projectId !== null);
  const total = (rows: typeof indexes) => rows.reduce((sum, index) => sum + index.omitted, 0);
  db.update(step)
    .set({
      memoryTrace: {
        teamMemoryIds: teamIndexes.map((index) => index.id),
        teamMemoriesOmitted: total(teamIndexes),
        projectMemoryIds: projectIndexes.map((index) => index.id),
        projectMemoriesOmitted: total(projectIndexes),
        recalledMemoryIds: [],
      },
    })
    .where(eq(step.id, stepId))
    .run();
  return memories.map(({ title, content }) => ({ title, content }));
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
  if (kind !== 'session') return [...base];
  return [
    ...base,
    WORKER_ASK_USER_TOOL,
    WORKER_THREAD_REPORT_TOOL,
    ...(isGithubProject ? [WORKER_CLOSE_AS_DUPLICATE_TOOL] : []),
  ];
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
