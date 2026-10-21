// GitHub 读工具（#1406 P5a-2）：chief relay 与 MCP 面的 issues /
// pull_requests / workflow_runs 共用这一份实现（listTodos / listSchedules
// 同律），两面同一调用给同一份数据。
// 纪律：
// - 参数单源 = shared githubReadToolParamsSchemas（MCP inputSchema 同一个）；
//   perPage 超上限压到上限。
// - 项目闸：项目属调用方团队、repoKind github、githubRepo 是 owner/repo；
//   任何一关不过都不出站。用的永远是调用方团队自己的 token。
// - token：openGithubToken（github-issues requireToken 同语义）。无连接 =
//   404，密文解不开 = 409，都不回落匿名读。
// - GitHub 文本（标题、label、分支名、login、workflow 名）是第三方写的数据：
//   去格式字符与控制字符、按码点限长，只进结构化字段；列表不带 issue / PR
//   正文。htmlUrl 由 owner/repo 与数字 id 拼出，不搬上游的 URL 串。
// - 超时 GITHUB_READ_TIMEOUT_MS 低于 daemon relay 的 REMOTE_TOOL_TIMEOUT_MS
//   （10s）：relay 放弃之前 server 已经给了答案，不会出现重叠的重试请求。
// - GitHub 失败一律变成带短原因的 HttpError（工具面的错误结果：chief 侧
//   「<tool> rejected: …」、MCP 侧 isError），不带 URL 与 token。状态码只影响
//   daemon 的重试：5xx（上游 5xx、超时、网络、形坏）对 replaySafe 读重试，
//   4xx（401 / 403 / 404 / 422 / 限流）不重试。

import {
  GITHUB_READ_PER_PAGE_MAX,
  githubIssueSourceRef,
  githubReadToolParamsSchemas,
  isGithubRepoRef,
  type SecretBox,
} from '@pacman/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, todo } from '../db/schema.js';
import { HttpError, notFound, parseWith } from '../lib/errors.js';
import {
  type FetchLike,
  type GithubListFailure,
  type GithubListResult,
  githubListIssues,
  githubListPulls,
  githubListWorkflowRuns,
} from '../lib/github.js';
import { openGithubToken } from './github-connection.js';

/** 单次 GitHub 读的超时。daemon relay 读工具 10s 超时（REMOTE_TOOL_TIMEOUT_MS），
 * 留 4s 给 relay 往返与本地处理。 */
export const GITHUB_READ_TIMEOUT_MS = 6_000;

/** 标题限长；其余 GitHub 字符串（label、login、分支、workflow 名、状态词、
 * 时间串）限 TEXT_MAX。 */
const TITLE_MAX = 200;
const TEXT_MAX = 100;

export type GithubReadToolName = keyof typeof githubReadToolParamsSchemas;

export interface GithubReadDeps {
  db: Db;
  box: SecretBox;
  /** 出站注入位（AppContext.githubFetch 同族；缺省 globalThis.fetch）。 */
  githubFetch?: FetchLike;
}

/** 第三方文本进模型前的处理：删格式字符（bidi 覆写、零宽、tag 字符——不可见，
 * 能颠倒显示或藏一段指令），控制字符、行 / 段分隔符与空白串并成一个空格，
 * 去首尾空白；按码点限长，超长截到 max - 1 再补「…」。 */
export function cleanGithubText(value: string, max: number): string {
  const flat = value
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ')
    .trim();
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('')}…`;
}

function cleanOpt(value: string | null): string | null {
  return value === null ? null : cleanGithubText(value, TEXT_MAX);
}

interface GithubTarget {
  owner: string;
  repo: string;
  /** `owner/repo`（回显与错误文案用）。 */
  slug: string;
  token: string;
}

/** 项目闸 + 连接闸。项目不属本团队与不存在同形 404（不泄露存在性）。
 * githubRepo 除了过 isGithubRepoRef，还不许 `.` / `..` 段：两者都过得了那条
 * 正则，拼进 `repos/{o}/{r}` 后会被 URL 规范化成别的路径（`../user` 会读到
 * `GET /user/issues`）。GitHub 的用户名与仓库名都不能是 `.` 或 `..`。 */
function openTarget(deps: GithubReadDeps, teamId: string, projectId: string): GithubTarget {
  const row = deps.db
    .select({ repoKind: project.repoKind, githubRepo: project.githubRepo })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `project ${projectId} not found`);
  if (row.repoKind !== 'github') {
    throw new HttpError(409, `project ${projectId} is not GitHub-backed`);
  }
  const slug = row.githubRepo;
  const [owner, repo] = slug?.split('/') ?? [];
  if (
    slug === null ||
    !isGithubRepoRef(slug) ||
    owner === undefined ||
    repo === undefined ||
    [owner, repo].some((segment) => segment === '.' || segment === '..')
  ) {
    throw new HttpError(409, `project ${projectId} has no valid githubRepo (owner/repo)`);
  }
  let token: string | null;
  try {
    token = openGithubToken({ db: deps.db, box: deps.box }, teamId);
  } catch {
    throw new HttpError(
      409,
      'github connection cannot be read (the stored token does not decrypt); reconnect GitHub',
    );
  }
  if (token === null) throw notFound('github connection');
  return { owner, repo, slug, token };
}

function readFailure(failure: GithubListFailure, slug: string): HttpError {
  switch (failure.kind) {
    case 'timeout':
      return new HttpError(
        504,
        `github: no answer within ${GITHUB_READ_TIMEOUT_MS}ms; try again later`,
      );
    case 'network':
      return new HttpError(502, 'github: network error; try again later');
    case 'malformed':
      return new HttpError(502, 'github: malformed response');
    case 'rate-limited':
      return new HttpError(
        429,
        `github: rate limit reached (HTTP ${failure.status}); wait before calling again`,
      );
    case 'status': {
      const { status } = failure;
      if (status === 401) {
        return new HttpError(
          424,
          'github: the team token was rejected (HTTP 401); reconnect GitHub',
        );
      }
      if (status === 403) {
        return new HttpError(
          424,
          `github: access forbidden (HTTP 403); the team token may lack access to ${slug}`,
        );
      }
      if (status === 404) {
        return new HttpError(
          404,
          `github: ${slug} not found, or the team token cannot see it (HTTP 404)`,
        );
      }
      if (status >= 500) {
        return new HttpError(502, `github: upstream error (HTTP ${status}); try again later`);
      }
      return new HttpError(424, `github: request rejected (HTTP ${status})`);
    }
  }
}

function unwrap<T>(result: GithubListResult<T>, slug: string): { items: T[]; hasMore: boolean } {
  if (!result.ok) throw readFailure(result.failure, slug);
  return result;
}

/** 页参数：page 缺省 1；perPage 缺省 = 上限，超上限压到上限。 */
function pageOf(params: { page?: number; perPage?: number }, max: number) {
  return { page: params.page ?? 1, perPage: Math.min(params.perPage ?? max, max) };
}

/** 本团队由这些 issue 建过的任务：sourceRef（小写比较，GitHub 的 owner/repo
 * 不分大小写）→ 序号最早那张任务的 id。别的团队的任务不算。 */
function taskIdsBySourceRef(db: Db, teamId: string, refs: string[]): Map<string, string> {
  const ids = new Map<string, string>();
  if (refs.length === 0) return ids;
  const rows = db
    .select({ id: todo.id, sourceRef: todo.sourceRef })
    .from(todo)
    .where(
      and(
        eq(todo.teamId, teamId),
        inArray(
          sql`lower(${todo.sourceRef})`,
          refs.map((ref) => ref.toLowerCase()),
        ),
      ),
    )
    .orderBy(asc(todo.seqNum))
    .all();
  for (const row of rows) {
    const key = (row.sourceRef ?? '').toLowerCase();
    if (!ids.has(key)) ids.set(key, row.id);
  }
  return ids;
}

/** 三件的执行体（chief-tools / mcp-face 两面同调）。返回值由各面 JSON 化。 */
export async function executeGithubReadTool(
  deps: GithubReadDeps,
  teamId: string,
  name: GithubReadToolName,
  params: Record<string, unknown>,
): Promise<unknown> {
  const fetchImpl = deps.githubFetch ?? fetch;
  const timeoutMs = GITHUB_READ_TIMEOUT_MS;
  switch (name) {
    case 'issues': {
      const p = parseWith(githubReadToolParamsSchemas.issues, params, 'params');
      const t = openTarget(deps, teamId, p.projectId);
      const state = p.state ?? 'open';
      const paging = pageOf(p, GITHUB_READ_PER_PAGE_MAX.issues);
      const { items, hasMore } = unwrap(
        await githubListIssues(fetchImpl, t.token, t.owner, t.repo, {
          state,
          ...paging,
          timeoutMs,
        }),
        t.slug,
      );
      const refOf = (n: number) => githubIssueSourceRef(t.owner, t.repo, n).toLowerCase();
      const taskIds = taskIdsBySourceRef(
        deps.db,
        teamId,
        items.map((issue) => refOf(issue.number)),
      );
      return {
        projectId: p.projectId,
        repo: t.slug,
        state,
        ...paging,
        hasMore,
        issues: items.map((issue) => ({
          number: issue.number,
          title: cleanGithubText(issue.title, TITLE_MAX),
          state: issue.state,
          labels: issue.labels.map((label) => cleanGithubText(label.name, TEXT_MAX)),
          author: cleanOpt(issue.author),
          authorAssociation: cleanOpt(issue.authorAssociation),
          createdAt: cleanOpt(issue.createdAt),
          updatedAt: cleanOpt(issue.updatedAt),
          htmlUrl: `https://github.com/${t.slug}/issues/${issue.number}`,
          taskId: taskIds.get(refOf(issue.number)) ?? null,
        })),
      };
    }
    case 'pull_requests': {
      const p = parseWith(githubReadToolParamsSchemas.pull_requests, params, 'params');
      const t = openTarget(deps, teamId, p.projectId);
      const state = p.state ?? 'open';
      const paging = pageOf(p, GITHUB_READ_PER_PAGE_MAX.pull_requests);
      const { items, hasMore } = unwrap(
        await githubListPulls(fetchImpl, t.token, t.owner, t.repo, {
          state,
          ...paging,
          timeoutMs,
        }),
        t.slug,
      );
      return {
        projectId: p.projectId,
        repo: t.slug,
        state,
        ...paging,
        hasMore,
        pullRequests: items.map((pull) => ({
          number: pull.number,
          title: cleanGithubText(pull.title, TITLE_MAX),
          state: pull.state,
          draft: pull.draft,
          mergedAt: cleanOpt(pull.mergedAt),
          headRef: cleanOpt(pull.headRef),
          baseRef: cleanOpt(pull.baseRef),
          author: cleanOpt(pull.author),
          htmlUrl: `https://github.com/${t.slug}/pull/${pull.number}`,
        })),
      };
    }
    case 'workflow_runs': {
      const p = parseWith(githubReadToolParamsSchemas.workflow_runs, params, 'params');
      const t = openTarget(deps, teamId, p.projectId);
      const paging = pageOf(p, GITHUB_READ_PER_PAGE_MAX.workflow_runs);
      const { items, hasMore } = unwrap(
        await githubListWorkflowRuns(fetchImpl, t.token, t.owner, t.repo, {
          ...(p.branch !== undefined ? { branch: p.branch } : {}),
          ...(p.status !== undefined ? { status: p.status } : {}),
          ...paging,
          timeoutMs,
        }),
        t.slug,
      );
      return {
        projectId: p.projectId,
        repo: t.slug,
        branch: p.branch ?? null,
        status: p.status ?? null,
        ...paging,
        hasMore,
        workflowRuns: items.map((run) => ({
          id: run.id,
          name: cleanOpt(run.name),
          headBranch: cleanOpt(run.headBranch),
          headSha: cleanOpt(run.headSha),
          status: cleanOpt(run.status),
          conclusion: cleanOpt(run.conclusion),
          event: cleanOpt(run.event),
          createdAt: cleanOpt(run.createdAt),
          htmlUrl: `https://github.com/${t.slug}/actions/runs/${run.id}`,
        })),
      };
    }
  }
}
