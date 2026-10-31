import { z } from 'zod';
import { HttpError } from './errors.js';
import type { FetchLike } from './github.js';

const feedbackSchema = z.object({
  id: z.number().int().positive(),
  user: z.object({ login: z.string().min(1) }).nullable(),
  body: z.string().nullable(),
  state: z.string().optional(),
  created_at: z.string().optional(),
  submitted_at: z.string().nullish(),
});

export interface GithubFeedback {
  key: string;
  id: number;
  kind: 'comment' | 'review-comment' | 'review';
  createdAt: number;
  author: string;
  body: string;
}

export const feedbackHighWaterSchema = z.object({
  comment: z.number().int().nonnegative(),
  'review-comment': z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
});

export function isCairnIdentity(login: string): boolean {
  return /^(?:cairn|cairnwright)(?:\[bot\])?$/i.test(login);
}

export async function githubPrFeedback(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ comments: GithubFeedback[]; highWater: z.infer<typeof feedbackHighWaterSchema> }> {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const out: GithubFeedback[] = [];
  const highWater = { comment: 0, 'review-comment': 0, review: 0 };
  for (const [kind, path] of [
    ['comment', `issues/${prNumber}/comments`],
    ['review-comment', `pulls/${prNumber}/comments`],
    ['review', `pulls/${prNumber}/reviews`],
  ] as const) {
    for (let page = 1; ; page += 1) {
      if (page > 10) throw new HttpError(502, 'GitHub feedback pagination incomplete');
      const response = await fetchImpl(`${base}/${path}?per_page=100&page=${page}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'cairn-server',
          authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new HttpError(502, 'GitHub feedback unavailable');
      const rows = z.array(feedbackSchema).parse(await response.json());
      for (const row of rows) {
        highWater[kind] = Math.max(highWater[kind], row.id);
        if (row.user === null || isCairnIdentity(row.user.login)) continue;
        if (kind === 'review' && row.state !== 'CHANGES_REQUESTED') continue;
        const body = row.body?.trim() ?? '';
        if (body === '' && kind !== 'review') continue;
        if (
          /<!--\s*(?:review-gate(?:[-:]|\s)|cairn(?:[-:]|\s)|(?:BEGIN|END) CAIRN-RUNTIME)/i.test(
            body,
          )
        )
          continue;
        out.push({
          key: `${kind}:${row.id}`,
          kind,
          id: row.id,
          createdAt: Date.parse(row.created_at ?? row.submitted_at ?? '') || 0,
          author: row.user.login,
          body: body || 'Changes requested.',
        });
      }
      if (rows.length < 100) break;
    }
  }
  return {
    comments: out.sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key)),
    highWater,
  };
}
