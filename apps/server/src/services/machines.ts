import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type {
  AgentTodoReport,
  ClaudeCodeReport,
  MachineAttachmentResponse,
  MachineCapabilities,
  MachineSkillsManifestResponse,
  StepActivityReport,
  StepRecord,
  ToolCallRecord,
  TranscriptRow,
} from '@cairn/shared';
import { machineRecordSchema, parseReportedCapabilities } from '@cairn/shared';
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { apiKey, build, machine, steerPending, step, stopPending, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { newMachineToken } from '../lib/keys.js';
import { todoAuthorizesAttachment } from './attachment-authorization.js';
import { readAttachmentMeta } from './attachments.js';
import { NotFoundError } from './builds.js';
import { consumeChiefSteer } from './chief-turns.js';
import { recommendMachineConcurrency } from './dispatch-eligibility.js';
import type { ConversationStreamHub } from './events.js';
import {
  agentForStep,
  isChiefConversation,
  type MachineDeps,
  ownedStep,
  upsertChiefRow,
  upsertMessage,
} from './machine-deps.js';
import type { LocalSkill } from './skills.js';
import { listSkillFiles, readSkillFileBytes, scanLocalSkills } from './skills.js';

export { claimStep, meetsMcpVersionGate } from './machine-claim.js';
export {
  agentForStep,
  isChiefConversation,
  type MachineDeps,
  ownedStep,
  publishStepStatus,
  upsertChiefRow,
  upsertMessage,
} from './machine-deps.js';
export { finishStep } from './machine-finish-step.js';
export { MERGE_NOT_LANDED_NOTE } from './machine-merge-landing.js';
export { stepToken, toProviderConfig } from './machine-step-token.js';

export function fetchSteer(
  deps: { db: Db; convHub?: ConversationStreamHub },
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
  if (isChiefConversation(stepRow.buildId)) consumeChiefSteer(deps, stepRow.buildId);
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

export function heartbeatStep(deps: MachineDeps, machineId: string, stepId: string): void {
  if (!deps.db.select({ id: step.id }).from(step).where(eq(step.id, stepId)).get()) {
    throw new HttpError(410, `step ${stepId} no longer exists`);
  }
  const row = ownedStep(deps, machineId, stepId);
  deps.db.update(step).set({ lastHeartbeatAt: nowMs() }).where(eq(step.id, row.id)).run();
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
  const stepRow = ownedStep(deps, machineId, stepId);
  if (tokenTeamId !== machineTeamId) throw new NotFoundError(`attachment ${attachmentId}`);
  const buildRow = deps.db
    .select({ todoId: build.todoId })
    .from(build)
    .where(eq(build.id, stepRow.buildId))
    .get();
  if (buildRow === undefined || !todoAuthorizesAttachment(deps.db, buildRow.todoId, attachmentId)) {
    throw new NotFoundError(`attachment ${attachmentId}`);
  }
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
