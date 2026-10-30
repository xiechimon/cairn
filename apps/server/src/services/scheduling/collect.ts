import {
  type FetchLike,
  type GithubListFailure,
  type GithubListResult,
  githubBranchRaw,
  githubContentsRaw,
  githubListPulls,
  githubOpenIssuesDetail,
  githubPullRaw,
  isFullSha,
} from '../../lib/github.js';
import type { ScheduleIssue, ScheduleMergedPull } from './plan.js';

export const SCHEDULE_TIMEOUT_MS = 15_000;
export const SCHEDULE_ISSUE_PAGES = 6;
export const SCHEDULE_PULL_PAGES = 4;
export const SCHEDULE_PER_PAGE = 100;
export const SCHEDULE_MERGED_PULL_LIMIT = 100;
export const SCHEDULE_MERGED_PULL_PAGES = Math.ceil(SCHEDULE_MERGED_PULL_LIMIT / SCHEDULE_PER_PAGE);
export const SCHEDULE_OPEN_ISSUE_PAGES = 20;
export const SCHEDULE_LEDGER_PATHS = [
  'docs/spec/28-bootstrap-closed-loop-self-authored-self-merged.md',
  'docs/spec/28-自举闭环-自写自合.md',
  'docs/spec/README.md',
  'README.md',
];

export type CollectFailure = GithubListFailure | { kind: 'budget' };

export async function collectPages<T>(
  read: (
    page: number,
  ) => Promise<(GithubListResult<T> & { ok: true }) | { ok: false; failure: GithubListFailure }>,
  maxPages: number,
): Promise<{ ok: true; items: T[]; truncated: boolean } | { ok: false; failure: CollectFailure }> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await read(page);
    if (!res.ok) return { ok: false, failure: res.failure };
    items.push(...res.items);
    if (!res.hasMore) return { ok: true, items, truncated: false };
  }
  return { ok: true, items, truncated: true };
}

export interface RawIssueReader {
  number: number;
  title: string;
  body: string;
}

export function toScheduleIssue(
  entry: {
    number: number;
    title: string;
    state: 'open' | 'closed';
    labels: { name: string }[];
    createdAt: string | null;
    updatedAt: string | null;
  },
  body: string,
  owner: string,
  repo: string,
) {
  return {
    number: entry.number,
    title: entry.title,
    body,
    labels: entry.labels.map((l) => l.name),
    state: entry.state,
    createdAt: parseTime(entry.createdAt),
    updatedAt: parseTime(entry.updatedAt),
    url: `https://github.com/${owner}/${repo}/issues/${entry.number}`,
  };
}

export function parseTime(value: string | null): number {
  if (value === null) return 0;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : 0;
}

export type ScheduleFetch = FetchLike;

export async function defaultBranchSha(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
): Promise<string | null> {
  for (const branch of ['main', 'master']) {
    const raw = await githubBranchRaw(fetchImpl, token, owner, repo, branch, {
      etag: null,
      timeoutMs: SCHEDULE_TIMEOUT_MS,
    });
    if (raw.kind !== 'ok') continue;
    const sha = (raw.body as { commit?: { sha?: unknown } } | null)?.commit?.sha;
    if (typeof sha === 'string' && isFullSha(sha)) return sha;
  }
  return null;
}

export async function repoFile(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string> {
  const raw = await githubContentsRaw(fetchImpl, token, owner, repo, path, ref, {
    timeoutMs: SCHEDULE_TIMEOUT_MS,
  });
  if (raw.kind !== 'ok') return '';
  const body = raw.body as { content?: unknown; encoding?: unknown } | null;
  if (body === null || typeof body.content !== 'string' || body.encoding !== 'base64') return '';
  try {
    return Buffer.from(body.content, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

export async function ledgerLines(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  ref: string,
): Promise<string[]> {
  const lines: string[] = [];
  for (const path of SCHEDULE_LEDGER_PATHS) {
    const text = await repoFile(fetchImpl, token, owner, repo, path, ref);
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed !== '' && /#\d+/.test(trimmed)) lines.push(trimmed);
    }
  }
  return lines;
}

export async function openIssues(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
): Promise<ScheduleIssue[] | { skipped: string }> {
  const issues: ScheduleIssue[] = [];
  let url: string | null = null;
  for (let page = 0; page < SCHEDULE_OPEN_ISSUE_PAGES; page += 1) {
    const read = await githubOpenIssuesDetail(fetchImpl, token, owner, repo, { url });
    if (read === null) return { skipped: page === 0 ? 'issues-unreadable' : 'issues-partial' };
    if (read.notModified) break;
    for (const item of read.data.issues) {
      issues.push({
        number: item.number,
        title: item.title,
        body: item.body,
        labels: item.labels.map((l) => l.name),
        state: item.state,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        url: item.url,
      });
    }
    if (read.data.next === null) break;
    url = read.data.next;
  }
  return issues;
}

export async function mergedPulls(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
): Promise<ScheduleMergedPull[] | { skipped: string }> {
  const pulls = await collectPages(
    (page) =>
      githubListPulls(fetchImpl, token, owner, repo, {
        state: 'closed',
        page,
        perPage: SCHEDULE_PER_PAGE,
        timeoutMs: SCHEDULE_TIMEOUT_MS,
      }),
    SCHEDULE_MERGED_PULL_PAGES,
  );
  if (!pulls.ok) return { skipped: `pulls-${pulls.failure.kind}` };
  const merged = pulls.items
    .filter((p) => p.mergedAt !== null)
    .map((p) => ({
      number: p.number,
      title: p.title,
      mergedAt: Date.parse(p.mergedAt ?? '') || 0,
      url: `https://github.com/${owner}/${repo}/pull/${p.number}`,
    }))
    .sort((a, b) => b.mergedAt - a.mergedAt)
    .slice(0, SCHEDULE_MERGED_PULL_LIMIT);
  const collected: ScheduleMergedPull[] = [];
  for (const pull of merged) {
    const raw = await githubPullRaw(fetchImpl, token, owner, repo, pull.number, {
      etag: null,
      timeoutMs: SCHEDULE_TIMEOUT_MS,
    });
    if (raw.kind !== 'ok') return { skipped: 'pull-evidence-unreadable' };
    const body = (raw.body as { body?: unknown } | null)?.body;
    collected.push({ ...pull, body: typeof body === 'string' ? body : '' });
  }
  return collected;
}
