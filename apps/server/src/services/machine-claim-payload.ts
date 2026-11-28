import type {
  BlockerHandoffRecord,
  ClaimedStep,
  LocalFolderActionCommand,
  LocalMergeCommand,
  RemoteToolDef,
  SkillInjectionRecord,
  StepKind,
} from '@cairn/shared';
import {
  AGENT_TOOL_TAG,
  appendMergedPrGuard,
  buildMergedPrGuardInstruction,
  buildTaskPromptText,
  CLAIM_PAYLOAD_VERSION,
  CORE_COORDINATOR_TOOLS,
  fencedTitle,
  isBuildStepKind,
  LOCAL_TOOL_CREATE_TAG,
  MCP_MIN_CLI_VERSION,
  SUGGEST_REPLIES_TOOL_NAME,
  selectSkillsForTask,
  WORKER_ASK_USER_TOOL,
  WORKER_CLOSE_AS_DUPLICATE_TOOL,
  WORKER_MEMORY_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS_GITHUB,
  WORKER_THREAD_REPORT_TOOL,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type build,
  type chiefThread,
  type machine,
  type project,
  type StepFallbackRow,
  step,
  type todo,
} from '../db/schema.js';
import { receivesAnswers, undeliveredAnswers } from './answer-delivery.js';
import { chiefHistoryFor } from './chief-claim-history.js';
import {
  chiefLastRanOnOtherAccount,
  chiefLastRanOnOtherMachine,
  chiefLastSessionBefore,
} from './claude-account-hold.js';
import { rotatesPastCompaction } from './coordinator-context.js';
import { resolveCoordinatorRemoteTools } from './coordinator-diagnostics.js';
import { chiefTurnContext } from './coordinator-steps.js';
import { captureCoordinatorClaim } from './coordinator-turn-capture.js';
import { stepRuntimeFor } from './dispatch-eligibility.js';
import { interruptedEffectsNote } from './external-effects.js';
import { projectRepoRef } from './git.js';
import { listProjectGithubLabelVocab } from './github-labels.js';
import { parseHostedMergeInstruction } from './hosted-merge-instruction.js';
import type { MachineDeps } from './machine-deps.js';
import { connectorSlugs } from './mcp-servers.js';
import { injectMemoryDocuments } from './memory.js';
import { memoryEditIdOfPrompt } from './memory-edit-turns.js';
import { effectiveModel } from './model-fallback.js';
import {
  coordinatorMemoryOwner,
  memoryOpsAreTeamScoped,
  memoryOwnerOf,
  type RouteProfile,
} from './routing-rules.js';
import { scanLocalSkills } from './skills.js';
import { writeMemoryTraceGuarded } from './step-groups/memory-trace.js';
import { readQuota } from './step-groups/quota.js';
import { readSubscription } from './step-groups/subscription.js';
import { stepNamesTask } from './task-naming.js';
import { isThreadScheduleTool } from './thread-schedule-tools.js';
import { turnProvenance } from './turn-provenance.js';

export const TASK_SEGMENTS_MIN_CLI_VERSION = '0.2.4';
export const CHIEF_MAIL_MIN_CLI_VERSION = '0.2.2';

export function cliVersionAtLeast(latestCliVersion: string | null, min: string): boolean {
  if (!latestCliVersion) return false;
  const parse = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(latestCliVersion), parse(min)];
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

export function meetsMcpVersionGate(latestCliVersion: string | null): boolean {
  return cliVersionAtLeast(latestCliVersion, MCP_MIN_CLI_VERSION);
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

export function workerSkillInjection(
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

function claimLocalTools(agentTools: readonly string[]): string[] {
  const tools: string[] = [];
  if (agentTools.includes(AGENT_TOOL_TAG)) {
    tools.push(LOCAL_TOOL_CREATE_TAG);
  }
  return tools;
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

function injectWorkerStepMemories(
  db: Db,
  stepId: string,
  claimedAt: number,
  scope: Parameters<typeof injectMemoryDocuments>[1],
) {
  const { memories, indexes } = injectMemoryDocuments(db, scope);
  const teamIndexes = indexes.filter((index) => index.projectId === null);
  const projectIndexes = indexes.filter((index) => index.projectId !== null);
  const total = (rows: typeof indexes) => rows.reduce((sum, index) => sum + index.omitted, 0);
  db.transaction((tx) =>
    writeMemoryTraceGuarded(
      tx,
      stepId,
      {
        memoryTrace: {
          teamMemoryIds: teamIndexes.map((index) => index.id),
          teamMemoriesOmitted: total(teamIndexes),
          projectMemoryIds: projectIndexes.map((index) => index.id),
          projectMemoriesOmitted: total(projectIndexes),
          recalledMemoryIds: [],
        },
      },
      and(eq(step.status, 'claimed'), eq(step.claimedAt, claimedAt))!,
    ),
  );
  return memories.map(({ title, content }) => ({ title, content }));
}

const DAEMON_QUICK_REPLIES_GUIDANCE = [
  '<quick_replies>',
  `On user turns (never on [wake:…] event turns), answer the user directly first; never call ${SUGGEST_REPLIES_TOOL_NAME} before answering, and skip it on simple questions, short replies, or if you called ask_user. Only after finishing a substantive multi-step reply where 1 to 3 concrete next actions genuinely help, optionally call ${SUGGEST_REPLIES_TOOL_NAME} once in the conversation's language (never suggest destructive or irreversible actions).`,
  '</quick_replies>',
].join('\n');

export interface ChiefClaimPayloadInput {
  machineId: string;
  stepRow: typeof step.$inferSelect;
  threadRow: typeof chiefThread.$inferSelect;
  agentRow: RouteProfile;
  readmeSection: string | null;
  stagedUploads: string | null;
  machineRow?: typeof machine.$inferSelect;
  mcpServers?: string[];
  hasMcpServers?: boolean;
}

export function buildChiefClaimPayload(
  deps: MachineDeps,
  input: ChiefClaimPayloadInput,
): ClaimedStep {
  const { machineId, stepRow, threadRow, agentRow, readmeSection, stagedUploads, machineRow } =
    input;
  const { fallback } = readQuota(deps.db, stepRow.id);
  const model = effectiveModel(agentRow, { fallback });
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
  deps.db.transaction((tx) =>
    writeMemoryTraceGuarded(
      tx,
      stepRow.id,
      { memoryTrace },
      and(
        eq(step.status, 'claimed'),
        stepRow.claimedAt === null ? isNull(step.claimedAt) : eq(step.claimedAt, stepRow.claimedAt),
      )!,
    ),
  );
  const runtime = stepRuntimeFor(model.provider);
  const subscription =
    runtime === 'claude-code' || runtime === 'devin' || runtime === 'antigravity'
      ? readSubscription(deps.db, stepRow.id)
      : null;
  const boundSubscriptionId =
    runtime === 'claude-code'
      ? subscription!.claudeSubscriptionId
      : runtime === 'devin'
        ? subscription!.devinSubscriptionId
        : runtime === 'antigravity'
          ? subscription!.antigravitySubscriptionId
          : runtime === 'doubao'
            ? (deps.db
                .select({ id: step.doubaoSubscriptionId })
                .from(step)
                .where(eq(step.id, stepRow.id))
                .get()?.id ?? null)
            : null;
  const localDiskSessionRuntime =
    runtime === 'antigravity' ||
    runtime === 'claude-code' ||
    runtime === 'devin' ||
    runtime === 'doubao' ||
    runtime === 'gemini';
  const continuesSession =
    !stepRow.freshSession &&
    threadRow.sessionId !== '' &&
    threadRow.sessionRuntime === runtime &&
    !rotatesPastCompaction(deps.db, threadRow.id, runtime) &&
    !(
      localDiskSessionRuntime &&
      chiefLastRanOnOtherMachine(deps.db, threadRow.id, threadRow.sessionId, stepRow.id, machineId)
    ) &&
    (runtime !== 'claude-code' &&
    runtime !== 'devin' &&
    runtime !== 'antigravity' &&
    runtime !== 'doubao'
      ? true
      : !chiefLastRanOnOtherAccount(
          deps.db,
          threadRow.id,
          stepRow.id,
          boundSubscriptionId,
          runtime,
        ) &&
        !(
          runtime === 'doubao' &&
          chiefLastSessionBefore(
            deps.db,
            threadRow.id,
            stepRow.id,
            machineRow?.capabilities?.doubao?.switchedAt,
          )
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
    thinkingLevel: fallback?.model ? null : (agentRow.thinkingLevel ?? null),
    volatileText: volatileParts.length === 0 ? null : volatileParts.join('\n\n'),
  });
  const locked = chiefTurnLocked(stepRow);
  const history = locked ? null : chiefHistoryFor(deps.db, threadRow, stepRow);
  const chiefMcp = input.hasMcpServers
    ? input.mcpServers
    : stepRow.mcpGrant !== null
      ? stepRow.mcpGrant
      : machineRow
        ? stepMcpGrant(deps.db, machineRow, locked)
        : locked
          ? []
          : undefined;
  return {
    payloadVersion: CLAIM_PAYLOAD_VERSION,
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
      thinkingLevel: fallback?.model ? null : agentRow.thinkingLevel,
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
              CORE_COORDINATOR_TOOLS.has(def.name) ? def : { ...def, deferred: true },
            )),
    ],
    ...(chiefMcp !== undefined ? { mcpServers: chiefMcp } : {}),
    ...(locked ? { remoteToolsOnly: true as const } : {}),
  };
}

export interface WorkerClaimPayloadInput {
  machineId: string;
  teamId: string;
  origin: string;
  stepRow: typeof step.$inferSelect;
  buildRow: typeof build.$inferSelect;
  todoRow: typeof todo.$inferSelect;
  projectRow: typeof project.$inferSelect | undefined;
  machineRow: typeof machine.$inferSelect;
  agentRow: RouteProfile;
  model: { provider: string | null; modelId: string | null };
  claimedAt: number;
  switchedFallback: StepFallbackRow | null;
  skillInjection: SkillInjectionRecord;
  blockerHandoff: BlockerHandoffRecord | null;
  guardPr: { prNumber: number; prUrl: string | null } | null;
  localMerge: LocalMergeCommand | null;
  localFolderAction: LocalFolderActionCommand | null;
  priorSessionId: string | null;
  priorMachineId: string | null;
  freshSession: boolean;
  sessionOnOtherMachine: boolean;
  mcpServers: string[] | undefined;
}

export function buildWorkerClaimPayload(
  deps: MachineDeps,
  input: WorkerClaimPayloadInput,
): ClaimedStep {
  const { db } = deps;
  const {
    machineId,
    teamId,
    origin,
    stepRow,
    todoRow,
    projectRow,
    machineRow,
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
    mcpServers,
  } = input;
  const session = freshSession
    ? { action: 'new' as const, sessionId: null }
    : {
        action: priorSessionId ? ('continue' as const) : ('new' as const),
        sessionId: priorSessionId,
        ...(priorMachineId !== null && sessionOnOtherMachine ? { priorMachineId } : {}),
      };
  const fallback = switchedFallback === null ? readQuota(db, stepRow.id).fallback : null;
  const repoRef = projectRepoRef(projectRow, origin);
  const mergeTarget = stepRow.kind === 'merge' ? parseHostedMergeInstruction(stepRow.prompt) : null;
  const repo =
    repoRef?.kind === 'hosted' && mergeTarget !== null
      ? { ...repoRef, baseBranch: mergeTarget.baseBranch }
      : repoRef;
  const segmentsDaemon = cliVersionAtLeast(
    machineRow.latestCliVersion,
    TASK_SEGMENTS_MIN_CLI_VERSION,
  );
  const isGithubProject = projectRow?.repoKind === 'github';
  const namesTask = stepNamesTask(db, stepRow);
  const taskMeta =
    isGithubProject && namesTask && projectRow
      ? {
          titleFinal: todoRow.sourceKind === 'github-issue' || todoRow.request !== null,
          vocab: listProjectGithubLabelVocab(db, projectRow.id),
        }
      : undefined;
  const guardInstruction =
    guardPr === null
      ? stepRow.prompt
      : stepRow.prompt !== null
        ? appendMergedPrGuard(stepRow.prompt, {
            prNumber: guardPr.prNumber,
            prUrl: guardPr.prUrl,
          })
        : buildMergedPrGuardInstruction({ prNumber: guardPr.prNumber, prUrl: guardPr.prUrl });
  const effectNote = interruptedEffectsNote(db, todoRow.id);
  const instruction =
    guardInstruction !== null && effectNote !== null
      ? `${guardInstruction}\n\n${effectNote}`
      : (guardInstruction ?? effectNote);
  const decided = new Set(todoRow.decisions.map((decision) => decision.requestId));
  const answerIds = receivesAnswers(stepRow.kind)
    ? undeliveredAnswers(db, stepRow.buildId)
        .map((answer) => answer.requestId)
        .filter((requestId) => decided.has(requestId))
    : [];
  return {
    payloadVersion: CLAIM_PAYLOAD_VERSION,
    step: {
      id: stepRow.id,
      buildId: stepRow.buildId,
      kind: stepRow.kind,
      machineId,
      createdAt: stepRow.createdAt,
      generation: claimedAt,
    },
    conversationId: stepRow.buildId,
    ...(localMerge !== null ? { localMerge } : {}),
    ...(localFolderAction !== null ? { localFolderAction } : {}),
    session,
    ...(instruction !== null ? { instruction } : {}),
    ...(answerIds.length > 0 ? { answerIds } : {}),
    todo: {
      id: todoRow.id,
      seqNum: todoRow.seqNum,
      title:
        todoRow.request !== null && !segmentsDaemon
          ? fencedTitle(todoRow.title, todoRow)
          : todoRow.title,
      spec: todoRow.spec,
      ...(todoRow.decisions.length > 0 ? { decisions: todoRow.decisions } : {}),
      ...(taskMeta !== undefined ? { meta: taskMeta } : {}),
      sourceKind: todoRow.sourceKind,
      sourceRef: todoRow.sourceRef,
      ...(todoRow.request !== null && segmentsDaemon ? { request: todoRow.request } : {}),
      ...(blockerHandoff !== null ? { blockerHandoff } : {}),
      output: todoRow.output,
    },
    project: {
      id: todoRow.projectId,
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
      thinkingLevel: fallback?.model || switchedFallback !== null ? null : agentRow.thinkingLevel,
      memories: injectWorkerStepMemories(db, stepRow.id, claimedAt, {
        agentId: memoryOwnerOf(db, teamId, stepRow.kind),
        teamId,
        teamScoped: memoryOpsAreTeamScoped(stepRow.kind),
        threadId: todoRow.id,
        projectId: todoRow.projectId,
      }),
      defaultSkill: agentRow.defaultSkill,
      skillsAllowlist: agentRow.skillsAllowlist === null ? null : [...agentRow.skillsAllowlist],
      injectedSkills: skillInjection.hits.map((h) => h.id),
      tools: [...agentRow.tools],
    },
    remoteTools: workerRemoteTools(stepRow.kind, isGithubProject, namesTask),
    localTools: claimLocalTools(agentRow.tools),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
  };
}
