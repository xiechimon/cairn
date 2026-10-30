import {
  type Phase,
  type ProjectRepoKind,
  type ScheduleReport,
  scheduleReportSchema,
} from '@cairn/shared';
import { and, eq, isNotNull, notInArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { build, project, todo } from '../../db/schema.js';
import type { FetchLike } from '../../lib/github.js';
import { newRecordId, nowMs } from '../../lib/ids.js';
import {
  autonomySettingsOf,
  autonomyStateOf,
  evaluateAutonomyGates,
  lastMemberWriteAt,
  recordAutonomyStart,
  recordAutonomyVerdict,
  spentForGate,
} from '../autonomy-gates.js';
import type { BuildDeps } from '../builds.js';
import { githubRepoOfProject } from '../git.js';
import { teamGithubToken } from '../github-connection.js';
import { ISSUE_INTAKE_LABEL } from '../issue-intake.js';
import { defaultBranchSha, ledgerLines, mergedPulls, openIssues } from './collect.js';
import { planSchedule } from './plan.js';
import { insertScheduleReport, latestScheduleReport } from './store.js';

export const SCHEDULE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function issuesMatchPersistedReport(
  listed: readonly { number: number; updatedAt: number }[],
  report: ScheduleReport | null,
): boolean {
  if (report === null) return false;
  if (listed.length !== report.items.length) return false;
  const prior = new Map(report.items.map((item) => [item.issue, item.updatedAt ?? 0]));
  if (prior.size !== listed.length) return false;
  for (const issue of listed) {
    if (prior.get(issue.number) !== issue.updatedAt) return false;
  }
  return true;
}

export interface SchedulingLogger {
  info(obj: object, msg: string): void;
}

export interface SchedulingRun {
  githubFetch: FetchLike;
  logger?: SchedulingLogger;
}

export type ScheduleSweepOutcome =
  | { kind: 'gated'; reason: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'generated'; report: ScheduleReport };

export interface ProjectRow {
  id: string;
  teamId: string;
  repoKind: ProjectRepoKind | null;
  githubRepo: string | null;
  autonomy: unknown;
}

const SETTLED_PHASES: readonly Phase[] = ['done', 'closed', 'failed'];

export function inFlightIssues(db: Db, projectId: string): Map<number, string> {
  const rows = db
    .select({ sourceRef: todo.sourceRef })
    .from(todo)
    .innerJoin(build, eq(build.todoId, todo.id))
    .where(
      and(
        eq(todo.projectId, projectId),
        eq(todo.sourceKind, 'github-issue'),
        isNotNull(todo.sourceRef),
        notInArray(todo.phase, [...SETTLED_PHASES]),
      ),
    )
    .all();
  const out = new Map<number, string>();
  for (const row of rows) {
    const ref = row.sourceRef ?? '';
    const match = /#(\d+)$/.exec(ref) ?? /issues\/(\d+)/.exec(ref);
    if (match === null) continue;
    const issue = Number(match[1]);
    if (!Number.isSafeInteger(issue) || issue <= 0 || out.has(issue)) continue;
    out.set(issue, ref);
  }
  return out;
}

export async function scheduleProject(
  deps: BuildDeps,
  run: SchedulingRun,
  row: ProjectRow,
  now: number,
): Promise<ScheduleSweepOutcome> {
  const repoRef = githubRepoOfProject(row);
  if (repoRef === null) return { kind: 'skipped', reason: 'repo-unbound' };
  const settings = autonomySettingsOf({ autonomy: row.autonomy as never });
  const previous = autonomyStateOf(deps.db, row.id, 'scheduling');
  const gate = evaluateAutonomyGates({
    now,
    settings,
    inFlight: 0,
    inFlightCap: 1,
    lastMemberWriteAt: lastMemberWriteAt(deps.db),
    lastStartedAt: previous?.lastStartedAt ?? null,
    spentTodayUsd: spentForGate(deps.db, row.id, settings, now),
  });
  recordAutonomyVerdict(deps.db, row.id, 'scheduling', gate, now);
  if (!gate.ok) return { kind: 'gated', reason: gate.reason };
  const got = await teamGithubToken(deps, row.teamId);
  if ('reason' in got) return { kind: 'skipped', reason: got.reason };
  const sha = await defaultBranchSha(run.githubFetch, got.token, repoRef.owner, repoRef.repo);
  if (sha === null) return { kind: 'skipped', reason: 'main-unreadable' };
  const listed = await openIssues(run.githubFetch, got.token, repoRef.owner, repoRef.repo);
  if ('skipped' in listed) return { kind: 'skipped', reason: listed.skipped };
  const issuesUnchanged = issuesMatchPersistedReport(listed, latestScheduleReport(deps.db, row.id));
  const dormancy = evaluateAutonomyGates({
    now,
    settings,
    dormancy: { baselineSha: previous?.baselineSha ?? null, currentSha: sha },
    inFlight: 0,
    inFlightCap: 1,
    lastMemberWriteAt: null,
    lastStartedAt: null,
    spentTodayUsd: 0,
  });
  if (issuesUnchanged && !dormancy.ok && dormancy.reason === 'dormant') {
    recordAutonomyVerdict(deps.db, row.id, 'scheduling', dormancy, now);
    return { kind: 'gated', reason: 'dormant' };
  }
  const pulls = await mergedPulls(run.githubFetch, got.token, repoRef.owner, repoRef.repo);
  if ('skipped' in pulls) return { kind: 'skipped', reason: pulls.skipped };
  const specLedger = await ledgerLines(
    run.githubFetch,
    got.token,
    repoRef.owner,
    repoRef.repo,
    sha,
  );
  recordAutonomyStart(deps.db, row.id, 'scheduling', now, sha);
  const report = scheduleReportSchema.parse({
    ...planSchedule(
      {
        generatedAt: now,
        mainSha: sha,
        issues: listed,
        mergedPulls: pulls,
        specLedger,
        inFlight: inFlightIssues(deps.db, row.id),
      },
      ISSUE_INTAKE_LABEL,
    ),
    id: newRecordId(),
    projectId: row.id,
  });
  insertScheduleReport(deps.db, report);
  return { kind: 'generated', report };
}

export function createScheduling(
  deps: BuildDeps,
  run: SchedulingRun,
): { sweep(now?: number): Promise<ScheduleSweepOutcome[]> } {
  let sweeping = false;
  return {
    sweep: async (now: number = nowMs()): Promise<ScheduleSweepOutcome[]> => {
      if (sweeping) return [];
      sweeping = true;
      const outcomes: ScheduleSweepOutcome[] = [];
      try {
        const rows = deps.db
          .select()
          .from(project)
          .where(and(eq(project.repoKind, 'github'), isNotNull(project.githubRepo)))
          .all();
        for (const row of rows) {
          const target = row as unknown as ProjectRow;
          try {
            const outcome = await scheduleProject(deps, run, target, now);
            outcomes.push(outcome);
            if (outcome.kind === 'generated') {
              run.logger?.info(
                { projectId: target.id, issues: outcome.report.items.length },
                'schedule report generated',
              );
            } else {
              run.logger?.info(
                { projectId: target.id, kind: outcome.kind, reason: outcome.reason },
                'schedule skipped',
              );
            }
          } catch (err) {
            outcomes.push({ kind: 'skipped', reason: 'error' });
            run.logger?.info({ projectId: target.id, err: String(err) }, 'schedule project failed');
          }
        }
      } finally {
        sweeping = false;
      }
      return outcomes;
    },
  };
}
