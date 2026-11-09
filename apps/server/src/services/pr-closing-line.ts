import { type GithubRepoRef, parseGithubIssueSourceRef } from '@cairn/shared';
import type { todo } from '../db/schema.js';
import { type FetchLike, githubUpdatePullBody } from '../lib/github.js';
import type { GithubWriteToken } from '../lib/github-token.js';

type TaskSource = Pick<typeof todo.$inferSelect, 'sourceKind' | 'sourceRef'>;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function taskIssueNumber(row: TaskSource, repo: GithubRepoRef): number | null {
  if (row.sourceKind !== 'github-issue' && row.sourceKind !== 'github-issue-self') return null;
  const issue = row.sourceRef === null ? null : parseGithubIssueSourceRef(row.sourceRef);
  if (issue === null) return null;
  const sameRepo =
    issue.owner.toLowerCase() === repo.owner.toLowerCase() &&
    issue.repo.toLowerCase() === repo.repo.toLowerCase();
  return sameRepo ? issue.issueNumber : null;
}

function bodyClosingTaskIssue(body: string, row: TaskSource, repo: GithubRepoRef): string | null {
  const issueNumber = taskIssueNumber(row, repo);
  if (issueNumber === null) return null;
  const qualified = `${escapeRegExp(repo.owner)}/${escapeRegExp(repo.repo)}`;
  const linked = new RegExp(
    `(?<![\\w-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?:\\s*:\\s*|\\s+)(?:${qualified})?#${issueNumber}(?!\\d)`,
    'i',
  );
  if (linked.test(body)) return null;
  const kept = body.trimEnd();
  return `${kept}${kept === '' ? '' : '\n\n'}Closes #${issueNumber}\n`;
}

export async function ensurePullClosesTaskIssue(
  fetchImpl: FetchLike,
  token: GithubWriteToken,
  repo: GithubRepoRef,
  prNumber: number,
  row: TaskSource,
  body: string,
): Promise<string | null> {
  const next = bodyClosingTaskIssue(body, row, repo);
  if (next === null) return null;
  await githubUpdatePullBody(fetchImpl, token, repo.owner, repo.repo, prNumber, next);
  return next;
}
