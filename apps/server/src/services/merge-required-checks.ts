import type { GithubRepoRef } from '@cairn/shared';
import { HttpError } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { readRequiredChecksAt } from './merge-gate/github-facts.js';
import { requiredChecksReadiness } from './merge-gate/readiness.js';
import { githubGateReadPort } from './merge-gate-github.js';

export async function assertMergeRequiredChecks(
  fetchImpl: FetchLike,
  token: string,
  repo: GithubRepoRef,
  branch: string,
  head: string,
): Promise<void> {
  const port = githubGateReadPort(fetchImpl, token, repo.owner, repo.repo, 10_000);
  const checks = await readRequiredChecksAt(port, repo, branch, head);
  const blockers: string[] = [];
  requiredChecksReadiness(head, checks, (code, ...detail) => {
    if (code === 'required-checks-none') return;
    blockers.push(`${code}${detail.length === 0 ? '' : `: ${detail.join(', ')}`}`);
  });
  if (blockers.length > 0) {
    throw new HttpError(409, `Required checks are not green: ${blockers.join('; ')}`);
  }
}
