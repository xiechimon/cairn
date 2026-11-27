import type { GitIdentity, StepRecord, TranscriptUserOrigin, UserRecord } from '@cairn/shared';
import { isChiefConversationId } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type CommitEffects,
  type EffectHubs,
  type ScheduleEffect,
  withCommitEffects,
} from '../db/commit-effects.js';
import { build, chiefThread, message, type StepStallMeta, step, todo } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import type { KeySecretBox } from '../lib/secret-box.js';
import { NotFoundError } from './builds.js';
import { upsertChiefMessage } from './chief.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import type { SendMail } from './mail-smtp.js';
import type { McpOAuthState } from './mcp-servers.js';
import type { OAuthClientConfig } from './oauth.js';
import type { VapidKeys } from './push.js';
import { profileForStep as profileForStepRoute } from './routing-rules.js';

export function isChiefConversation(id: string): boolean {
  return isChiefConversationId(id);
}

export interface MachineDeps extends CommitEffects {
  githubAppTokenSocket?: string | null | undefined;
  githubAppIdentity?: GitIdentity | null | undefined;
  db: Db;
  assertClaim?: () => void;
  hub: TeamStreamHub;
  machineHub: MachineWakeHub;
  box: KeySecretBox;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
  reposDir: string;
  workspacesDir?: string | undefined;
  attachmentsDir: string;
  skillsDir: string;
  mcpConfigPath?: string;
  convHub?: ConversationStreamHub;
  githubFetch?: FetchLike;
  githubBaseFetch?: FetchLike;
  oauthFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
  githubApp?: Readonly<{ clientId: string; slug: string }> | null | undefined;
  mcpFetch?: typeof fetch;
  mailSend?: SendMail;
  mcpOAuthState?: McpOAuthState;
}

const DEFERRED_SIGNALS = new Set(['wake', 'steerSignal', 'stopSignal']);

function deferSignals<T extends object>(hub: T, schedule: ScheduleEffect): T {
  return new Proxy(hub, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      const call = value as (...args: unknown[]) => unknown;
      if (typeof key === 'string' && (key.startsWith('publish') || DEFERRED_SIGNALS.has(key))) {
        return (...args: unknown[]) => {
          schedule(key, () => call.apply(target, args));
        };
      }
      return call.bind(target);
    },
  });
}

export function withFencedTransaction<D extends EffectHubs & CommitEffects & { db: Db }, T>(
  deps: D,
  run: (deps: D) => T,
): T {
  return withCommitEffects(deps, run, (hubs, schedule) => ({
    hub: deferSignals(hubs.hub, schedule),
    ...(hubs.machineHub !== undefined
      ? { machineHub: deferSignals(hubs.machineHub, schedule) }
      : {}),
    ...(hubs.convHub !== undefined ? { convHub: deferSignals(hubs.convHub, schedule) } : {}),
  }));
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

export function profileForStep(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  kind: StepRecord['kind'],
  stepId: string | null = null,
) {
  return profileForStepRoute(deps.db, todoRow, kind, stepId);
}

export function ownedStepRow(deps: MachineDeps, machineId: string | null, stepId: string) {
  deps.assertClaim?.();
  const row = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row) throw new NotFoundError(`step ${stepId}`);
  if (row.machineId !== machineId) throw new NotFoundError(`step ${stepId} (not yours)`);
  return row;
}

export function ownedStep(deps: MachineDeps, machineId: string | null, stepId: string) {
  const row = ownedStepRow(deps, machineId, stepId);
  if (row.status !== 'claimed') throw new NotFoundError(`step ${stepId} (not running)`);
  return row;
}

export function stepTeamId(
  deps: Pick<MachineDeps, 'db'>,
  stepRow: typeof step.$inferSelect,
): string | null {
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

type MessageRowInput = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: unknown;
  createdAt: number;
};

export function upsertMessage(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & { conversationId: string; origin?: TranscriptUserOrigin | null },
): void {
  deps.db
    .insert(message)
    .values(row)
    .onConflictDoUpdate({
      target: message.id,
      set: {
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
        actor: null,
        origin: sql`coalesce(excluded.origin, ${message.origin})`,
      },
    })
    .run();
  deps.convHub?.publishMessage(row.conversationId, row);
}

export function upsertChiefRow(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & {
    threadId: string;
    projectId?: string | null;
    origin?: TranscriptUserOrigin | null;
  },
): void {
  const stored = upsertChiefMessage(deps.db, row);
  deps.convHub?.publishMessage(row.threadId, stored);
}

const PROGRESS_WRITE_INTERVAL_MS = 30_000;

export function clearedStallMeta(meta: StepStallMeta | null | undefined): {
  changed: boolean;
  value: StepStallMeta | null;
} {
  if (!meta) return { changed: false, value: null };
  if (
    meta.activity === undefined &&
    meta.reportedAt === undefined &&
    meta.reportedFingerprint === undefined
  ) {
    return { changed: false, value: meta };
  }
  const next: StepStallMeta = {};
  if (meta.recoveryCount !== undefined) next.recoveryCount = meta.recoveryCount;
  if (meta.lastCause !== undefined) next.lastCause = meta.lastCause;
  if (meta.lastRecoveredAt !== undefined) next.lastRecoveredAt = meta.lastRecoveredAt;
  if (meta.lastRecoveredFromMachineId !== undefined)
    next.lastRecoveredFromMachineId = meta.lastRecoveredFromMachineId;
  return { changed: true, value: Object.keys(next).length > 0 ? next : null };
}

export function markStepProgress(
  db: Db,
  row: Pick<typeof step.$inferSelect, 'id' | 'status' | 'lastProgressAt' | 'stallState'>,
  now: number = nowMs(),
): void {
  if (row.status !== 'claimed') return;
  const cleaned = clearedStallMeta(row.stallState);
  const dueProgress =
    row.lastProgressAt === null || now - row.lastProgressAt >= PROGRESS_WRITE_INTERVAL_MS;
  if (!dueProgress && !cleaned.changed) return;
  db.update(step)
    .set({
      ...(dueProgress ? { lastProgressAt: now } : {}),
      ...(cleaned.changed ? { stallState: cleaned.value } : {}),
    })
    .where(eq(step.id, row.id))
    .run();
}

export function touchStepProgress(db: Db, stepId: string, now: number = nowMs()): void {
  const row = db
    .select({
      id: step.id,
      status: step.status,
      lastProgressAt: step.lastProgressAt,
      stallState: step.stallState,
    })
    .from(step)
    .where(eq(step.id, stepId))
    .get();
  if (row !== undefined) markStepProgress(db, row, now);
}
