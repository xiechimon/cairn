import { HttpError } from '../lib/errors.js';
import {
  type FetchLike,
  type GithubListFailure,
  type GithubListResult,
  type GithubOverlapEntry,
  githubListPullFiles,
  githubListPulls,
  githubSearchIssues,
} from '../lib/github.js';

export async function lookupGithubOverlaps(
  fetchImpl: FetchLike,
  target: { owner: string; repo: string; slug: string; token: string },
  terms: string[],
  paths: string[],
  opts: {
    timeoutMs: number;
    cleanTitle: (title: string) => string;
    readFailure: (failure: GithubListFailure, slug: string) => HttpError;
  },
) {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const words = [...new Set(terms.map((term) => term.trim()))];
  const query = words.map((term) => `"${term.replace(/["\\]/g, ' ')}"`).join(' OR ');
  const { token, owner, repo, slug } = target;
  const item = (entry: GithubOverlapEntry, kind: 'issues' | 'pull') => ({
    number: entry.number,
    title: opts.cleanTitle(entry.title),
    htmlUrl: `https://github.com/${slug}/${kind}/${entry.number}`,
  });
  const failed = (failure: GithubListFailure, lookup: string): never => {
    const error = opts.readFailure(failure, slug);
    throw new HttpError(error.status, `github_overlap ${lookup}: ${error.message}`);
  };
  const unwrap = <T>(result: GithubListResult<T>, lookup: string) => {
    if (!result.ok) return failed(result.failure, lookup);
    return result;
  };
  const search = async (lookup: string, scope: string, kind: 'issues' | 'pull') => {
    const result = await githubSearchIssues(
      fetchImpl,
      token,
      `repo:${slug} ${scope} in:title,body ${query}`,
      opts.timeoutMs,
    );
    if (!result.ok) return failed(result.failure, lookup);
    if (
      result.incompleteResults ||
      result.totalCount > 100 ||
      result.hasMore ||
      result.items.length !== result.totalCount
    ) {
      throw new HttpError(
        502,
        `github_overlap ${lookup}: incomplete GitHub search; narrow the terms and repeat`,
      );
    }
    return result.items.map((entry) => item(entry, kind));
  };
  const openIssues = await search('openIssues', 'is:issue is:open', 'issues');
  const openPulls = await search('openPulls', 'is:pr is:open', 'pull');
  const recentPulls = await search('recentPulls', `is:pr is:merged merged:>=${since}`, 'pull');
  const filePulls: (ReturnType<typeof item> & { overlappingFiles: string[] })[] = [];
  if (paths.length) {
    const planned = new Set(paths.map((path) => path.replace(/^\.\//, '')));
    let morePulls = true;
    for (let page = 1; morePulls; page++) {
      const pulls = unwrap(
        await githubListPulls(fetchImpl, token, owner, repo, {
          state: 'open',
          page,
          perPage: 100,
          timeoutMs: opts.timeoutMs,
        }),
        'filePulls open PRs',
      );
      morePulls = pulls.hasMore;
      for (const pull of pulls.items) {
        const overlappingFiles: string[] = [];
        let moreFiles = true;
        for (let filePage = 1; moreFiles; filePage++) {
          const lookup = `filePulls files for PR #${pull.number}`;
          const files = unwrap(
            await githubListPullFiles(fetchImpl, token, owner, repo, pull.number, {
              page: filePage,
              perPage: 100,
              timeoutMs: opts.timeoutMs,
            }),
            lookup,
          );
          if (filePage >= 30 && (files.hasMore || files.items.length === 100)) {
            throw new HttpError(
              502,
              `github_overlap ${lookup}: GitHub file limit reached; lookup may be incomplete`,
            );
          }
          moreFiles = files.hasMore;
          for (const file of files.items) {
            if (
              planned.has(file.filename) ||
              (file.previousFilename !== null && planned.has(file.previousFilename))
            )
              overlappingFiles.push(file.filename);
          }
        }
        if (overlappingFiles.length) filePulls.push({ ...item(pull, 'pull'), overlappingFiles });
      }
    }
  }
  return {
    repo: slug,
    checkedAt: now.toISOString(),
    since,
    terms: words,
    paths,
    openIssues,
    openPulls,
    recentPulls,
    filePulls,
  };
}
