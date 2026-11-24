import {
  type GithubIssueEcho,
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
import { githubRepoIssue, githubRepoLabels } from '../lib/github.js';
import { githubRepoOfProject } from './git.js';
import { githubReadToken } from './github-autonomous-token.js';
import { refreshingGithubFetch, teamUserToken } from './github-connection.js';
import { resolveProjectGithubLabelIds, syncGithubLabels } from './github-labels.js';
import { CORRECTION_PROMPT } from './merge-gate/correction.js';
import type { OAuthClientConfig } from './oauth.js';
import { createTodo, type TodoDeps } from './todos.js';

type ProjectRow = typeof projectTable.$inferSelect;

export interface GithubIssueFaceDeps {
  db: Db;
  box: SecretBox;
  githubFetch?: FetchLike;
  githubBaseFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
  githubApp?: Readonly<{ clientId: string; slug: string }> | null | undefined;
}

function requireGithubRepo(row: ProjectRow): GithubRepoRef {
  const ref = githubRepoOfProject(row);
  if (ref === null) throw notFound('github issues');
  return ref;
}

async function requireToken(
  deps: GithubIssueFaceDeps,
  teamId: string,
  repo: GithubRepoRef,
): Promise<string> {
  const preferred = await githubReadToken(deps, teamId, repo);
  if (preferred !== null) return preferred;
  const access = await teamUserToken(deps, teamId);
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

export type ImportGithubIssueDeps = GithubIssueFaceDeps & Omit<TodoDeps, 'box'>;

const importsInFlightByDb = new WeakMap<Db, Set<string>>();

function importsInFlightOf(db: Db): Set<string> {
  let set = importsInFlightByDb.get(db);
  if (set === undefined) {
    set = new Set<string>();
    importsInFlightByDb.set(db, set);
  }
  return set;
}

export async function importGithubIssue(
  deps: ImportGithubIssueDeps,
  row: ProjectRow,
  issueNumber: number,
): Promise<TodoRecord> {
  const { owner, repo } = requireGithubRepo(row);
  const fetchImpl = refreshingGithubFetch(
    deps,
    deps.githubBaseFetch ?? deps.githubFetch ?? fetch,
    row.teamId,
  );
  const ref = githubIssueSourceRef(owner, repo, issueNumber);
  if (claimedSourceRefs(deps.db, row.teamId, [ref]).has(ref.toLowerCase())) {
    throw new HttpError(409, `issue ${ref} already has a task`);
  }
  const claim = `${row.teamId}\u0000${ref.toLowerCase()}`;
  const importsInFlight = importsInFlightOf(deps.db);
  if (importsInFlight.has(claim)) {
    throw new HttpError(409, `issue ${ref} is being imported`);
  }
  importsInFlight.add(claim);
  try {
    const token = await requireToken(deps, row.teamId, { owner, repo });
    const detail = await githubRepoIssue(fetchImpl, token, owner, repo, issueNumber);
    const repoLabels = await githubRepoLabels(fetchImpl, token, owner, repo);
    syncGithubLabels(deps.db, row.id, [...repoLabels, ...detail.labels]);
    const names = [...new Set(detail.labels.map((l) => l.name))];
    const resolved = resolveProjectGithubLabelIds(deps.db, row.id, names);
    const githubLabelIds = names
      .map((name) => resolved.get(name))
      .filter((id): id is string => id !== undefined);
    return createTodo(deps, {
      teamId: row.teamId,
      projectId: row.id,
      title: neutralizeIssueAttachmentTokens(detail.title),
      spec: `${names.some((name) => name.toLowerCase() === 'correction') ? `${CORRECTION_PROMPT}\n\n` : ''}${neutralizeIssueAttachmentTokens(detail.body ?? '')}`,
      githubLabelIds,
      correctionRequired: names.some((name) => name.toLowerCase() === 'correction'),
      createdBy: deps.user.id,
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
  const token = await requireToken(deps, row.teamId, parsed);
  const detail = await githubRepoIssue(
    refreshingGithubFetch(deps, deps.githubBaseFetch ?? deps.githubFetch ?? fetch, row.teamId),
    token,
    parsed.owner,
    parsed.repo,
    parsed.issueNumber,
  );
  return { number: detail.number, title: detail.title, state: detail.state };
}
