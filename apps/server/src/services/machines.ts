import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import type {
  AgentTodoReport,
  BackgroundTask,
  ClaudeCodeReport,
  MachineAttachmentResponse,
  MachineCapabilities,
  MachinePresenceBody,
  MachineSkillsManifestResponse,
  MachineSteerAckBody,
  MachineSteerResponse,
  StepActivityReport,
  StepRecord,
  ToolCallRecord,
  TranscriptRow,
} from '@cairn/shared';
import {
  backgroundTaskMessageId,
  claudeLoginSchema,
  confinementEnforced,
  isActiveStepStatus,
  machineRecordSchema,
  machineStrain,
  PROGRESS_ACTIVITY_PHASES,
  parseReportedCapabilities,
  transcriptPromptRowId,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  apiKey,
  build,
  computer,
  computerCall,
  machine,
  phone,
  routingRule,
  steerPending,
  step,
  stopPending,
  team,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { newMachineToken } from '../lib/keys.js';
import { markDelivered, receivesAnswers, undeliveredAnswers } from './answer-delivery.js';
import { todoAuthorizesAttachment } from './attachment-authorization.js';
import { readAttachmentMeta } from './attachments.js';
import { NotFoundError } from './builds.js';
import { ackChiefSteer, chiefSteerSentBatch, takeChiefSteer } from './chief-turns.js';
import { availableRuntimes } from './dispatch-eligibility.js';
import type { ConversationStreamHub } from './events.js';
import { applyComputerPresence } from './machine-computer-presence.js';
import {
  isChiefConversation,
  type MachineDeps,
  ownedStep,
  ownedStepRow,
  profileForStep,
  upsertChiefRow,
  upsertMessage,
} from './machine-deps.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { stepScopeProjectId } from './picked-project.js';
import type { LocalSkill } from './skills.js';
import { listSkillFiles, readSkillFileBytes, scanLocalSkills } from './skills.js';
import { flushShield, shieldFor, stepClaimFacts } from './terminal-claims.js';

export { claimStep, meetsMcpVersionGate } from './machine-claim.js';
export {
  isChiefConversation,
  type MachineDeps,
  ownedStep,
  ownedStepRow,
  profileForStep,
  publishStepStatus,
  upsertChiefRow,
  upsertMessage,
} from './machine-deps.js';
export { finishStep } from './machine-finish-step.js';
export { MERGE_NOT_LANDED_NOTE } from './machine-merge-landing.js';
export { stepToken, toProviderConfig } from './machine-step-token.js';

export const STEER_SENT_STALE_MS = 30_000;

export function fetchSteer(
  deps: { db: Db },
  machine: { id: string | null },
  stepId: string,
  options: { batches?: boolean } = {},
): MachineSteerResponse {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow || stepRow.machineId !== machine.id || stepRow.status !== 'claimed') {
    return { content: null };
  }
  const answers =
    !isChiefConversation(stepRow.buildId) && receivesAnswers(stepRow.kind)
      ? undeliveredAnswers(db, stepRow.buildId)
      : [];
  const withAnswers = (content: string | null): MachineSteerResponse =>
    answers.length > 0 ? { content, answers } : { content };
  const pending = db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, stepRow.buildId))
    .get();
  if (!pending) return withAnswers(null);
  const now = nowMs();
  if (pending.stepId !== stepId) {
    const target = db
      .select({ status: step.status })
      .from(step)
      .where(eq(step.id, pending.stepId))
      .get();
    if (target === undefined || !isActiveStepStatus(target.status)) {
      db.delete(steerPending).where(eq(steerPending.conversationId, stepRow.buildId)).run();
    }
    return withAnswers(null);
  }
  const markSent = () => {
    db.update(steerPending)
      .set({ sentAt: now })
      .where(eq(steerPending.conversationId, stepRow.buildId))
      .run();
  };
  if (isChiefConversation(stepRow.buildId)) {
    if (pending.sentAt !== null && now - pending.sentAt < STEER_SENT_STALE_MS) {
      return { content: null };
    }
    if (pending.sentAt !== null) {
      const sent = chiefSteerSentBatch(db, stepRow.buildId, stepRow);
      if (sent.ids.length === 0) {
        db.delete(steerPending).where(eq(steerPending.conversationId, stepRow.buildId)).run();
        return { content: null };
      }
      markSent();
      return { content: sent.content, messageIds: sent.ids, steerSentAt: now };
    }
    const batch = takeChiefSteer(db, stepRow.buildId, options);
    if (batch === null) return { content: null };
    markSent();
    return { content: pending.content, messageIds: batch, steerSentAt: now };
  }
  if (pending.sentAt !== null && now - pending.sentAt < STEER_SENT_STALE_MS) {
    return withAnswers(null);
  }
  markSent();
  return { ...withAnswers(pending.content), steerSentAt: now };
}

export function ackSteer(
  deps: { db: Db; convHub?: ConversationStreamHub; machineHub?: MachineWakeHub },
  machine: { id: string | null; teamId: string },
  stepId: string,
  body: MachineSteerAckBody = {},
): { ok: true } {
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (stepRow === undefined || stepRow.machineId !== machine.id) return { ok: true };
  const servedFence =
    body.steerSentAt !== undefined
      ? eq(steerPending.sentAt, body.steerSentAt)
      : body.answerIds === undefined && body.messageIds === undefined
        ? isNotNull(steerPending.sentAt)
        : undefined;
  if (servedFence !== undefined) {
    deps.db
      .delete(steerPending)
      .where(
        and(
          eq(steerPending.conversationId, stepRow.buildId),
          eq(steerPending.stepId, stepId),
          servedFence,
        ),
      )
      .run();
  }
  if (isChiefConversation(stepRow.buildId)) {
    if (stepRow.status === 'claimed') ackChiefSteer(deps, machine.teamId, stepRow, body.messageIds);
  } else if (body.answerIds !== undefined && body.answerIds.length > 0) {
    markDelivered(deps, stepRow.buildId, body.answerIds, body.via ?? 'steer', stepId);
  }
  return { ok: true };
}

export function fetchStop(
  deps: { db: Db },
  machine: { id: string | null },
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
  if (pending) {
    const target = db
      .select({ status: step.status })
      .from(step)
      .where(eq(step.id, pending.stepId))
      .get();
    if (target === undefined || !isActiveStepStatus(target.status)) {
      db.delete(stopPending).where(eq(stopPending.conversationId, pending.conversationId)).run();
    }
  }
  if (stepRow.archiveStop === 'requested') {
    db.update(step).set({ archiveStop: 'acknowledged' }).where(eq(step.id, stepId)).run();
    return { discard: false };
  }
  return { discard: pending?.stepId === stepId ? pending.discard : null };
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
  const login = claudeLoginSchema.safeParse(row.claudeCodeReport?.login);
  const reportedHostname =
    row.claudeCodeReport?.hostname ?? (row.kind === 'local' ? hostname() : undefined);
  return machineRecordSchema.parse({
    id: row.id,
    name: row.name,
    ...(reportedHostname !== undefined ? { hostname: reportedHostname } : {}),
    teamId: row.teamId,
    online: row.online,
    lastSeenAt: row.lastSeenAt,
    latestCliVersion: row.latestCliVersion,
    kind: row.kind,
    enabledRuntimes: availableRuntimes(row),
    ...(runningSteps !== undefined ? { runningSteps } : {}),
    capabilities: row.capabilities,
    ...(login.success ? { claudeLogin: login.data } : {}),
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
  if (reported.osPlatform === undefined && previous?.osPlatform !== undefined) {
    reported = { ...reported, osPlatform: previous.osPlatform };
  }
  const previousReport = previous?.confinement;
  const report = reported.confinement;
  if (
    confinementEnforced(reported.osPlatform) &&
    report &&
    (report.generation === (previousReport?.generation ?? 0) + 1
      ? report.state !== 'checking'
      : !previousReport ||
        report.generation !== previousReport.generation ||
        report.invocation !== previousReport.invocation ||
        report.revision <= previousReport.revision)
  ) {
    throw new HttpError(409, 'Stale confinement report');
  }
  if (!report && previousReport)
    reported = {
      ...reported,
      confinement: {
        invocation: previousReport.invocation,
        generation: previousReport.generation,
        revision: previousReport.revision,
        state: 'checking',
      },
    };
  if (reported.hardware === undefined && previous?.hardware !== undefined) {
    return { ...reported, hardware: previous.hardware };
  }
  return reported;
}

function localMachineRow(db: Db, teamId: string, name: string) {
  if (name !== hostname()) return undefined;
  const byKind = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.kind, 'local')))
    .get();
  if (byKind !== undefined) return byKind;
  return db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.name, name)))
    .get();
}

function presentedHostKeys(
  hostKey: string | null | undefined,
  legacyHostKeys: readonly string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of [hostKey, ...(legacyHostKeys ?? [])]) {
    if (key == null || key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function machinesByHostKeys(db: Db, teamId: string, keys: readonly string[]) {
  if (keys.length === 0) return [];
  return db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), inArray(machine.hostKey, [...keys])))
    .all();
}

function pickPrimaryHostMatch(
  matches: readonly (typeof machine.$inferSelect)[],
  hostKey: string | null,
  legacyHostKeys: readonly string[],
): typeof machine.$inferSelect | undefined {
  if (matches.length === 0) return undefined;
  const local = matches.find((row) => row.kind === 'local');
  if (local !== undefined) return local;
  if (hostKey !== null) {
    const exact = matches.find((row) => row.hostKey === hostKey);
    if (exact !== undefined) return exact;
  }
  for (const key of legacyHostKeys) {
    const legacy = matches.find((row) => row.hostKey === key);
    if (legacy !== undefined) return legacy;
  }
  return matches[0];
}

function hostKeyHeldByOther(db: Db, teamId: string, hostKey: string, machineId: string): boolean {
  return (
    db
      .select({ id: machine.id })
      .from(machine)
      .where(
        and(eq(machine.teamId, teamId), eq(machine.hostKey, hostKey), ne(machine.id, machineId)),
      )
      .get() !== undefined
  );
}

export function seedLocalMachine(
  db: Db,
  teamId: string,
): 'existing' | 'adopted' | 'created' | 'blocked' {
  const local = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.kind, 'local')))
    .get();
  if (local) return 'existing';
  const byName = localMachineRow(db, teamId, hostname());
  if (byName !== undefined) {
    if (byName.tokenHash !== null || byName.apiKeyId !== null) return 'blocked';
    db.update(machine).set({ kind: 'local' }).where(eq(machine.id, byName.id)).run();
    return 'adopted';
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
    })
    .run();
  return 'created';
}

function adoptAsDefaultIfUnset(db: Db, teamId: string, machineId: string): void {
  const otherEnrolled = db
    .select({ id: machine.id })
    .from(machine)
    .where(and(eq(machine.teamId, teamId), ne(machine.id, machineId), isNotNull(machine.tokenHash)))
    .get();
  if (otherEnrolled !== undefined) return;
  db.update(team)
    .set({ defaultMachineId: machineId })
    .where(and(eq(team.id, teamId), isNull(team.defaultMachineId)))
    .run();
}

export function beginMachineStarting(
  deps: Pick<MachineDeps, 'hub' | 'machineHub'>,
  machine: { id: string; teamId: string; online: boolean },
): void {
  deps.machineHub.beginStarting(machine.id, nowMs());
  if (machine.online) return;
  deps.hub.publish(machine.teamId, () => ({
    type: 'machine_presence',
    machineId: machine.id,
    online: false,
  }));
}

function upgradedHostKeyOf(
  db: Db,
  teamId: string,
  machineId: string,
  currentHostKey: string | null,
  nextHostKey: string | null,
  legacyHostKeys: readonly string[],
): string | undefined {
  if (
    nextHostKey !== null &&
    currentHostKey !== nextHostKey &&
    (currentHostKey === null || legacyHostKeys.includes(currentHostKey)) &&
    !hostKeyHeldByOther(db, teamId, nextHostKey, machineId)
  ) {
    return nextHostKey;
  }
  return undefined;
}

function notifyRetiredMachines(
  deps: Pick<MachineDeps, 'hub' | 'machineHub'>,
  teamId: string,
  retiredIds: readonly string[],
): void {
  for (const id of retiredIds) {
    deps.machineHub.revokeMachine(id);
    deps.hub.publish(teamId, () => ({
      type: 'machine_presence',
      machineId: id,
      online: false,
    }));
  }
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
    hostKey?: string;
    legacyHostKeys?: readonly string[];
  },
): { machineId: string; token: string; teamId: string; serverUrl: string } {
  const { db } = deps;
  if (input.name === hostname()) {
    throw new HttpError(403, 'local machine requires owner approval');
  }
  const token = newMachineToken();
  const capabilities = parseCapabilitiesField(input.capabilities);
  const hostKey = input.hostKey ?? null;
  const legacyHostKeys = input.legacyHostKeys ?? [];
  const keys = presentedHostKeys(hostKey, legacyHostKeys);
  const byHost = pickPrimaryHostMatch(
    machinesByHostKeys(db, input.teamId, keys),
    hostKey,
    legacyHostKeys,
  );
  const byKey =
    byHost === undefined
      ? db
          .select()
          .from(machine)
          .where(and(eq(machine.apiKeyId, input.keyId), eq(machine.teamId, input.teamId)))
          .get()
      : undefined;
  const existing = byHost ?? byKey;
  if (existing !== undefined && existing.kind === 'local') {
    throw new HttpError(403, 'local machine requires owner approval');
  }
  if (byHost !== undefined && byHost.apiKeyId !== input.keyId) {
    throw new HttpError(403, 'another enrollment owns this host key');
  }
  if (existing !== undefined && existing.retiredAt !== null) {
    throw new HttpError(403, 'a revoked machine re-registers through the authorize page');
  }
  if (existing !== undefined) {
    const retiredIds = db.transaction(() => {
      const upgradedHostKey = upgradedHostKeyOf(
        db,
        input.teamId,
        existing.id,
        existing.hostKey,
        hostKey,
        legacyHostKeys,
      );
      db.update(machine)
        .set({
          tokenHash: token.hash,
          name: input.name,
          apiKeyId: input.keyId,
          retiredAt: null,
          ...(upgradedHostKey !== undefined ? { hostKey: upgradedHostKey } : {}),
          ...(input.cliVersion !== undefined ? { latestCliVersion: input.cliVersion } : {}),
          ...(input.claudeCode !== undefined ? { claudeCodeReport: input.claudeCode } : {}),
          ...(capabilities !== undefined || existing.capabilities?.confinement
            ? {
                capabilities: mergeReportedCapabilities(
                  existing.capabilities,
                  capabilities ?? {
                    ...(existing.capabilities ?? { mcpServers: [], skills: [] }),
                    confinement: undefined,
                  },
                ),
              }
            : {}),
        })
        .where(eq(machine.id, existing.id))
        .run();
      const updated = db.select().from(machine).where(eq(machine.id, existing.id)).get();
      if (updated === undefined) return [];
      const retired = retireVerifiedDuplicatesInTx(deps, updated, { hostKeys: keys });
      const postRetireHostKey = upgradedHostKeyOf(
        db,
        input.teamId,
        existing.id,
        updated.hostKey,
        hostKey,
        legacyHostKeys,
      );
      if (postRetireHostKey !== undefined) {
        db.update(machine)
          .set({ hostKey: postRetireHostKey })
          .where(eq(machine.id, existing.id))
          .run();
      }
      return retired;
    });
    notifyRetiredMachines(deps, input.teamId, retiredIds);
    if (deps.machineHub.isConnected(existing.id)) deps.machineHub.revokeMachine(existing.id);
    beginMachineStarting(deps, existing);
    adoptAsDefaultIfUnset(db, input.teamId, existing.id);
    return {
      machineId: existing.id,
      token: token.plain,
      teamId: input.teamId,
      serverUrl: input.serverUrl,
    };
  }
  const machineId = newRecordId();
  const retiredIds = db.transaction(() => {
    db.insert(machine)
      .values({
        id: machineId,
        teamId: input.teamId,
        name: input.name,
        online: false,
        tokenHash: token.hash,
        apiKeyId: input.keyId,
        latestCliVersion: input.cliVersion ?? null,
        kind: 'remote',
        ...(hostKey !== null ? { hostKey } : {}),
        ...(input.claudeCode !== undefined ? { claudeCodeReport: input.claudeCode } : {}),
        ...(capabilities !== undefined
          ? { capabilities: mergeReportedCapabilities(null, capabilities) }
          : {}),
      })
      .run();
    const inserted = db.select().from(machine).where(eq(machine.id, machineId)).get();
    return inserted !== undefined && keys.length > 0
      ? retireVerifiedDuplicatesInTx(deps, inserted, { hostKeys: keys })
      : [];
  });
  notifyRetiredMachines(deps, input.teamId, retiredIds);
  beginMachineStarting(deps, { id: machineId, teamId: input.teamId, online: false });
  adoptAsDefaultIfUnset(db, input.teamId, machineId);
  return { machineId, token: token.plain, teamId: input.teamId, serverUrl: input.serverUrl };
}

function enrollmentExistingRow(
  db: Db,
  teamId: string,
  name: string | undefined,
  hostKey: string | null,
  legacyHostKeys: readonly string[] = [],
) {
  const keys = presentedHostKeys(hostKey, legacyHostKeys);
  const byHost = pickPrimaryHostMatch(
    machinesByHostKeys(db, teamId, keys),
    hostKey,
    legacyHostKeys,
  );
  if (byHost !== undefined) return byHost;
  return name === undefined ? undefined : localMachineRow(db, teamId, name);
}

/** Whether an enrollment may claim the server host's own runner identity. A
 * machine name is self-reported and is not a credential: claiming the local
 * runner (by name or by hostKey) needs proof that the enrollment was started on
 * the host itself, and once the row knows a hostKey the enrollment must present
 * that same one. */
export function localEnrollmentRefusal(
  db: Db,
  input: {
    teamId: string;
    name?: string;
    hostKey?: string;
    legacyHostKeys?: readonly string[];
    fromLocalHost: boolean;
  },
): string | null {
  const namesThisHost = input.name === hostname();
  const hostKey = input.hostKey ?? null;
  const legacyHostKeys = input.legacyHostKeys ?? [];
  const keys = presentedHostKeys(hostKey, legacyHostKeys);
  const keySet = new Set(keys);
  const byHost = pickPrimaryHostMatch(
    machinesByHostKeys(db, input.teamId, keys),
    hostKey,
    legacyHostKeys,
  );
  const row =
    byHost ??
    (input.name === undefined ? undefined : localMachineRow(db, input.teamId, input.name));
  if (row?.kind !== 'local' && !namesThisHost) return null;
  if (row !== undefined && row.kind !== 'local') {
    if (byHost === undefined) {
      return 'another enrolled machine already holds this host name';
    }
    if (!input.fromLocalHost) {
      return 'this enrollment does not prove it is the local host runner';
    }
    const localRow = db
      .select()
      .from(machine)
      .where(and(eq(machine.teamId, input.teamId), eq(machine.kind, 'local')))
      .get();
    if (
      localRow !== undefined &&
      (localRow.tokenHash !== null ||
        localRow.retiredAt !== null ||
        (localRow.hostKey !== null && !keySet.has(localRow.hostKey)))
    ) {
      return 'this enrollment does not prove it is the local host runner';
    }
    return null;
  }
  if (
    !input.fromLocalHost ||
    (row !== undefined && row.hostKey !== null && !keySet.has(row.hostKey))
  ) {
    return 'this enrollment does not prove it is the local host runner';
  }
  return null;
}

export function authorizeEnrollmentMachine(
  deps: MachineDeps,
  input: {
    teamId: string;
    name: string;
    serverUrl: string;
    ownerApproved: boolean;
    fromLocalHost: boolean;
    hostKey?: string;
    legacyHostKeys?: readonly string[];
    retireToken?: string;
  },
): { machineId: string; token: string; teamId: string; serverUrl: string } {
  const { db } = deps;
  const token = newMachineToken();
  const isLocal = input.name === hostname();
  const hostKey = input.hostKey ?? null;
  const legacyHostKeys = input.legacyHostKeys ?? [];
  const keys = presentedHostKeys(hostKey, legacyHostKeys);
  const existing = enrollmentExistingRow(db, input.teamId, input.name, hostKey, legacyHostKeys);
  const claimsLocal = existing?.kind === 'local' || isLocal;
  if (claimsLocal && !input.ownerApproved) {
    throw new HttpError(403, 'local machine requires owner approval');
  }
  if (existing !== undefined && existing.retiredAt !== null && !input.ownerApproved) {
    throw new HttpError(403, 'a revoked machine requires owner approval to re-register');
  }
  if (existing !== undefined && existing.apiKeyId !== null && !input.ownerApproved) {
    throw new HttpError(403, 'only the owner can adopt an api-key machine');
  }
  const refusal = localEnrollmentRefusal(db, {
    teamId: input.teamId,
    name: input.name,
    hostKey: input.hostKey,
    legacyHostKeys,
    fromLocalHost: input.fromLocalHost,
  });
  if (refusal !== null) {
    throw new HttpError(403, refusal);
  }
  const retireToken = input.ownerApproved ? input.retireToken : undefined;
  if (existing) {
    const promotesToLocal = existing.kind !== 'local' && isLocal;
    const retiredIds = db.transaction(() => {
      const upgradedHostKey = upgradedHostKeyOf(
        db,
        input.teamId,
        existing.id,
        existing.hostKey,
        hostKey,
        legacyHostKeys,
      );
      db.update(machine)
        .set({
          tokenHash: token.hash,
          name: existing.kind === 'local' || isLocal ? hostname() : input.name,
          apiKeyId: null,
          retiredAt: null,
          ...(existing.kind === 'local' || isLocal ? { kind: 'local' as const } : {}),
          ...(upgradedHostKey !== undefined ? { hostKey: upgradedHostKey } : {}),
          capabilities:
            existing.capabilities === null
              ? null
              : mergeReportedCapabilities(existing.capabilities, {
                  ...existing.capabilities,
                  confinement: undefined,
                }),
        })
        .where(eq(machine.id, existing.id))
        .run();
      const retired: string[] = [];
      if (promotesToLocal) {
        const unclaimedLocal = db
          .select()
          .from(machine)
          .where(
            and(
              eq(machine.teamId, input.teamId),
              eq(machine.kind, 'local'),
              ne(machine.id, existing.id),
              isNull(machine.tokenHash),
              isNull(machine.hostKey),
              isNull(machine.retiredAt),
            ),
          )
          .get();
        if (unclaimedLocal !== undefined) {
          mergeMachineRowInTx(db, existing, unclaimedLocal);
          retired.push(unclaimedLocal.id);
        }
      }
      const updated = db.select().from(machine).where(eq(machine.id, existing.id)).get();
      if (updated !== undefined && input.ownerApproved) {
        retired.push(
          ...retireVerifiedDuplicatesInTx(deps, updated, {
            hostKeys: keys,
            allowCrossApiKey: true,
            ...(retireToken !== undefined ? { retireToken } : {}),
          }),
        );
        const postRetireHostKey = upgradedHostKeyOf(
          db,
          input.teamId,
          existing.id,
          updated.hostKey,
          hostKey,
          legacyHostKeys,
        );
        if (postRetireHostKey !== undefined) {
          db.update(machine)
            .set({ hostKey: postRetireHostKey })
            .where(eq(machine.id, existing.id))
            .run();
        }
      }
      return retired;
    });
    notifyRetiredMachines(deps, input.teamId, retiredIds);
    if (deps.machineHub.isConnected(existing.id)) deps.machineHub.revokeMachine(existing.id);
    beginMachineStarting(deps, existing);
    adoptAsDefaultIfUnset(db, input.teamId, existing.id);
    return {
      machineId: existing.id,
      token: token.plain,
      teamId: input.teamId,
      serverUrl: input.serverUrl,
    };
  }
  const machineId = newRecordId();
  const retiredIds = db.transaction(() => {
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
        ...(hostKey !== null ? { hostKey } : {}),
      })
      .run();
    const inserted = db.select().from(machine).where(eq(machine.id, machineId)).get();
    if (inserted === undefined || !input.ownerApproved) return [];
    if (keys.length === 0 && retireToken === undefined) return [];
    return retireVerifiedDuplicatesInTx(deps, inserted, {
      hostKeys: keys,
      allowCrossApiKey: true,
      ...(retireToken !== undefined ? { retireToken } : {}),
    });
  });
  notifyRetiredMachines(deps, input.teamId, retiredIds);
  beginMachineStarting(deps, { id: machineId, teamId: input.teamId, online: false });
  adoptAsDefaultIfUnset(db, input.teamId, machineId);
  return { machineId, token: token.plain, teamId: input.teamId, serverUrl: input.serverUrl };
}

export function markPresence(
  deps: MachineDeps,
  machineId: string,
  body: MachinePresenceBody,
  admitOnline = true,
): void {
  const { db, hub } = deps;
  const row = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!row) throw new NotFoundError(`machine ${machineId}`);
  const becameOnline = admitOnline && !row.online;
  const previousLogin = row.claudeCodeReport?.login;
  const reportedLogin = body.claudeCode?.login;
  const loginChanged =
    body.claudeCode !== undefined &&
    (previousLogin?.state !== reportedLogin?.state ||
      previousLogin?.expiresAt !== reportedLogin?.expiresAt);
  const capabilities =
    parseCapabilitiesField(body.capabilities) ??
    (row.capabilities?.confinement ? { ...row.capabilities, confinement: undefined } : undefined);
  const merged =
    capabilities !== undefined
      ? mergeReportedCapabilities(row.capabilities, capabilities)
      : undefined;
  const reportedHostKey = body.hostKey ?? null;
  const legacyHostKeys = body.legacyHostKeys ?? [];
  const { retiredIds, computerChanged } = db.transaction(() => {
    const canRetireOnPresence =
      row.hostKey !== null &&
      legacyHostKeys.length > 0 &&
      (row.kind === 'local' || row.apiKeyId !== null) &&
      (row.hostKey === reportedHostKey || legacyHostKeys.includes(row.hostKey));
    const retired = canRetireOnPresence
      ? retireVerifiedDuplicatesInTx(deps, row, {
          hostKeys: legacyHostKeys,
          allowCrossApiKey: row.kind === 'local',
        })
      : [];
    const backfilledHostKey =
      reportedHostKey !== null &&
      row.hostKey === null &&
      !hostKeyHeldByOther(db, row.teamId, reportedHostKey, machineId)
        ? reportedHostKey
        : undefined;
    db.update(machine)
      .set({
        ...(admitOnline ? { online: true } : {}),
        ...(backfilledHostKey !== undefined ? { hostKey: backfilledHostKey } : {}),
        lastSeenAt: nowMs(),
        ...(body.cliVersion !== undefined ? { latestCliVersion: body.cliVersion } : {}),
        ...(body.claudeCode !== undefined ? { claudeCodeReport: body.claudeCode } : {}),
        ...(merged !== undefined ? { capabilities: merged } : {}),
      })
      .where(eq(machine.id, machineId))
      .run();
    return {
      retiredIds: retired,
      computerChanged: applyComputerPresence(db, machineId, row.teamId, body.computers, nowMs()),
    };
  });
  notifyRetiredMachines(deps, row.teamId, retiredIds);
  const runtimeFingerprint = (
    claude: ClaudeCodeReport | null | undefined,
    caps: MachineCapabilities | null | undefined,
  ) =>
    JSON.stringify([
      claude?.bin?.version ?? null,
      claude?.update ?? null,
      caps?.devin?.version ?? null,
      caps?.devin?.update ?? null,
      caps?.gemini ?? null,
    ]);
  const runtimeUpdateChanged =
    runtimeFingerprint(row.claudeCodeReport, row.capabilities) !==
    runtimeFingerprint(
      body.claudeCode !== undefined ? body.claudeCode : row.claudeCodeReport,
      merged !== undefined ? merged : row.capabilities,
    );
  const strainChanged =
    merged !== undefined &&
    machineStrain(row.capabilities?.hardware).join() !== machineStrain(merged.hardware).join();
  const antigravityChanged =
    merged !== undefined &&
    JSON.stringify(merged.antigravity) !== JSON.stringify(row.capabilities?.antigravity);
  if (
    becameOnline ||
    loginChanged ||
    computerChanged ||
    strainChanged ||
    antigravityChanged ||
    runtimeUpdateChanged
  ) {
    const online = admitOnline || row.online;
    hub.publish(row.teamId, () => ({ type: 'machine_presence', machineId, online }));
  }
}

function mergeMachineRowInTx(
  db: Db,
  target: Pick<typeof machine.$inferSelect, 'id' | 'teamId'>,
  dup: Pick<typeof machine.$inferSelect, 'id' | 'teamId'>,
): void {
  if (target.teamId !== dup.teamId) {
    throw new Error('cannot merge machines across teams');
  }
  db.update(routingRule)
    .set({ machineId: target.id, updatedAt: nowMs() })
    .where(eq(routingRule.machineId, dup.id))
    .run();
  db.update(team)
    .set({ defaultMachineId: target.id })
    .where(eq(team.defaultMachineId, dup.id))
    .run();
  for (const entry of db
    .select({ id: todo.id, v: todo.v, routeOverride: todo.routeOverride })
    .from(todo)
    .where(and(eq(todo.teamId, dup.teamId), isNotNull(todo.routeOverride)))
    .all()) {
    if (entry.routeOverride?.machineId !== dup.id) continue;
    db.update(todo)
      .set({ routeOverride: { ...entry.routeOverride, machineId: target.id }, v: entry.v + 1 })
      .where(eq(todo.id, entry.id))
      .run();
  }
  db.update(step)
    .set({ machineId: target.id })
    .where(and(eq(step.machineId, dup.id), ne(step.status, 'claimed')))
    .run();
  for (const entry of db
    .select({ id: phone.id, deviceId: phone.deviceId })
    .from(phone)
    .where(eq(phone.machineId, dup.id))
    .all()) {
    const clash = db
      .select({ id: phone.id })
      .from(phone)
      .where(and(eq(phone.machineId, target.id), eq(phone.deviceId, entry.deviceId)))
      .get();
    if (clash === undefined) {
      db.update(phone).set({ machineId: target.id }).where(eq(phone.id, entry.id)).run();
    } else {
      db.update(computerCall)
        .set({ phoneId: clash.id })
        .where(eq(computerCall.phoneId, entry.id))
        .run();
      db.delete(phone).where(eq(phone.id, entry.id)).run();
    }
  }
  db.update(computer).set({ machineId: target.id }).where(eq(computer.machineId, dup.id)).run();
  db.update(computerCall)
    .set({ machineId: target.id })
    .where(eq(computerCall.machineId, dup.id))
    .run();
  db.delete(machine).where(eq(machine.id, dup.id)).run();
}

function hasActiveMachineWork(db: Db, machineId: string): boolean {
  const claimedStep = db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
    .get();
  if (claimedStep !== undefined) return true;
  const activeCall = db
    .select({ id: computerCall.id })
    .from(computerCall)
    .where(
      and(
        eq(computerCall.machineId, machineId),
        inArray(computerCall.state, ['dispatched', 'running']),
      ),
    )
    .get();
  return activeCall !== undefined;
}

function retireVerifiedDuplicatesInTx(
  deps: Pick<MachineDeps, 'db' | 'machineHub'>,
  target: typeof machine.$inferSelect,
  proof: {
    hostKeys?: readonly string[];
    retireToken?: string;
    allowCrossApiKey?: boolean;
  },
): string[] {
  const keys = (proof.hostKeys ?? []).filter((key) => key !== '');
  const tokenHash = proof.retireToken !== undefined ? hashCredential(proof.retireToken) : null;
  if (keys.length === 0 && tokenHash === null) return [];
  const credentialMatch =
    keys.length > 0 && tokenHash !== null
      ? or(inArray(machine.hostKey, keys), eq(machine.tokenHash, tokenHash))
      : keys.length > 0
        ? inArray(machine.hostKey, keys)
        : eq(machine.tokenHash, tokenHash as string);
  const candidates = deps.db
    .select()
    .from(machine)
    .where(
      and(
        eq(machine.teamId, target.teamId),
        eq(machine.online, false),
        isNull(machine.retiredAt),
        ne(machine.id, target.id),
        ne(machine.kind, 'local'),
        credentialMatch,
      ),
    )
    .all();
  const keySet = new Set(keys);
  const retiredIds: string[] = [];
  for (const dup of candidates) {
    if (deps.machineHub.isConnected(dup.id) || hasActiveMachineWork(deps.db, dup.id)) continue;
    const provedByHostKey = dup.hostKey !== null && keySet.has(dup.hostKey);
    const provedByToken = tokenHash !== null && dup.tokenHash === tokenHash;
    if (!provedByHostKey && !provedByToken) continue;
    if (proof.allowCrossApiKey !== true && dup.apiKeyId !== target.apiKeyId) continue;
    mergeMachineRowInTx(deps.db, target, dup);
    retiredIds.push(dup.id);
  }
  return retiredIds;
}

export function markConnected(deps: Pick<MachineDeps, 'db' | 'hub'>, machineId: string): void {
  const { db, hub } = deps;
  const row = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!row) return;
  db.update(machine)
    .set({ online: true, lastSeenAt: nowMs() })
    .where(eq(machine.id, machineId))
    .run();
  if (!row.online) {
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
  deps: Pick<MachineDeps, 'db' | 'hub'> & { machineHub?: MachineWakeHub | undefined },
  now: number = nowMs(),
): void {
  const { db } = deps;
  for (const machineId of deps.machineHub?.expireStarting(now) ?? []) {
    if (deps.machineHub?.isConnected(machineId)) continue;
    const row = db
      .select({ teamId: machine.teamId, online: machine.online })
      .from(machine)
      .where(eq(machine.id, machineId))
      .get();
    if (row === undefined) continue;
    if (row.online) {
      markOffline(deps, machineId);
      continue;
    }
    deps.hub.publish(row.teamId, () => ({ type: 'machine_presence', machineId, online: false }));
  }
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
    deps.machineHub?.cancelGrace(row.id);
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
    generation: r.claimedAt ?? undefined,
  };
}

export function heartbeatStep(deps: MachineDeps, machineId: string | null, stepId: string): void {
  if (!deps.db.select({ id: step.id }).from(step).where(eq(step.id, stepId)).get()) {
    throw new HttpError(410, `step ${stepId} no longer exists`);
  }
  const row = ownedStep(deps, machineId, stepId);
  deps.db.update(step).set({ lastHeartbeatAt: nowMs() }).where(eq(step.id, row.id)).run();
}

const PROGRESS_WRITE_INTERVAL_MS = 30_000;

function markProgress(
  deps: Pick<MachineDeps, 'db'>,
  row: Pick<typeof step.$inferSelect, 'id' | 'status' | 'lastProgressAt'>,
): void {
  const now = nowMs();
  if (row.status !== 'claimed') return;
  if (row.lastProgressAt !== null && now - row.lastProgressAt < PROGRESS_WRITE_INTERVAL_MS) return;
  deps.db.update(step).set({ lastProgressAt: now }).where(eq(step.id, row.id)).run();
}

export function reportTool(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  call: ToolCallRecord,
): void {
  const row = ownedStep(deps, machineId, stepId);
  markProgress(deps, row);
  const messageRow = {
    id: call.id,
    role: 'assistant' as const,
    content: { kind: 'toolcall', call },
    createdAt: call.endedAt ?? nowMs(),
  };
  if (isChiefConversation(row.buildId)) {
    const rest = flushShield(deps.db, stepId);
    if (rest !== '') deps.convHub?.publishTextDelta(row.buildId, rest);
    upsertChiefRow(deps, {
      ...messageRow,
      threadId: row.buildId,
      projectId: stepScopeProjectId(row),
    });
    return;
  }
  upsertMessage(deps, { ...messageRow, conversationId: row.buildId });
}

export function reportBackgroundTask(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  task: BackgroundTask,
): void {
  const row = ownedStepRow(deps, machineId, stepId);
  markProgress(deps, row);
  const messageRow = {
    id: backgroundTaskMessageId(row.id, task.taskId),
    role: 'assistant' as const,
    content: {
      kind: 'bg_task',
      task:
        row.status !== 'claimed' && task.status === 'running'
          ? { ...task, status: 'orphaned', endedAt: nowMs() }
          : task,
    },
    createdAt: task.startedAt,
  };
  if (isChiefConversation(row.buildId)) {
    const rest = flushShield(deps.db, stepId);
    if (rest !== '') deps.convHub?.publishTextDelta(row.buildId, rest);
    upsertChiefRow(deps, {
      ...messageRow,
      threadId: row.buildId,
      projectId: stepScopeProjectId(row),
    });
    return;
  }
  upsertMessage(deps, { ...messageRow, conversationId: row.buildId });
}

export function reportTranscriptDelta(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  text: string,
): void {
  const row = ownedStep(deps, machineId, stepId);
  if (text === '') return;
  markProgress(deps, row);
  if (!isChiefConversation(row.buildId)) {
    deps.convHub?.publishTextDelta(row.buildId, text);
    return;
  }
  const shielded = shieldFor(deps.db, stepId, () => stepClaimFacts(deps.db, row)).push(text);
  if (shielded !== '') deps.convHub?.publishTextDelta(row.buildId, shielded);
}

export function reportThinkingDelta(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  text: string,
): void {
  const row = ownedStep(deps, machineId, stepId);
  if (text === '') return;
  markProgress(deps, row);
  deps.convHub?.publishThinkingDelta(row.buildId, text);
}

export function storeTranscriptRow(
  deps: MachineDeps,
  owned: ReturnType<typeof ownedStepRow>,
  stepId: string,
  row: TranscriptRow,
): void {
  markProgress(deps, owned);
  const origin =
    row.role === 'user' && row.id === transcriptPromptRowId(stepId) ? 'task-prompt' : null;
  if (isChiefConversation(owned.buildId)) {
    const rest = flushShield(deps.db, stepId);
    if (rest !== '') deps.convHub?.publishTextDelta(owned.buildId, rest);
    upsertChiefRow(deps, {
      id: row.id,
      threadId: owned.buildId,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
      projectId: stepScopeProjectId(owned),
      origin,
    });
    return;
  }
  upsertMessage(deps, {
    id: row.id,
    conversationId: owned.buildId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    origin,
  });
}

export function reportTranscriptRow(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  row: TranscriptRow,
): void {
  storeTranscriptRow(deps, ownedStep(deps, machineId, stepId), stepId, row);
}

export function reportActivity(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  report: StepActivityReport,
): void {
  const row = ownedStep(deps, machineId, stepId);
  if (PROGRESS_ACTIVITY_PHASES.includes(report.phase)) markProgress(deps, row);
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
  const agentRow = profileForStep(deps, todoRow, row.kind, row.id);
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
    const dir = skill.dir;
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
  const dir = skill.dir;
  if (!listSkillFiles(dir).includes(filePath)) throw new NotFoundError(`file ${filePath}`);
  const bytes = readSkillFileBytes(dir, filePath);
  if (bytes === null) throw new NotFoundError(`file ${filePath}`);
  return bytes;
}
