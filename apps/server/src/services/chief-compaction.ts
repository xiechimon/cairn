import {
  type ChiefCompactionSettings,
  type CoordinatorCompactResponse,
  type CoordinatorContextResponse,
  type CoordinatorSummary,
  isChiefDigestThreadId,
  type MachineDoneBody,
} from '@cairn/shared';
import { and, desc, eq, gte, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  agent,
  chief,
  chiefMessage,
  chiefThread,
  chiefTurnUsage,
  machine,
  step,
  stopPending,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { chiefStepAbandoned, liveChiefSteps, requestChiefStepStop } from './chief-turns.js';
import { stepRuntimeFor } from './dispatch-eligibility.js';
import type { ConversationStreamHub } from './events.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { publishStepRow } from './quota-wait.js';

export const CHIEF_COMPACTION: ChiefCompactionSettings = {
  thresholdTokens: 64_000,
  keepRecentTokens: 16_384,
};

export const CHIEF_COMPACT_MAX_ATTEMPTS = 2;

export const CHIEF_COMPACT_WAIT_MS = 180_000;

export const CHIEF_COMPACT_MAX_MS = 5 * 60_000;

export interface IdleCompactionPolicy {
  idleMs: number;
  cacheWindowMs: number;
  triggerTokens: number;
}

export const IDLE_COMPACTION_DEFAULTS: IdleCompactionPolicy = {
  idleMs: 45_000,
  cacheWindowMs: 5 * 60_000,
  triggerTokens: Math.round(CHIEF_COMPACTION.thresholdTokens * 0.75),
};

type ThreadRow = typeof chiefThread.$inferSelect;
type StepRow = typeof step.$inferSelect;

export interface CompactionDeps {
  db: Db;
  machineHub?: MachineWakeHub;
  convHub?: ConversationStreamHub;
}

const bindingSchema = z.object({
  cursor: z.string().min(1),
  generation: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  reason: z.enum(['idle', 'manual']),
});
type CompactBinding = z.infer<typeof bindingSchema>;

function compactBindingOf(stepRow: Pick<StepRow, 'compactOnly' | 'prompt'>): CompactBinding | null {
  if (!stepRow.compactOnly || stepRow.prompt === null) return null;
  try {
    const parsed = bindingSchema.safeParse(JSON.parse(stepRow.prompt));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function isChiefCompactStep(row: Pick<StepRow, 'kind' | 'compactOnly'>): boolean {
  return row.kind === 'chief' && row.compactOnly;
}

type CompactOutcome =
  | { kind: 'landed'; summary: CoordinatorSummary }
  | { kind: 'nothing' }
  | { kind: 'discarded' }
  | { kind: 'unsupported' }
  | { kind: 'stopped' }
  | { kind: 'failed'; error: string };

const waiters = new Map<string, Set<(outcome: CompactOutcome) => void>>();

function settleWaiter(stepId: string, outcome: CompactOutcome): void {
  const resolvers = waiters.get(stepId);
  if (resolvers === undefined) return;
  waiters.delete(stepId);
  for (const resolve of resolvers) resolve(outcome);
}

function latestMessageId(db: Db, threadId: string): string | null {
  return (
    db
      .select({ id: chiefMessage.id })
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .orderBy(desc(chiefMessage.createdAt), sql`rowid desc`)
      .limit(1)
      .get()?.id ?? null
  );
}

function latestTurnUsage(db: Db, threadId: string) {
  return db
    .select()
    .from(chiefTurnUsage)
    .where(and(eq(chiefTurnUsage.threadId, threadId), isNotNull(chiefTurnUsage.contextTokens)))
    .orderBy(desc(chiefTurnUsage.createdAt), sql`rowid desc`)
    .limit(1)
    .get();
}

export function currentSummary(thread: ThreadRow): CoordinatorSummary | null {
  const summary = thread.compactSummary;
  if (summary === null || summary.sessionId !== thread.sessionId || thread.sessionId === '') {
    return null;
  }
  return {
    coveredThroughMessageId: summary.coveredThroughMessageId,
    generation: thread.compactGeneration,
    updatedAt: summary.updatedAt,
  };
}

function compactMachineReady(db: Db, thread: ThreadRow): boolean {
  const chiefRow = db.select().from(chief).where(eq(chief.id, thread.chiefId)).get();
  const agentRow = chiefRow?.agentId
    ? db.select().from(agent).where(eq(agent.id, chiefRow.agentId)).get()
    : undefined;
  if (!agentRow?.modelId || agentRow.machineId === null) return false;
  if (stepRuntimeFor(agentRow.provider) !== 'pi') return false;
  return machineCompacts(db.select().from(machine).where(eq(machine.id, agentRow.machineId)).get());
}

export function machineCompacts(
  row: Pick<typeof machine.$inferSelect, 'online' | 'capabilities'> | undefined,
): boolean {
  return row?.online === true && row.capabilities?.features?.includes('chief-compact') === true;
}

type CompactionPlan =
  | { kind: 'ready'; cursor: string }
  | { kind: 'running'; stepId: string }
  | { kind: 'busy' }
  | { kind: 'unchanged' }
  | { kind: 'capped' }
  | { kind: 'unavailable' };

function compactionPlan(db: Db, thread: ThreadRow): CompactionPlan {
  const live = liveChiefSteps(db, thread.id);
  const turns = live.filter((row) => !isChiefCompactStep(row));
  if (turns.length > 0 || thread.activeRun !== null) return { kind: 'busy' };
  const running = live.find(isChiefCompactStep);
  if (running !== undefined) return { kind: 'running', stepId: running.id };
  const cursor = latestMessageId(db, thread.id);
  if (thread.sessionId === '' || cursor === null) return { kind: 'unchanged' };
  if (currentSummary(thread)?.coveredThroughMessageId === cursor) return { kind: 'unchanged' };
  const attempt = thread.compactAttempt;
  if (attempt?.cursor === cursor && attempt.nothingToCompact === true) {
    return { kind: 'unchanged' };
  }
  if (attempt?.cursor === cursor && attempt.count >= CHIEF_COMPACT_MAX_ATTEMPTS) {
    return { kind: 'capped' };
  }
  if (!compactMachineReady(db, thread)) return { kind: 'unavailable' };
  return { kind: 'ready', cursor };
}

function enqueueCompaction(
  deps: CompactionDeps,
  thread: ThreadRow,
  cursor: string,
  reason: CompactBinding['reason'],
  now: number,
): string {
  const binding: CompactBinding = {
    cursor,
    generation: thread.compactGeneration,
    sessionId: thread.sessionId,
    reason,
  };
  const id = newRecordId();
  const prior = thread.compactAttempt;
  deps.db
    .insert(step)
    .values({
      id,
      buildId: thread.id,
      kind: 'chief',
      machineId: null,
      status: 'pending',
      prompt: JSON.stringify(binding),
      compactOnly: true,
      createdAt: now,
    })
    .run();
  deps.db
    .update(chiefThread)
    .set({ compactAttempt: { cursor, count: prior?.cursor === cursor ? prior.count + 1 : 1 } })
    .where(eq(chiefThread.id, thread.id))
    .run();
  deps.machineHub?.wake(thread.teamId);
  return id;
}

export function planIdleCompactions(
  deps: CompactionDeps,
  now: number,
  policy: IdleCompactionPolicy = IDLE_COMPACTION_DEFAULTS,
): void {
  const threads = deps.db
    .select()
    .from(chiefThread)
    .where(
      and(
        isNull(chiefThread.archivedAt),
        ne(chiefThread.sessionId, ''),
        gte(chiefThread.lastTurnAt, now - policy.cacheWindowMs),
        lte(chiefThread.lastTurnAt, now - policy.idleMs),
      ),
    )
    .all()
    .filter((thread) => !isChiefDigestThreadId(thread.id));
  for (const thread of threads) {
    const usage = latestTurnUsage(deps.db, thread.id);
    if (usage === undefined || (usage.contextTokens ?? 0) < policy.triggerTokens) continue;
    const summary = currentSummary(thread);
    if (summary !== null && usage.createdAt <= summary.updatedAt) continue;
    const plan = compactionPlan(deps.db, thread);
    if (plan.kind !== 'ready') continue;
    enqueueCompaction(deps, thread, plan.cursor, 'idle', now);
  }
}

export function compactStepIsCurrent(db: Db, stepRow: StepRow): boolean {
  const binding = compactBindingOf(stepRow);
  if (binding === null) return false;
  const thread = db.select().from(chiefThread).where(eq(chiefThread.id, stepRow.buildId)).get();
  return (
    thread !== undefined &&
    thread.archivedAt === null &&
    thread.sessionId === binding.sessionId &&
    thread.compactGeneration === binding.generation &&
    thread.activeRun === null
  );
}

export function discardCompactStep(
  deps: CompactionDeps,
  stepRow: StepRow,
  reason: 'stale' | 'unsupported',
): void {
  deps.db.delete(step).where(eq(step.id, stepRow.id)).run();
  if (reason === 'unsupported') refundAttempt(deps.db, stepRow);
  publishStepRow(deps, { ...stepRow, status: 'stopped' });
  settleWaiter(stepRow.id, { kind: reason === 'stale' ? 'discarded' : 'unsupported' });
}

function refundAttempt(db: Db, stepRow: StepRow): void {
  const binding = compactBindingOf(stepRow);
  const thread = db.select().from(chiefThread).where(eq(chiefThread.id, stepRow.buildId)).get();
  const attempt = thread?.compactAttempt;
  if (binding === null || attempt == null || attempt.cursor !== binding.cursor) return;
  db.update(chiefThread)
    .set({ compactAttempt: attempt.count > 1 ? { ...attempt, count: attempt.count - 1 } : null })
    .where(eq(chiefThread.id, stepRow.buildId))
    .run();
}

export function sweepOverlongCompactions(deps: CompactionDeps, now: number = nowMs()): void {
  const overlong = deps.db
    .select({ step, thread: chiefThread })
    .from(step)
    .innerJoin(chiefThread, eq(chiefThread.id, step.buildId))
    .where(
      and(
        eq(step.compactOnly, true),
        eq(step.status, 'claimed'),
        lt(step.claimedAt, now - CHIEF_COMPACT_MAX_MS),
      ),
    )
    .all();
  for (const row of overlong) {
    if (!chiefStepAbandoned(row.step, now)) {
      requestChiefStepStop(deps, row.thread, row.step, now);
      continue;
    }
    deps.db
      .update(step)
      .set({ status: 'stopped', finishedAt: now })
      .where(eq(step.id, row.step.id))
      .run();
    deps.db.delete(stopPending).where(eq(stopPending.stepId, row.step.id)).run();
    publishStepRow(deps, { ...row.step, status: 'stopped' });
    settleWaiter(row.step.id, {
      kind: 'failed',
      error: 'compaction timed out on a machine that stopped reporting',
    });
    deps.machineHub?.wake(row.thread.teamId);
  }
}

export function preemptChiefCompaction(deps: CompactionDeps, threadId: string): void {
  const thread = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  if (thread === undefined) return;
  const now = nowMs();
  for (const row of liveChiefSteps(deps.db, threadId).filter(isChiefCompactStep)) {
    if (row.status !== 'claimed' || chiefStepAbandoned(row, now)) {
      deps.db.delete(step).where(eq(step.id, row.id)).run();
      deps.db.delete(stopPending).where(eq(stopPending.stepId, row.id)).run();
      publishStepRow(deps, { ...row, status: 'stopped' });
      settleWaiter(row.id, { kind: 'stopped' });
      continue;
    }
    requestChiefStepStop(deps, thread, row, now);
  }
}

function landCompaction(
  db: Db,
  stepRow: StepRow,
  binding: CompactBinding,
  report: NonNullable<MachineDoneBody['compaction']>,
  now: number,
): CoordinatorSummary | null {
  const landed = db
    .update(chiefThread)
    .set({
      compactGeneration: binding.generation + 1,
      compactSummary: {
        coveredThroughMessageId: binding.cursor,
        sessionId: binding.sessionId,
        updatedAt: now,
        tokensBefore: report.tokensBefore,
        tokensAfter: report.tokensAfter,
        summaryTokens: report.summaryTokens,
      },
      compactAttempt: null,
    })
    .where(
      and(
        eq(chiefThread.id, stepRow.buildId),
        eq(chiefThread.compactGeneration, binding.generation),
        eq(chiefThread.sessionId, binding.sessionId),
      ),
    )
    .run();
  if (landed.changes === 0) return null;
  return {
    coveredThroughMessageId: binding.cursor,
    generation: binding.generation + 1,
    updatedAt: now,
  };
}

function compactOutcome(
  db: Db,
  stepRow: StepRow,
  binding: CompactBinding | null,
  outcome: MachineDoneBody,
  now: number,
): CompactOutcome {
  if (outcome.status === 'stopped') return { kind: 'stopped' };
  if (outcome.status === 'failed') {
    return { kind: 'failed', error: outcome.errorMessage ?? 'compaction failed' };
  }
  const report = outcome.compaction;
  if (binding === null || report === undefined) {
    return { kind: 'failed', error: 'compaction step reported no compaction result' };
  }
  if (!report.compacted) {
    db.update(chiefThread)
      .set({
        compactAttempt: {
          cursor: binding.cursor,
          count: CHIEF_COMPACT_MAX_ATTEMPTS,
          nothingToCompact: true,
        },
      })
      .where(
        and(
          eq(chiefThread.id, stepRow.buildId),
          eq(chiefThread.compactGeneration, binding.generation),
        ),
      )
      .run();
    return { kind: 'nothing' };
  }
  const summary = landCompaction(db, stepRow, binding, report, now);
  return summary === null ? { kind: 'discarded' } : { kind: 'landed', summary };
}

export function finishChiefCompaction(
  deps: CompactionDeps,
  stepRow: StepRow,
  outcome: MachineDoneBody,
  now: number,
): void {
  const binding = compactBindingOf(stepRow);
  const result = compactOutcome(deps.db, stepRow, binding, outcome, now);
  deps.db
    .update(step)
    .set({
      status: result.kind === 'stopped' ? 'stopped' : result.kind === 'failed' ? 'failed' : 'done',
      finishedAt: now,
    })
    .where(eq(step.id, stepRow.id))
    .run();
  if (result.kind === 'failed') {
    process.stderr.write(`Coordinator compaction ${stepRow.id} failed: ${result.error}\n`);
  }
  settleWaiter(stepRow.id, result);
  const thread = deps.db
    .select()
    .from(chiefThread)
    .where(eq(chiefThread.id, stepRow.buildId))
    .get();
  if (thread !== undefined) deps.machineHub?.wake(thread.teamId);
}

function awaitCompaction(stepId: string, timeoutMs: number): Promise<CompactOutcome> {
  return new Promise((resolve, reject) => {
    const resolvers = waiters.get(stepId) ?? new Set();
    waiters.set(stepId, resolvers);
    const settle = (outcome: CompactOutcome): void => {
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      resolvers.delete(settle);
      if (resolvers.size === 0 && waiters.get(stepId) === resolvers) waiters.delete(stepId);
      reject(new HttpError(504, 'compaction is still running; check the context meter later'));
    }, timeoutMs);
    timer.unref?.();
    resolvers.add(settle);
  });
}

export async function compactThreadNow(
  deps: CompactionDeps,
  thread: ThreadRow,
  timeoutMs: number = CHIEF_COMPACT_WAIT_MS,
): Promise<CoordinatorCompactResponse> {
  const plan = compactionPlan(deps.db, thread);
  if (plan.kind === 'busy') throw new HttpError(409, 'a Coordinator turn is running or queued');
  if (plan.kind === 'unchanged') return { skipped: 'unchanged' };
  if (plan.kind === 'capped') {
    throw new HttpError(409, 'compaction already failed for this range; send a message first');
  }
  if (plan.kind === 'unavailable') {
    throw new HttpError(503, 'no online machine can compact the Coordinator session');
  }
  const stepId =
    plan.kind === 'running'
      ? plan.stepId
      : enqueueCompaction(deps, thread, plan.cursor, 'manual', nowMs());
  const outcome = await awaitCompaction(stepId, timeoutMs);
  if (outcome.kind === 'landed') return { summary: outcome.summary };
  if (outcome.kind === 'nothing') return { skipped: 'unchanged' };
  if (outcome.kind === 'failed') throw new HttpError(502, outcome.error);
  if (outcome.kind === 'unsupported') {
    throw new HttpError(503, 'the Coordinator machine cannot compact sessions');
  }
  throw new HttpError(409, 'a new Coordinator turn superseded the compaction');
}

export function threadContextUsage(
  db: Db,
  thread: ThreadRow,
  fixed: { system: number; tools: number },
): CoordinatorContextResponse {
  const summary = currentSummary(thread);
  const stored = summary !== null ? thread.compactSummary : null;
  const usage = thread.sessionId === '' ? undefined : latestTurnUsage(db, thread.id);
  const afterSummary = stored?.tokensAfter ?? null;
  const measured =
    usage !== undefined && (afterSummary === null || usage.createdAt > (stored?.updatedAt ?? 0));
  const used = measured
    ? (usage.contextTokens ?? 0)
    : fixed.system + fixed.tools + (afterSummary ?? 0);
  const summaryTokens = stored?.summaryTokens ?? 0;
  const recent = Math.max(0, used - fixed.system - fixed.tools - summaryTokens);
  const prompt = usage === undefined ? 0 : usage.input + usage.cacheRead + usage.cacheWrite;
  return {
    budgetTokens: CHIEF_COMPACTION.thresholdTokens,
    usedTokens: used,
    sections: [
      { name: 'system', tokens: fixed.system },
      { name: 'tools', tokens: fixed.tools },
      { name: 'brief', tokens: 0 },
      { name: 'index', tokens: 0 },
      { name: 'summary', tokens: summaryTokens },
      { name: 'recent', tokens: recent },
    ],
    summary,
    cacheReadShare: usage === undefined || prompt === 0 ? null : usage.cacheRead / prompt,
  };
}
