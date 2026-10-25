import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type {
  AgentTodoReport,
  ClaimedStep,
  ClaudeCodeReport,
  GitCredentials,
  MachineAttachmentResponse,
  MachineCapabilities,
  MachineDoneBody,
  MachineSkillsManifestResponse,
  MachineTokenResponse,
  ProviderConfig,
  SecretBox,
  StepActivityReport,
  StepRecord,
  ToolCallRecord,
  TranscriptRow,
  UserRecord,
} from '@cairn/shared';
import {
  AGENT_TOOL_SHELL,
  AGENT_TOOL_TAG,
  appendMergedPrGuard,
  assertSkillInjection,
  buildMergedPrGuardInstruction,
  buildMergedPrGuardNote,
  buildSecondPrWarningNote,
  buildTaskPromptText,
  CHANGES_DIFF_MAX_BYTES,
  CHIEF_REMOTE_TOOLS,
  CHIEF_TURN_ERROR_KIND,
  classifyStepFailure,
  formatSkillRouteSection,
  GITHUB_ACCESS_TOKEN_USERNAME,
  isBackendRuntimeId,
  isChiefConversationId,
  LOCAL_TOOL_CREATE_TAG,
  LOCAL_TOOL_REMOTE_SHELL,
  MCP_MIN_CLI_VERSION,
  machineRecordSchema,
  mergedPrGuardNoteRowId,
  parseReportedCapabilities,
  SKILL_INJECTION_CHECK_KIND,
  type SkillInjectionFacts,
  type SkillInjectionRecord,
  secondPrWarningNoteRowId,
  selectSkillsForTask,
  skillFactsFromContents,
  suggestSkillsForMessage,
  WORKER_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS_GITHUB,
} from '@cairn/shared';
import { and, asc, eq, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  apiKey,
  build,
  chief,
  chiefMessage,
  chiefThread,
  machine,
  message,
  type StepFallbackRow,
  steerPending,
  step,
  stopPending,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { conflict, HttpError } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import type { FetchLike } from '../lib/github.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { newMachineToken } from '../lib/keys.js';
import { emitRuntimeStepSpan } from '../runtime-otel.js';
import { readAttachmentMeta } from './attachments.js';
import { blockerHandoffForClaim } from './blocker-handoff.js';
import {
  applyStepFailure,
  applyStoppedStep,
  completeStep,
  failStepWithEvents,
  mergedPrElsewhere,
  NotFoundError,
  reportedVerdictHeads,
  toBuildRecord,
} from './builds.js';
import {
  chiefClaimContext,
  finishChiefTurn,
  notifyChiefTurn,
  parseChiefTrigger,
  recoverGateWake,
  upsertChiefMessage,
} from './chief.js';
import { cancelPendingQuestions } from './chief-questions.js';
import type { StepCredentialBundle } from './credentials.js';
import {
  issueStepGitCredential,
  resolveChiefStepCredentials,
  resolveStepCredentials,
  revokeStepGitCredential,
} from './credentials.js';
import {
  agentForStep as agentForStepEligibility,
  agentRunningCount,
  capabilityGatePasses,
  machineRunningCount,
  recommendMachineConcurrency,
  runtimeGatePasses,
  unassignedStepReason,
} from './dispatch-eligibility.js';
import { quotaHoldBackoffMs, quotaHoldNote } from './dispatch-timeouts.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import {
  diffTextNamesAFile,
  parseUnifiedDiff,
  projectOfTodo,
  projectRepoRef,
  repoDirFor,
} from './git.js';
import { openGithubToken } from './github-connection.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { injectMemories } from './memory.js';
import {
  effectiveModel,
  isZeroUsageSilentSuccess,
  planModelFallback,
  recordProviderOutcome,
  ZERO_USAGE_FAILURE,
  ZERO_USAGE_RETRY_NOTE,
} from './model-fallback.js';
import { markModelDead } from './model-liveness.js';
import { notifyModelFallback } from './notifications.js';
import { applyQuotaWaitStep } from './quota-wait.js';
import type { LocalSkill } from './skills.js';
import { listSkillFiles, readSkillFileBytes, scanLocalSkills } from './skills.js';
import { listProjectTagVocab } from './tags.js';
import { setTodoPhase } from './todos.js';

export function isChiefConversation(id: string): boolean {
  return isChiefConversationId(id);
}

export interface MachineDeps {
  db: Db;
  hub: TeamStreamHub;
  machineHub: MachineWakeHub;
  box: SecretBox;
  user: UserRecord;
  reposDir: string;
  attachmentsDir: string;
  skillsDir: string;
  mcpConfigPath?: string;
  convHub?: ConversationStreamHub;
  githubFetch?: FetchLike;
}

export function publishStepStatus(deps: MachineDeps, stepId: string): void {
  if (!deps.convHub) return;
  const row = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row) return;
  deps.convHub.publishStep(row.buildId, {
    id: row.id,
    buildId: row.buildId,
    kind: row.kind,
    machineId: row.machineId,
    createdAt: row.createdAt,
    status: row.status,
    checkpointCommit: row.checkpointCommit,
    skillInjection: row.skillInjection ?? null,
  });
}

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

export function fetchSteer(
  deps: { db: Db },
  machine: { id: string },
  stepId: string,
): { content: string | null } {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow || stepRow.machineId !== machine.id || stepRow.status !== 'claimed') {
    return { content: null };
  }
  const pending = db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, stepRow.buildId))
    .get();
  if (!pending) return { content: null };
  db.delete(steerPending).where(eq(steerPending.conversationId, stepRow.buildId)).run();
  if (pending.stepId !== stepId) {
    return { content: null };
  }
  return { content: pending.content };
}

export function fetchStop(
  deps: { db: Db },
  machine: { id: string },
  stepId: string,
): { discard: boolean | null } {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow || stepRow.machineId !== machine.id || stepRow.status !== 'claimed') {
    return { discard: null };
  }
  const pending = db
    .select()
    .from(stopPending)
    .where(eq(stopPending.conversationId, stepRow.buildId))
    .get();
  if (!pending) return { discard: null };
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  if (pending.stepId !== stepId) {
    return { discard: null };
  }
  return { discard: pending.discard };
}

export function findMachineByToken(db: Db, token: string) {
  return db
    .select()
    .from(machine)
    .where(eq(machine.tokenHash, hashCredential(token)))
    .get();
}

export function findApiKeyByPlain(db: Db, plain: string) {
  return db
    .select()
    .from(apiKey)
    .where(eq(apiKey.keyHash, hashCredential(plain)))
    .get();
}

export { machineRunningCount } from './dispatch-eligibility.js';

export function toMachineRecord(row: typeof machine.$inferSelect, runningSteps?: number) {
  const recommendation = recommendMachineConcurrency(row.capabilities?.hardware);
  return machineRecordSchema.parse({
    id: row.id,
    name: row.name,
    teamId: row.teamId,
    online: row.online,
    latestCliVersion: row.latestCliVersion,
    kind: row.kind,
    enabledRuntimes: row.enabledRuntimes,
    shellEnabled: row.shellEnabled,
    maxConcurrent: row.maxConcurrent,
    maxConcurrentOverridden: row.maxConcurrentOverridden,
    recommendedConcurrent: recommendation.value,
    concurrencyRange: recommendation.range,
    concurrencySource: row.maxConcurrentOverridden ? 'manual' : recommendation.source,
    ...(runningSteps !== undefined ? { runningSteps } : {}),
    capabilities: row.capabilities,
  });
}

function parseCapabilitiesField(raw: unknown): MachineCapabilities | undefined {
  if (raw === undefined) return undefined;
  return parseReportedCapabilities(raw);
}

function mergeReportedCapabilities(
  previous: MachineCapabilities | null,
  reported: MachineCapabilities,
): MachineCapabilities {
  if (reported.hardware === undefined && previous?.hardware !== undefined) {
    return { ...reported, hardware: previous.hardware };
  }
  return reported;
}

function reportedConcurrencyPatch(
  row: {
    maxConcurrentOverridden: boolean;
    capabilities: MachineCapabilities | null;
  },
  reported: MachineCapabilities,
): {
  capabilities: MachineCapabilities;
  maxConcurrent?: number;
} {
  const capabilities = mergeReportedCapabilities(row.capabilities, reported);
  const recommendation = recommendMachineConcurrency(capabilities.hardware);
  return {
    capabilities,
    ...(!row.maxConcurrentOverridden ? { maxConcurrent: recommendation.value } : {}),
  };
}

export function backfillMachineConcurrency(db: Db): number {
  const rows = db
    .select({
      id: machine.id,
      maxConcurrent: machine.maxConcurrent,
      capabilities: machine.capabilities,
    })
    .from(machine)
    .where(eq(machine.maxConcurrentOverridden, false))
    .all();
  let changed = 0;
  for (const row of rows) {
    const { value } = recommendMachineConcurrency(row.capabilities?.hardware);
    if (row.maxConcurrent === value) continue;
    db.update(machine).set({ maxConcurrent: value }).where(eq(machine.id, row.id)).run();
    changed += 1;
  }
  return changed;
}

export function machineConcurrencyPatch(
  row: typeof machine.$inferSelect,
  maxConcurrent: number | null,
): {
  maxConcurrent: number;
  maxConcurrentOverridden: boolean;
} {
  if (maxConcurrent === null) {
    const recommendation = recommendMachineConcurrency(row.capabilities?.hardware);
    return { maxConcurrent: recommendation.value, maxConcurrentOverridden: false };
  }
  return { maxConcurrent, maxConcurrentOverridden: true };
}

function localMachineRow(db: Db, teamId: string, name: string) {
  if (name !== hostname()) return undefined;
  return db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.name, name)))
    .get();
}

export function seedLocalMachine(db: Db, teamId: string): void {
  const local = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.kind, 'local')))
    .get();
  if (local) return;
  const byName = localMachineRow(db, teamId, hostname());
  if (byName) {
    db.update(machine).set({ kind: 'local' }).where(eq(machine.id, byName.id)).run();
    return;
  }
  db.insert(machine)
    .values({
      id: newRecordId(),
      teamId,
      name: hostname(),
      online: false,
      tokenHash: null,
      apiKeyId: null,
      latestCliVersion: null,
      kind: 'local',
      enabledRuntimes: ['pi'],
    })
    .run();
}

export function enrollMachine(
  deps: MachineDeps,
  input: {
    keyId: string;
    teamId: string;
    name: string;
    cliVersion?: string;
    serverUrl: string;
    claudeCode?: ClaudeCodeReport;
    capabilities?: unknown;
  },
): { machineId: string; token: string; teamId: string; serverUrl: string } {
  const { db } = deps;
  const token = newMachineToken();
  const isLocal = input.name === hostname();
  const capabilities = parseCapabilitiesField(input.capabilities);
  const existing =
    db
      .select()
      .from(machine)
      .where(and(eq(machine.apiKeyId, input.keyId), eq(machine.teamId, input.teamId)))
      .get() ?? (isLocal ? localMachineRow(db, input.teamId, input.name) : undefined);
  if (existing) {
    db.update(machine)
      .set({
        tokenHash: token.hash,
        name: input.name,
        apiKeyId: input.keyId,
        ...(input.cliVersion !== undefined ? { latestCliVersion: input.cliVersion } : {}),
        ...(isLocal ? { kind: 'local' as const } : {}),
        ...(input.claudeCode !== undefined ? { claudeCodeReport: input.claudeCode } : {}),
        ...(capabilities !== undefined ? reportedConcurrencyPatch(existing, capabilities) : {}),
      })
      .where(eq(machine.id, existing.id))
      .run();
    return {
      machineId: existing.id,
      token: token.plain,
      teamId: input.teamId,
      serverUrl: input.serverUrl,
    };
  }
  const machineId = newRecordId();
  db.insert(machine)
    .values({
      id: machineId,
      teamId: input.teamId,
      name: input.name,
      online: false,
      tokenHash: token.hash,
      apiKeyId: input.keyId,
      latestCliVersion: input.cliVersion ?? null,
      kind: isLocal ? 'local' : 'remote',
      enabledRuntimes: ['pi'],
      ...(input.claudeCode !== undefined ? { claudeCodeReport: input.claudeCode } : {}),
      ...(capabilities !== undefined
        ? reportedConcurrencyPatch(
            { maxConcurrentOverridden: false, capabilities: null },
            capabilities,
          )
        : {}),
    })
    .run();
  return { machineId, token: token.plain, teamId: input.teamId, serverUrl: input.serverUrl };
}

export function authorizeEnrollmentMachine(
  deps: MachineDeps,
  input: { teamId: string; name: string; serverUrl: string },
): { machineId: string; token: string; teamId: string; serverUrl: string } {
  const { db } = deps;
  const token = newMachineToken();
  const isLocal = input.name === hostname();
  const existing = isLocal ? localMachineRow(db, input.teamId, input.name) : undefined;
  if (existing) {
    db.update(machine)
      .set({ tokenHash: token.hash, kind: 'local' })
      .where(eq(machine.id, existing.id))
      .run();
    return {
      machineId: existing.id,
      token: token.plain,
      teamId: input.teamId,
      serverUrl: input.serverUrl,
    };
  }
  const machineId = newRecordId();
  db.insert(machine)
    .values({
      id: machineId,
      teamId: input.teamId,
      name: input.name,
      online: false,
      tokenHash: token.hash,
      apiKeyId: null,
      latestCliVersion: null,
      kind: isLocal ? 'local' : 'remote',
      enabledRuntimes: ['pi'],
    })
    .run();
  return { machineId, token: token.plain, teamId: input.teamId, serverUrl: input.serverUrl };
}

export function markPresence(
  deps: MachineDeps,
  machineId: string,
  body: { cliVersion?: string; claudeCode?: ClaudeCodeReport; capabilities?: unknown },
): void {
  const { db, hub } = deps;
  const row = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!row) throw new NotFoundError(`machine ${machineId}`);
  const becameOnline = !row.online;
  const capabilities = parseCapabilitiesField(body.capabilities);
  db.update(machine)
    .set({
      online: true,
      lastSeenAt: nowMs(),
      ...(body.cliVersion !== undefined ? { latestCliVersion: body.cliVersion } : {}),
      ...(body.claudeCode !== undefined ? { claudeCodeReport: body.claudeCode } : {}),
      ...(capabilities !== undefined ? reportedConcurrencyPatch(row, capabilities) : {}),
    })
    .where(eq(machine.id, machineId))
    .run();
  if (becameOnline) {
    hub.publish(row.teamId, () => ({ type: 'machine_presence', machineId, online: true }));
  }
}

export function markOffline(deps: Pick<MachineDeps, 'db' | 'hub'>, machineId: string): void {
  const { db, hub } = deps;
  const row = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!row?.online) return;
  db.update(machine).set({ online: false }).where(eq(machine.id, machineId)).run();
  hub.publish(row.teamId, () => ({ type: 'machine_presence', machineId, online: false }));
}

export const MACHINE_STALE_OFFLINE_MS = 150_000;

export function sweepStaleMachines(
  deps: Pick<MachineDeps, 'db' | 'hub'>,
  now: number = nowMs(),
): void {
  const { db } = deps;
  const stale = db
    .select({ id: machine.id })
    .from(machine)
    .where(
      and(
        eq(machine.online, true),
        isNotNull(machine.lastSeenAt),
        lt(machine.lastSeenAt, now - MACHINE_STALE_OFFLINE_MS),
      ),
    )
    .all();
  for (const row of stale) {
    markOffline(deps, row.id);
  }
}

export function recoverSteps(deps: MachineDeps, machineId: string): StepRecord[] {
  return deps.db
    .select()
    .from(step)
    .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
    .orderBy(asc(step.createdAt))
    .all()
    .map(toStepRecord);
}

function toStepRecord(r: typeof step.$inferSelect): StepRecord {
  return {
    id: r.id,
    buildId: r.buildId,
    kind: r.kind,
    machineId: r.machineId,
    createdAt: r.createdAt,
  };
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

export function agentForStep(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  kind: StepRecord['kind'],
  prompt: string | null = null,
) {
  return agentForStepEligibility(deps.db, todoRow, kind, prompt);
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

export function heartbeatStep(deps: MachineDeps, machineId: string, stepId: string): void {
  if (!deps.db.select({ id: step.id }).from(step).where(eq(step.id, stepId)).get()) {
    throw new HttpError(410, `step ${stepId} no longer exists`);
  }
  const row = ownedStep(deps, machineId, stepId);
  deps.db.update(step).set({ lastHeartbeatAt: nowMs() }).where(eq(step.id, row.id)).run();
}

export function ownedStep(deps: MachineDeps, machineId: string, stepId: string) {
  const row = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row) throw new NotFoundError(`step ${stepId}`);
  if (row.machineId !== machineId) throw new NotFoundError(`step ${stepId} (not yours)`);
  return row;
}

function stepTeamId(deps: MachineDeps, stepRow: typeof step.$inferSelect): string | null {
  const { db } = deps;
  if (isChiefConversation(stepRow.buildId)) {
    return (
      db
        .select({ teamId: chiefThread.teamId })
        .from(chiefThread)
        .where(eq(chiefThread.id, stepRow.buildId))
        .get()?.teamId ?? null
    );
  }
  const todoRow = db
    .select({ teamId: todo.teamId })
    .from(build)
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(eq(build.id, stepRow.buildId))
    .get();
  return todoRow?.teamId ?? null;
}

export function reportTool(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  call: ToolCallRecord,
): void {
  const row = ownedStep(deps, machineId, stepId);
  const messageRow = {
    id: call.id,
    role: 'assistant' as const,
    content: { kind: 'toolcall', call },
    createdAt: call.endedAt ?? nowMs(),
  };
  if (isChiefConversation(row.buildId)) {
    upsertChiefRow(deps, { ...messageRow, threadId: row.buildId });
    return;
  }
  upsertMessage(deps, { ...messageRow, conversationId: row.buildId });
}

export function reportTranscriptDelta(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  text: string,
): void {
  const row = ownedStep(deps, machineId, stepId);
  if (text === '') return;
  deps.convHub?.publishTextDelta(row.buildId, text);
}

export function reportThinkingDelta(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  text: string,
): void {
  const row = ownedStep(deps, machineId, stepId);
  if (text === '') return;
  deps.convHub?.publishThinkingDelta(row.buildId, text);
}

export function reportTranscriptRow(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  row: TranscriptRow,
): void {
  const owned = ownedStep(deps, machineId, stepId);
  if (isChiefConversation(owned.buildId)) {
    upsertChiefRow(deps, {
      id: row.id,
      threadId: owned.buildId,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    });
    return;
  }
  upsertMessage(deps, {
    id: row.id,
    conversationId: owned.buildId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  });
}

export function reportActivity(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  report: StepActivityReport,
): void {
  const row = ownedStep(deps, machineId, stepId);
  deps.convHub?.publishActivity(row.buildId, { ...report, stepId, at: nowMs() });
}

export function reportAgentTodo(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  report: AgentTodoReport,
): void {
  const row = ownedStep(deps, machineId, stepId);
  deps.convHub?.publishAgentTodo(row.buildId, { ...report, stepId, at: nowMs() });
}

export function machineAttachmentDownload(
  deps: MachineDeps,
  machineId: string,
  machineTeamId: string,
  stepId: string,
  attachmentId: string,
  tokenTeamId: string | undefined,
): MachineAttachmentResponse {
  ownedStep(deps, machineId, stepId);
  if (tokenTeamId !== machineTeamId) throw new NotFoundError(`attachment ${attachmentId}`);
  const meta = readAttachmentMeta(
    { db: deps.db, attachmentsDir: deps.attachmentsDir },
    machineTeamId,
    attachmentId,
  );
  return {
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    contentBase64: meta.content,
  };
}

function skillsSelection(
  deps: MachineDeps,
  row: ReturnType<typeof ownedStep>,
): { isChief: boolean; unrestricted: boolean; wanted: LocalSkill[] } {
  const scanned = scanLocalSkills(deps.skillsDir);
  if (row.kind === 'chief') return { isChief: true, unrestricted: true, wanted: scanned };
  const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${row.buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${buildRow.todoId}`);
  const agentRow = agentForStep(deps, todoRow, row.kind, row.prompt);
  const allowlist = agentRow?.skillsAllowlist ?? null;
  if (allowlist === null) return { isChief: false, unrestricted: true, wanted: scanned };
  const whitelist = new Set(allowlist);
  return {
    isChief: false,
    unrestricted: false,
    wanted: scanned.filter((s) => whitelist.has(s.id)),
  };
}

export function machineSkillsManifest(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
): MachineSkillsManifestResponse {
  const row = ownedStep(deps, machineId, stepId);
  const { isChief, unrestricted, wanted } = skillsSelection(deps, row);
  const skills: MachineSkillsManifestResponse['skills'] = [];
  for (const skill of wanted) {
    const dir = join(deps.skillsDir, skill.dirName);
    const files: MachineSkillsManifestResponse['skills'][number]['files'] = [];
    for (const path of listSkillFiles(dir)) {
      const bytes = readSkillFileBytes(dir, path);
      if (bytes === null) continue;
      files.push({
        path,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    skills.push({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      dirName: skill.dirName,
      files,
    });
  }
  return { selection: isChief || unrestricted ? 'all' : 'whitelist', skills };
}

export function machineSkillFile(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  dirName: string,
  filePath: string,
): Buffer {
  const row = ownedStep(deps, machineId, stepId);
  const { wanted } = skillsSelection(deps, row);
  const skill = wanted.find((s) => s.dirName === dirName);
  if (!skill) throw new NotFoundError(`skill ${dirName}`);
  const dir = join(deps.skillsDir, skill.dirName);
  if (!listSkillFiles(dir).includes(filePath)) throw new NotFoundError(`file ${filePath}`);
  const bytes = readSkillFileBytes(dir, filePath);
  if (bytes === null) throw new NotFoundError(`file ${filePath}`);
  return bytes;
}

type MessageRowInput = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: unknown;
  createdAt: number;
};

export function upsertMessage(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & { conversationId: string },
): void {
  deps.db
    .insert(message)
    .values(row)
    .onConflictDoUpdate({
      target: message.id,
      set: { role: row.role, content: row.content, createdAt: row.createdAt },
    })
    .run();
  deps.convHub?.publishMessage(row.conversationId, row);
}

export function upsertChiefRow(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & { threadId: string },
): void {
  upsertChiefMessage(deps.db, row);
  deps.convHub?.publishMessage(row.threadId, row);
}

function holdStepForQuota(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  outcome: MachineDoneBody,
): void {
  const { db } = deps;
  const holdCount = stepRow.holdCount + 1;
  const holdUntil = nowMs() + quotaHoldBackoffMs(holdCount);
  db.update(step)
    .set({ status: 'pending', machineId: null, holdReason: 'quota', holdUntil, holdCount })
    .where(eq(step.id, stepRow.id))
    .run();
  const note = quotaHoldNote(outcome.errorMessage ?? '', holdUntil);
  if (isChiefConversation(stepRow.buildId)) {
    upsertChiefRow(deps, {
      id: `quota-hold-${stepRow.id}`,
      threadId: stepRow.buildId,
      role: 'system',
      content: note,
      createdAt: nowMs(),
    });
  } else {
    upsertMessage(deps, {
      id: `quota-hold-${stepRow.id}`,
      conversationId: stepRow.buildId,
      role: 'system',
      content: note,
      createdAt: nowMs(),
    });
  }
  publishStepStatus(deps, stepRow.id);
  const teamId = stepTeamId(deps, stepRow);
  if (teamId !== null) deps.machineHub.wake(teamId);
}

export function stepToken(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
): MachineTokenResponse {
  const owned = ownedStep(deps, machineId, stepId);
  if (isChiefConversation(owned.buildId)) return chiefStepToken(deps, stepId, owned.buildId);
  const bundle = resolveStepCredentials({ db: deps.db, box: deps.box }, stepId);
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  const buildRow = stepRow
    ? deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get()
    : undefined;
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const agentRow =
    stepRow && todoRow ? agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) : null;
  const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
  const git =
    projectRow?.repoKind === 'hosted' && todoRow
      ? issueStepGitCredential(deps, { teamId: todoRow.teamId, stepId })
      : projectRow?.repoKind === 'github' && todoRow
        ? githubExecCredential(deps, todoRow.teamId)
        : null;
  return {
    provider: toProviderConfig(
      bundle.provider,
      stepRow?.fallback?.model?.provider ?? agentRow?.provider,
    ),
    secrets: bundle.secrets,
    git,
  };
}

function githubExecCredential(deps: MachineDeps, teamId: string): GitCredentials | null {
  const token = openGithubToken({ db: deps.db, box: deps.box }, teamId);
  return token !== null ? { username: GITHUB_ACCESS_TOKEN_USERNAME, password: token } : null;
}

export function toProviderConfig(
  bundleProvider: StepCredentialBundle['provider'],
  agentProviderId: string | null | undefined,
): ProviderConfig | null {
  if (bundleProvider) {
    return {
      kind: 'http',
      providerId: bundleProvider.providerId,
      label: bundleProvider.label,
      baseUrl: bundleProvider.baseUrl,
      api: bundleProvider.api,
      authHeader: bundleProvider.authHeader,
      compat: bundleProvider.compat,
      models: bundleProvider.models,
      ...(bundleProvider.apiKey !== null ? { apiKey: bundleProvider.apiKey } : {}),
    };
  }
  if (isBackendRuntimeId(agentProviderId)) return null;
  return agentProviderId ? { kind: 'api_key', providerId: agentProviderId } : null;
}

function chiefStepToken(
  deps: MachineDeps,
  _stepId: string,
  conversationId: string,
): MachineTokenResponse {
  const threadId = conversationId;
  const bundle = resolveChiefStepCredentials({ db: deps.db, box: deps.box }, threadId);
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  const chiefRow = threadRow
    ? deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get()
    : undefined;
  const agentRow = chiefRow?.agentId
    ? deps.db.select().from(agent).where(eq(agent.id, chiefRow.agentId)).get()
    : undefined;
  return {
    provider: toProviderConfig(bundle.provider, agentRow?.provider),
    secrets: bundle.secrets,
    git: null,
  };
}

function recordSkillInjectionCheck(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  facts: SkillInjectionFacts,
): void {
  const chiefStep = stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId);
  let skillsAllowlist: readonly string[] | null = null;
  let defaultSkill: string | null = null;
  let requested: string[] | undefined;
  if (!chiefStep) {
    const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    const todoRow = buildRow
      ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
      : undefined;
    const agentRow = todoRow ? agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) : null;
    if (agentRow == null) return;
    skillsAllowlist = agentRow.skillsAllowlist ?? null;
    defaultSkill = agentRow.defaultSkill;
    if (stepRow.skillInjection == null) {
      requested = undefined;
    } else {
      const ids = stepRow.skillInjection.hits.map((h) => h.id);
      requested =
        defaultSkill == null || defaultSkill === ''
          ? ids
          : [defaultSkill, ...ids.filter((id) => id !== defaultSkill)];
    }
  }
  const contents = (
    chiefStep
      ? deps.db
          .select({ content: chiefMessage.content })
          .from(chiefMessage)
          .where(eq(chiefMessage.threadId, stepRow.buildId))
          .all()
      : deps.db
          .select({ content: message.content })
          .from(message)
          .where(eq(message.conversationId, stepRow.buildId))
          .all()
  ).map((row) => row.content);
  const verdict = assertSkillInjection({
    skillsAllowlist,
    defaultSkill,
    requested,
    names: facts,
    facts: skillFactsFromContents(contents),
  });
  const row = {
    id: `skill-injection-${stepRow.id}`,
    role: 'system' as const,
    content: JSON.stringify({
      kind: SKILL_INJECTION_CHECK_KIND,
      level: verdict.level,
      reds: verdict.reds,
      yellows: verdict.yellows,
      injected: facts.injected,
      omitted: facts.omitted,
      unrendered: facts.unrendered,
    }),
    createdAt: nowMs(),
  };
  if (chiefStep) upsertChiefRow(deps, { ...row, threadId: stepRow.buildId });
  else upsertMessage(deps, { ...row, conversationId: stepRow.buildId });
}

export async function finishStep(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  body: MachineDoneBody,
): Promise<void> {
  const { db } = deps;
  const found = db.select().from(step).where(eq(step.id, stepId)).get();
  if (found && found.status !== 'claimed') {
    const released =
      found.machineId === null &&
      stepTeamId(deps, found) ===
        db.select({ teamId: machine.teamId }).from(machine).where(eq(machine.id, machineId)).get()
          ?.teamId;
    if (found.machineId === machineId || released) {
      revokeStepGitCredential(deps, stepId);
      return;
    }
  }
  const stepRow = ownedStep(deps, machineId, stepId);
  revokeStepGitCredential(deps, stepId);
  let priorMerged: { prNumber: number; prUrl: string | null } | null = null;
  if (body.prUrl !== undefined && body.prNumber !== undefined) {
    const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    if (buildRow) priorMerged = await mergedPrElsewhere(deps, buildRow.todoId, stepRow.buildId);
  }
  const mergeSuccess = stepRow.kind === 'merge' && body.status === 'success';
  let landingSkipped = mergeSuccess && mergeCardLeftReview(deps, stepRow);
  let landingError: string | null = null;
  if (mergeSuccess && !landingSkipped) {
    const landing = await applyMergeLanding(deps, stepRow, body.commit ?? null);
    if (landing === MERGE_LANDING_SKIPPED) landingSkipped = true;
    else landingError = landing;
  }
  {
    const current = db.select().from(step).where(eq(step.id, stepId)).get();
    if (
      current?.status !== 'claimed' ||
      current.machineId !== machineId ||
      current.claimedAt !== stepRow.claimedAt
    ) {
      throw conflict(`step ${stepId} was released or claimed again while its report was applied`);
    }
  }
  {
    const teamId = stepTeamId(deps, stepRow);
    if (teamId !== null) deps.machineHub.wake(teamId);
  }
  if (landingSkipped) {
    upsertMessage(deps, {
      id: `merge-not-landed-${stepId}`,
      conversationId: stepRow.buildId,
      role: 'system',
      content: MERGE_NOT_LANDED_NOTE,
      createdAt: nowMs(),
    });
  }
  if (body.sessionId !== undefined) {
    db.update(step).set({ sessionId: body.sessionId }).where(eq(step.id, stepId)).run();
  }
  if (body.commit !== undefined) {
    db.update(step).set({ checkpointCommit: body.commit }).where(eq(step.id, stepId)).run();
  }
  {
    const sets: Partial<typeof build.$inferSelect> = {};
    if (body.prUrl !== undefined && body.prNumber !== undefined) {
      sets.prUrl = body.prUrl;
      sets.prNumber = body.prNumber;
    }
    if (body.changesDiff !== undefined && body.changesDiff.length <= CHANGES_DIFF_MAX_BYTES) {
      const files = parseUnifiedDiff(body.changesDiff);
      sets.changes =
        files.length === 0 && diffTextNamesAFile(body.changesDiff)
          ? { files, changed: true }
          : files;
    }
    if (Object.keys(sets).length > 0) {
      const updated = db.update(build).set(sets).where(eq(build.id, stepRow.buildId)).run();
      if (updated.changes > 0) {
        const row = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
        const todoRow = row
          ? db.select().from(todo).where(eq(todo.id, row.todoId)).get()
          : undefined;
        if (row && todoRow) deps.hub.publishBuildDoc(todoRow.teamId, toBuildRecord(row));
      }
    }
  }
  if (priorMerged !== null && body.prNumber !== undefined) {
    upsertMessage(deps, {
      id: secondPrWarningNoteRowId(stepRow.buildId),
      conversationId: stepRow.buildId,
      role: 'system',
      content: buildSecondPrWarningNote({
        prNumber: body.prNumber,
        mergedPrNumber: priorMerged.prNumber,
        mergedPrUrl: priorMerged.prUrl,
      }),
      createdAt: nowMs(),
    });
  }
  const outcome: MachineDoneBody =
    landingError !== null ? { ...body, status: 'failed', errorMessage: landingError } : body;
  for (const u of outcome.usage ?? []) {
    const cost = u.cost;
    db.insert(tokenUsage)
      .values({
        buildId: stepRow.buildId,
        model: u.model,
        input: u.input,
        output: u.output,
        cacheRead: u.cacheRead,
        cacheWrite: u.cacheWrite,
        costInput: cost?.input ?? 0,
        costOutput: cost?.output ?? 0,
        costCacheRead: cost?.cacheRead ?? 0,
        costCacheWrite: cost?.cacheWrite ?? 0,
        costTotal: cost?.total ?? 0,
      })
      .onConflictDoUpdate({
        target: [tokenUsage.buildId, tokenUsage.model],
        set: {
          input: sql`${tokenUsage.input} + ${u.input}`,
          output: sql`${tokenUsage.output} + ${u.output}`,
          cacheRead: sql`${tokenUsage.cacheRead} + ${u.cacheRead}`,
          cacheWrite: sql`${tokenUsage.cacheWrite} + ${u.cacheWrite}`,
          costInput: sql`${tokenUsage.costInput} + ${cost?.input ?? 0}`,
          costOutput: sql`${tokenUsage.costOutput} + ${cost?.output ?? 0}`,
          costCacheRead: sql`${tokenUsage.costCacheRead} + ${cost?.cacheRead ?? 0}`,
          costCacheWrite: sql`${tokenUsage.costCacheWrite} + ${cost?.cacheWrite ?? 0}`,
          costTotal: sql`${tokenUsage.costTotal} + ${cost?.total ?? 0}`,
        },
      })
      .run();
  }
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  const worker = workerStepContext(deps, stepRow);
  const zeroUsage = worker !== null && isZeroUsageSilentSuccess(stepRow.kind, outcome);
  if (worker?.agentRow) {
    recordProviderOutcome(effectiveModel(worker.agentRow, stepRow).provider, outcome, zeroUsage);
  }
  if (worker !== null) {
    const plan = planModelFallback(db, stepRow, worker.agentRow, outcome);
    if (plan !== null) {
      if (plan.trigger === 'model_unavailable') {
        markModelDead(plan.from.provider, plan.from.modelId);
      }
      requeueStep(deps, stepRow, plan.row, {
        id: `model-fallback-${stepRow.id}-${plan.row.tried.length}`,
        content: plan.note,
      });
      notifyModelFallback(deps, worker.todoRow, worker.agentRow, plan.note);
      return;
    }
  }
  if (outcome.status === 'failed' && outcome.quotaBlock !== undefined) {
    applyQuotaWaitStep(deps, stepRow, outcome.quotaBlock);
    return;
  }
  if (outcome.status === 'failed' && classifyStepFailure(outcome.errorMessage ?? '') === 'quota') {
    holdStepForQuota(deps, stepRow, outcome);
    return;
  }
  if (
    outcome.status === 'failed' &&
    classifyStepFailure(outcome.errorMessage ?? '') === 'model_unavailable' &&
    worker?.agentRow
  ) {
    const ran = effectiveModel(worker.agentRow, stepRow);
    if (ran.provider && ran.modelId) markModelDead(ran.provider, ran.modelId);
  }
  if (outcome.skillInjectionFacts !== undefined) {
    recordSkillInjectionCheck(deps, stepRow, outcome.skillInjectionFacts);
  }
  if (stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId)) {
    db.update(step)
      .set({ status: outcome.status === 'success' ? 'done' : 'failed' })
      .where(eq(step.id, stepId))
      .run();
    publishStepStatus(deps, stepId);
    cancelPendingQuestions(
      {
        db: deps.db,
        hub: deps.hub,
        user: deps.user,
        ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
      },
      stepRow.buildId,
      '回合已结束',
    );
    finishChiefTurn(deps, stepRow.buildId, outcome);
    if (outcome.status === 'success') notifyChiefTurn(deps, stepRow.buildId, stepRow.prompt);
    if (outcome.status === 'failed') recoverGateWake(deps, stepRow);
    if (outcome.status === 'failed' && outcome.errorMessage) {
      upsertChiefRow(deps, {
        id: `chief-err-${stepId}`,
        threadId: stepRow.buildId,
        role: 'system',
        content: JSON.stringify({ kind: CHIEF_TURN_ERROR_KIND, message: outcome.errorMessage }),
        createdAt: nowMs(),
      });
    }
    emitRuntimeStepSpan(deps.db, stepId);
    return;
  }
  const verdictReport = reportedVerdictHeads(stepRow, {
    gateHeadSha: body.gateHeadSha,
    commit: body.commit,
  });
  if (zeroUsage) {
    if (!(stepRow.fallback?.zeroUsageRetried ?? false)) {
      requeueStep(
        deps,
        stepRow,
        {
          model: stepRow.fallback?.model ?? null,
          tried: stepRow.fallback?.tried ?? [],
          zeroUsageRetried: true,
        },
        { id: `zero-usage-retry-${stepRow.id}`, content: ZERO_USAGE_RETRY_NOTE },
      );
      return;
    }
    applyStepFailure(deps, stepRow, ZERO_USAGE_FAILURE, verdictReport);
    publishStepStatus(deps, stepId);
    emitRuntimeStepSpan(deps.db, stepId);
    return;
  }
  if (outcome.status === 'success') {
    completeStep(deps, stepId, {
      hasChanges: outcome.hasChanges,
      ...(outcome.workBranchDrift !== undefined
        ? { workBranchDrift: outcome.workBranchDrift }
        : {}),
      ...(outcome.findings !== undefined ? { findings: outcome.findings } : {}),
      ...(outcome.findingsError !== undefined ? { findingsError: outcome.findingsError } : {}),
      ...(outcome.verifyVerdict !== undefined ? { verifyVerdict: outcome.verifyVerdict } : {}),
      ...(outcome.verifyVerdictError !== undefined
        ? { verifyVerdictError: outcome.verifyVerdictError }
        : {}),
      ...(outcome.report !== undefined ? { report: outcome.report } : {}),
      verdictReport,
    });
    publishStepStatus(deps, stepId);
    emitRuntimeStepSpan(deps.db, stepId);
    return;
  }
  if (outcome.status === 'stopped') {
    applyStoppedStep(deps, stepId);
    publishStepStatus(deps, stepId);
    emitRuntimeStepSpan(deps.db, stepId);
    return;
  }
  applyStepFailure(deps, stepRow, outcome.errorMessage ?? `step ${outcome.status}`, verdictReport);
  publishStepStatus(deps, stepId);
  emitRuntimeStepSpan(deps.db, stepId);
}

function workerStepContext(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
): { todoRow: typeof todo.$inferSelect; agentRow: typeof agent.$inferSelect | null } | null {
  if (isChiefConversation(stepRow.buildId)) return null;
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return null;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return null;
  return { todoRow, agentRow: agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) };
}

function requeueStep(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  fallback: StepFallbackRow,
  note: { id: string; content: string },
): void {
  deps.db
    .update(step)
    .set({
      status: 'pending',
      machineId: null,
      sessionId: null,
      fallback,
      holdReason: null,
      holdUntil: null,
    })
    .where(eq(step.id, stepRow.id))
    .run();
  upsertMessage(deps, {
    id: note.id,
    conversationId: stepRow.buildId,
    role: 'system',
    content: note.content,
    createdAt: nowMs(),
  });
  publishStepStatus(deps, stepRow.id);
}

const MERGE_LANDING_SKIPPED = Symbol('merge-landing-skipped');

export const MERGE_NOT_LANDED_NOTE =
  '合并步跑完时任务已取消或已挪回待开始，合并没有落地：默认分支保持不变';

function mergeCardLeftReview(deps: MachineDeps, stepRow: typeof step.$inferSelect): boolean {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  return todoRow?.phase === 'closed' || todoRow?.phase === 'todo';
}

async function applyMergeLanding(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  commit: string | null,
): Promise<string | null | typeof MERGE_LANDING_SKIPPED> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
  if (!todoRow || projectRow?.repoKind !== 'hosted' || projectRow.repoName === null) {
    return null;
  }
  if (commit === null) return 'merge step reported no commit';
  const dir = repoDirFor(deps.reposDir, todoRow.teamId, projectRow.repoName);
  const { defaultBranch } = await systemGitOps.listBranches(dir);
  const branch = defaultBranch ?? 'main';
  const tip = await systemGitOps.resolveCommit(dir, `refs/heads/${branch}`);
  if (tip !== null && tip !== commit) {
    const ancestor = await systemGitOps.isAncestor(dir, tip, commit);
    if (!ancestor) {
      return `merge landing refused: ${branch} moved (non-fast-forward) — rerun the task`;
    }
  }
  if (mergeCardLeftReview(deps, stepRow)) return MERGE_LANDING_SKIPPED;
  await systemGitOps.updateBranchRef(dir, branch, commit);
  return null;
}
