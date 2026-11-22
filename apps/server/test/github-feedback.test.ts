import { expect, test } from 'vitest';
import { githubPrFeedback } from '../src/lib/github-feedback.js';

const PER_PAGE = 100;
const FULL_PAGES = 11;

const commentRow = (id: number) => ({
  id,
  user: { login: 'octo', type: 'User' },
  body: `review note ${id}`,
  created_at: '2026-11-20T00:00:00Z',
});

test('feedback reads follow pagination past the tenth page to the last one', async () => {
  const requested: string[] = [];
  const feedback = await githubPrFeedback(
    async (input) => {
      const url = new URL(String(input));
      requested.push(`${url.pathname}?${url.searchParams.get('page')}`);
      const page = Number(url.searchParams.get('page') ?? '1');
      const body = url.pathname.endsWith('/issues/7/comments')
        ? page <= FULL_PAGES
          ? Array.from({ length: PER_PAGE }, (_, index) =>
              commentRow((page - 1) * PER_PAGE + index + 1),
            )
          : []
        : [];
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
    'ghp_feedback_pages_token',
    'octo',
    'alpha',
    7,
  );
  expect(feedback.comments).toHaveLength(FULL_PAGES * PER_PAGE);
  expect(Math.max(...feedback.comments.map((c) => c.id))).toBe(FULL_PAGES * PER_PAGE);
  expect(feedback.highWater.comment).toBe(FULL_PAGES * PER_PAGE);
  expect(
    requested.filter((entry) => entry.startsWith('/repos/octo/alpha/issues/7/comments')),
  ).toEqual(
    Array.from(
      { length: FULL_PAGES + 1 },
      (_, index) => `/repos/octo/alpha/issues/7/comments?${index + 1}`,
    ),
  );
});
