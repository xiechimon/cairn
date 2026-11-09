import { type GithubRepoRef, parseGithubIssueSourceRef } from '@cairn/shared';
import type { todo } from '../db/schema.js';
import { type FetchLike, githubPull, githubUpdatePullBody } from '../lib/github.js';
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

const INERT_MARKDOWN = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|<!--[\s\S]*?(?:-->|$)|`[^`\n]*`/g;

function closesIssue(body: string, issueNumber: number, repo: GithubRepoRef): boolean {
  const qualified = `${escapeRegExp(repo.owner)}/${escapeRegExp(repo.repo)}`;
  return new RegExp(
    `(?<![\\w-])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?:\\s*:\\s*|\\s+)(?:${qualified})?#${issueNumber}(?!\\d)`,
    'i',
  ).test(body.replace(INERT_MARKDOWN, ' '));
}

export async function ensurePullClosesTaskIssue(
  fetchImpl: FetchLike,
  token: GithubWriteToken,
  repo: GithubRepoRef,
  prNumber: number,
  row: TaskSource,
  seenBody: string,
): Promise<string | null> {
  const issueNumber = taskIssueNumber(row, repo);
  if (issueNumber === null || closesIssue(seenBody, issueNumber, repo)) return null;
  const page = await githubPull(fetchImpl, token, repo.owner, repo.repo, prNumber);
  if (page?.pull == null) throw new Error(`PR #${prNumber} body unreadable`);
  const current = page.pull.body;
  if (closesIssue(current, issueNumber, repo)) return null;
  const kept = current.trimEnd();
  const next = `${kept}${kept === '' ? '' : '\n\n'}Closes #${issueNumber}\n`;
  await githubUpdatePullBody(fetchImpl, token, repo.owner, repo.repo, prNumber, next);
  return next;
}
