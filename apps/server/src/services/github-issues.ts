import {
  type GithubIssueEcho,
  type GithubIssueState,
  type GithubIssuesResponse,
  type GithubRepoRef,
  githubIssueSourceRef,
  neutralizeIssueAttachmentTokens,
  parseGithubIssueSourceRef,
  type SecretBox,
  type TodoRecord,
} from '@cairn/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type project as projectTable, todo as todoTable } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { githubRepoIssue, githubRepoIssues, githubRepoLabels } from '../lib/github.js';
import { githubRepoOfProject } from './git.js';
import { teamGithubToken } from './github-connection.js';
import type { OAuthClientConfig } from './oauth.js';
import { normalizeGithubLabelColor, resolveProjectTagIds, syncGithubLabels } from './tags.js';
import { createTodo, type TodoDeps } from './todos.js';

type ProjectRow = typeof projectTable.$inferSelect;

export interface GithubIssueFaceDeps {
  db: Db;
  box: SecretBox;
  githubFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
}

function requireGithubRepo(row: ProjectRow): GithubRepoRef {
  const ref = githubRepoOfProject(row);
  if (ref === null) throw notFound('github issues');
  return ref;
}

async function requireToken(deps: GithubIssueFaceDeps, teamId: string): Promise<string> {
  const access = await teamGithubToken(deps, teamId);
  if (!('token' in access)) throw notFound('github connection');
  return access.token;
}

function claimedSourceRefs(db: Db, teamId: string, refs: string[]): Set<string> {
  if (refs.length === 0) return new Set();
  const rows = db
    .select({ sourceRef: todoTable.sourceRef })
    .from(todoTable)
    .where(
      and(
        eq(todoTable.teamId, teamId),
        inArray(
          sql`lower(${todoTable.sourceRef})`,
          refs.map((r) => r.toLowerCase()),
        ),
      ),
    )
    .all();
  return new Set(
    rows.map((r) => r.sourceRef?.toLowerCase()).filter((v): v is string => v !== undefined),
  );
}

export async function listProjectGithubIssues(
  deps: GithubIssueFaceDeps,
  row: ProjectRow,
  opts: { state: GithubIssueState; page: number },
): Promise<GithubIssuesResponse> {
  const { owner, repo } = requireGithubRepo(row);
  const token = await requireToken(deps, row.teamId);
  const fetchImpl = deps.githubFetch ?? fetch;
  const { issues, hasMore } = await githubRepoIssues(fetchImpl, token, owner, repo, opts);
  const claimed = claimedSourceRefs(
    deps.db,
    row.teamId,
    issues.map((issue) => githubIssueSourceRef(owner, repo, issue.number)),
  );
  return {
    issues: issues
      .filter(
        (issue) => !claimed.has(githubIssueSourceRef(owner, repo, issue.number).toLowerCase()),
      )
      .map((issue) => ({
        ...issue,
        labels: issue.labels.map((label) => ({
          name: label.name,
          color: normalizeGithubLabelColor(label.color),
        })),
      })),
    page: opts.page,
    hasMore,
  };
}

export type ImportGithubIssueDeps = GithubIssueFaceDeps & Omit<TodoDeps, 'box'>;

const importsInFlight = new Map<string, string>();

export function importsInFlightFor(projectId: string): number {
  let n = 0;
  for (const p of importsInFlight.values()) if (p === projectId) n += 1;
  return n;
}

export async function importGithubIssue(
  deps: ImportGithubIssueDeps,
  row: ProjectRow,
  issueNumber: number,
  opts: { createdBy?: string } = {},
): Promise<TodoRecord> {
  const { owner, repo } = requireGithubRepo(row);
  const fetchImpl = deps.githubFetch ?? fetch;
  const ref = githubIssueSourceRef(owner, repo, issueNumber);
  if (claimedSourceRefs(deps.db, row.teamId, [ref]).has(ref.toLowerCase())) {
    throw new HttpError(409, `issue ${ref} already has a task`);
  }
  const claim = `${row.teamId}\u0000${ref.toLowerCase()}`;
  if (importsInFlight.has(claim)) {
    throw new HttpError(409, `issue ${ref} is being imported`);
  }
  importsInFlight.set(claim, row.id);
  try {
    const token = await requireToken(deps, row.teamId);
    const detail = await githubRepoIssue(fetchImpl, token, owner, repo, issueNumber);
    const repoLabels = await githubRepoLabels(fetchImpl, token, owner, repo);
    syncGithubLabels(deps.db, row.id, [...repoLabels, ...detail.labels]);
    const names = [...new Set(detail.labels.map((l) => l.name))];
    const resolved = resolveProjectTagIds(deps.db, row.id, names);
    const tagIds = names
      .map((name) => resolved.get(name))
      .filter((id): id is string => id !== undefined);
    return createTodo(deps, {
      teamId: row.teamId,
      projectId: row.id,
      title: neutralizeIssueAttachmentTokens(detail.title),
      spec: neutralizeIssueAttachmentTokens(detail.body ?? ''),
      tagIds,
      createdBy: opts.createdBy ?? deps.user.id,
      ownerId: deps.user.id,
      sourceKind: 'github-issue',
      sourceRef: ref,
    });
  } finally {
    importsInFlight.delete(claim);
  }
}

export async function readSourceIssueEcho(
  deps: GithubIssueFaceDeps,
  todoId: string,
): Promise<GithubIssueEcho> {
  const row = deps.db
    .select({
      teamId: todoTable.teamId,
      sourceKind: todoTable.sourceKind,
      sourceRef: todoTable.sourceRef,
    })
    .from(todoTable)
    .where(eq(todoTable.id, todoId))
    .get();
  if (!row || row.sourceKind === null || row.sourceRef === null) {
    throw notFound('source issue');
  }
  const parsed = parseGithubIssueSourceRef(row.sourceRef);
  if (!parsed) throw notFound('source issue');
  const token = await requireToken(deps, row.teamId);
  const detail = await githubRepoIssue(
    deps.githubFetch ?? fetch,
    token,
    parsed.owner,
    parsed.repo,
    parsed.issueNumber,
  );
  return { number: detail.number, title: detail.title, state: detail.state };
}
