import type { GithubRepoRef } from '@cairn/shared';
import { ACTIVE_STEP_STATUSES, conversationBranch, MERGE_ANNOUNCEMENT } from '@cairn/shared';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { type build, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import {
  type GithubMergeResult,
  githubMergePull,
  githubPull,
  hasPullFields,
  isFullSha,
  isOwnPull,
  WRITE_AUTHOR_ASSOCIATIONS,
} from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { claimAutonomousMerge, settleAutonomousMerge } from './autonomous-merge.js';
import { assertNoMergedPrElsewhere } from './build-pr-probe.js';
import {
  assertDeliveredBuild,
  assertMergeTools,
  type BuildDeps,
  finishTodoDone,
  lastPushedCheckpoint,
  type MergeRequestOutcome,
  mergingBuilds,
  NotFoundError,
  STEP_KIND_TEXT,
} from './builds.js';
import { projectOfTodo } from './git.js';
import { teamUserToken } from './github-connection.js';
import { githubText } from './github-text.js';
import { assertMergeRequiredChecks } from './merge-required-checks.js';
import { assertPhaseTransition } from './phase.js';
import { ensurePullClosesTaskIssue } from './pr-closing-line.js';
import { selfIssueCreatePending, setTodoPhase } from './todos.js';
import { insertGateAnnouncement, insertMessageRow } from './transcript.js';

type BuildRow = typeof build.$inferSelect;
type TodoRow = typeof todo.$inferSelect;

function apiMergeGate(deps: BuildDeps, row: BuildRow): { todoRow: TodoRow; failed: boolean } {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRow.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  const failed = todoRow.phase === 'failed';
  if (failed) {
    assertDeliveredBuild(deps, row);
  } else {
    if (todoRow.phase !== 'done') assertPhaseTransition(todoRow.phase, 'done');
    if (todoRow.phase !== 'review' && todoRow.phase !== 'done') {
      throw new HttpError(409, `Finish the task before requesting a merge (${todoRow.phase})`);
    }
  }
  if (todoRow.latestBuildId !== row.id) {
    throw new HttpError(
      409,
      `这次运行已不是任务的当前运行（任务重跑过），cairn 不经它合并 PR #${row.prNumber}`,
    );
  }
  const busy = deps.db
    .select({ kind: step.kind })
    .from(step)
    .where(
      and(
        eq(step.buildId, row.id),
        inArray(step.status, [...ACTIVE_STEP_STATUSES]),
        notInArray(step.kind, ['review', 'verify']),
      ),
    )
    .get()?.kind;
  if (busy !== undefined) {
    throw new HttpError(
      409,
      `本任务还有一个${STEP_KIND_TEXT[busy]}步在排队或在跑，它收尾时还会推送提交：等它跑完再合并。`,
    );
  }
  return { todoRow, failed };
}

const CLOSING_SHAPE = /(?<![a-z])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*\S*\d/i;

const PLAIN_MERGE_BODY = 'Merged by cairn.';

function unclearReason(result: Extract<GithubMergeResult, { kind: 'unknown' }>): string {
  switch (result.reason) {
    case 'timeout':
      return '请求超时';
    case 'network':
      return '网络错误';
    case 'malformed':
      return `HTTP ${result.status}，应答读不出`;
    case 'status':
      return `HTTP ${result.status}`;
  }
}

export async function mergeThroughGithub(
  deps: BuildDeps,
  row: BuildRow,
  prNumber: number,
  repoRef: GithubRepoRef,
  actor: string,
): Promise<MergeRequestOutcome> {
  const initial = apiMergeGate(deps, row);
  const targetProject = projectOfTodo(deps.db, initial.todoRow);
  await assertNoMergedPrElsewhere(deps, row, prNumber);
  const gate = apiMergeGate(deps, row);
  assertMergeTools(deps, gate.todoRow);
  const hint = '分支和 PR 保留，可在 GitHub 上核对后合并';
  const access = await teamUserToken(deps, gate.todoRow.teamId);
  if ('reason' in access) {
    if (access.reason === 'no-secret-box') {
      throw new HttpError(
        409,
        `PR #${prNumber} 要经 GitHub 合并，但 server 没有配置密钥（secret box），读不了团队的 GitHub 连接：请检查 server 的密钥配置。`,
      );
    }
    const reconnect = access.reason === 'token-unreadable';
    const connect = reconnect ? '重新连接 GitHub' : '连接 GitHub';
    const next = gate.failed
      ? `任务处于失败态：${connect} 后重新请求合并`
      : `请${connect} 后重新请求合并，或直接在 GitHub 上合并这张 PR（${hint}；私有仓库没有连接时对账读不到它）`;
    throw new HttpError(
      409,
      reconnect
        ? `PR #${prNumber} 要经 GitHub 合并，但团队的 GitHub 连接解不开（密钥换过或密文损坏）：${next}。`
        : `PR #${prNumber} 要经 GitHub 合并，但团队没有连接 GitHub：${next}。`,
    );
  }
  const token = access.token;
  if (mergingBuilds.has(row.id)) {
    throw new HttpError(409, `PR #${prNumber} 的合并请求正在进行，等它返回后再试。`);
  }
  mergingBuilds.add(row.id);
  try {
    const fetchImpl = deps.githubFetch ?? fetch;
    const page = await githubPull(fetchImpl, token, repoRef.owner, repoRef.repo, prNumber);
    const before = apiMergeGate(deps, row);
    if (before.todoRow.phase !== gate.todoRow.phase) {
      throw new HttpError(409, `读取 PR 期间任务相位已变为 ${before.todoRow.phase}，没有发起合并`);
    }
    const pull = page?.pull ?? null;
    const branch = conversationBranch(row.id);
    if (pull === null || !hasPullFields(pull) || pull.title === null || pull.headSha === null) {
      throw new HttpError(
        409,
        `读不到 PR #${prNumber} 在 GitHub 上的状态（网络、限流或 GitHub 连接失效），没有发起合并：稍后再试。`,
      );
    }
    if (pull.state === 'closed' && !pull.merged) {
      throw new HttpError(
        409,
        `PR #${prNumber} 在 GitHub 上已关闭且未合并，无法合并：重新打开它，或重新运行任务。`,
      );
    }
    if (!isOwnPull(pull, branch)) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的 head 不是本任务在 ${repoRef.owner}/${repoRef.repo} 的工作分支「${branch}」，cairn 不合并它：请在 GitHub 上核对这张 PR。`,
      );
    }
    if (!WRITE_AUTHOR_ASSOCIATIONS.has(pull.authorAssociation ?? '')) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的作者对仓库没有写权限（author_association ${githubText(pull.authorAssociation ?? '缺失')}），cairn 不经 API 合并它：请在 GitHub 上核对后合并（${hint}）。`,
      );
    }
    const baseBranch = projectOfTodo(deps.db, before.todoRow)?.baseBranch ?? pull.defaultBranch;
    if (pull.baseRef !== baseBranch) {
      throw new HttpError(
        409,
        `PR #${prNumber} targets branch "${githubText(pull.baseRef)}" instead of project base branch "${githubText(baseBranch)}". Check the PR base on GitHub before merging.`,
      );
    }
    if (pull.merged) {
      if (!gate.failed) {
        throw new HttpError(409, `PR #${prNumber} 已在 GitHub 合并，没有再发起合并：${hint}。`);
      }
      setTodoPhase(deps, row.todoId, 'review');
      insertMessageRow(deps, row.id, {
        id: newRecordId(),
        role: 'system',
        content: `PR #${prNumber} 已在 GitHub 合并：cairn 对账核对后收尾（核对不上时在时间线说明）。`,
        createdAt: nowMs(),
      });
      return { state: 'merged', prNumber, commit: pull.headSha, alreadyMerged: true };
    }
    const checkpoint = lastPushedCheckpoint(deps, row.id, { mergeSteps: true });
    if (checkpoint === null || !isFullSha(checkpoint)) {
      throw new HttpError(
        409,
        `本任务没有可核对的推送提交（执行步没回报有效的提交 SHA），cairn 不经 GitHub 合并 PR #${prNumber}：请在 GitHub 上核对后合并（${hint}），或重新运行任务。`,
      );
    }
    if (pull.headSha !== checkpoint) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的 head 是 ${githubText(pull.headSha).slice(0, 7)}，不是本任务最后推送的提交 ${checkpoint.slice(0, 7)}：GitHub 可能还没同步刚推的提交（稍后再点），或分支上有了别的提交（有人推送，或点了 Update branch）。cairn 只合并它推送过的提交；请在 GitHub 上核对后合并（${hint}），或让任务再跑一轮。`,
      );
    }
    const titled = `${pull.title} (#${prNumber})`;
    await assertMergeRequiredChecks(fetchImpl, token, repoRef, pull.baseRef, checkpoint);
    await selfIssueCreatePending(row.todoId);
    const closing = apiMergeGate(deps, row);
    await ensurePullClosesTaskIssue(
      fetchImpl,
      token,
      repoRef,
      prNumber,
      closing.todoRow,
      pull.body,
    ).catch((error: unknown) => {
      throw new HttpError(
        409,
        `PR #${prNumber} 的描述里补不上关闭本任务 issue 的那一行（${error instanceof Error ? githubText(error.message) : '未知错误'}），没有发起合并：稍后再试。`,
      );
    });
    const current = apiMergeGate(deps, row);
    const currentProject = projectOfTodo(deps.db, current.todoRow);
    if (
      current.todoRow.projectId !== initial.todoRow.projectId ||
      currentProject?.repoKind !== targetProject?.repoKind ||
      currentProject?.githubRepo !== targetProject?.githubRepo ||
      currentProject?.baseBranch !== targetProject?.baseBranch ||
      lastPushedCheckpoint(deps, row.id, { mergeSteps: true }) !== checkpoint
    )
      throw new HttpError(409, 'The delivery or merge target changed while preparing the merge');
    claimAutonomousMerge(deps.db, row.id, true);
    const result = await githubMergePull(fetchImpl, token, repoRef.owner, repoRef.repo, prNumber, {
      sha: checkpoint,
      commitTitle: CLOSING_SHAPE.test(pull.title) ? `Merge pull request #${prNumber}` : titled,
      commitMessage: PLAIN_MERGE_BODY,
    });
    if (result.kind === 'merged' || result.kind === 'refused' || result.kind === 'rate-limited')
      settleAutonomousMerge(deps.db, row.id, result.kind === 'merged' ? 'merged' : 'refused');
    if (result.kind === 'rate-limited') {
      const { limit } = result;
      const when =
        limit.retryAfterSeconds !== null
          ? `，${limit.retryAfterSeconds} 秒后再试`
          : limit.resetAt !== null
            ? `，限流在 ${new Date(limit.resetAt).toISOString()} 解除`
            : '';
      throw new HttpError(
        409,
        `GitHub 限流，没有处理合并 PR #${prNumber} 的请求（HTTP ${limit.status}${when}）${result.message === '' ? '' : `：${githubText(result.message)}`}——稍后重新请求合并，或直接在那里合并（${hint}）`,
      );
    }
    if (result.kind === 'refused') {
      throw new HttpError(
        409,
        result.status === 401
          ? `GitHub 不认团队的 GitHub 连接（HTTP 401），PR #${prNumber} 没有合并：请重新连接 GitHub 后重新请求合并。`
          : `GitHub 拒绝合并 PR #${prNumber}（HTTP ${result.status}）${result.message === '' ? '' : `：${githubText(result.message)}`}——可在 GitHub 上处理后直接在那里合并（${hint}）`,
      );
    }
    const now = deps.db
      .select({ phase: todo.phase })
      .from(todo)
      .where(eq(todo.id, row.todoId))
      .get();
    const atGate = now?.phase === gate.todoRow.phase;
    if (atGate && gate.failed) setTodoPhase(deps, row.todoId, 'review');
    insertGateAnnouncement(deps, row.id, MERGE_ANNOUNCEMENT, actor);
    insertMessageRow(deps, row.id, {
      id: newRecordId(),
      role: 'system',
      content:
        result.kind === 'merged'
          ? `PR #${prNumber} 已由 cairn 经 GitHub 合并（squash，合并提交 ${githubText(result.sha).slice(0, 7)}）`
          : `已请 GitHub 合并 PR #${prNumber}，GitHub 没有明确答复（${unclearReason(result)}）。cairn 对账会读这张 PR；尚未确认合并结果，不会重复发起合并。`,
      createdAt: nowMs(),
    });
    if (result.kind === 'merged' && atGate) finishTodoDone(deps, row.todoId, row.id);
    return result.kind === 'merged'
      ? { state: 'merged', prNumber, commit: result.sha, alreadyMerged: false }
      : { state: 'unconfirmed', prNumber };
  } finally {
    mergingBuilds.delete(row.id);
  }
}
