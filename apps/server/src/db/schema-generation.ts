import type {
  BlockerHandoffRecord,
  ChiefMemoryTrace,
  SkillInjectionRecord,
  StepFailureCode,
  StepKind,
  StepPromptOrigin,
} from '@cairn/shared';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { QuotaWaitRow, StepFallbackRow, StepRanModel, StepStallMeta } from './schema.js';

export * from './schema.js';

const epochMs = (name: string) => integer(name);
const bool = (name: string) => integer(name, { mode: 'boolean' });
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const step = sqliteTable(
  'step',
  {
    id: text('id').primaryKey(),
    buildId: text('buildId').notNull(),
    kind: text('kind').$type<StepKind>().notNull(),
    machineId: text('machineId'),
    status: text('status')
      .$type<'pending' | 'claimed' | 'done' | 'failed' | 'stopped' | 'waiting_quota'>()
      .notNull()
      .default('pending'),
    archiveStop: text('archiveStop').$type<'requested' | 'acknowledged' | null>(),
    quotaBlock: json<QuotaWaitRow>('quotaBlock'),
    fallback: json<StepFallbackRow>('fallback'),
    ranModel: json<StepRanModel>('ranModel'),
    stallState: json<StepStallMeta>('stallState'),
    sessionId: text('sessionId'),
    scheduleId: text('scheduleId'),
    scheduledBy: text('scheduledBy'),
    checkpointCommit: text('checkpointCommit'),
    claimedAt: epochMs('claimedAt'),
    lastHeartbeatAt: epochMs('lastHeartbeatAt'),
    lastProgressAt: epochMs('lastProgressAt'),
    finishedAt: epochMs('finishedAt'),
    prompt: text('prompt'),
    promptOrigin: json<StepPromptOrigin>('promptOrigin'),
    scopeProjectId: text('scopeProjectId'),
    ownerMessageIds: json<string[]>('ownerMessageIds'),
    ownerSaid: text('ownerSaid'),
    byPerson: bool('byPerson').notNull().default(false),
    claudeSubscriptionId: text('claudeSubscriptionId'),
    devinSubscriptionId: text('devinSubscriptionId'),
    antigravitySubscriptionId: text('antigravitySubscriptionId'),
    doubaoSubscriptionId: text('doubaoSubscriptionId'),
    freshSession: bool('freshSession').notNull().default(false),
    skillInjection: json<SkillInjectionRecord>('skillInjection'),
    blockerHandoff: json<BlockerHandoffRecord>('blockerHandoff'),
    holdReason: text('holdReason'),
    holdUntil: epochMs('holdUntil'),
    holdCount: integer('holdCount').notNull().default(0),
    claimCount: integer('claimCount').notNull().default(0),
    failureCode: text('failureCode').$type<StepFailureCode | null>(),
    mcpGrant: json<string[]>('mcpGrant'),
    claimedRepo: text('claimedRepo'),
    claimedRepoId: integer('claimedRepoId'),
    targetMachineId: text('targetMachineId'),
    routedFromMachineId: text('routedFromMachineId'),
    routedReason: text('routedReason').$type<'offline' | 'busy' | 'manual-switch' | null>(),
    memoryTrace: json<ChiefMemoryTrace>('memoryTrace'),
    createdAt: epochMs('createdAt').notNull(),
  },
  (t) => [
    index('step_status_kind_idx').on(t.status, t.kind),
    index('step_buildId_status_idx').on(t.buildId, t.status),
    index('step_kind_idx').on(t.kind),
    index('step_merge_finished_idx').on(t.kind, t.status, t.finishedAt),
  ],
);
