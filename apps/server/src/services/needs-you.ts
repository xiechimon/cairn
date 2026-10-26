import type { NeedsYouQuery, NeedsYouReason } from '@cairn/shared';
import { isProviderAuthFailure } from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { build, project, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { applyBuildStepAction, type BuildDeps, NotFoundError } from './builds.js';
import { PhaseTransitionError } from './phase.js';
import { projectMergeConfigOf } from './projects.js';
import { getTodo } from './todos.js';

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
  if (isProviderAuthFailure(errorMessage)) return true;
  if (GATE_REJECTION.some((mark) => errorMessage.includes(mark))) return true;
  const lower = errorMessage.toLowerCase();
  return MISSING_CREDENTIALS.some((mark) => lower.includes(mark.toLowerCase()));
}

function owedAutomaticRetry(
  buildRow: { errorMessage: string | null; prevPhase: string | null } | undefined,
): boolean {
  if (buildRow === undefined) return false;
  if (failureNeedsHuman(buildRow.errorMessage ?? '')) return false;
  return buildRow.prevPhase !== 'failed';
}

export function listNeedsYou(deps: BuildDeps, teamId: string, now = nowMs()): NeedsYouQuery {
  const rows = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.teamId, teamId), inArray(todo.phase, ['confirm', 'review', 'failed'])))
    .all();
  const buildIds = rows.flatMap((row) => (row.latestBuildId === null ? [] : [row.latestBuildId]));
  const buildById = new Map(
    (buildIds.length === 0
      ? []
      : deps.db.select().from(build).where(inArray(build.id, buildIds)).all()
    ).map((row) => [row.id, row]),
  );
  const projectIds = [...new Set(rows.map((row) => row.projectId))];
  const projectById = new Map(
    (projectIds.length === 0
      ? []
      : deps.db.select().from(project).where(inArray(project.id, projectIds)).all()
    ).map((row) => [row.id, row]),
  );
  const entries: { todoId: string; reason: NeedsYouReason; phaseAt: number }[] = [];
  for (const row of rows) {
    let reason: NeedsYouReason | null = null;
    if (row.phase === 'confirm') reason = 'confirm';
    else if (row.phase === 'review') {
      const projectRow = projectById.get(row.projectId);
      const policy =
        projectRow === undefined ? 'autonomous' : projectMergeConfigOf(projectRow).mergePolicy;
      if (policy === 'human') reason = 'review';
    } else if (row.phase === 'failed') {
      const latest = row.latestBuildId === null ? undefined : buildById.get(row.latestBuildId);
      if (!owedAutomaticRetry(latest)) reason = 'failed';
    }
    if (reason !== null) entries.push({ todoId: row.id, reason, phaseAt: row.phaseAt });
  }
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
  const rows = deps.db.select().from(todo).where(eq(todo.phase, 'failed')).all();
  for (const row of rows) {
    if (row.latestBuildId === null) continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.latestBuildId)).get();
    if (buildRow === undefined || !owedAutomaticRetry(buildRow)) continue;
    try {
      await applyBuildStepAction(
        deps,
        buildRow.id,
        { action: 'restart', feedback: '', clientMessageId: newRecordId() },
        'cairn',
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
