import type { NeedsYouQuery } from '@cairn/shared';
import { isProviderAuthFailure } from '@cairn/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { applyBuildStepAction, type BuildDeps, NotFoundError } from './builds.js';
import { OWNED_CANDIDATE, ownershipOf } from './owner.js';
import { PhaseTransitionError } from './phase.js';
import { retryIsParked } from './retry-parking.js';
import { getTodo } from './todos.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

export const CITATION_CHECK_SOURCE_KIND = 'research-citation-check';
export const CITATION_PARKED_MARK = 'Citation check parked';
export const NEEDS_YOU_STALE_MS = 7 * 24 * 60 * 60 * 1000;

const GATE_REJECTION = [
  '方案结构不合格',
  '规划未产出方案',
  '信息卡未产出报告',
  '偏离工作分支',
  '构建零改动',
  '转人工处理',
  '死循环闸',
  '请人工复核',
] as const;

const MISSING_CREDENTIALS = [
  'no team secret is available',
  'api key is missing',
  'api key is not configured',
  'gemini login',
  'reconnect github',
  '重新连接 github',
  '未配置模型',
  '尚未上报模型清单',
  '未启用',
] as const;

export function failureNeedsHuman(errorMessage: string): boolean {
  if (retryIsParked(errorMessage)) return true;
  if (errorMessage.startsWith('PR Auto-fix needs you:')) return true;
  if (isProviderAuthFailure(errorMessage)) return true;
  if (errorMessage.startsWith(CITATION_PARKED_MARK)) return true;
  if (GATE_REJECTION.some((mark) => errorMessage.includes(mark))) return true;
  const lower = errorMessage.toLowerCase();
  return MISSING_CREDENTIALS.some((mark) => lower.includes(mark.toLowerCase()));
}

function lastStepScheduledBuildIds(db: Db, buildIds: string[]): Set<string> {
  if (buildIds.length === 0) return new Set();
  const latestByBuild = new Map<string, { scheduleId: string | null; createdAt: number }>();
  for (const row of db
    .select({ buildId: step.buildId, scheduleId: step.scheduleId, createdAt: step.createdAt })
    .from(step)
    .where(inArray(step.buildId, buildIds))
    .all()) {
    const seen = latestByBuild.get(row.buildId);
    if (seen === undefined || row.createdAt >= seen.createdAt) latestByBuild.set(row.buildId, row);
  }
  return new Set(
    [...latestByBuild].flatMap(([buildId, row]) => (row.scheduleId === null ? [] : [buildId])),
  );
}

function owedAutomaticRetry(
  buildRow: { id: string; errorMessage: string | null; prevPhase: string | null } | undefined,
  scheduledBuildIds: Set<string>,
): boolean {
  if (buildRow === undefined) return false;
  if (scheduledBuildIds.has(buildRow.id)) return false;
  if (failureNeedsHuman(buildRow.errorMessage ?? '')) return false;
  return buildRow.prevPhase !== 'failed';
}

export function failureAwaitsAutomaticRetry(
  db: Db,
  buildRow: { id: string; errorMessage: string | null; prevPhase: string | null },
): boolean {
  return owedAutomaticRetry(buildRow, lastStepScheduledBuildIds(db, [buildRow.id]));
}

export function listNeedsYou(
  deps: Pick<BuildDeps, 'db'>,
  teamId: string,
  now = nowMs(),
): NeedsYouQuery {
  const entries = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.teamId, teamId), OWNED_CANDIDATE))
    .all()
    .flatMap((row) => {
      const ownership = ownershipOf(deps.db, row);
      return ownership?.owner === 'owner'
        ? [{ todoId: row.id, reason: ownership.reason, phaseAt: row.phaseAt }]
        : [];
    });
  entries.sort((a, b) => b.phaseAt - a.phaseAt || (a.todoId < b.todoId ? -1 : 1));
  const current: NeedsYouQuery['current'] = [];
  const stale: NeedsYouQuery['stale'] = [];
  for (const entry of entries) {
    const record = getTodo(deps, entry.todoId);
    if (record === null) continue;
    const item = { todo: record, reason: entry.reason };
    if (now - entry.phaseAt > NEEDS_YOU_STALE_MS) stale.push(item);
    else current.push(item);
  }
  return { current, stale };
}

export async function sweepFailedRetries(deps: BuildDeps): Promise<void> {
  const rows = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.phase, 'failed'), isNull(todo.archivedAt)))
    .all();
  for (const row of rows) {
    if (row.latestBuildId === null || row.sourceKind === CITATION_CHECK_SOURCE_KIND) continue;
    if (pendingWorkerQuestions(deps.db, row.latestBuildId).length > 0) continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
    if (
      buildRow === undefined ||
      !owedAutomaticRetry(buildRow, lastStepScheduledBuildIds(deps.db, [row.latestBuildId]))
    ) {
      continue;
    }
    try {
      await applyBuildStepAction(
        deps,
        buildRow.id,
        { action: 'restart', feedback: '', clientMessageId: newRecordId() },
        'cairn',
        'automatic',
      );
    } catch (err) {
      if (
        err instanceof HttpError ||
        err instanceof PhaseTransitionError ||
        err instanceof NotFoundError
      ) {
        continue;
      }
      throw err;
    }
  }
}
