import { conversationBranch } from '@cairn/shared';
import { and, desc, eq, isNotNull, like, ne } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, step, todo } from '../db/schema.js';
import {
  type FetchLike,
  type GithubBranchPull,
  type GithubCheckRun,
  type GithubPull,
  githubBranchPulls,
  githubCommitCheckRuns,
  githubCompareStatus,
  githubPull,
  githubRequiredChecks,
  hasPullFields,
  isFullSha,
  isOwnOpenDefaultPull,
  isOwnPull,
  WRITE_AUTHOR_ASSOCIATIONS,
} from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { emitRuntimeBuildSpan } from '../runtime-otel.js';
import {
  type BuildDeps,
  enqueueStep,
  finishTodoDone,
  hasActiveStep,
  hasMessageRow,
  lastPushedCheckpoint,
  maybeEnqueueIndependentReview,
  maybeEnqueueVerifyStep,
  roundStart,
  stopUnclaimedGateSteps,
  toBuildRecord,
} from './builds.js';
import { CI_FIX_GREEN_EVENT, drainCiCorrections } from './ci-corrections.js';
import { DONE_ROW, prClosedUnmergedRow } from './delivery-rows.js';
import { githubRepoOfProject, projectOfTodo } from './git.js';
import { githubTokenOrNull } from './github-connection.js';
import { githubText } from './github-text.js';
import { evaluateProductGate as evaluateMergeGate } from './machine-gate-port.js';
import { CI_FIX_FAILURES_HEAD, CI_FIX_PROMPT_HEAD, CI_FIX_PUSH_RULE } from './retry-lessons.js';
import { setTodoPhase } from './todos.js';
import { insertMessageRow } from './transcript.js';

export const CI_POLL_INTERVAL_MS = 60_000;

export const CI_FIX_ROUNDS_MAX = 3;

export const CI_EMPTY_CHECKS_GRACE_MS = 300_000;

export const CI_ANON_READ_INTERVAL_MS = 300_000;

export const CI_MISSING_COMPARE_RECHECK_MS = 600_000;

export const CI_ANON_READS_PER_HOUR = 20;

export const CI_ANON_IP_READS_PER_HOUR = 50;

export const CI_FOREIGN_RELIST_MS = 600_000;

export const CI_FOREIGN_RELIST_ANON_MS = 3_600_000;

export const CI_CLOSED_CONFIRM_MS = 50_000;

export { CI_FIX_PROMPT_HEAD };

export const CI_MERGE_CONFLICT_PROMPT_HEAD = '[merge-conflict]';

export const CI_MERGE_CONFLICT_ROUNDS_MAX = 2;

export const CI_REQUIRED_CHECKS_TTL_MS = 600_000;

const CI_FIX_SUMMARY_MAX = 800;

export interface CiPollLogger {
  info(obj: object, msg: string): void;
}

export interface CiPoller {
  sweep(now?: number): Promise<void>;
}

export interface CiCheckFailure {
  name: string;
  conclusion: string;
  summary: string | null;
}

export type CheckVerdict =
  | { state: 'green' }
  | { state: 'pending'; missing?: string[] }
  | { state: 'empty' }
  | { state: 'red'; failures: CiCheckFailure[] }
  | { state: 'blocked'; checks: { name: string; conclusion: string }[] };

const FIXABLE = new Set(['failure', 'timed_out']);
const BLOCKING_UNREQUIRED = new Set(['cancelled', 'action_required']);

export function verdictOfCheckRuns(runs: GithubCheckRun[], required: string[] = []): CheckVerdict {
  const counted = required.length > 0 ? runs.filter((r) => required.includes(r.name)) : runs;
  if (required.length === 0 && counted.length === 0) return { state: 'empty' };
  if (counted.some((r) => r.status !== 'completed')) return { state: 'pending' };
  const passed = new Set(counted.filter((r) => r.conclusion === 'success').map((r) => r.name));
  const failures = counted
    .filter((r) => !passed.has(r.name) && FIXABLE.has(r.conclusion ?? ''))
    .map((r) => ({
      name: r.name,
      conclusion: r.conclusion ?? '',
      summary: r.outputSummary ?? r.outputTitle,
    }));
  if (failures.length > 0) return { state: 'red', failures };
  const missing = required.filter((name) => !counted.some((r) => r.name === name));
  if (missing.length > 0) return { state: 'pending', missing };
  const blocked = new Map<string, Set<string>>();
  for (const r of counted) {
    if (passed.has(r.name)) continue;
    if (required.length === 0 && !BLOCKING_UNREQUIRED.has(r.conclusion ?? '')) continue;
    blocked.set(r.name, (blocked.get(r.name) ?? new Set()).add(r.conclusion ?? ''));
  }
  if (blocked.size > 0) {
    return {
      state: 'blocked',
      checks: [...blocked].map(([name, c]) => ({ name, conclusion: [...c].join('/') })),
    };
  }
  return { state: 'green' };
}

export const CI_MERGE_CONFLICT_VERIFY_NOTE =
  '解冲突轮会把默认分支合进来、改动交付：之前的验证是冲突前的提交（还没人领的已停掉），检查通过、回到审核关口时重排一条验证步。';

export const CI_MERGE_CONFLICT_REVIEW_NOTE =
  '解冲突轮停掉了还没人领的 AI 审核步（它审的是冲突前的提交）；回到审核关口后如需审核，请重新发起。';

export function buildMergeConflictPrompt(args: {
  prNumber: number;
  prUrl: string | null;
  defaultBranch: string;
  round: number;
}): string {
  const quote = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
  return [
    `${CI_MERGE_CONFLICT_PROMPT_HEAD} 解冲突轮（第 ${args.round} 轮）：PR #${args.prNumber}${args.prUrl ? `（${args.prUrl}）` : ''} 与默认分支「${githubText(args.defaultBranch)}」冲突，GitHub 合并不了。`,
    '',
    `请在本分支上执行 git fetch origin ${quote(args.defaultBranch)}，再 git merge ${quote(`origin/${args.defaultBranch}`)}，解决冲突后提交，并推送到同一分支。`,
    '不要 rebase、不要 force-push、不要新开分支或 PR；推送后 CI 会重跑，系统会继续轮询。',
  ].join('\n');
}

export function buildCiFixPrompt(args: {
  prNumber: number;
  prUrl: string | null;
  round: number;
  failures: CiCheckFailure[];
}): string {
  const failures = args.failures
    .map((f) => {
      const summary = f.summary !== null ? `：${f.summary.slice(0, CI_FIX_SUMMARY_MAX)}` : '';
      return `- ${f.name}（${f.conclusion}）${summary}`;
    })
    .join('\n');
  return [
    `${CI_FIX_PROMPT_HEAD} CI 修复轮（第 ${args.round} 轮）：PR #${args.prNumber}${args.prUrl ? `（${args.prUrl}）` : ''} 的 CI 检查未通过。`,
    '',
    CI_FIX_FAILURES_HEAD,
    failures,
    '',
    CI_FIX_PUSH_RULE,
  ].join('\n');
}

export function countMarkedRounds(db: Db, buildId: string, head: string): number {
  return db
    .select({ id: step.id })
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.kind, 'build'), like(step.prompt, `${head}%`)))
    .all().length;
}

export function deadLoopMessage(rounds: number): string {
  return `CI 检查连续 ${rounds} 轮自动修复仍未通过（死循环闸：连续 ${CI_FIX_ROUNDS_MAX} 轮）——停止追加修复步，转人工处理。`;
}

interface PrChecksCacheEntry {
  sha: string;
  etag: string | null;
  runs: GithubCheckRun[];
  waitSince: number | null;
}

interface CiPollTally {
  candidates: number;
  pending: number;
  appended: number;
  advanced: number;
  failed: number;
  skipped: number;
  unreadable: number;
  errors: number;
  reviewCandidates: number;
  reviewPending: number;
  reviewSkipped: number;
  reviewUnreadable: number;
  reviewForeign: number;
  merged: number;
  closedUnmerged: number;
  hinted: number;
  settledBefore: number;
  adopted: number;
}

interface PullCacheEntry {
  etag: string | null;
  pull: GithubPull | null;
}

export function createCiPoller(
  deps: BuildDeps,
  run: {
    githubFetch: FetchLike;
    logger?: CiPollLogger;
    anonReadsPerHour?: number;
    anonIpReadsPerHour?: number;
  },
): CiPoller {
  const cache = new Map<string, PrChecksCacheEntry>();
  const pullCache = new Map<string, PullCacheEntry>();
  const grindPullCache = new Map<string, PullCacheEntry>();
  const requiredCache = new Map<string, { at: number; names: string[] | null }>();
  const anonReadAt = new Map<string, number>();
  const compareCache = new Map<
    string,
    Map<string, { status: string; at: number; failures: number }>
  >();
  const foreignListedAt = new Map<string, number>();
  const listFailures = new Map<string, number>();
  const lastReadByBuild = new Map<string, number>();
  const closedSeenAt = new Map<string, number>();
  function forgetClose(key: string): void {
    closedSeenAt.delete(key);
    listFailures.delete(key);
  }
  const knownRows = new Set<string>();
  const liveKeys = new Set<string>();
  const grindKeys = new Set<string>();
  let sweeping = false;
  let sweepStartedAt = 0;
  const anonOwn: number[] = [];
  const anonAll: number[] = [];

  function anonFree(now: number): number {
    for (const list of [anonOwn, anonAll]) {
      while (list.length > 0 && (list[0] ?? now) <= now - 3_600_000) list.shift();
    }
    return Math.min(
      (run.anonReadsPerHour ?? CI_ANON_READS_PER_HOUR) - anonOwn.length,
      (run.anonIpReadsPerHour ?? CI_ANON_IP_READS_PER_HOUR) - anonAll.length,
    );
  }

  function recordGrindAnonRead(now: number, count = 1): void {
    anonFree(now);
    for (let i = 0; i < count; i += 1) anonAll.push(now);
  }

  function takeAnonRead(now: number, need = 1): boolean {
    if (anonFree(now) < need) return false;
    anonOwn.push(now);
    anonAll.push(now);
    return true;
  }

  function rowKnown(buildId: string, content: string, since: number): boolean {
    const memo = `${buildId}\u0000${since}\u0000${content}`;
    if (knownRows.has(memo)) return true;
    if (!hasMessageRow(deps, buildId, 'system', content, since)) return false;
    knownRows.add(memo);
    return true;
  }

  function stillOurs(cand: { buildId: string; todoId: string }, since: number): boolean {
    return (
      freshReviewRow(cand.todoId, cand.buildId) !== null &&
      !hasActiveStep(deps, cand.buildId) &&
      !rowKnown(cand.buildId, DONE_ROW, since)
    );
  }

  function failWithMessage(
    cand: { buildId: string; todoId: string },
    teamId: string,
    text: string,
  ) {
    deps.db.update(build).set({ errorMessage: text }).where(eq(build.id, cand.buildId)).run();
    const row = deps.db.select().from(build).where(eq(build.id, cand.buildId)).get();
    if (row) deps.hub.publishBuildDoc(teamId, toBuildRecord(row));
    setTodoPhase(deps, cand.todoId, 'failed');
    emitRuntimeBuildSpan(deps.db, cand.buildId, 'failed');
  }

  function writeSystemRow(buildId: string, content: string): void {
    insertMessageRow(deps, buildId, {
      id: newRecordId(),
      role: 'system',
      content,
      createdAt: nowMs(),
    });
  }

  function mergeConflictRound(
    cand: { buildId: string; todoId: string },
    teamId: string,
    pr: { prNumber: number; prUrl: string | null },
    defaultBranch: string,
    fromReview: boolean,
  ): 'appended' | 'failed' | 'hinted' {
    const rounds = countMarkedRounds(deps.db, cand.buildId, CI_MERGE_CONFLICT_PROMPT_HEAD);
    if (rounds >= CI_MERGE_CONFLICT_ROUNDS_MAX) {
      const text = `PR #${pr.prNumber} 与默认分支「${githubText(defaultBranch)}」冲突，已自动解冲突 ${rounds} 轮仍冲突：不再派解冲突步，由人处理（在 GitHub 上解决冲突，或打回重做）。`;
      if (!fromReview) {
        failWithMessage(cand, teamId, text);
        return 'failed';
      }
      hintOnce(cand.buildId, text, roundStart(deps, cand.buildId));
      return 'hinted';
    }
    const reverify =
      deps.db
        .select({ id: step.id })
        .from(step)
        .where(and(eq(step.buildId, cand.buildId), eq(step.kind, 'verify')))
        .get() !== undefined;
    const stopsReview = stopUnclaimedGateSteps(deps, cand.buildId).includes('review');
    if (fromReview) setTodoPhase(deps, cand.todoId, 'queued');
    enqueueStep(
      deps,
      cand.buildId,
      'build',
      teamId,
      buildMergeConflictPrompt({ ...pr, defaultBranch, round: rounds + 1 }),
    );
    if (reverify) writeSystemRow(cand.buildId, CI_MERGE_CONFLICT_VERIFY_NOTE);
    if (stopsReview) writeSystemRow(cand.buildId, CI_MERGE_CONFLICT_REVIEW_NOTE);
    return 'appended';
  }

  function pushNotSeen(buildId: string, headSha: string | null, now: number): boolean {
    const last = deps.db
      .select({ sha: step.checkpointCommit, at: step.finishedAt })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          eq(step.status, 'done'),
          ne(step.kind, 'review'),
          isNotNull(step.checkpointCommit),
          isNotNull(step.finishedAt),
        ),
      )
      .orderBy(desc(step.finishedAt))
      .get();
    return (
      last?.sha != null &&
      last.at != null &&
      last.sha !== headSha &&
      now - last.at < CI_EMPTY_CHECKS_GRACE_MS
    );
  }

  function hintOnce(buildId: string, content: string, since: number): void {
    if (rowKnown(buildId, content, since)) return;
    writeSystemRow(buildId, content);
  }

  async function ownBranchPull(
    branch: string,
    target: { owner: string; repo: string },
    token: string | null,
    recorded: { number: number; baseRepoId: number; defaultBranch: string; owner: string },
    mergedAfter: number,
    now: number,
  ): Promise<GithubBranchPull | null | 'unreadable' | 'skipped'> {
    if (token === null && !takeAnonRead(now)) return 'skipped';
    const list = await githubBranchPulls(run.githubFetch, token, target.owner, target.repo, {
      head: `${recorded.owner}:${branch}`,
      base: recorded.defaultBranch,
    });
    if (list === null) return 'unreadable';
    const own = list.filter(
      (p) =>
        p.headRepoId === recorded.baseRepoId &&
        p.baseRepoId === recorded.baseRepoId &&
        p.headRef === branch &&
        p.baseRef === recorded.defaultBranch,
    );
    const changed = own.find(
      (p) => p.number === recorded.number && (p.state === 'open' || p.merged),
    );
    if (changed !== undefined) return changed;
    const adoptable = own.filter((p) => WRITE_AUTHOR_ASSOCIATIONS.has(p.authorAssociation ?? ''));
    const open = adoptable.filter((p) => p.state === 'open');
    const rejected = own.reduce(
      (n, p) => (p.state === 'closed' && !p.merged && p.number > n ? p.number : n),
      mergedAfter,
    );
    const pool = open.length > 0 ? open : adoptable.filter((p) => p.merged && p.number > rejected);
    return pool.reduce<GithubBranchPull | null>(
      (best, p) => (best === null || p.number > best.number ? p : best),
      null,
    );
  }

  function adoptPull(
    buildId: string,
    teamId: string,
    fullName: string,
    from: number,
    to: GithubBranchPull,
    reason: string,
    since: number,
  ): boolean {
    const changed = deps.db
      .update(build)
      .set({ prNumber: to.number, prUrl: `https://github.com/${fullName}/pull/${to.number}` })
      .where(and(eq(build.id, buildId), eq(build.prNumber, from)))
      .run().changes;
    if (changed === 0) return false;
    const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
    if (row) deps.hub.publishBuildDoc(teamId, toBuildRecord(row));
    hintOnce(
      buildId,
      `PR #${from} ${reason}；本任务工作分支「${conversationBranch(buildId)}」上${to.state === 'open' ? '开着' : '已合并'}的 PR #${to.number} 改记为本任务的 PR，对账接着读它。`,
      since,
    );
    return true;
  }

  function freshGrindRow(todoId: string) {
    const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
    return row !== undefined && row.phase === 'building' ? row : null;
  }

  function freshReviewRow(todoId: string, buildId: string) {
    const row = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
    return row !== undefined && row.phase === 'review' && row.latestBuildId === buildId
      ? row
      : null;
  }

  function githubTarget(todoRow: { projectId: string; teamId: string }) {
    const projRow = projectOfTodo(deps.db, todoRow);
    const ref = githubRepoOfProject(projRow);
    if (projRow === undefined || ref === null) return null;
    return {
      teamId: projRow.teamId,
      fullName: `${ref.owner}/${ref.repo}`,
      owner: ref.owner,
      repo: ref.repo,
    };
  }

  async function reconcileOne(
    cand: { buildId: string; todoId: string },
    now: number,
    tally: CiPollTally,
  ): Promise<void> {
    const todoRow = freshReviewRow(cand.todoId, cand.buildId);
    const buildRow = deps.db
      .select({ prNumber: build.prNumber, prUrl: build.prUrl })
      .from(build)
      .where(eq(build.id, cand.buildId))
      .get();
    const target = todoRow === null ? null : githubTarget(todoRow);
    if (
      todoRow === null ||
      buildRow === undefined ||
      buildRow.prNumber === null ||
      target === null
    ) {
      tally.reviewSkipped += 1;
      return;
    }
    const prNumber = buildRow.prNumber;
    const key = `${target.fullName}#${prNumber}`;
    liveKeys.add(key);
    if (hasActiveStep(deps, cand.buildId)) {
      forgetClose(key);
      tally.reviewSkipped += 1;
      return;
    }
    const token = await githubTokenOrNull(deps, target.teamId);
    const entry = pullCache.get(key) ?? null;
    let pull: GithubPull | null;
    let readAt = now;
    if (entry?.pull?.merged === true) {
      pull = entry.pull;
    } else {
      if (token === null) {
        const last = anonReadAt.get(key);
        if (
          (last !== undefined && now - last < CI_ANON_READ_INTERVAL_MS) ||
          !takeAnonRead(now, 2)
        ) {
          tally.reviewSkipped += 1;
          return;
        }
        anonReadAt.set(key, now);
      }
      lastReadByBuild.set(cand.buildId, now);
      const page = await githubPull(run.githubFetch, token, target.owner, target.repo, prNumber, {
        etag: entry?.etag ?? null,
      });
      readAt = now + (nowMs() - sweepStartedAt);
      if (page === null) {
        forgetClose(key);
        tally.reviewUnreadable += 1;
        return;
      }
      pull = page.notModified ? (entry?.pull ?? null) : page.pull;
      pullCache.set(key, { etag: page.etag, pull });
    }
    const branch = conversationBranch(cand.buildId);
    const foreign = pull !== null && hasPullFields(pull) && !isOwnPull(pull, branch);
    if (pull === null || (pull.state === 'open' && !foreign)) {
      forgetClose(key);
      const state = pull?.mergeableState ?? null;
      if (
        pull !== null &&
        isOwnOpenDefaultPull(pull, branch) &&
        (state === 'dirty' || state === 'behind') &&
        !pushNotSeen(cand.buildId, pull.headSha, now) &&
        freshReviewRow(cand.todoId, cand.buildId) !== null &&
        !hasActiveStep(deps, cand.buildId)
      ) {
        if (state === 'dirty') {
          const done = mergeConflictRound(
            cand,
            todoRow.teamId,
            { prNumber, prUrl: buildRow.prUrl },
            pull.defaultBranch,
            true,
          );
          if (done === 'appended') {
            tally.reviewPending += 1;
            return;
          }
        } else {
          hintOnce(
            cand.buildId,
            `PR #${prNumber} 落后于默认分支「${githubText(pull.defaultBranch)}」。cairn 不替人更新分支，合并由人做：在 GitHub 上点 Update branch（即 PUT pulls/${prNumber}/update-branch，带 expected_head_sha 为当前 head），CI 重跑后再合并。`,
            roundStart(deps, cand.buildId),
          );
        }
        tally.hinted += 1;
        return;
      }
      tally.reviewPending += 1;
      return;
    }
    if (freshReviewRow(cand.todoId, cand.buildId) === null || hasActiveStep(deps, cand.buildId)) {
      forgetClose(key);
      tally.reviewSkipped += 1;
      return;
    }
    const closedText = prClosedUnmergedRow(prNumber);
    const since = roundStart(deps, cand.buildId);
    if (!hasPullFields(pull)) {
      pullCache.delete(key);
      forgetClose(key);
      tally.reviewUnreadable += 1;
      return;
    }
    const recorded = {
      number: prNumber,
      baseRepoId: pull.baseRepoId,
      defaultBranch: pull.defaultBranch,
      owner: pull.baseOwner ?? target.owner,
    };
    if (foreign) {
      const foreignText = `PR #${prNumber} 的 head 不是本任务在 ${target.fullName} 的工作分支「${branch}」，可能是别人 fork 里同名分支开的 PR。对账不据它收尾或打回；任务留在审核关口，由人核对这张 PR。`;
      const listKey = `${cand.buildId}\u0000${key}`;
      const listedAt = foreignListedAt.get(listKey);
      const relistMs = token === null ? CI_FOREIGN_RELIST_ANON_MS : CI_FOREIGN_RELIST_MS;
      if (listedAt === undefined || now - listedAt >= relistMs) {
        const own = await ownBranchPull(branch, target, token, recorded, 0, now);
        if (own !== 'skipped') foreignListedAt.set(listKey, now);
        if (
          freshReviewRow(cand.todoId, cand.buildId) === null ||
          hasActiveStep(deps, cand.buildId)
        ) {
          tally.reviewSkipped += 1;
          return;
        }
        if (own !== null && own !== 'unreadable' && own !== 'skipped') {
          const adopted = adoptPull(
            cand.buildId,
            todoRow.teamId,
            target.fullName,
            prNumber,
            own,
            '的 head 不是本任务的工作分支',
            since,
          );
          if (adopted) tally.adopted += 1;
          else tally.reviewSkipped += 1;
          return;
        }
      }
      hintOnce(cand.buildId, foreignText, since);
      tally.reviewForeign += 1;
      return;
    }
    if (rowKnown(cand.buildId, pull.merged ? DONE_ROW : closedText, since)) {
      tally.settledBefore += 1;
      return;
    }
    if (pull.merged) {
      if (pull.baseRef !== pull.defaultBranch) {
        hintOnce(
          cand.buildId,
          `PR #${prNumber} 合并进了分支「${githubText(pull.baseRef)}」，不是默认分支「${githubText(pull.defaultBranch)}」，改动还没进默认分支。任务留在审核关口，由人决定下一步。`,
          since,
        );
        tally.hinted += 1;
        return;
      }
      const checkpoint = lastPushedCheckpoint(deps, cand.buildId, { mergeSteps: false });
      if (checkpoint !== null && pull.headSha === null) {
        pullCache.delete(key);
        tally.reviewUnreadable += 1;
        return;
      }
      if (checkpoint !== null && pull.headSha !== null && checkpoint !== pull.headSha) {
        const pairs = compareCache.get(key) ?? new Map();
        compareCache.set(key, pairs);
        const cmpKey = `${checkpoint}...${pull.headSha}`;
        const cached = pairs.get(cmpKey);
        let status =
          cached === undefined ||
          ((cached.status === 'missing' || cached.status === 'unreadable') &&
            now - cached.at >= CI_MISSING_COMPARE_RECHECK_MS)
            ? null
            : cached.status;
        if (status === null) {
          const sendsRequest = isFullSha(checkpoint) && isFullSha(pull.headSha);
          if (token === null && sendsRequest && !takeAnonRead(now)) {
            tally.reviewSkipped += 1;
            return;
          }
          status =
            (await githubCompareStatus(
              run.githubFetch,
              token,
              target.owner,
              target.repo,
              checkpoint,
              pull.headSha,
            )) ?? 'unreadable';
          const failures = status === 'unreadable' ? (cached?.failures ?? 0) + 1 : 0;
          pairs.set(cmpKey, { status, at: now, failures });
        }
        if (status === 'unreadable') {
          if ((pairs.get(cmpKey)?.failures ?? 0) >= 2 && stillOurs(cand, since)) {
            hintOnce(
              cand.buildId,
              `PR #${prNumber} 已在 GitHub 合并，但暂时读不到 compare（GitHub 出错、超时或限流），无法确认分支提交 ${checkpoint.slice(0, 7)} 在这次合并里；稍后重试。`,
              since,
            );
          }
          tally.reviewUnreadable += 1;
          return;
        }
        if (!stillOurs(cand, since)) {
          tally.reviewSkipped += 1;
          return;
        }
        if (status !== 'ahead' && status !== 'identical') {
          const head = pull.headSha.slice(0, 7);
          const cp = checkpoint.slice(0, 7);
          hintOnce(
            cand.buildId,
            status === 'missing'
              ? `PR #${prNumber} 已在 GitHub 合并（合并时 head ${head}），但 GitHub 上找不到分支提交 ${cp}（可能从没推送过），无法确认它在这次合并里。任务留在审核关口。`
              : status === 'invalid'
                ? `PR #${prNumber} 已在 GitHub 合并，但机器回报的分支提交不是有效的提交 SHA，无法核对它是否在这次合并里。任务留在审核关口。`
                : `PR #${prNumber} 已在 GitHub 合并（合并时 head ${head}），但分支提交 ${cp} 不是那个 head 的祖先：合并之后又推了提交，或分支被改写过。这部分改动可能还没进默认分支；任务留在审核关口，由人把这个提交另行合入默认分支。`,
            since,
          );
          tally.hinted += 1;
          return;
        }
      }
      const detail = [
        pull.mergeCommitSha === null
          ? null
          : `合并提交 ${githubText(pull.mergeCommitSha).slice(0, 7)}`,
        pull.mergedBy === null ? null : `由 ${githubText(pull.mergedBy)} 合并`,
      ].filter((x) => x !== null);
      writeSystemRow(
        cand.buildId,
        `PR #${prNumber} 已在 GitHub 合并${detail.length > 0 ? `（${detail.join('，')}）` : ''}`,
      );
      finishTodoDone(deps, cand.todoId, cand.buildId);
      tally.merged += 1;
      return;
    }
    const seen = closedSeenAt.get(key);
    if (seen === undefined || readAt - seen < CI_CLOSED_CONFIRM_MS) {
      if (seen === undefined) closedSeenAt.set(key, readAt);
      tally.reviewPending += 1;
      return;
    }
    if (pull.baseRef !== pull.defaultBranch) {
      hintOnce(
        cand.buildId,
        `PR #${prNumber} 的目标分支是「${githubText(pull.baseRef)}」，不是默认分支「${githubText(pull.defaultBranch)}」；它在 GitHub 关闭且未合并，可能是从工作分支往别的分支开的另一张 PR。对账不据它打回；任务留在审核关口，由人核对这张 PR。`,
        since,
      );
      tally.hinted += 1;
      return;
    }
    const sibling = await ownBranchPull(branch, target, token, recorded, prNumber, now);
    if (sibling === 'unreadable') {
      const failures = (listFailures.get(key) ?? 0) + 1;
      if (failures < 2) {
        listFailures.set(key, failures);
        tally.reviewUnreadable += 1;
        return;
      }
    }
    if (sibling === 'skipped') {
      tally.reviewSkipped += 1;
      return;
    }
    const found = sibling === 'unreadable' ? null : sibling;
    forgetClose(key);
    if (freshReviewRow(cand.todoId, cand.buildId) === null || hasActiveStep(deps, cand.buildId)) {
      tally.reviewSkipped += 1;
      return;
    }
    if (found?.number === prNumber) {
      tally.reviewPending += 1;
      return;
    }
    if (found !== null) {
      const adopted = adoptPull(
        cand.buildId,
        todoRow.teamId,
        target.fullName,
        prNumber,
        found,
        '在 GitHub 关闭且未合并',
        since,
      );
      if (adopted) tally.adopted += 1;
      else tally.reviewSkipped += 1;
      return;
    }
    writeSystemRow(cand.buildId, closedText);
    stopUnclaimedGateSteps(deps, cand.buildId);
    failWithMessage(cand, todoRow.teamId, closedText);
    tally.closedUnmerged += 1;
  }

  async function pollOne(
    cand: { buildId: string; todoId: string },
    now: number,
    tally: CiPollTally,
  ): Promise<void> {
    const todoRow = freshGrindRow(cand.todoId);
    if (todoRow === null) {
      tally.skipped += 1;
      return;
    }
    const buildRow = deps.db
      .select({ prNumber: build.prNumber, prUrl: build.prUrl })
      .from(build)
      .where(eq(build.id, cand.buildId))
      .get();
    const target = githubTarget(todoRow);
    if (buildRow === undefined || buildRow.prNumber === null || target === null) {
      tally.skipped += 1;
      return;
    }
    const key = `${target.fullName}#${buildRow.prNumber}`;
    grindKeys.add(key);
    if (hasActiveStep(deps, cand.buildId)) {
      tally.skipped += 1;
      return;
    }
    const grindToken = await githubTokenOrNull(deps, target.teamId);
    if (grindToken === null) recordGrindAnonRead(now);
    const pullEntry = grindPullCache.get(key) ?? null;
    const pullPage = await githubPull(
      run.githubFetch,
      grindToken,
      target.owner,
      target.repo,
      buildRow.prNumber,
      { etag: pullEntry?.etag ?? null },
    );
    const pull =
      pullPage === null ? null : pullPage.notModified ? (pullEntry?.pull ?? null) : pullPage.pull;
    if (pullPage === null || pull === null || pull.defaultBranch === null) {
      grindPullCache.delete(key);
      tally.unreadable += 1;
      return;
    }
    grindPullCache.set(key, { etag: pullPage.etag, pull });
    const branch = conversationBranch(cand.buildId);
    const own = isOwnOpenDefaultPull(pull, branch);
    if (own && pull.headSha === null) {
      tally.unreadable += 1;
      return;
    }
    if (own && pushNotSeen(cand.buildId, pull.headSha, now)) {
      tally.pending += 1;
      return;
    }
    if (own && pull.mergeableState === 'dirty') {
      if (freshGrindRow(cand.todoId) === null || hasActiveStep(deps, cand.buildId)) {
        tally.skipped += 1;
        return;
      }
      const done = mergeConflictRound(
        cand,
        todoRow.teamId,
        { prNumber: buildRow.prNumber, prUrl: buildRow.prUrl },
        pull.defaultBranch,
        false,
      );
      if (done === 'failed') tally.failed += 1;
      else tally.appended += 1;
      return;
    }
    const reqKey = `${target.fullName}\u0000${pull.defaultBranch}`;
    let required = requiredCache.get(reqKey);
    if (
      required === undefined ||
      (required.names === null
        ? required.at !== now
        : now - required.at >= CI_REQUIRED_CHECKS_TTL_MS)
    ) {
      if (grindToken === null) {
        recordGrindAnonRead(now, 2);
      }
      const names = await githubRequiredChecks(
        run.githubFetch,
        grindToken,
        target.owner,
        target.repo,
        pull.defaultBranch,
      );
      required = { at: now, names };
      requiredCache.set(reqKey, required);
    }
    if (required.names === null) {
      tally.unreadable += 1;
      return;
    }
    const requiredNames = required.names;
    const ref = own && pull.headSha !== null ? pull.headSha : branch;
    const cached = cache.get(key);
    const entry = cached?.sha === ref ? cached : null;
    if (grindToken === null) recordGrindAnonRead(now);
    const page = await githubCommitCheckRuns(
      run.githubFetch,
      grindToken,
      target.owner,
      target.repo,
      ref,
      {
        etag: entry?.etag ?? null,
      },
    );
    if (page === null) {
      tally.unreadable += 1;
      return;
    }
    const runs = page.notModified ? (entry?.runs ?? []) : page.checkRuns;
    let verdict = verdictOfCheckRuns(runs, requiredNames);
    const waiting =
      verdict.state === 'empty' ||
      (verdict.state === 'pending' &&
        (verdict.missing !== undefined || (entry?.waitSince ?? null) !== null));
    const waitSince = waiting ? (entry?.waitSince ?? now) : null;
    cache.set(key, { sha: ref, etag: page.etag, runs, waitSince });
    const inGrace = now - (waitSince ?? now) < CI_EMPTY_CHECKS_GRACE_MS;
    if (verdict.state === 'pending') {
      if (verdict.missing === undefined || inGrace) {
        tally.pending += 1;
        return;
      }
      verdict = {
        state: 'blocked',
        checks: verdict.missing.map((name) => ({ name, conclusion: 'missing' })),
      };
    }
    if (verdict.state === 'empty' && inGrace) {
      tally.pending += 1;
      return;
    }
    if (freshGrindRow(cand.todoId) === null) {
      tally.skipped += 1;
      return;
    }
    if (verdict.state === 'blocked') {
      const names = verdict.checks
        .map((c) => `「${githubText(c.name)}」（${githubText(c.conclusion)}）`)
        .join('、');
      hintOnce(
        cand.buildId,
        `PR #${buildRow.prNumber} 的 head ${own ? ref.slice(0, 7) : `分支「${githubText(branch)}」`} 上，检查 ${names} 的结论不算通过：磨绿不推进、也不派修复步。等它重跑，或由人处理。`,
        roundStart(deps, cand.buildId),
      );
      tally.pending += 1;
      return;
    }
    if (verdict.state === 'red') {
      const rounds = countMarkedRounds(deps.db, cand.buildId, CI_FIX_PROMPT_HEAD);
      if (rounds >= CI_FIX_ROUNDS_MAX) {
        failWithMessage(cand, todoRow.teamId, deadLoopMessage(rounds));
        tally.failed += 1;
        return;
      }
      enqueueStep(
        deps,
        cand.buildId,
        'build',
        todoRow.teamId,
        buildCiFixPrompt({
          prNumber: buildRow.prNumber,
          prUrl: buildRow.prUrl,
          round: rounds + 1,
          failures: verdict.failures,
        }),
      );
      tally.appended += 1;
      return;
    }
    if (
      verdict.state === 'green' &&
      own &&
      countMarkedRounds(deps.db, cand.buildId, CI_FIX_PROMPT_HEAD) > 0
    ) {
      hintOnce(cand.buildId, CI_FIX_GREEN_EVENT, 0);
    }
    setTodoPhase(deps, cand.todoId, 'review');
    maybeEnqueueIndependentReview(deps, todoRow, cand.buildId);
    const lastVerifyAt = deps.db
      .select({ at: step.createdAt })
      .from(step)
      .where(and(eq(step.buildId, cand.buildId), eq(step.kind, 'verify')))
      .orderBy(desc(step.createdAt))
      .get()?.at;
    maybeEnqueueVerifyStep(deps, todoRow, cand.buildId, {
      reverify:
        lastVerifyAt !== undefined &&
        hasMessageRow(
          deps,
          cand.buildId,
          'system',
          CI_MERGE_CONFLICT_VERIFY_NOTE,
          lastVerifyAt + 1,
        ),
    });
    tally.advanced += 1;
  }

  async function sweep(now: number = nowMs()): Promise<void> {
    if (sweeping) return;
    sweeping = true;
    try {
      await sweepOnce(now);
    } finally {
      sweeping = false;
    }
  }

  async function sweepOnce(now: number): Promise<void> {
    sweepStartedAt = nowMs();
    const candidates = deps.db
      .select({ buildId: build.id, todoId: todo.id })
      .from(build)
      .innerJoin(todo, and(eq(todo.id, build.todoId), eq(todo.latestBuildId, build.id)))
      .where(and(isNotNull(build.prNumber), eq(todo.phase, 'building')))
      .all();
    const reviewCandidates = deps.db
      .select({ buildId: build.id, todoId: todo.id })
      .from(build)
      .innerJoin(todo, and(eq(todo.id, build.todoId), eq(todo.latestBuildId, build.id)))
      .where(and(isNotNull(build.prNumber), eq(todo.phase, 'review')))
      .all();
    const tally: CiPollTally = {
      candidates: candidates.length,
      pending: 0,
      appended: 0,
      advanced: 0,
      failed: 0,
      skipped: 0,
      unreadable: 0,
      errors: 0,
      reviewCandidates: reviewCandidates.length,
      reviewPending: 0,
      reviewSkipped: 0,
      reviewUnreadable: 0,
      reviewForeign: 0,
      merged: 0,
      closedUnmerged: 0,
      hinted: 0,
      settledBefore: 0,
      adopted: 0,
    };
    grindKeys.clear();
    for (const cand of candidates) {
      try {
        await pollOne(cand, now, tally);
      } catch (err) {
        tally.errors += 1;
        run.logger?.info(
          { err: err instanceof Error ? err.message : String(err) },
          'ci pr-checks poll candidate failed (sweep continues)',
        );
      }
    }
    try {
      await drainCiCorrections(deps, run.githubFetch);
    } catch (err) {
      run.logger?.info(
        { err: err instanceof Error ? err.message : String(err) },
        'ci correction deferred',
      );
    }
    liveKeys.clear();
    reviewCandidates.sort(
      (a, b) => (lastReadByBuild.get(a.buildId) ?? 0) - (lastReadByBuild.get(b.buildId) ?? 0),
    );
    for (const cand of reviewCandidates) {
      try {
        await evaluateMergeGate({ ...deps, githubFetch: run.githubFetch }, cand.buildId);
        await reconcileOne(cand, now, tally);
      } catch (err) {
        tally.errors += 1;
        run.logger?.info(
          { err: err instanceof Error ? err.message : String(err) },
          'pr reconcile candidate failed (sweep continues)',
        );
      }
    }
    for (const k of cache.keys()) if (!grindKeys.has(k)) cache.delete(k);
    for (const k of grindPullCache.keys()) if (!grindKeys.has(k)) grindPullCache.delete(k);
    for (const k of pullCache.keys()) if (!liveKeys.has(k)) pullCache.delete(k);
    for (const k of anonReadAt.keys()) if (!liveKeys.has(k)) anonReadAt.delete(k);
    for (const k of compareCache.keys()) if (!liveKeys.has(k)) compareCache.delete(k);
    for (const k of closedSeenAt.keys()) if (!liveKeys.has(k)) closedSeenAt.delete(k);
    const reviewBuilds = new Set(reviewCandidates.map((c) => c.buildId));
    for (const k of lastReadByBuild.keys()) if (!reviewBuilds.has(k)) lastReadByBuild.delete(k);
    for (const k of foreignListedAt.keys())
      if (!liveKeys.has(k.slice(k.indexOf('\u0000') + 1))) foreignListedAt.delete(k);
    for (const k of listFailures.keys()) if (!liveKeys.has(k)) listFailures.delete(k);
    for (const [k, v] of requiredCache)
      if (now - v.at >= CI_REQUIRED_CHECKS_TTL_MS) requiredCache.delete(k);
    for (const cand of candidates) {
      try {
        await evaluateMergeGate({ ...deps, githubFetch: run.githubFetch }, cand.buildId);
      } catch (err) {
        tally.errors += 1;
        run.logger?.info(
          { err: err instanceof Error ? err.message : String(err) },
          'merge gate evaluation failed (sweep continues)',
        );
      }
    }
    const memoBuilds = new Set([...reviewBuilds, ...candidates.map((c) => c.buildId)]);
    for (const k of knownRows)
      if (!memoBuilds.has(k.slice(0, k.indexOf('\u0000')))) knownRows.delete(k);
    run.logger?.info(tally, 'ci pr-checks sweep');
  }

  return { sweep };
}
