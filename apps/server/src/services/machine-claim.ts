import type { ClaimedStep } from '@cairn/shared';
import {
  AGENT_TOOL_SHELL,
  AGENT_TOOL_TAG,
  appendMergedPrGuard,
  buildMergedPrGuardInstruction,
  buildMergedPrGuardNote,
  buildTaskPromptText,
  CHIEF_REMOTE_TOOLS,
  formatSkillRouteSection,
  LOCAL_TOOL_CREATE_TAG,
  LOCAL_TOOL_REMOTE_SHELL,
  MCP_MIN_CLI_VERSION,
  mergedPrGuardNoteRowId,
  type SkillInjectionRecord,
  selectSkillsForTask,
  suggestSkillsForMessage,
  WORKER_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS_GITHUB,
} from '@cairn/shared';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { agent, build, chief, chiefThread, machine, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { blockerHandoffForClaim } from './blocker-handoff.js';
import { failStepWithEvents, mergedPrElsewhere } from './builds.js';
import { chiefClaimContext, parseChiefTrigger } from './chief.js';
import {
  agentRunningCount,
  capabilityGatePasses,
  machineRunningCount,
  runtimeGatePasses,
  unassignedStepReason,
} from './dispatch-eligibility.js';
import { projectOfTodo, projectRepoRef } from './git.js';
import {
  agentForStep,
  type MachineDeps,
  publishStepStatus,
  upsertMessage,
} from './machine-deps.js';
import { injectMemories } from './memory.js';
import { effectiveModel } from './model-fallback.js';
import { scanLocalSkills } from './skills.js';
import { listProjectTagVocab } from './tags.js';
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
        or(isNull(step.holdUntil), lte(step.holdUntil, sql`${nowMs()}`)),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all();
  return rows;
}

function claimChiefCandidates(deps: MachineDeps, machineId: string, teamId: string) {
  return deps.db
    .select({ stepRow: step, threadRow: chiefThread, chiefRow: chief, agentRow: agent })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .innerJoin(chief, eq(chiefThread.chiefId, chief.id))
    .innerJoin(agent, eq(chief.agentId, agent.id))
    .where(
      and(
        eq(step.status, 'pending'),
        eq(step.kind, 'chief'),
        eq(chiefThread.teamId, teamId),
        eq(agent.machineId, machineId),
        or(isNull(step.holdUntil), lte(step.holdUntil, sql`${nowMs()}`)),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all();
}

export function meetsMcpVersionGate(latestCliVersion: string | null): boolean {
  if (!latestCliVersion) return false;
  const parse = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(latestCliVersion), parse(MCP_MIN_CLI_VERSION)];
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

function claimLocalTools(
  machineRow: { shellEnabled: boolean },
  agentTools: readonly string[],
): string[] {
  const tools: string[] = [];
  if (agentTools.includes(AGENT_TOOL_SHELL) && machineRow.shellEnabled) {
    tools.push(LOCAL_TOOL_REMOTE_SHELL);
  }
  if (agentTools.includes(AGENT_TOOL_TAG)) {
    tools.push(LOCAL_TOOL_CREATE_TAG);
  }
  return tools;
}

function buildChiefClaim(
  deps: MachineDeps,
  machineId: string,
  stepRow: typeof step.$inferSelect,
  threadRow: typeof chiefThread.$inferSelect,
  agentRow: typeof agent.$inferSelect,
  machineRow?: typeof machine.$inferSelect,
): ClaimedStep | null {
  if (!agentRow.modelId) return null;
  if (!machineRow || !runtimeGatePasses(machineRow, agentRow.provider)) return null;
  if (!capabilityGatePasses(machineRow, agentRow)) return null;
  const claimedAt = nowMs();
  const res = deps.db
    .update(step)
    .set({
      status: 'claimed',
      machineId,
      claimedAt,
      lastHeartbeatAt: claimedAt,
      holdReason: null,
      holdUntil: null,
    })
    .where(and(eq(step.id, stepRow.id), eq(step.status, 'pending')))
    .run();
  if (res.changes === 0) return null;
  const ctx = chiefClaimContext(deps, threadRow.id);
  const trigger = parseChiefTrigger(stepRow.prompt);
  const systemPrompt = ctx?.systemPrompt ?? '';
  let routeSection = '';
  if (ctx && trigger === 'user') {
    const hint = suggestSkillsForMessage(
      stepRow.prompt ?? '',
      scanLocalSkills(deps.skillsDir).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    );
    if (hint) routeSection = formatSkillRouteSection(hint);
  }
  const memories = injectMemories(deps.db, { agentId: agentRow.id });
  const chiefMcp = claimMcpSlugs(machineRow?.latestCliVersion ?? null, agentRow.mcpServers);
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
    ...(stepRow.prompt !== null
      ? {
          instruction:
            routeSection === '' ? stepRow.prompt : `${stepRow.prompt}\n\n${routeSection}`,
        }
      : {}),
    agent: {
      id: agentRow.id,
      displayName: agentRow.displayName,
      description: agentRow.description,
      provider: agentRow.provider,
      modelId: agentRow.modelId,
      thinkingLevel: agentRow.thinkingLevel,
      memories,
    },
    chief: {
      threadId: threadRow.id,
      systemPrompt,
      trigger,
    },
    remoteTools: [...CHIEF_REMOTE_TOOLS],
    ...(chiefMcp !== undefined ? { mcpServers: chiefMcp } : {}),
  };
}

async function tryClaim(
  deps: MachineDeps,
  machineId: string,
  teamId: string,
  origin: string,
  maxWorkers?: number,
): Promise<ClaimedStep | null> {
  const { db } = deps;
  const machineRow = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!machineRow) return null;
  const running = machineRunningCount(db, machineId);
  const workerCap = Math.min(
    machineRow.maxConcurrent,
    ...(maxWorkers !== undefined ? [maxWorkers] : []),
  );
  const full = running >= workerCap;
  const workerCands = full ? [] : claimCandidates(deps, machineId, teamId);
  const chiefCands = full ? [] : claimChiefCandidates(deps, machineId, teamId);
  const earliestWorker = workerCands[0]?.stepRow.createdAt ?? Number.POSITIVE_INFINITY;
  for (const cand of chiefCands) {
    if (cand.stepRow.createdAt > earliestWorker) break;
    if (
      cand.agentRow.maxConcurrentTasks !== null &&
      agentRunningCount(db, cand.agentRow.id) >= cand.agentRow.maxConcurrentTasks
    ) {
      continue;
    }
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

  for (const cand of workerCands) {
    const agentRow = agentForStep(deps, cand.todoRow, cand.stepRow.kind, cand.stepRow.prompt);
    if (agentRow === null) {
      failStepWithEvents(
        deps,
        cand.stepRow,
        unassignedStepReason(cand.todoRow, cand.stepRow.kind, cand.stepRow.prompt),
      );
      continue;
    }
    if (!agentRow.modelId) continue;
    if (agentRow.machineId !== machineId) continue;
    const model = effectiveModel(agentRow, cand.stepRow);
    if (!runtimeGatePasses(machineRow, model.provider)) continue;
    if (!capabilityGatePasses(machineRow, agentRow)) continue;
    if (
      agentRow.maxConcurrentTasks !== null &&
      agentRunningCount(db, agentRow.id) >= agentRow.maxConcurrentTasks
    ) {
      continue;
    }
    const prior = db
      .select({ sessionId: step.sessionId, machineId: step.machineId, fallback: step.fallback })
      .from(step)
      .where(and(eq(step.buildId, cand.stepRow.buildId), sql`${step.sessionId} is not null`))
      .orderBy(asc(step.createdAt))
      .all();
    const latestPrior = prior.length > 0 ? (prior[prior.length - 1] ?? null) : null;
    const priorRow =
      latestPrior !== null &&
      (latestPrior.fallback?.model?.provider ?? null) ===
        (cand.stepRow.fallback?.model?.provider ?? null)
        ? latestPrior
        : null;
    const priorSessionId = priorRow?.sessionId ?? null;
    const priorMachineId = priorRow?.machineId ?? null;
    const sessionOnOtherMachine =
      priorSessionId !== null && priorMachineId !== null && priorMachineId !== machineId;
    const planHandoffMissing =
      cand.stepRow.kind === 'build' && cand.buildRow.withPlan && cand.buildRow.planDocId === null;
    const skillInjection = workerSkillInjection(deps, agentRow, cand.todoRow);
    const guardPr =
      cand.stepRow.kind === 'plan' || cand.stepRow.kind === 'build'
        ? await mergedPrElsewhere(deps, cand.todoRow.id, cand.stepRow.buildId)
        : null;
    const blockerHandoff = await blockerHandoffForClaim(deps, cand.stepRow, cand.todoRow);
    const claimedAt = nowMs();
    const res = db
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
      .where(and(eq(step.id, cand.stepRow.id), eq(step.status, 'pending')))
      .run();
    if (res.changes === 0) continue;
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
    const session =
      planHandoffMissing ||
      cand.stepRow.kind === 'review' ||
      cand.stepRow.kind === 'verify' ||
      cand.stepRow.freshSession
        ? { action: 'new' as const, sessionId: null }
        : {
            action: priorSessionId ? ('continue' as const) : ('new' as const),
            sessionId: priorSessionId,
            ...(priorMachineId !== null && sessionOnOtherMachine ? { priorMachineId } : {}),
          };
    const projectRow = projectOfTodo(db, cand.todoRow);
    const repo = projectRepoRef(projectRow, origin);
    const workerMcp = claimMcpSlugs(machineRow.latestCliVersion, agentRow.mcpServers);
    const isGithubProject = projectRow?.repoKind === 'github';
    const taskMeta =
      isGithubProject && projectRow
        ? {
            titleFinal: cand.todoRow.sourceKind === 'github-issue',
            vocab: listProjectTagVocab(db, projectRow.id),
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
    return {
      step: {
        id: cand.stepRow.id,
        buildId: cand.stepRow.buildId,
        kind: cand.stepRow.kind,
        machineId,
        createdAt: cand.stepRow.createdAt,
      },
      conversationId: cand.stepRow.buildId,
      session,
      ...(instruction !== null ? { instruction } : {}),
      todo: {
        id: cand.todoRow.id,
        seqNum: cand.todoRow.seqNum,
        title: cand.todoRow.title,
        spec: cand.todoRow.spec,
        ...(taskMeta !== undefined ? { meta: taskMeta } : {}),
        sourceKind: cand.todoRow.sourceKind,
        sourceRef: cand.todoRow.sourceRef,
        ...(blockerHandoff !== null ? { blockerHandoff } : {}),
        output: cand.todoRow.output,
      },
      project: { id: cand.todoRow.projectId, name: projectRow?.name ?? '', repo },
      agent: {
        id: agentRow.id,
        displayName: agentRow.displayName,
        description: agentRow.description,
        provider: model.provider,
        modelId: model.modelId,
        thinkingLevel: cand.stepRow.fallback?.model ? null : agentRow.thinkingLevel,
        memories: injectMemories(db, {
          agentId: agentRow.id,
          projectId: cand.todoRow.projectId,
        }),
        defaultSkill: agentRow.defaultSkill,
        skillsAllowlist: agentRow.skillsAllowlist === null ? null : [...agentRow.skillsAllowlist],
        injectedSkills: skillInjection.hits.map((h) => h.id),
        tools: [...agentRow.tools],
      },
      remoteTools: [...(isGithubProject ? WORKER_REMOTE_TOOLS_GITHUB : WORKER_REMOTE_TOOLS)],
      localTools: claimLocalTools(machineRow, agentRow.tools),
      ...(workerMcp !== undefined ? { mcpServers: workerMcp } : {}),
    };
  }
  return null;
}

export async function claimStep(
  deps: MachineDeps,
  machineId: string,
  teamId: string,
  holdMs: number,
  origin: string,
  signal?: AbortSignal,
  body?: { maxWorkers?: number },
): Promise<ClaimedStep | null> {
  if (signal?.aborted) return null;
  const sinceWake = deps.machineHub.wakeSeq(teamId);
  const first = await tryClaim(deps, machineId, teamId, origin, body?.maxWorkers);
  if (first) return first;
  await deps.machineHub.waitWake(teamId, holdMs, signal, sinceWake);
  if (signal?.aborted) return null;
  return tryClaim(deps, machineId, teamId, origin, body?.maxWorkers);
}
