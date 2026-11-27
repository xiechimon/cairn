import type { Phase } from '@cairn/shared';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { build, gateVerdict, step, todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import {
  type ActiveCondition,
  type NotificationDeps,
  notifyWatchdogFlag,
  raiseConditionNotices,
} from './notifications.js';
import { pendingWorkerQuestions } from './worker-question-store.js';

export const WATCHDOG_STUCK_MS = 30 * 60_000;
export const WATCHDOG_BLOCK_ROUNDS = 3;
export const WATCHDOG_REPEAT_FAILURES = 3;

const WATCHED_PHASES: readonly Phase[] = ['queued', 'planning', 'building', 'review'];
const SNIPPET_ERROR_CHARS = 80;

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function stepProgressAt(row: typeof step.$inferSelect): number {
  return row.lastProgressAt ?? row.claimedAt ?? row.createdAt;
}

function stuckReason(db: NotificationDeps['db'], buildId: string, now: number): string | null {
  const claimed = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.status, 'claimed')))
    .all()
    .filter((row) => row.stallState?.reportedAt == null);
  const silent = claimed.filter((row) => now - stepProgressAt(row) >= WATCHDOG_STUCK_MS);
  if (silent.length === 0) return null;
  if (pendingWorkerQuestions(db, buildId).length > 0) return null;
  const longest = silent.reduce((a, b) => (stepProgressAt(a) <= stepProgressAt(b) ? a : b));
  return `步骤 ${longest.kind} 自 ${clockTime(stepProgressAt(longest))} 起没有任何新进展，任务可能已停滞`;
}

function gateReason(db: NotificationDeps['db'], todoId: string, buildId: string): string | null {
  const verdicts = db
    .select({ outcome: gateVerdict.outcome, createdAt: gateVerdict.createdAt })
    .from(gateVerdict)
    .where(eq(gateVerdict.buildId, buildId))
    .all();
  let blockCount = 0;
  let mismatchCount = 0;
  let lastBlockAt = 0;
  let lastMismatchAt = 0;
  let lastPassAt = 0;
  for (const verdict of verdicts) {
    if (verdict.outcome === 'block') {
      blockCount += 1;
      lastBlockAt = Math.max(lastBlockAt, verdict.createdAt);
    } else if (verdict.outcome === 'tampered' || verdict.outcome === 'unbound') {
      mismatchCount += 1;
      lastMismatchAt = Math.max(lastMismatchAt, verdict.createdAt);
    } else if (verdict.outcome === 'pass') {
      lastPassAt = Math.max(lastPassAt, verdict.createdAt);
    }
  }
  const reasons: string[] = [];
  if (blockCount >= WATCHDOG_BLOCK_ROUNDS && lastBlockAt > lastPassAt) {
    reasons.push(`验收已连续 ${blockCount} 轮拦下改动（BLOCK），任务在同一处打转`);
  }
  if (mismatchCount > 0 && lastMismatchAt > lastPassAt) {
    reasons.push(`验收 ${mismatchCount} 次判定交付版本与预期不一致，改动可能偏离了任务`);
  }
  const counts = new Map<string, number>();
  for (const row of db
    .select({ errorMessage: build.errorMessage })
    .from(build)
    .where(and(eq(build.todoId, todoId), isNotNull(build.errorMessage)))
    .all()) {
    const error = row.errorMessage;
    if (error === null) continue;
    counts.set(error, (counts.get(error) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (repeated !== undefined && repeated[1] >= WATCHDOG_REPEAT_FAILURES) {
    const firstLine = (repeated[0].split('\n', 1)[0] ?? '').slice(0, SNIPPET_ERROR_CHARS);
    reasons.push(`同一个失败已连续出现 ${repeated[1]} 次：${firstLine}`);
  }
  return reasons.length === 0 ? null : reasons.join('\n');
}

export function sweepWorkerWatchdog(deps: NotificationDeps, now: number = nowMs()): number {
  const rows = deps.db
    .select()
    .from(todo)
    .where(
      and(
        inArray(todo.phase, [...WATCHED_PHASES]),
        isNull(todo.archivedAt),
        isNotNull(todo.latestBuildId),
      ),
    )
    .all();
  const flagged: ActiveCondition[] = [];
  for (const row of rows) {
    const buildId = row.latestBuildId;
    if (buildId === null) continue;
    const snippet = [stuckReason(deps.db, buildId, now), gateReason(deps.db, row.id, buildId)]
      .filter((reason): reason is string => reason !== null)
      .join('\n');
    if (snippet === '') continue;
    flagged.push({
      subjectId: row.id,
      fingerprint: snippet,
      notify: () => notifyWatchdogFlag(deps, row, snippet),
    });
  }
  return raiseConditionNotices(deps, 'watchdog_flag', flagged, now);
}
