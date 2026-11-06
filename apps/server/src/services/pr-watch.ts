import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { build, gateVerdict, project, step, team, threadPr, todo } from '../db/schema.js';
import {
  type FetchLike,
  type GithubCheckRun,
  type GithubPullPanel,
  githubCommitCheckRuns,
  githubPullPanel,
} from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { BuildDeps } from './builds.js';
import { CI_CLOSED_CONFIRM_MS } from './ci-loop.js';
import { githubRepoOfProject } from './git.js';
import { githubTokenOrNull } from './github-connection.js';
import { type CheckTally, checkTallyOf, FINISHED_PR_STATES, mergeStateOf } from './thread-pr.js';

export const PR_WATCH_INTERVAL_MS = 60_000;

export const PR_WATCH_SLOW_INTERVAL_MS = 300_000;

export const PR_WATCH_STRETCH_BELOW = 0.2;

export const PR_WATCH_ARMED_ONLY_BELOW = 0.05;

const RATE_WINDOW_FALLBACK_MS = 3_600_000;

export type PrWatchPacing = 'normal' | 'stretched' | 'armed-only';

export interface PrWatchTally {
  pacing: PrWatchPacing;
  watched: number;
  read: number;
  notModified: number;
  created: number;
  updated: number;
  duplicates: number;
  unreadable: number;
  pruned: number;
}

export interface PrWatch {
  sweep(now?: number): Promise<PrWatchTally>;
}

interface RateWindow {
  remaining: number;
  limit: number;
  expiresAt: number;
}

interface Target {
  teamId: string;
  threadId: string;
  buildId: string;
  prNumber: number;
  owner: string;
  repo: string;
  fullName: string;
}

type PanelState = 'open' | 'draft' | 'merged' | 'closed';

function pacingOf(rate: RateWindow | undefined, now: number): PrWatchPacing {
  if (rate === undefined || rate.limit <= 0 || now >= rate.expiresAt) return 'normal';
  const ratio = rate.remaining / rate.limit;
  if (ratio < PR_WATCH_ARMED_ONLY_BELOW) return 'armed-only';
  if (ratio < PR_WATCH_STRETCH_BELOW) return 'stretched';
  return 'normal';
}

function headerNumber(headers: { get(name: string): string | null }, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function createPrWatch(
  deps: BuildDeps,
  run: { githubFetch: FetchLike; logger?: { info(obj: object, msg: string): void } },
): PrWatch {
  const pulls = new Map<string, { etag: string | null; pull: GithubPullPanel }>();
  const checks = new Map<string, { sha: string; etag: string | null; runs: GithubCheckRun[] }>();
  const rates = new Map<string, RateWindow>();
  const teamReadAt = new Map<string, number>();
  const closedSeenAt = new Map<string, number>();
  let sweeping = false;

  function observing(teamId: string, now: number): FetchLike {
    return async (input, init) => {
      const response = await run.githubFetch(input, init);
      const remaining = headerNumber(response.headers, 'x-ratelimit-remaining');
      const limit = headerNumber(response.headers, 'x-ratelimit-limit');
      if (remaining !== null && limit !== null) {
        const resetSeconds = headerNumber(response.headers, 'x-ratelimit-reset');
        rates.set(teamId, {
          remaining,
          limit,
          expiresAt: resetSeconds !== null ? resetSeconds * 1000 : now + RATE_WINDOW_FALLBACK_MS,
        });
      }
      return response;
    };
  }

  function targetsOf(teamId: string): Target[] {
    const found: Target[] = [];
    const candidates = deps.db
      .select({ build, todo, project })
      .from(build)
      .innerJoin(todo, eq(todo.id, build.todoId))
      .innerJoin(project, eq(project.id, todo.projectId))
      .where(
        and(
          eq(todo.teamId, teamId),
          eq(todo.latestBuildId, build.id),
          isNull(todo.archivedAt),
          isNotNull(build.prNumber),
        ),
      )
      .all();
    for (const candidate of candidates) {
      const ref = githubRepoOfProject(candidate.project);
      if (ref === null || candidate.build.prNumber === null) continue;
      found.push({
        teamId,
        threadId: candidate.todo.id,
        buildId: candidate.build.id,
        prNumber: candidate.build.prNumber,
        owner: ref.owner,
        repo: ref.repo,
        fullName: `${ref.owner}/${ref.repo}`.toLowerCase(),
      });
    }
    return found;
  }

  function pruneSuperseded(teamId: string): number {
    const stale = deps.db
      .select({ id: threadPr.id })
      .from(threadPr)
      .innerJoin(todo, eq(todo.id, threadPr.threadId))
      .innerJoin(build, eq(build.id, threadPr.buildId))
      .where(
        and(
          eq(threadPr.teamId, teamId),
          or(ne(todo.latestBuildId, threadPr.buildId), isNull(build.prNumber)),
        ),
      )
      .all();
    for (const row of stale) deps.db.delete(threadPr).where(eq(threadPr.id, row.id)).run();
    return stale.length;
  }

  function isAwake(buildId: string): boolean {
    return (
      deps.db
        .select({ id: step.id })
        .from(step)
        .where(and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed'])))
        .get() !== undefined
    );
  }

  function latestVerdict(buildId: string): { result: 'pass' | 'block'; head: string } | null {
    const row = deps.db
      .select()
      .from(gateVerdict)
      .where(and(eq(gateVerdict.buildId, buildId), eq(gateVerdict.kind, 'review')))
      .orderBy(desc(gateVerdict.createdAt))
      .get();
    if (row === undefined || (row.outcome !== 'pass' && row.outcome !== 'block')) return null;
    return { result: row.outcome, head: row.headSha ?? row.expectedHeadSha };
  }

  function stateOf(
    key: string,
    pull: GithubPullPanel,
    now: number,
    previous: PanelState | undefined,
  ): PanelState | null {
    if (pull.merged) return 'merged';
    if (pull.state === 'open') {
      closedSeenAt.delete(key);
      return pull.draft ? 'draft' : 'open';
    }
    const seen = closedSeenAt.get(key);
    if (seen === undefined) {
      closedSeenAt.set(key, now);
      return previous ?? null;
    }
    return now - seen >= CI_CLOSED_CONFIRM_MS ? 'closed' : (previous ?? null);
  }

  async function readChecks(
    fetchImpl: FetchLike,
    token: string,
    target: Target,
    key: string,
    head: string,
    tally: PrWatchTally,
  ): Promise<CheckTally | null> {
    const cached = checks.get(key);
    const etag = cached?.sha === head ? cached.etag : null;
    const page = await githubCommitCheckRuns(fetchImpl, token, target.owner, target.repo, head, {
      etag,
    });
    if (page === null) return null;
    if (page.notModified && cached?.sha === head) {
      tally.notModified += 1;
      return checkTallyOf(cached.runs);
    }
    checks.set(key, { sha: head, etag: page.etag, runs: page.checkRuns });
    return checkTallyOf(page.checkRuns);
  }

  async function watchOne(
    fetchImpl: FetchLike,
    token: string,
    target: Target,
    now: number,
    tally: PrWatchTally,
  ): Promise<void> {
    const key = `${target.teamId}:${target.fullName}#${target.prNumber}`;
    const existing = deps.db
      .select()
      .from(threadPr)
      .where(eq(threadPr.buildId, target.buildId))
      .get();
    if (
      existing !== undefined &&
      existing.number === target.prNumber &&
      existing.repo === target.fullName &&
      FINISHED_PR_STATES.includes(existing.state)
    ) {
      return;
    }
    const owner = deps.db
      .select({ buildId: threadPr.buildId })
      .from(threadPr)
      .where(
        and(
          eq(threadPr.teamId, target.teamId),
          eq(threadPr.repo, target.fullName),
          eq(threadPr.number, target.prNumber),
        ),
      )
      .get();
    if (owner !== undefined && owner.buildId !== target.buildId) {
      tally.duplicates += 1;
      return;
    }
    tally.watched += 1;
    const cachedPull = pulls.get(key);
    const page = await githubPullPanel(
      fetchImpl,
      token,
      target.owner,
      target.repo,
      target.prNumber,
      { etag: cachedPull?.etag ?? null },
    );
    if (page === null) {
      tally.unreadable += 1;
      return;
    }
    let pull = page.pull;
    if (page.notModified) {
      tally.notModified += 1;
      pull = cachedPull?.pull ?? null;
    } else if (pull !== null) {
      pulls.set(key, { etag: page.etag, pull });
    }
    if (pull === null) {
      tally.unreadable += 1;
      return;
    }
    tally.read += 1;
    const state = stateOf(key, pull, now, existing?.state);
    if (state === null) return;
    const finished = FINISHED_PR_STATES.includes(state);
    const head = pull.headSha ?? '';
    let counted: CheckTally | null = null;
    if (!finished && head !== '') {
      counted = await readChecks(fetchImpl, token, target, key, head, tally);
      if (counted === null) tally.unreadable += 1;
    }
    const readComplete = finished || head === '' || counted !== null;
    const sameLine = existing !== undefined && existing.head === head;
    const keep: CheckTally = {
      passed: existing?.checksPassed ?? 0,
      failed: existing?.checksFailed ?? 0,
      running: existing?.checksRunning ?? 0,
      total: existing?.checksTotal ?? 0,
      failedNames:
        existing !== undefined ? (JSON.parse(existing.checksFailedNames) as string[]) : [],
    };
    const checksNow =
      counted ??
      (sameLine || finished
        ? keep
        : { passed: 0, failed: 0, running: 0, total: 0, failedNames: [] });
    const mergeState = finished
      ? (existing?.mergeState ?? 'unknown')
      : mergeStateOf(pull.mergeableState);
    const progressed =
      existing === undefined ||
      existing.head !== head ||
      existing.checksPassed !== checksNow.passed ||
      existing.checksFailed !== checksNow.failed ||
      existing.checksRunning !== checksNow.running;
    const blockedSince =
      !finished && mergeState === 'blocked'
        ? existing?.blockedSince != null && !progressed
          ? existing.blockedSince
          : now
        : null;
    const verdict = latestVerdict(target.buildId);
    const values = {
      repo: target.fullName,
      number: target.prNumber,
      title: pull.title,
      url:
        pull.htmlUrl ?? `https://github.com/${target.owner}/${target.repo}/pull/${target.prNumber}`,
      state,
      mergeState,
      additions: pull.additions,
      deletions: pull.deletions,
      checksPassed: checksNow.passed,
      checksFailed: checksNow.failed,
      checksRunning: checksNow.running,
      checksTotal: checksNow.total,
      checksFailedNames: JSON.stringify(checksNow.failedNames),
      head,
      checksReadFor:
        counted !== null ? head : sameLine || finished ? (existing?.checksReadFor ?? '') : '',
      headRef: pull.headRef,
      baseRef: pull.baseRef,
      verdictResult: verdict?.result ?? null,
      verdictHead: verdict?.head ?? null,
      blockedSince,
    };
    if (existing === undefined) {
      deps.db
        .insert(threadPr)
        .values({
          id: newRecordId(),
          teamId: target.teamId,
          threadId: target.threadId,
          buildId: target.buildId,
          ...values,
          lastReadAt: readComplete ? now : 0,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
      tally.created += 1;
      return;
    }
    const changed = (Object.keys(values) as (keyof typeof values)[]).some(
      (field) => existing[field] !== values[field],
    );
    if (!changed) {
      if (readComplete) {
        deps.db.update(threadPr).set({ lastReadAt: now }).where(eq(threadPr.id, existing.id)).run();
      }
      return;
    }
    deps.db
      .update(threadPr)
      .set({ ...values, ...(readComplete ? { lastReadAt: now } : {}), updatedAt: now })
      .where(eq(threadPr.id, existing.id))
      .run();
    tally.updated += 1;
  }

  return {
    async sweep(now = nowMs()): Promise<PrWatchTally> {
      const tally: PrWatchTally = {
        pacing: 'normal',
        watched: 0,
        read: 0,
        notModified: 0,
        created: 0,
        updated: 0,
        duplicates: 0,
        unreadable: 0,
        pruned: 0,
      };
      if (sweeping) return tally;
      sweeping = true;
      try {
        for (const { id: teamId } of deps.db.select({ id: team.id }).from(team).all()) {
          try {
            tally.pruned += pruneSuperseded(teamId);
            const token = await githubTokenOrNull(deps, teamId);
            if (token === null) continue;
            const pacing = pacingOf(rates.get(teamId), now);
            tally.pacing = pacing;
            const last = teamReadAt.get(teamId);
            if (
              pacing !== 'normal' &&
              last !== undefined &&
              now - last < PR_WATCH_SLOW_INTERVAL_MS
            ) {
              continue;
            }
            teamReadAt.set(teamId, now);
            const fetchImpl = observing(teamId, now);
            let targets = targetsOf(teamId);
            if (pacing === 'armed-only') {
              targets = targets.filter((target) => {
                const armed = deps.db
                  .select({ id: threadPr.id })
                  .from(threadPr)
                  .where(
                    and(eq(threadPr.buildId, target.buildId), eq(threadPr.mergeWhenReady, true)),
                  )
                  .get();
                return armed !== undefined || isAwake(target.buildId);
              });
            }
            for (const target of targets) {
              try {
                await watchOne(fetchImpl, token, target, now, tally);
              } catch (error) {
                tally.unreadable += 1;
                run.logger?.info(
                  {
                    buildId: target.buildId,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  'PR watch deferred',
                );
              }
            }
          } catch (error) {
            run.logger?.info(
              { teamId, error: error instanceof Error ? error.message : String(error) },
              'PR watch team deferred',
            );
          }
        }
      } finally {
        sweeping = false;
      }
      return tally;
    },
  };
}
