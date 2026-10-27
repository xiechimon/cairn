import type {
  ExecuteScheduleBody,
  ProjectRepoKind,
  ScheduleExecuteResult,
  ScheduleItem,
  ScheduleReport,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { project as projectTable } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { nowMs } from '../../lib/ids.js';
import type { BuildDeps } from '../builds.js';
import { githubRepoOfProject } from '../git.js';
import { teamGithubToken } from '../github-connection.js';
import { markScheduleApplied, scheduleReportById, updateScheduleDecision } from './store.js';
import { type ScheduleGithubWriter, scheduleGithubWriter } from './writes.js';

export const closeComment = (item: ScheduleItem) => {
  const proof = item.evidence[0];
  const ref = proof === undefined ? '' : `（证据：${proof.ref}）`;
  return `总管排期确认关闭：${item.reason}${ref}`;
};

export interface ScheduleExecuteDeps {
  deps: BuildDeps;
  user: { id: string; displayName: string };
  writer?: ScheduleGithubWriter;
}

export interface ScheduleProjectRow {
  id: string;
  teamId: string;
  repoKind: ProjectRepoKind | null;
  githubRepo: string | null;
}

export function projectRowOf(db: BuildDeps['db'], projectId: string): ScheduleProjectRow | null {
  const row = db
    .select({
      id: projectTable.id,
      teamId: projectTable.teamId,
      repoKind: projectTable.repoKind,
      githubRepo: projectTable.githubRepo,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .get();
  return row ?? null;
}

export function reportedItems(report: ScheduleReport): ScheduleItem[] {
  return report.items.filter(
    (item) => item.labelChange !== null || item.group === 'close' || item.executor !== null,
  );
}

export async function executeSchedule(
  deps: ScheduleExecuteDeps,
  projectId: string,
  body: ExecuteScheduleBody,
  now: number = nowMs(),
): Promise<ScheduleExecuteResult> {
  const row = projectRowOf(deps.deps.db, projectId);
  const report = scheduleReportById(deps.deps.db, projectId, body.reportId);
  if (row === null || report === null) throw new HttpError(404, 'schedule report not found');
  if (report.appliedAt !== null) {
    return {
      applied: [],
      skipped: body.issues.map((issue) => ({ issue, reason: 'already-applied' as const })),
    };
  }
  const repoRef = githubRepoOfProject(row);
  if (repoRef === null) throw new HttpError(409, 'project has no github repository');
  const got = await teamGithubToken(deps.deps, row.teamId);
  if ('reason' in got) throw new HttpError(409, `github unavailable: ${got.reason}`);
  const writer = deps.writer ?? scheduleGithubWriter(deps.deps);
  const wanted = new Set(body.issues);
  const applied: number[] = [];
  const skipped: ScheduleExecuteResult['skipped'] = [];
  for (const item of report.items) {
    if (!wanted.has(item.issue)) continue;
    const outcome = await applyItem(writer, got.token, repoRef, item);
    if (outcome === 'applied') applied.push(item.issue);
    else skipped.push({ issue: item.issue, reason: outcome });
  }
  if (applied.length > 0) {
    updateScheduleDecision(deps.deps.db, projectId, report.id, deps.user.id, now);
    markScheduleApplied(deps.deps.db, projectId, report.id, now, deps.user.id);
  }
  return { applied, skipped };
}

export async function applyItem(
  writer: ScheduleGithubWriter,
  token: string,
  repoRef: { owner: string; repo: string },
  item: ScheduleItem,
): Promise<'applied' | 'stale' | 'missing'> {
  const live = await writer.issue(token, repoRef.owner, repoRef.repo, item.issue);
  if (live === null) return 'missing';
  if (item.updatedAt !== null && live.updatedAt > item.updatedAt) return 'stale';
  if (live.state === 'closed' && item.group !== 'close') return 'stale';
  if (item.group === 'close') {
    await writer.closeIssue(
      token,
      repoRef.owner,
      repoRef.repo,
      item.issue,
      closeComment(item),
      item.closeReason === 'done' ? 'completed' : 'not_planned',
    );
  }
  if (item.labelChange !== null) {
    for (const label of item.labelChange.add) {
      await writer.addLabel(token, repoRef.owner, repoRef.repo, item.issue, label);
    }
    for (const label of item.labelChange.remove) {
      await writer.removeLabel(token, repoRef.owner, repoRef.repo, item.issue, label);
    }
  }
  return 'applied';
}
