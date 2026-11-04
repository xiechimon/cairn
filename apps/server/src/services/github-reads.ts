import {
  GITHUB_READ_PER_PAGE_MAX,
  githubIssueSourceRef,
  githubReadToolParamsSchemas,
} from '@cairn/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { project, todo } from '../db/schema.js';
import { HttpError, notFound, parseWith } from '../lib/errors.js';
import {
  type GithubListFailure,
  type GithubListResult,
  githubListIssues,
  githubListPulls,
  githubListWorkflowRuns,
} from '../lib/github.js';
import { githubRepoOfProject } from './git.js';
import { teamGithubToken } from './github-connection.js';
import type { GithubIssueFaceDeps } from './github-issues.js';

export const GITHUB_READ_TIMEOUT_MS = 6_000;

const TITLE_MAX = 200;
const TEXT_MAX = 100;

export type GithubReadToolName = keyof typeof githubReadToolParamsSchemas;

export type GithubReadDeps = GithubIssueFaceDeps;

export function cleanGithubText(value: string, max: number): string {
  const flat = value
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ')
    .trim();
  if (flat.length <= max) return flat;
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('')}…`;
}

function cleanOpt(value: string | null): string | null {
  return value === null ? null : cleanGithubText(value, TEXT_MAX);
}

interface GithubTarget {
  owner: string;
  repo: string;
  slug: string;
  token: string;
}

async function openTarget(
  deps: GithubReadDeps,
  teamId: string,
  projectId: string,
): Promise<GithubTarget> {
  const row = deps.db
    .select({ repoKind: project.repoKind, githubRepo: project.githubRepo })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `project ${projectId} not found`);
  if (row.repoKind !== 'github') {
    throw new HttpError(409, `project ${projectId} is not GitHub-backed`);
  }
  const ref = githubRepoOfProject(row);
  if (ref === null) {
    throw new HttpError(409, `project ${projectId} has no valid githubRepo (owner/repo)`);
  }
  const { owner, repo } = ref;
  const slug = `${owner}/${repo}`;
  const access = await teamGithubToken(deps, teamId);
  if ('reason' in access && access.reason === 'token-unreadable') {
    throw new HttpError(
      409,
      'github connection cannot be read (the stored token does not decrypt); reconnect GitHub',
    );
  }
  if (!('token' in access)) throw notFound('github connection');
  return { owner, repo, slug, token: access.token };
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

function pageOf(params: { page?: number; perPage?: number }, max: number) {
  return { page: params.page ?? 1, perPage: Math.min(params.perPage ?? max, max) };
}

function taskIdsBySourceRef(db: Db, teamId: string, refs: string[]): Map<string, string> {
  const ids = new Map<string, string>();
  if (refs.length === 0) return ids;
  const rows = db
    .select({ id: todo.id, sourceRef: todo.sourceRef })
    .from(todo)
    .where(and(eq(todo.teamId, teamId), inArray(sql`lower(${todo.sourceRef})`, refs)))
    .orderBy(asc(todo.seqNum))
    .all();
  for (const row of rows) {
    const key = (row.sourceRef ?? '').toLowerCase();
    if (!ids.has(key)) ids.set(key, row.id);
  }
  return ids;
}

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
      const t = await openTarget(deps, teamId, p.projectId);
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
      const t = await openTarget(deps, teamId, p.projectId);
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
      const t = await openTarget(deps, teamId, p.projectId);
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
